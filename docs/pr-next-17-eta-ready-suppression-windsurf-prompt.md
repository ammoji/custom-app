# PR-NEXT-17 — Suppress ETA countdown once status hits `ready_for_pickup`

**Source:** Finding **#17** in `docs/TESTING-FINDINGS-2026-05-30.md` — surfaced by Sudhir during testing of PR-NEXT-13a. Customer's `OrderDetailScreen` renders TWO conflicting lines once the shop marks the order ready:

1. Top status block: `Ready — Partner is picking up` (correct, post-PR-NEXT-1 unified status display)
2. Below it: `Pickup ready in X minutes` / `Pickup ready X minutes ago` (the `ready_by` ETA countdown — now stale and contradictory)

The countdown was the shop's expected-ready time. Once the order IS ready, counting time-since-ready is meaningless and the "ago" wording reads like the system is contradicting itself.

**Naming note:** Closes finding #17. PR is the 17th in the testing-findings work; not related to any earlier "17" in the codebase.

**Deploy class:** **pure client OTA.** No callable, no rules, no `app.json`, no permission. Ships via `eas update --branch production` alone.

**Read first**

1. `CLAUDE.md` (full)
2. `docs/TESTING-FINDINGS-2026-05-30.md` — finding #17 entry (the hypothesis already names the fix site)
3. `docs/pr-next-1-order-status-propagation-windsurf-prompt.md` — parent PR; explains the `pickedUpAt`-aware `hidden` branch that PR-NEXT-1 added for finding #10. This PR extends the same pattern to one more state.
4. `.windsurf/code-discipline.md` (Rules 1, 2)
5. `src/utils/orderEtaDisplay.ts` — the state machine. Lines 75–132. The single new branch lands here.
6. `tests/utils/orderEtaDisplay.test.ts` lines 65–74 — the existing test that pins the OLD behavior (`ready_for_pickup` + readyByEstimate → `ready_by`). Must flip to expect `hidden`.
7. `src/screens/OrderDetailScreen.tsx` lines 365–409 — the customer render branch that consumes `etaDisplay.kind`. Should require ZERO changes (the new `hidden` return from the helper makes the JSX naturally skip the countdown).
8. PR-NEXT-13a's `PartnerIdentityCard` at `src/components/order/PartnerIdentityCard.tsx` — context, not modified. Once a partner claims, this card renders alongside the suppressed countdown — clean fresh-context replacement.

---

## Root cause (one read confirmed)

`orderEtaDisplay` in `src/utils/orderEtaDisplay.ts` runs through this order:

1. `delivered`/`cancelled` → `hidden` ✅
2. `pickedUpAt != null` → `hidden` ✅ (PR-NEXT-1 caught this for finding #10)
3. `status === 'pending'` → `awaiting_confirmation` ✅
4. `readyByEstimate` is a valid number → `ready_by` ⬅️ **bug: this catches `ready_for_pickup` too**
5. `estimatedDeliveryAt` fallback → `eta_fallback` / `arriving_soon`
6. else → `hidden`

Step 4 doesn't filter on status. When the order is `ready_for_pickup` with `pickedUpAt` still null (the post-shop-ready, pre-partner-pickup window — which can last 5–30 minutes), step 4 fires and returns the countdown. As the wall clock ticks past `readyByEstimate`, the countdown copy switches from "Pickup ready in X min" to "Pickup ready X min ago" — meaningless once the order is actually ready.

PR-NEXT-1 fixed the post-pickup case (step 2). This PR closes the matching gap for the post-ready case.

---

## Plan

### §A — Add one branch to `orderEtaDisplay`

In `src/utils/orderEtaDisplay.ts`, insert AFTER the `pickedUpAt` branch (after line 89) and BEFORE the `pending` branch (before line 96):

```ts
// Finding #17 — once the shop marks the order ready_for_pickup, the
// "Pickup ready in/ago" countdown loses meaning. The order IS
// ready; counting time-since-ready creates the stale
// "Pickup ready 5 min ago" message that contradicts the chip's
// post-claim "Ready — Partner is picking up" label.
//
// Pre-partner-claim window (ready_for_pickup, deliveryPersonId
// still null): the chip alone signals "ready, awaiting partner."
//
// Post-partner-claim window (ready_for_pickup, deliveryPersonId
// set, pickedUpAt still null): the chip + PR-NEXT-13a's
// `PartnerIdentityCard` carry the fresh context.
//
// Post-pickup window (pickedUpAt != null): handled by the earlier
// branch above (PR-NEXT-1).
if (order.status === 'ready_for_pickup') {
  return { kind: 'hidden' };
}
```

That's the entire server-side / helper change. The status check is what we need — `deliveryPersonId` is NOT in `EtaInput` today and we deliberately keep it out: the post-claim and pre-claim variants both produce the same suppression decision, so dragging a new field into the state machine adds no value.

**Order of branches matters.** The new branch must come AFTER `pickedUpAt != null` (the earlier branch is more specific — caught the in-transit case) and AFTER `delivered/cancelled` (terminal-state handler). It can go before OR after the `pending` branch since the two conditions are mutually exclusive; putting it right after the `pickedUpAt` branch keeps the "in-flight progression" branches together and the "non-progression" branches (pending, hidden fallbacks) at the bottom.

### §B — Update the existing test + add one new test

In `tests/utils/orderEtaDisplay.test.ts`:

**B.1 — Flip the existing test at line 65–74:**

```ts
test('ready_for_pickup order returns hidden (finding #17 — countdown stale once ready)', () => {
  // Finding #17 — pre-fix this returned `ready_by` and the customer
  // saw a contradictory "Pickup ready X min ago" countdown alongside
  // the chip's "Ready — Partner is picking up" label. Post-fix the
  // ETA slot stays empty and the chip + PR-NEXT-13a's
  // PartnerIdentityCard carry the fresh context.
  const order: EtaInput = {
    status: 'ready_for_pickup',
    readyByEstimate: NOW + 5 * MIN,
  };
  expect(orderEtaDisplay(order, NOW)).toEqual({ kind: 'hidden' });
});
```

**B.2 — Add a second new test for the elapsed case** (the one Sudhir actually saw):

```ts
test('ready_for_pickup order whose readyByEstimate is in the past also returns hidden (finding #17)', () => {
  // The "Pickup ready 5 minutes AGO" symptom Sudhir reported: the
  // shop marked ready, the readyByEstimate moment passed, and the
  // countdown flipped to elapsed time. Suppression applies
  // regardless of whether readyByEstimate is in the past or future.
  const order: EtaInput = {
    status: 'ready_for_pickup',
    readyByEstimate: NOW - 5 * MIN,
  };
  expect(orderEtaDisplay(order, NOW)).toEqual({ kind: 'hidden' });
});
```

**B.3 — Add a regression-anchor test** to make sure we didn't accidentally suppress for the earlier states:

```ts
test('accepted order with readyByEstimate still returns ready_by (regression: only ready_for_pickup is suppressed)', () => {
  const order: EtaInput = {
    status: 'accepted',
    readyByEstimate: NOW + 10 * MIN,
  };
  expect(orderEtaDisplay(order, NOW)).toEqual({
    kind: 'ready_by',
    readyByEstimate: NOW + 10 * MIN,
  });
});

test('preparing order with readyByEstimate still returns ready_by (same regression check)', () => {
  const order: EtaInput = {
    status: 'preparing',
    readyByEstimate: NOW + 10 * MIN,
  };
  expect(orderEtaDisplay(order, NOW)).toEqual({
    kind: 'ready_by',
    readyByEstimate: NOW + 10 * MIN,
  });
});
```

(The existing tests at lines 42 + 54 already cover accepted/preparing → `ready_by` for current/recent readyByEstimate values, but the regression anchors above pin the contract explicitly against the new branch.)

Net test delta: +3 (one flip from `ready_by` → `hidden`, one new elapsed-time test, one new regression anchor pair).

### §C — Verify the render-site needs no change

`src/screens/OrderDetailScreen.tsx` line 387–401 already does `etaDisplay.kind === 'ready_by'`. When the helper returns `hidden`, none of the four render branches (`awaiting_confirmation`, `ready_by`, `eta_fallback`, `arriving_soon`) fire — the whole "pickup ETA" View just renders empty for that state. No JSX changes needed. Confirm by reading the render block end-to-end after the helper change; if any non-conditional Text or sub-layout exists in that block, you'd need to gate it too, but per my read it's all `{etaDisplay.kind === '...' && (...)}` branches.

Same for `OrderConfirmationScreen` and `ActiveOrdersRail` (the other two callers per `src/utils/orderEtaDisplay.ts` lines 17–21) — they consume the same kind-based render dispatch. Sweep them briefly: confirm no non-conditional render path that would surface a stale message after the `hidden` return.

---

## Discipline checklist

1. **Rule 1 — Imports stay.** No new imports.
2. **Rule 2 — Hooks above conditionals.** N/A — helper-only change.
3. **No schema, no callable, no helper extraction.** Single-branch addition to existing helper.
4. **Test discipline.** §B adds 3 new tests + flips 1 existing → +3 net suite count.
5. **OTA classification.** Pure JS. No `app.json`, no permission, no plugin. OTA-safe.

---

## Acceptance checklist

Need one customer device + one shop owner + one delivery partner. Pilot smoke flow.

**Primary fix (the bug Sudhir reported):**

1. Customer places an order. Shop accepts → marks Preparing. Customer's OrderDetailScreen shows `Pickup ready in X min` countdown (existing behavior). ✅
2. Shop marks `ready_for_pickup`. Customer's chip should flip to the post-PR-NEXT-1 ready-state label (`Ready for pickup` or `Ready — waiting for partner` depending on which copy the chip helper produces for the no-partner-yet case). The "Pickup ready in/ago" countdown line **disappears entirely**. No stale "Pickup ready 0 min ago" copy.
3. Wait a minute, refresh the screen. Countdown stays suppressed. No "Pickup ready 1 min ago" creep.
4. Partner accepts the pickup. Chip flips to `Ready — Partner is picking up` (post-PR-NEXT-1). `PartnerIdentityCard` (PR-NEXT-13a) appears with `📦 Heading to the shop` subtitle. Countdown still suppressed. **No double-line contradiction.** ← the original symptom is gone.
5. Partner taps "I've picked it up." Chip flips to `Out for delivery`. PartnerIdentityCard subtitle flips to `🛵 On the way to you`. Countdown still suppressed (already hidden by the pre-existing `pickedUpAt` branch).

**Regression — earlier states still show countdown:**

6. Place a second order. Shop accepts → marks Preparing. Customer's countdown reads `Pickup ready in X min` correctly. **The fix did not collapse the accepted/preparing-state copy.**
7. Watch the countdown tick. As `readyByEstimate` approaches, the copy stays meaningful. ✅

**Regression — terminal states still hidden:**

8. Same order from step 5: partner taps Delivered. Customer's countdown stays suppressed. PartnerIdentityCard handling unchanged.
9. Cancel a different order (within the 2-min window). Customer's countdown stays suppressed. Chip says Cancelled.

**Other surfaces — no regression:**

10. ActiveOrdersRail on HomeScreen: an in-flight `ready_for_pickup` order in the rail now hides its ETA cell entirely. The rail card still renders order + shop + tap-to-detail correctly.
11. OrderConfirmationScreen: same fix flows through. An order placed and quickly marked ready (rare but possible during pilot testing) hides the countdown.

**Test suite:**

12. `npx tsc --noEmit` clean
13. `npm run test:unit` clean; suite count up by 3 (one flip + two new tests + one regression anchor pair = net +3).

---

## Out of scope (explicit deferrals)

- **Replacing the suppressed countdown with a fresh-context message** like `Ready — waiting for delivery partner`. The current chip already carries that signal; the PartnerIdentityCard fills the slot once a partner claims. A fresh sub-line below the chip could be added in a follow-up if pilot feedback asks for it, but v1 is "stop the contradiction, render nothing extra."
- **Distinguishing pre-claim vs post-claim ready states** (e.g. show countdown only pre-claim, hide post-claim). The state machine deliberately treats both the same way — both produce the same suppression decision and the visual difference is already carried by the PartnerIdentityCard appearing/disappearing.
- **Adding `deliveryPersonId` to `EtaInput`.** Would unlock more granular branching but no current branch needs it. Keep the type narrow.
- **Refactoring `OrderStatusChip` copy** for the post-ready states. The chip handles its own copy via `displayOrderStatus()` (PR-NEXT-1) — this PR doesn't touch that surface.

---

## Deploy plan

Pure client OTA:

```
npx tsc --noEmit            # clean
npm run test:unit           # all green; suite count +3
git commit -m "PR-NEXT-17: suppress ETA countdown once ready_for_pickup (finding #17)"
eas update --branch production --message "PR-NEXT-17 ETA suppression on ready_for_pickup"
```

Pull on customer device → walk through steps 1–11 of the acceptance checklist.

---

## Doc trail updates after ship

- `docs/TESTING-FINDINGS-2026-05-30.md` — flip finding **#17** to `✅ SHIPPED in PR-NEXT-17 (June 1 2026)` with a one-paragraph note: one-branch fix in `orderEtaDisplay`, mirrors PR-NEXT-1's `pickedUpAt`-aware suppression pattern.
- `docs/SESSION_LOG.md` — append the standard one-paragraph entry covering the state-machine single-branch addition, the test flip + 3 new tests, the deliberately-narrow `EtaInput` type (no `deliveryPersonId` needed), and the cross-reference to PR-NEXT-1's matching `pickedUpAt` branch.
- `CLAUDE.md` — bump date.
- `PRELAUNCH_CHECKLIST.md` — short note under PR-NEXT-13a's block.
