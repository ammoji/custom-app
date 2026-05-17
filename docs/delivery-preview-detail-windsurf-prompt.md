# Delivery Preview Detail — Windsurf prompt

## Why this PR exists

Parallel to the Shop Order Detail PR. Solo testing found that
delivery partners can't see what's inside an available pickup
before tapping Accept — only shop name, drop area, item count,
total. That's not enough to decide whether to claim the run (e.g.
a partner who doesn't carry refrigerated goods needs to see if the
order has dairy; a partner who avoids alcohol needs to see brand
names).

Same architectural pattern as the shop owner fix: make the card
tappable, navigate to a detail screen with full item list +
customer address + payment method, and let the delivery partner
claim from either the dashboard card OR the detail screen.

The existing `DeliveryOrderDetailScreen` already handles a
read-only "non-assigned" branch for post-claim views — we extend it
to handle the **unclaimed-available** state too, with a Claim
button at the bottom.

## Read first

- **`.windsurf/test-discipline.md`** — tests run **once at end** +
  deliberate-break demo. `npm test` is the runner.
- `src/screens/delivery/DeliveryDashboardScreen.tsx` — the
  dashboard with `AvailablePickupCard` (currently not tappable)
  and `ActiveDeliveryCard` (already tappable, navigates to detail)
- `src/screens/delivery/DeliveryOrderDetailScreen.tsx` — the
  detail screen. Has `isAssigned = order.deliveryPersonId === uid`
  branch and read-only-ish layout for non-assigned. Lacks a
  Claim/Accept button — we add it.
- `src/services/orderService.ts` — `claimDelivery`, `watchOrder`
  already exist
- `firestore.rules` — the available-pickup read clause already
  allows `(isDeliveryPerson() && status == 'out_for_delivery' &&
  deliveryPersonId == null)`. No rule changes needed.

## Scope (in)

1. **`DeliveryDashboardScreen`** — wrap each `AvailablePickupCard`
   body in a `Pressable` that navigates to `DeliveryOrderDetail`
   with `orderId`. Keep the existing Accept button on the card for
   the quick-action path (matches the shop owner card pattern).
   Ensure tapping the Accept button does NOT also navigate
   (`e.stopPropagation()` or separate touchable hierarchy).

2. **`DeliveryOrderDetailScreen`** — extend the existing logic:
   - Compute `isAvailableForClaim = !isAssigned &&
     order.status === 'out_for_delivery' && order.deliveryPersonId
     === null && isDelivery`
   - When `isAvailableForClaim`, render an **"Accept this pickup"**
     primary button at the bottom (mirrors the dashboard's
     `handleClaim` flow): calls `orderService.claimDelivery({
     orderId })`, optimistic re-fetch via `listMyDeliveries`,
     navigates back to dashboard on success, surfaces an error
     Alert on race-claim failure.
   - When `isAssigned` and not yet delivered: existing
     pickup/delivered buttons stay as-is.
   - When `isAssigned` and delivered: existing "Delivered" green
     card stays as-is.
   - When NOT assigned, NOT available (e.g. order is now
     `delivered` or claimed by someone else mid-view): show a
     terminal-state EmptyState ("This pickup was claimed by another
     partner" / "This order is already delivered"). Server enforces
     this anyway via `claimDelivery` returning an error, but the
     UI should reflect terminal state without requiring a tap.
   - Header title: "Pickup details" when available-for-claim,
     "Delivery details" when assigned. Small but improves the
     mental model.

3. **Tests** — extract a `useDeliveryOrderDetail` hook colocated
   with the screen, same pattern as `useShopListData` /
   `useShopOrderDetail` (from the in-flight shop PR). The hook
   owns: watchOrder subscription, loading/error state, the
   `isAvailableForClaim` derived flag, and the
   `handleClaim` / `handlePickedUp` / `handleDelivered` action
   handlers with optimistic state.

   Required test count: ≥4 tests in
   `tests/hooks/useDeliveryOrderDetail.test.ts`:
   - On mount with an available-for-claim order, derived flags
     compute correctly (`isAvailableForClaim === true`,
     `isAssigned === false`)
   - On mount with an order claimed by ANOTHER delivery person,
     derived flags reflect terminal state
   - On `handleClaim` failure (race lost), state reverts and error
     is surfaced
   - On watcher error, loading flips to false and error state set
     (regression guard for the watcher contract)

   **Deliberate-break demo**: revert the optimistic-revert in
   `handleClaim`, confirm "claim failure reverts optimistic state"
   test fails by name, revert, confirm green.

4. **PRELAUNCH_CHECKLIST.md** — log this fix; note that the
   "delivery partner can't see items before claiming" follow-up is
   done.

## Scope (out — explicitly defer)

- New Cloud Functions — `claimDelivery` and `watchOrder` already
  work for delivery role
- Distance-aware filtering (already a separate tracked follow-up
  in PRELAUNCH_CHECKLIST)
- "Reject without claim" — there's no reject from delivery side;
  not claiming IS the rejection
- Delivery partner notes on the order
- Earnings preview ("you'll earn ₹X for this run") — separate
  feature, no schema for delivery payouts yet
- Modifying `firestore.rules`
- React Native rendering tests (RNTL still deferred)

## Deploy + OTA

JS-only — no Cloud Function deploy needed.

```
eas update --branch preview --message "delivery preview detail screen"
```

## Acceptance checklist

- [ ] Tapping an Available Pickup card on
      `DeliveryDashboardScreen` navigates to
      `DeliveryOrderDetailScreen` with the right `orderId`
- [ ] Tapping the Accept button on the card does NOT navigate (only
      the card body navigates)
- [ ] On the detail screen, an unclaimed available pickup shows
      "Accept this pickup" button at the bottom; tapping it claims
      the order via `claimDelivery` and navigates back to dashboard
- [ ] After claim succeeds, returning to dashboard shows the order
      under "My Active Deliveries" (existing 10s poll picks it up,
      or the immediate refresh after claim does it sooner)
- [ ] If two delivery partners claim the same order simultaneously,
      the loser sees an Alert ("Already taken") and the dashboard
      reflects current reality
- [ ] All four screens with watcher-driven loading still resolve
      correctly (no regression on
      `DeliveryDashboardScreen` / `DeliveryOrderDetailScreen`
      loading state)
- [ ] `npm test` passes — total ≥ baseline + new test count
- [ ] `npx tsc --noEmit` — 11 baseline errors, 0 new
- [ ] Deliberate-break demo executed and reverted; failing test
      name captured
- [ ] OTA published with group ID + platform IDs

## Reporting back

- Test count added
- Deliberate-break demo output
- OTA group + iOS + Android IDs
- Files modified with line counts
- Anything noticed but NOT fixed (logged for follow-up)
- If this PR was folded with the Shop Order Detail PR (Windsurf's
  decision based on whether the shop PR was already in flight),
  the combined acceptance pass + the savings from shared hook
  pattern

## Important — do not

- Do not modify Cloud Functions — UI-only PR
- Do not modify `firestore.rules`
- Do not add new schema fields
- Do not change the dashboard's existing Active Delivery card
  navigation pattern (it already works correctly)
- Do not change the "first-wins atomic claim" transaction
  semantics — race conditions are server-enforced
- Do not fix the 11 baseline TS errors
- Do not auto-format files outside the diff
- Do not commit anything — staged for Sudhir's review
- Do not run tests iteratively — exactly twice (deliberate-break
  + final), per the discipline doc
