# HOTFIX-5 — Cold-start push notification taps lose their deep-link target

**Source:** Case 2 in Sudhir's June 1 end-to-end test pass. *"After placing order, shopkeeper got notification, I clicked on notification as shopkeeper, it brought me on home page instead of that order."*

**Scope NOT obvious from the symptom:** the symptom Sudhir reported is shopkeeper-specific, but the **root cause affects every cold-start push tap across every role** — customer tapping a delivered push from a closed app, admin tapping a shop-approval push from a closed app, delivery partner tapping a pickup push from a closed app. They all currently land on Home (or default landing) when the app is launched from a fully-closed state by a notification tap. The shopkeeper case is just the one Sudhir noticed first because that flow runs hourly in testing.

**Deploy class:** pure client OTA. No callable, no rules, no `app.json`, no permission, no plugin. Ships via `eas update --branch production`.

**Read first**

1. `CLAUDE.md` (full)
2. `docs/TESTING-FINDINGS-2026-05-30.md` — Case 2 entry (log this as Finding #18 if not yet logged)
3. `docs/pr-next-1-order-status-propagation-windsurf-prompt.md` — PR-NEXT-1 added the existing push routing table in `AuthBootstrap.tsx` lines 211–377. This PR extends the SAME table to also fire on cold-start.
4. `.windsurf/code-discipline.md` (Rules 1, 2)
5. `src/components/AuthBootstrap.tsx`:
   - Lines 1–14 — imports (we add one)
   - Lines 25–384 — the big `useEffect` that holds auth subscription + push routing
   - Lines 211–377 — the existing `addNotificationResponseReceivedListener` callback (the routing logic gets extracted into a named function)
6. `src/navigation/navigationRef.ts` — `safeNavigate` (lines 30–39). Currently warns + drops nav when the container isn't ready, which is exactly what cold-start hits.

---

## Root cause (confirmed end-to-end)

Audit of `src/components/AuthBootstrap.tsx` and `src/navigation/navigationRef.ts`:

```ts
// AuthBootstrap.tsx line 211
const tapSub = Notifications.addNotificationResponseReceivedListener(
  response => { /* routing table */ }
);
```

`addNotificationResponseReceivedListener` fires only for taps that happen AFTER the listener is registered. The Expo docs are explicit: cold-start taps (where the notification tap launches a closed app) are not caught by this listener — they're available via `Notifications.getLastNotificationResponseAsync()` instead. No call to `getLastNotificationResponseAsync` exists anywhere in `src/` (confirmed by `grep -r "getLastNotificationResponseAsync"`).

So:

1. Shopkeeper's app is closed
2. Customer places order → server fires `pushToOwner` with `{ orderId, type: 'new_order_for_shop' }` (functions/src/index.ts:3483-3486 — verified)
3. iOS APNs delivers the push (shopkeeper is on iOS, APNs is working)
4. Shopkeeper taps the notification → OS launches the app, passes the response into the launch intent
5. App boots → AuthBootstrap mounts → registers `addNotificationResponseReceivedListener` (line 211)
6. **Listener was registered AFTER the cold-start response was already consumed by Expo's internal handler**
7. Routing logic at line 299 (`if (type === 'new_order_for_shop') safeNavigate('ShopOrderDetail', { orderId })`) never runs
8. Default landing = Home

**Bonus failure mode** even if we add `getLastNotificationResponseAsync`: `safeNavigate` no-ops when `navigationRef.isReady()` is false (navigationRef.ts:31-38). At cold-start the `NavigationContainer` mounts asynchronously, so a same-tick dispatch from `getLastNotificationResponseAsync().then(...)` may still hit the warn-and-drop branch. Fix needs to wait for both the navigator AND the auth state to be ready.

---

## Plan

Single-file edit in `src/components/AuthBootstrap.tsx`. Two parts:

### §A — Extract the response handler into a named function

Currently the response-handling logic is inline inside `addNotificationResponseReceivedListener`'s callback (lines 211–377, 165+ lines of routing table). Extract it into a named function so it can be called from BOTH the listener and the new cold-start dispatch:

```ts
// Inside the same useEffect — keeps closure access to `unsubscribe` /
// `timer` cleanup. Don't hoist it outside the effect because it
// reads `useAuthStore.getState()` at call time (snapshot at tap
// moment, not at mount).
const handleNotificationResponse = (
  response: Notifications.NotificationResponse,
) => {
  const data = response.notification.request.content.data as
    | Record<string, unknown>
    | undefined;
  const type =
    typeof data?.type === 'string' ? (data.type as string) : undefined;

  // (… entire existing routing table from lines 219–377 goes here,
  //  verbatim. The shop_pending_approval / delivery_request_pending
  //  early returns + the order-routing fallthrough + the audience
  //  precedence + the final OrderDetail fallback all move together.)
};
```

### §B — Dispatch the cold-start response after nav + auth are both ready

Immediately after the handler is defined (still inside the useEffect, before or after the existing listener registration — order doesn't matter):

```ts
// HOTFIX-5 (Case 2 + every other cold-start deep-link)
// ─────────────────────────────────────────────────────
// `addNotificationResponseReceivedListener` only fires for taps that
// occur AFTER registration — cold-start taps (app fully closed when
// the push arrived, user taps to launch) are consumed by Expo
// internally before this useEffect ever runs. The launching response
// is available via `getLastNotificationResponseAsync()`; without this
// call, every cold-start tap silently lands on Home regardless of
// the deep-link target. Affects shopkeeper new-order, customer
// delivered, admin pending-approval, delivery-partner pickup —
// every push type the listener below routes.
//
// Returns null when the app wasn't opened via a tap (normal
// foreground launch / push received while running), so this is a
// no-op for non-tap launches. No risk of double-dispatch with the
// listener: the listener only fires for taps registered AFTER it
// attached.
//
// Race-guard: even with the response in hand, dispatching
// immediately is unsafe because (1) `navigationRef.isReady()` is
// false until the NavigationContainer mounts a few frames later,
// causing `safeNavigate` to warn-and-drop, and (2) audience-mapped
// types (`order_status`, `order_delivered`, `order_cancelled`) read
// `useAuthStore.getState()` for role precedence, which is
// `ready=false` until the auth subscription fires. We poll every
// 100ms for both flags, with a 10s safety ceiling so a stuck launch
// can't leak an interval.
let coldStartDispatched = false;
Notifications.getLastNotificationResponseAsync().then(response => {
  if (!response || coldStartDispatched) return;

  const startedAt = Date.now();
  const TIMEOUT_MS = 10_000;
  const POLL_MS = 100;

  const tryDispatch = () => {
    if (coldStartDispatched) return;
    const auth = useAuthStore.getState();
    if (navigationRef.isReady() && auth.ready) {
      coldStartDispatched = true;
      handleNotificationResponse(response);
      return;
    }
    if (Date.now() - startedAt > TIMEOUT_MS) {
      // Safety net — don't poll forever. If we couldn't dispatch
      // within 10s the app is in some unusual state (locked SIM,
      // anonymous auth thrash, navigator never mounting). Log so
      // Sentry can surface a recurring failure pattern.
      console.warn(
        '[AuthBootstrap] cold-start deep-link timed out waiting for nav+auth ready',
        { type: response.notification.request.content.data?.type },
      );
      return;
    }
    setTimeout(tryDispatch, POLL_MS);
  };
  tryDispatch();
});
```

Add the navigationRef import at the top of the file:

```ts
import { navigationRef } from '../navigation/navigationRef';
```

(Carry the standard "DO NOT REMOVE" comment matching local discipline if other imports use it.)

### §C — Replace the inline listener callback with the named function

Where the existing `addNotificationResponseReceivedListener` is registered (line 211), simply pass the named function instead of the inline arrow:

```ts
const tapSub = Notifications.addNotificationResponseReceivedListener(
  handleNotificationResponse,
);
```

All 165 lines of inline routing become this one line. The cleanup at line 382 (`tapSub.remove()`) stays unchanged.

---

## Why the race-guard polls instead of using onReady / useEffect dependencies

Three reasons:

1. **`NavigationContainer.onReady` lives on the JSX prop**, not on the imperative ref. We'd need to thread state through props or use a separate event, both of which spread the side-effect across multiple files. The polling stays in one place.

2. **`useAuthStore.subscribe` would work** for the auth-ready half, but adding it just for cold-start dispatch couples the cold-start logic to the auth subscription's emission timing, which is fragile (anon → real-uid upgrade, sign-out re-auth, etc.). Polling on the same tick is cheaper than orchestrating two reactive sources.

3. **The polling cost is bounded:** at most 100 ticks (10s), each tick reads two synchronous booleans. Once the app is past mount, the loop exits in 1-2 ticks (~200ms). Imperceptible to the user. Compare to a missed deep-link (the current state): the user gives up on the app being able to do this and stops tapping notifications.

If a future PR wants to reactify this, the obvious pattern is a `useColdStartNotificationResponse` hook that reads the response, then uses `useEffect([nav-ready, auth-ready])` to dispatch. Out of scope for HOTFIX-5; current shape is straightforward and ships immediately.

---

## What about the dedup concern?

`getLastNotificationResponseAsync` returns the response that ORIGINALLY launched the app. `addNotificationResponseReceivedListener` fires for taps that happen AFTER registration. In every case I've tested in the Expo docs + community threads:

- Cold-start tap → `getLastNotificationResponseAsync` returns it; listener does NOT fire for the same tap
- Warm-start tap → `getLastNotificationResponseAsync` returns null (or returns the cold-start response from an earlier launch, but the dedup flag `coldStartDispatched` blocks re-handling); listener fires
- App opened normally, no notification → both return null / never fire

The `coldStartDispatched` flag is belt-and-braces for the rare case where Expo returns a stale-from-earlier response on a non-tap warm boot. Catches any double-dispatch path that might exist on specific Android OEMs without changing happy-path semantics.

---

## Discipline checklist

1. **Rule 1 — Imports stay.** New `navigationRef` import in AuthBootstrap with explicit "DO NOT REMOVE" comment.
2. **Rule 2 — Hooks above conditionals.** The `useEffect` is already at the top of the component; the new `getLastNotificationResponseAsync` call lives inside it. No new hooks.
3. **No schema, no callable, no helper change.** Pure client-side lifecycle plumbing.
4. **No new tests.** This is a runtime-orchestration fix; the response-routing logic is unchanged. Manual acceptance covers it.
5. **OTA classification.** Pure JS. No `app.json`, no permission, no plugin. OTA-safe.

---

## Acceptance checklist

Two test devices minimum (one to send pushes from, one to receive). Push notifications are inherently cross-device.

**Primary fix — Case 2 (shopkeeper cold-start new-order):**

1. Shopkeeper device (iOS — APNs working): force-quit the app completely (swipe up + swipe app away on iOS, or Settings → Apps → Force Stop on Android if testing there once FCM clears).
2. From customer device, place a fresh order at the shopkeeper's shop.
3. Shopkeeper's device receives a push notification while the app is fully closed.
4. Shopkeeper taps the push.
5. App launches and routes **directly to ShopOrderDetail for that order** — NOT to Home. **The bug Sudhir reported is fixed.**

**Regression — warm-start still works:**

6. Shopkeeper opens app, then sends it to background (swipe up / home button). App is suspended but not killed.
7. Customer places another order.
8. Shopkeeper receives push, taps it.
9. App resumes and routes to ShopOrderDetail. (This was already working before HOTFIX-5; confirm it still works.)

**Generalized fix — other roles cold-start:**

10. Customer cold-start delivered tap (once FCM is fixed for Android): walk an order through to delivered, customer taps the delivered push from a closed app → lands on customer OrderDetail. While FCM is broken on Android, test this on iOS customer if you have one.
11. Admin cold-start pending-approval tap: shop submits KYC, admin's app is closed, admin taps the push → lands on ShopRegistrationDetail.
12. Delivery partner cold-start new-pickup tap: shop marks ready, partner's app closed, partner taps → lands on DeliveryOrderDetail.

**Edge cases:**

13. Cold-start tap then immediate swipe-out: app launches via tap, partner sees the right screen flash, swipes app out. Reopen normally (not from notification) → app opens to default landing as expected (the 10s polling has long expired; no leaked timer).
14. Two notifications stacked, tap the older one: app launches to the older notification's deep-link. (Expo returns the most-recently-tapped response.)
15. Cold-start tap with a malformed push (missing `data.type` or `data.orderId`): app launches, the routing function returns early without crashing or navigating, app shows default landing. (Same behavior as the existing inline listener for malformed pushes.)

**Test suite (no changes expected):**

16. `npx tsc --noEmit` clean
17. `npm run test:unit` clean (no new tests; no existing tests cover lifecycle plumbing)

---

## Out of scope (explicit deferrals)

- **Migrating to `Notifications.useLastNotificationResponse()` hook** — same diagnostic, more reactive. Defer; current polling is the cleanest shape for the existing useEffect architecture.
- **Sentry alerting on cold-start timeout** — the 10s timeout log is `console.warn`. If the timeout fires repeatedly in production, add Sentry capture as a follow-up.
- **Audience-precedence improvements** for cold-start cases where auth state is uncertain. The current logic reads `useAuthStore.getState()` at dispatch time, which is correct after the polling waits for `auth.ready`. If a user's role flags change between the response being captured and the dispatch, they get the routing they'd get for their CURRENT role — that's the right semantics.
- **Deep-link to specific tabs / nested stacks within a detail screen** — out of scope; the existing routing table already targets the right top-level screens.

---

## Deploy plan

Pure client OTA:

```
npx tsc --noEmit          # clean
npm run test:unit         # all green; suite unchanged
git commit -m "HOTFIX-5: cold-start push deep-link (Case 2 + every cold-start tap)"
eas update --branch production --message "HOTFIX-5 cold-start push deep-link"
```

Pull on shopkeeper iOS device → run steps 1–5 of the acceptance checklist. The fix lands immediately for any role tapping any push from a closed app.

---

## Doc trail updates after ship

- `docs/TESTING-FINDINGS-2026-05-30.md` — log Case 2 as Finding **#18** (or whichever number is next) and immediately flip to `✅ SHIPPED in PR-NEXT-HOTFIX-5 (June 1 2026)` with a one-paragraph note covering the cold-start vs warm-start asymmetry + the nav-ready/auth-ready polling. Note that the fix affects every push type, not just `new_order_for_shop`.
- `docs/SESSION_LOG.md` — one-paragraph entry covering the diagnosis (cold-start tap consumed before listener attaches; `safeNavigate` no-ops on cold-start race), the extracted `handleNotificationResponse` function, the polling-with-timeout dispatch pattern.
- `CLAUDE.md` — bump date.
- `PRELAUNCH_CHECKLIST.md` — short addendum under PR-NEXT-1's push-routing block noting cold-start was a gap until HOTFIX-5.
