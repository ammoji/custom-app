# Shop Order Detail screen — Windsurf prompt

## Why this PR exists

Solo testing found a real fulfillment gap: a shop owner on
`ShopOwnerDashboardScreen` sees the order's count + phone + total +
status chip, but **not the individual items** they need to actually
prepare. Same goes for customer name, delivery address, payment
method. Without those, "Accept" is a coin flip — the owner can't
check stock, can't verify the brand of atta the customer wanted,
can't confirm the address is in their delivery range.

Server-side has all this data already (it's just `order.items[]`,
`order.deliveryAddress`, `order.paymentMethod` on the existing
order doc). This PR is pure UI work — render what's already there.

## Read first

- **`.windsurf/test-discipline.md`** — tests run **once at end**,
  plus the deliberate-break demo. `npm test` is the runner.
- `src/screens/OrderDetailScreen.tsx` — customer's order detail
  screen. Pattern to mirror for the shop owner's version (similar
  layout: status header, address, items, bill summary).
- `src/screens/shop/ShopOwnerDashboardScreen.tsx` — the source
  screen we're adding navigation from
- `src/services/orderService.ts` — `watchOrder` already exists and
  works for shop owners per the Firestore rules; no new callable
  needed
- `firestore.rules` — confirm `isShopOwnerOf(resource.data.shopId)`
  is allowed to read; it is (rules tests pin this)

## Scope (in)

1. **New screen: `src/screens/shop/ShopOrderDetailScreen.tsx`**
   - Receives `{ orderId }` route param
   - Subscribes to `orderService.watchOrder(orderId, cb)` for live
     updates (the existing watcher contract — `(order, err) => void`)
   - Layout (top to bottom):
     - **Status header** — chip + order ID + placed-at time, with
       ETA in minutes if not delivered/cancelled
     - **Customer section** — name (read-only), phone (tap-to-call
       via `Linking.openURL('tel:...')`)
     - **Delivery address section** — full address with the
       existing `addressOneLine`-style formatting
     - **Items section** — one row per item: image (small, ~48px),
       name + pack label, `× quantity`, line total `(price × qty)`
     - **Bill summary** — subtotal, delivery fee, total (matches
       customer's OrderDetail layout)
     - **Payment** — method (COD / Online) with paid/pending status
       for online orders
     - **Action buttons** at the bottom — same set the dashboard
       card has: Accept / Mark Preparing / Mark Out for Delivery,
       filtered through `SHOP_OWNER_ALLOWED_ACTIONS` and
       `nextActionsFor(item.status)`. Optimistic update + revert on
       failure, same pattern as the dashboard's `handleAction`.
   - Loading + error states handled per the watcher contract: error
     banner with Retry, never indefinite spin.
   - Access guard: if `!isShopOwner || !shopId || order.shopId !==
     shopId`, show `EmptyState` with "Not your shop's order"
     message instead of rendering. Defensive — Cloud Function
     `getOrder` will reject the read anyway via the rules, but UI
     should not hang waiting for a permission-denied error.

2. **Modify `ShopOwnerDashboardScreen.tsx`**
   - Wrap each order card's body in a `Pressable` that navigates
     to `ShopOrderDetail` with `orderId`
   - Add a chevron (`›`) on the right side of the card to signal
     tappability
   - **Keep** the action buttons (Accept / Preparing / Out for
     Delivery) at the bottom of the card — quick-action path for
     trivial orders ("got 3 mangoes, accept and move on"). The
     buttons need a `onPress={(e) => e.stopPropagation()}` wrapper
     OR the Pressable card should use `onPress` while the buttons
     stay in their own touchable hierarchy. Either way, tapping a
     button must NOT also navigate.
   - Visual: card looks slightly more "interactive" — subtle
     border emphasis or shadow change on press is fine; match
     existing pressable patterns elsewhere in the app

3. **Register the route in `AppNavigator.tsx`**:
   ```ts
   ShopOrderDetail: { orderId: string };
   ```
   Add the `Stack.Screen` registration next to the other shop
   screens.

4. **Update `PRELAUNCH_CHECKLIST.md`** — log this fix; promote any
   related "shop owner can't fulfill order" follow-up items to Done.

## Scope (out — explicitly defer)

- New Cloud Function — `watchOrder` / `getOrder` already work for
  shop owners
- Modifying Firestore rules — already allow `isShopOwnerOf`
- Modifying the order schema — everything we need is already there
- Push notification when order accepted/etc — already fires via
  existing `sendOrderStatusPush` trigger
- Print/export receipt — not needed for MVP
- Internal notes / comments on orders — defer
- Estimated-prep-time editor (shop owner setting their own ETA) —
  defer
- "Reject order" action button — currently dashboard only supports
  forward transitions; rejection is admin-only via
  `cancelMyPendingOrder` from customer side. Shop-side reject is a
  feature, not a bug — defer.

## Tests (mandatory)

Per `.windsurf/test-discipline.md`. Aim for ≥4 new tests.

Extract the screen's state machine into a testable hook
(`useShopOrderDetail.ts` next to the screen) — same architectural
pattern as `useShopListData`. Hook owns the watchOrder subscription,
loading/error state, and the action-button handler. Screen stays a
thin presenter.

Suggested test split:

1. `tests/hooks/useShopOrderDetail.test.ts` (≥3 tests)
   - On mount with a valid orderId, subscribes to watchOrder and
     populates `order` state on first callback
   - On watcher error, sets `error` and clears `loading`
   - On `handleAction` failure, reverts the optimistic state change
     and surfaces the error

2. `tests/services/orderService.watchers.test.ts` — verify
   `watchOrder` is already covered for the "shop owner reads
   another shop's order, gets permission-denied" path. If a test
   doesn't exist for that, add one. (Likely already there from the
   v2-iii hotfix tests, but confirm.)

**Deliberate-break demo** required. Suggest reverting the
"setLoading(false) on watcher error" line in the hook, confirm the
test for "watcher error clears loading" fails by name, revert,
confirm green.

## Deploy + OTA

This PR is JS-only — no Cloud Function changes. **No
`firebase deploy` needed.**

Push OTA per usual:

```
eas update --branch preview --message "shop owner order detail screen"
```

## Acceptance checklist

- [ ] New screen renders all required sections (status, customer,
      address, items, bill, payment, actions)
- [ ] Tapping an order card on `ShopOwnerDashboardScreen`
      navigates to the new screen with the correct `orderId`
- [ ] Tapping an action button on the dashboard card does NOT
      also navigate — only the card body navigates
- [ ] `tel:` link on customer phone works on native (manual test
      on Sudhir's device)
- [ ] Loading state resolves; error state shows banner + Retry;
      never indefinite spin
- [ ] Permission guard: if a shop owner somehow deep-links into
      an order from a different shop, EmptyState renders instead
      of a broken screen
- [ ] `npm test` passes with ≥ baseline + new test count
- [ ] `npx tsc --noEmit` — 11 baseline errors, 0 new
- [ ] Deliberate-break demo executed; failing test name captured
- [ ] OTA published with group ID + platform IDs

## Reporting back

- Total new test count
- Deliberate-break demo output
- OTA group ID + iOS + Android update IDs
- Files added/modified with line counts
- Anything noticed but NOT fixed (logged for follow-up)
- Confirmation that web parity is preserved — `expo start --web`
  → shop owner dashboard → tap order card → detail screen renders
  the same content (web doesn't get `tel:` link working, that's
  fine; everything else should)

## Important — do not

- Do not modify Cloud Functions — UI-only PR
- Do not modify firestore.rules — already correct
- Do not add reject/cancel from shop side — deferred
- Do not add new schema fields to Order
- Do not fix the 11 baseline TS errors
- Do not add full React Native rendering tests (RNTL is still out
  of scope; hook tests cover the state machine adequately)
- Do not commit anything — leave staged for Sudhir's review
- Do not run tests iteratively — exactly twice (deliberate-break
  + final), per the discipline doc
