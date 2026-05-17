# PR 3 — Concurrency cleanup (Windsurf prompt)

## Why this PR exists

Code review on May 17 2026 surfaced four concurrency / error-handling
gaps. None are launch blockers individually, but together they cause
real user-visible bugs that surface within the first week of any
multi-user deployment:

1. `OrdersScreen` swallows fetch failure → customers with real orders
   see "No orders yet" empty state. Confidence-destroying.
2. **Optimistic rollback races** overwrite concurrent watcher ticks
   in three places (`useShopOrderDetail.ts`,
   `DeliveryDashboardScreen` `handleDelivered`/`handlePickedUp`).
   Bug: customer / shop / delivery role taps a status button, the
   API call fails, rollback fires — and the rollback blindly
   overwrites whatever the 5-10s polling watcher just installed in
   between. Worst case: rollback undoes a successful concurrent
   state transition.
   *(Note: `AdminOrdersScreen.handleAction` had the same bug class
   but was patched during PR 2 testing with the self-healing
   paid-cancel intercept. The pattern there is correct — copy from
   it.)*
3. `ShopMenuScreen` silent fetch error → shop owner sees empty menu,
   might re-add duplicates of items they think are missing.
4. **Role revocation mid-session has no UX.** When admin revokes a
   user's shopOwner / delivery claim while they have the relevant
   dashboard open, the next watcher tick returns `permission-denied`
   but the UI keeps trying. `useAuthStore` still has stale role
   flags until next app restart, so the user keeps tapping a dead
   dashboard.

Plus one tag-along bug already noted in the code review:

5. `useOnlineDeliveryCount` keeps stale value forever on permanent
   error → admin sees a number that's no longer real.

This PR fixes all five. Pure client-side. No Cloud Functions, no
rules, no indexes. JS-only OTA at the end.

## Read first

- `.windsurf/test-discipline.md` — tests run **once at end** + the
  deliberate-break demo. `npm test` is the runner.
- `.windsurf/deploy-discipline.md` — OTA-only PR; no firebase deploys.
- `src/screens/admin/AdminOrdersScreen.tsx` — the **reference
  pattern** for items 1 & 2. Has both the error-state-with-retry-
  banner AND the post-fix self-healing intercept after an optimistic
  rollback. Copy from this file's posture.
- `src/services/orderService.ts` — watcher contract: every `watch*`
  cb is called as `cb(data, undefined)` on success and
  `cb(empty, error)` on failure. Established post-loader-spin
  hotfix. Don't break it.
- `src/services/authService.ts` — has `refreshClaims()` that returns
  the refreshed user object. Used in `WaitingForApprovalScreen` and
  `DeliveryApprovalWaitingScreen` already.

## Scope (in)

### 1. `OrdersScreen` error state

`src/screens/OrdersScreen.tsx`:

- Add `const [error, setError] = useState<string | null>(null);`.
- In `listMyOrders` catch block, set the error message and DON'T
  flip `orders` to `[]` (preserve whatever data we had if any).
- Render an error banner above the FlatList (mirror
  `AdminOrdersScreen`'s `styles.errorBanner` + Retry button —
  same shape, same styles).
- `ListEmptyComponent`: hide the "Place your first order" CTA if
  `error` is set — show "Couldn't load orders. Tap Retry." instead.
- Retry pattern: `setRetryNonce(n => n + 1)` + include `retryNonce`
  in `useEffect` deps (mirror AdminOrdersScreen lines ~57, ~141).

### 2. `ShopMenuScreen` error state

`src/screens/shop/ShopMenuScreen.tsx`:

Same shape as #1 — `error` state, banner above the FlatList, hide
empty CTA when error is set. Retry calls `fetchOnce()`. Don't
collapse the existing `items` array on error (so a transient blip
doesn't make a shop owner think their menu is empty).

### 3. Optimistic rollback races — 3 sites, 1 pattern

Establish a small pure helper that codifies the "is it safe to
rollback?" check:

**New helper** `src/utils/optimisticRollback.ts`:
```ts
/**
 * Should we rollback an optimistic state mutation?
 *
 * Returns true iff the current state still matches the optimistic
 * value we wrote — i.e. no concurrent watcher tick has installed a
 * different (and presumably authoritative) value in the meantime.
 * If something else has happened, trust the watcher: it saw the
 * server state and we should not overwrite it with stale captured
 * data.
 *
 * Used by all client-side optimistic-update sites in the dashboards
 * (AdminOrders, useShopOrderDetail, DeliveryDashboard handlePickedUp
 * / handleDelivered). Extracted so the race-condition reasoning lives
 * in one place and can be unit-tested without touching React.
 */
export function shouldRollbackOptimistic<T>(
  currentValue: T,
  optimisticValue: T,
): boolean {
  return currentValue === optimisticValue;
}
```
(Yes it's tiny. The point is the *contract* — the test file and the
comment block — not the implementation. We're documenting an
invariant that's easy to violate.)

Add `tests/utils/optimisticRollback.test.ts` with:
- "returns true when current still matches optimistic (no concurrent change)"
- "returns false when current differs (watcher installed something else; don't clobber)"
- "uses strict equality (no deep comparison)"

**Apply the helper at 3 sites:**

a. `src/screens/shop/ShopOrderDetailScreen.useShopOrderDetail.ts`
   (lines ~158-179): in the catch block, only call
   `setState(prev => applyOptimisticStatus(prev.order, previousStatus))`
   if `shouldRollbackOptimistic(prev.order?.status, optimisticStatus)`.
   Otherwise, log a console.warn (`[useShopOrderDetail] rollback
   suppressed — watcher already updated`) and skip the rollback.

b. `src/screens/delivery/DeliveryDashboardScreen.tsx`
   `handlePickedUp` (lines ~181-201): currently sets
   `setMine(prev => prev.map(o => o.id===order.id ? {...o, pickedUpAt:null} : o))`
   on failure — literal-null rollback. Use the helper: only revert
   if the current pickedUpAt is still the optimistic value we set.

c. `src/screens/delivery/DeliveryDashboardScreen.tsx`
   `handleDelivered` (lines ~207-228): same fix posture.

For each: capture the pre-optimistic value at the START of the
handler (before `setState`), pass to the catch block, check via the
helper before rolling back. Mirror AdminOrdersScreen's
`previousOrders` capture pattern (line ~77).

### 4. Role revocation mid-session UX

When `permission-denied` or `unauthenticated` arrives via a watcher
callback or fetch failure, the user's claim was probably revoked.
Refresh claims + update the auth store so the role-guard EmptyState
kicks in and routes them out.

**New helper** `src/utils/handleRoleAuthError.ts`:
```ts
/**
 * Detects "your claim was revoked" type errors (permission-denied,
 * unauthenticated) coming back from a watcher or callable, and
 * refreshes the client's auth state so stale role flags drop. Used
 * by shop / delivery dashboards. Returns true iff the error was
 * recognized + claim refresh was attempted.
 *
 * Doesn't navigate — the screen's own role-guard render branch will
 * show the EmptyState on the next render after auth store updates.
 */
export async function handleRoleAuthError(
  err: unknown,
  refreshClaims: () => Promise<unknown | null>,
  setUser: (u: unknown) => void,
): Promise<boolean> { ... }
```

Pure helper with tests in `tests/utils/handleRoleAuthError.test.ts`:
- "recognizes functions/permission-denied"
- "recognizes permission-denied (no prefix)"
- "recognizes unauthenticated"
- "ignores other errors"
- "calls setUser with refreshed user when claim refresh succeeds"
- "doesn't throw if refreshClaims rejects"

Apply at:
- `src/screens/shop/ShopOwnerDashboardScreen.tsx` (in watcher's err
  branch, before / instead of the existing error banner)
- `src/screens/delivery/DeliveryDashboardScreen.tsx` (same)
- `src/screens/shop/ShopMenuScreen.tsx` (in `fetchOnce` catch block)

UX: when handleRoleAuthError returns true, show a one-line message
"Your role was changed. Refreshing..." for ~1s, then the screen will
naturally re-render through the role-guard branch and show the
"Shop owner access required" / "Delivery access required"
EmptyState. No need for explicit navigation.

### 5. `useOnlineDeliveryCount` stale-value fix

`src/hooks/useOnlineDeliveryCount.ts`:

Add a consecutive-failure counter. After 3 consecutive failed
polls, set `count` to null (matching the "loading / error"
placeholder). Reset the counter to 0 on any successful poll.

Don't refactor the polling shape — just add the counter. Tests in
`tests/hooks/useOnlineDeliveryCount.test.ts` (file may not exist
yet — create it):
- "starts with count = null"
- "updates count on successful poll"
- "keeps last-known count on transient single failure"
- "clears count to null after 3 consecutive failures"
- "resets failure counter on next successful poll"

## Scope (out — explicitly defer)

- **Don't refactor the watcher contract itself.** The
  `cb(data, undefined)` / `cb(empty, error)` posture is correct.
  This PR just makes the *callers* handle errors better.
- **Don't add a global error boundary.** That's a different
  refactor. Per-screen error state + banner is the established
  pattern; stay consistent.
- **Don't migrate to React Query / SWR / Tanstack Query.** The
  zustand + custom polling is small enough that a library dependency
  isn't worth the bundle bloat for MVP.
- **Don't try to deduplicate the 3 optimistic-rollback sites into
  one custom hook.** Their shapes differ enough (state structures,
  what gets mutated) that extracting a generic hook would obscure
  more than it saves. Just use the small helper for the predicate.

## Acceptance checklist

- [ ] `OrdersScreen` has an error state + retry banner + empty-CTA
      suppression when error is set.
- [ ] `ShopMenuScreen` has the same.
- [ ] `optimisticRollback.ts` helper exists, applied at all 3
      sites (useShopOrderDetail, DeliveryDashboard ×2). Each site
      uses the helper to gate its rollback.
- [ ] `handleRoleAuthError.ts` helper exists, applied at all 3
      sites (ShopOwnerDashboard, DeliveryDashboard, ShopMenuScreen).
- [ ] `useOnlineDeliveryCount` has consecutive-failure counter that
      clears `count` to null after 3 strikes.
- [ ] All 3 helpers have pure-function tests (≥3 each — expect
      ~10-12 new tests total).
- [ ] `npm test` passes — total ≥ baseline + new tests.
- [ ] Deliberate-break demo: weaken `shouldRollbackOptimistic` to
      always return true (the buggy "blind rollback" behavior).
      Confirm a test fails by name. Revert.
- [ ] `npx tsc --noEmit` — 0 new errors (baseline preserved).
- [ ] `npm run audit:indexes` passes (no new queries; expect no
      change).

## Deploy plan (hand to user — NOT executed)

OTA-only.

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
eas update --branch preview --message "PR 3: concurrency cleanup"
```

After the OTA, force-reload the app on a test phone. Smoke tests:

1. **Customer side**: kill network for 5s, open Orders, see "Couldn't
   load — Tap Retry" instead of "No orders yet". Restore network,
   Retry → orders load.
2. **Shop owner side**: same shape on Menu — kill network briefly,
   confirm error banner instead of empty-list trap.
3. **Optimistic rollback**: hard to reproduce without a flaky
   network simulator. Manual repro by toggling airplane mode during
   the 1-2s window of an Accept / Mark Picked Up / Mark Delivered
   action — verify the optimistic state survives transient errors
   without weird overwrites.
4. **Role revocation**: have admin Device A open AdminOrders →
   revoke shopOwner from a test account. Device B (the revoked
   user) was on ShopOwnerDashboard. Within the next watcher cycle
   (~10s), Device B should auto-route to the "Shop owner access
   required" EmptyState without the user navigating.

If all four smoke tests pass:
```powershell
eas update --branch production --message "PR 3: concurrency cleanup"
```

## Reporting back

- Output of `npm test` (one final run per discipline).
- Output of `npx tsc --noEmit` (error count, baseline vs new).
- Deliberate-break demo: test name that failed, file/line you
  weakened, confirmation of revert.
- List of new files + line counts.
- Per-site notes for the 3 optimistic-rollback applications: which
  state field is being guarded, which previous value is captured,
  any edge cases noticed.
- The deploy commands handed back — NOT executed.

## Design notes for Windsurf

- The pattern of small pure helpers + per-screen wiring + per-helper
  test file is the established posture. Don't reach for bigger
  abstractions.
- The auto-formatter import-stripping issue (documented in PRs 1, 2,
  12c) will try to drop newly-added imports of the helpers. After
  every save, grep the file to confirm imports survived.
- All 5 fixes are independent — if you hit a snag on one, ship the
  others. They don't share state.
- The deliberate-break target is `shouldRollbackOptimistic` because
  it's the smallest helper with the biggest blast radius: if it's
  wrong, all 3 dashboards lose their race-condition protection. A
  test like "returns false when current differs" failing is the
  right signal.
