# Testing findings — Android validation + full re-test (started May 30 2026)

Living list of bugs and critical-enhancement candidates surfaced
during the Android-validation + iOS re-test phase that started
May 30, before the 1-shop Ballabgarh pilot.

Each entry is sized for triage: severity, platform, scope, fix
approach, and current status. Critical bugs blocking pilot go to the
top; enhancements / nice-to-haves at the bottom.

---

## Bugs

### #1 — Android: cart bar overlapped by system nav, "View Cart" un-tappable

- **Severity:** **Pilot-blocker** for Android customers — they
  cannot proceed to checkout from a shop's menu screen, the home
  screen, the shop list, or search results. iOS unaffected.
- **Platform:** Android only. Reproducible on the Play Internal
  Testing install on Sudhir's new Android phone (May 30, 7:03 PM).
  Likely affects every Android phone with the standard
  gesture-navigation bar.
- **Symptom:** the green "N items · ₹X · View Cart ›" bar floats at
  the bottom of the screen but sits *behind* the Android system
  navigation pills (back / home / recent-apps). The "View Cart" tap
  target is intercepted by the OS, so customers cannot proceed to
  the Cart screen via this affordance.
- **Root cause:** `cartBar` styles use
  `position: 'absolute'; bottom: spacing.lg` — a flat distance from
  the screen bottom that does not account for the Android system
  navigation bar's height. iOS happens to clear by coincidence
  (home-indicator inset < `spacing.lg`); Android's nav bar is
  taller.
- **Scope:** 4 screens all use the identical anti-pattern.
  - `src/screens/HomeScreen.tsx` (~line 952)
  - `src/screens/ShopListScreen.tsx` (~line 223)
  - `src/screens/ShopDetailScreen.tsx` (~line 345)
  - `src/screens/SearchScreen.tsx` (~line 439)
  Plus: the `FlatList` / `ScrollView` content above each cart bar
  likely has bottom padding sized for `spacing.lg + cartBarHeight`
  only — that also needs `insets.bottom` added so the last list
  item doesn't end up hidden behind the floated bar.
- **Fix approach:** use `useSafeAreaInsets()` from
  `react-native-safe-area-context` (already a dependency; other
  screens use SafeAreaView from the same library). Add
  `insets.bottom` to both the cart bar's bottom offset and the
  scroll container's `paddingBottom`. OTA-safe — pure JS, no
  native module change, no permission change, no `app.json`
  change. Ships via `eas update --branch production`.
- **Status:** ✅ **SHIPPED in PR-NEXT-2** (May 31 2026). All four
  screens (`HomeScreen`, `ShopListScreen`, `ShopDetailScreen`,
  `SearchScreen`) now call `useSafeAreaInsets()` and apply
  `bottom: insets.bottom + spacing.sm` to the cart bar plus
  `paddingBottom: 120 + insets.bottom` to the scroll/list
  container. Hook placement follows code-discipline Rule 2 (with
  the other hooks, above any conditional early returns). 979/979
  tests stay green. OTA ship via `eas update --branch production`.
- **Workaround until fix ships:** the in-screen cart-bar tap is
  blocked, but customers can still reach the Cart screen via the
  bottom tab bar (if present) or the back-then-forward navigation.
  For Sudhir's own testing during the fix window, ignore the
  cart-bar tap and navigate to Cart via whatever app-level
  navigation surface is reachable on the device.

---

### #2 — Cancel order: no push notification to shopkeeper

- **Severity:** **Pilot-blocker** — shopkeeper prepares the order, customer cancels, shopkeeper keeps preparing because they never got the signal. Wasted inventory + bad first impression on first cancellation.
- **Platform:** Both.
- **Symptom:** Customer cancels an order within the 2-min window; shopkeeper receives no push.
- **Root cause:** `updateOrderStatus` callable (functions/src/index.ts ~line 838) likely handles cancellation transitions but doesn't fan out a push to the shopkeeper. Need to verify the push trigger covers the `cancelled` transition and routes to shopkeeper, not just the customer.
- **Fix approach:** Extend the order-status push trigger to send to shopkeeper (and admin?) on cancellation. Tests pin the fan-out.
- **Status:** ✅ **SHIPPED in PR-NEXT-1** (May 31 2026). `sendOrderStatusPush` now fans out to shopkeeper (`pushToOwner`) + admin (`pushToAdmins`) on any→cancelled transition with explicit per-audience copy. Customer push remains via the existing `buildOrderStatusPushPlan` path.

### #3 — Notification deep-link: shopkeeper tap → home, not the order

- **Severity:** **High** (UX, bad at scale) — once shops get many orders, hunting for "which order was that notification?" wastes time per push.
- **Platform:** Both (push handler is JS).
- **Symptom:** Shopkeeper taps a new-order push notification; app opens to Home, not to the specific ShopOrderDetail.
- **Root cause:** PR 45.2 added push-tap deep-link handlers for `shop_pending_approval` and `delivery_request_pending` but not for the new-order notification.
- **Fix approach:** Extend the push-tap deep-link in `AuthBootstrap.tsx` (or wherever PR 45.2 put it) to handle the new-order notification type → navigate to `ShopOrderDetail` with the orderId. Mirror for the customer-side `order_status_changed` push → navigate to customer OrderDetail. Same for delivery → DeliveryOrderDetail.
- **Status:** ✅ **SHIPPED in PR-NEXT-1** (May 31 2026). `AuthBootstrap` now routes `new_order_for_shop`, `new_pickup_for_delivery`, `order_picked_up`, `order_cancelled`, `order_delivered`, and the legacy `order_status` push types to the appropriate detail screen. Audience derived from `useAuthStore` claims at tap time (shopOwner-with-matching-shopId precedence > admin > customer).

### #4 — Bulk "Mark N unavailable" silently fails — 0 updated, N skipped

- **Severity:** **High** — shopkeeper UX broken; can only update items one-by-one.
- **Platform:** Both (server bug).
- **Symptom:** Shopkeeper selects 3 menu items, taps "Mark 3 unavailable" → confirmation popup → confirm → "Updated with skips, 0 updated, 3 skipped (item may no longer exist)". But the items DO exist and are visible in the menu.
- **Root cause:** TBD. Likely a server-side bulk-update callable comparing wrong fields or using stale ids. Need to find the callable name + read its validator.
- **Fix approach:** Find the callable (probably `updateMenuItemsAvailability` or similar — grep for it). Read the per-item processing loop. Diagnose why each item is being skipped. Likely a field-mismatch (e.g., expecting `id` but getting `menuItemId`, or shop-id check failing).
- **Status:** ✅ **SHIPPED in PR-NEXT-4** (May 31 2026). Root cause confirmed during drafting: `bulkUpdateMenuAvailability` queried `db.collection('menuItems')` — a top-level collection that doesn't exist (per-shop menu items live at `shops/{shopId}/menu/{menuItemId}`). Every chunk-query returned empty → every requested ID got bucketed as `skippedCount` → user-facing message "item may no longer exist" misdirected diagnosis. Fixed by scoping the query to `shops/{shopId}/menu` via `FieldPath.documentId() in chunk`. The pre-PR `data.shopId === shopId` filter became dead code (subcollection scope guarantees it) and was dropped. Also: filter `deletedAt != null` in the chunk loop so a soft-deleted item (PR-NEXT-4 §C) doesn't get its `available` flag toggled. Bumped `updatedAt` write to `FieldValue.serverTimestamp()` (was `Date.now()`) to avoid the PR 48 §I mixed-type orderBy bug.

### #5 — Cannot delete menu items (shopkeeper or admin)

- **Severity:** **Medium** — workaround is "mark unavailable" but that leaves clutter; real deletion needed.
- **Platform:** Both (feature gap).
- **Symptom:** No delete affordance on menu items.
- **Fix approach:** Soft-delete pattern — add `deletedAt: number | null` to MenuItem; new callable `deleteMenuItem` writes the timestamp; listMyShopMenu / listShopMenuPublic exclude items where `deletedAt != null`; order history (which embeds the menu snapshot at order time, not a live reference) is unaffected.
- **Status:** ✅ **SHIPPED in PR-NEXT-4** (May 31 2026). Root cause re-diagnosed during drafting: a Delete affordance DID exist on `ShopMenuItemEditScreen` calling `removeMenuItem`, but the callable's behavior was asymmetric — custom items hard-deleted (gone), global items soft-disabled via `available: false` (stayed in menu, just struck through). Shopkeepers reported it as "delete doesn't work" because the global-item case looked identical to "mark unavailable." Unified via the `deletedAt` pattern: new `deletedAt?: number | null` field on `MenuItem` (optional/back-compat); `removeMenuItem` writes `deletedAt: serverTimestamp() + available: false` for both kinds; all four listing surfaces (`listMyShopMenu`, `listShopMenuPublic`, `searchMenuPublic`, `bulkUpdateMenuAvailability`) drop `deletedAt != null` rows in-memory (Firestore `where(field, '==', null)` doesn't match absent fields → would silently exclude every legacy pre-PR menu item). Pure helper `excludeDeleted` in `src/utils/menuListingHelpers.ts` pinned by 15 tests. Customer-facing "Remove this item from your menu?" copy in `ShopMenuItemEditScreen` is now identical for custom and global. Order history unaffected — `CartItem` snapshots name/price/imageUrl at order-time, no live read of the menu doc. Client wrapper return shape narrowed from `{ deleted, softDisabled? }` → `{ ok: true }` (only known caller never read the discriminator).

### #6 — No in-shop search; need search history too

- **Severity:** **Medium** today (small menus), **High** at scale (1000-item shops).
- **Platform:** Both.
- **Symptom:** Customer enters a shop's menu screen → only scroll, no search. Same for shopkeeper menu management and admin shop view.
- **Fix approach:** Add in-shop search bar to ShopDetailScreen (customer side), ShopMenuScreen (shopkeeper side), and the admin equivalent. Filter the existing menu list client-side (fast, no callable needed) for sub-1000-item lists; for larger, consider server-side. Plus: persist last 5 search queries per user role in AsyncStorage and surface them as quick-pick chips when the search bar focuses.
- **Status:** Logged. Standalone PR-NEXT-9 (in-shop search + history) — bigger feature, deferred from the critical-fix wave.

### #7 — Delivery dashboard: frequent "Network connection lost" errors

- **Severity:** **High** — disrupts the partner's primary workflow.
- **Platform:** iOS at least (screenshot attached); probably Android too.
- **Symptom:** Delivery dashboard repeatedly shows "The network connection was lost. Retry." over a few minutes. Network is otherwise fine.
- **Root cause:** TBD. Watchers (watchAvailableDeliveries, watchMyDeliveries) poll at 10/15s intervals; transient HTTP failures may be surfacing as a banner instead of being silently retried. Or it's an RNFB callable issue specific to delivery callables.
- **Fix approach:** Diagnose first — add a Sentry breadcrumb on each watcher fetch error with HTTP code + message. Then either: (a) silence transient errors and only show the banner after N consecutive failures, OR (b) fix the underlying network issue if it's reproducible. Likely (a) — defensive UX.
- **Status:** Logged. Folding into PR-NEXT-5 (delivery dashboard reliability).

### #8 — Online toggle doesn't persist across screen navigations

- **Severity:** **High** — partner thinks they're online (and so do they expect to receive pickups), but the system thinks they're offline → no pickup pushes → no work.
- **Platform:** Both.
- **Symptom:** Delivery dashboard → toggle Online → navigate away → return to dashboard → toggle shows Offline again.
- **Root cause:** The dashboard's `online` local state initializes to `false` on every mount and never reads from `users/{uid}.deliveryStatus`. The toggle writes the server state correctly (PR confirmed in `setDeliveryStatus`) but the UI doesn't reflect the persisted value on next mount.
- **Fix approach:** On dashboard mount, fetch current `users/{uid}.deliveryStatus` (via a new lightweight callable `getMyDeliveryStatus` or by including it in an existing profile read) and initialize the toggle from that value.
- **Status:** ✅ **SHIPPED in PR 50** (May 31 2026). The dashboard now calls the new `getMyDeliverySettings` callable inside its existing `useFocusEffect` and re-hydrates both the Online switch and the notification-radius input from authoritative server state on every focus. Verified by smoke step #2 of the PR 50 acceptance checklist.

### #9 — Show shopkeeper the count of online delivery partners in their service area

- **Severity:** **Enhancement** (not pilot-blocker, but builds shopkeeper trust).
- **Platform:** Both.
- **Symptom:** Shopkeeper has no visibility into whether anyone will actually pick up the order they're preparing.
- **Fix approach:** Lightweight callable that counts `users` where `isDelivery && deliveryStatus === 'online'` and (optionally) within haversine of the shop's location. Display on ShopOwnerDashboard as a small badge ("3 partners online nearby").
- **Status:** Logged. Standalone PR-NEXT-7 (small).

### #10 — "Picked up" status not propagating; conflicting labels on customer view

- **Severity:** **Pilot-blocker** — customer sees contradictory status, breaks trust.
- **Platform:** Both.
- **Symptom (two parts):**
  1. Out of 3 test orders, only 1 correctly showed "Picked up" propagation to customer + shopkeeper. The other 2 kept showing "Ready for pickup" even after partner tapped "I've picked it up."
  2. On the 1 that did propagate, customer sees BOTH "Out for delivery" (top) AND "Pickup ready 5 minutes ago" (bottom) simultaneously.
- **Root cause confirmed in code** (functions/src/index.ts ~3277-3286, markPickedUp):
  - `markPickedUp` writes `pickedUpAt: serverTimestamp()` but **never updates `order.status`**. The top-level status field stays as `'ready_for_pickup'`.
  - The `statusHistory` arrayUnion entry also incorrectly labels the new state as `'ready_for_pickup'` instead of (e.g.) `'picked_up'`.
  - This is a *deliberate* design (no `'picked_up'` value in the OrderStatus enum) where the picked-up state is signaled by `pickedUpAt !== null`. But the client UI inconsistently checks either `order.status` OR `pickedUpAt`, producing contradictory labels.
  - The intermittent (1-of-3) propagation may be a watcher refresh race — the customer's watcher takes a poll cycle to see the new `pickedUpAt` value, and if the top-label code path doesn't refresh on `pickedUpAt` change, the user sees stale text.
- **Fix approach:**
  1. Extract a pure helper `displayOrderStatus(order): { label, sublabel }` that reads `(status, pickedUpAt, deliveredAt, cancelledAt)` together and returns ONE coherent label. Use it everywhere status is rendered (customer, shopkeeper, delivery, admin) so the two text surfaces can't disagree.
  2. Fix `markPickedUp`'s statusHistory entry: the new state label should be `'picked_up'` (or a documented constant) — not `'ready_for_pickup'`.
  3. (Optional, larger) Add `'picked_up'` to the OrderStatus enum as an explicit intermediate state and make `markPickedUp` update `order.status` to it. Bigger change — defer until the displayOrderStatus helper stabilizes the UI.
  4. Unit-test `displayOrderStatus` exhaustively (every state combination).
- **Status:** ✅ **SHIPPED in PR-NEXT-1** (May 31 2026). `src/utils/orderStatusDisplay.ts` is the new single source of truth (synthetic `picked_up` state for `status==='ready_for_pickup' && pickedUpAt!=null`); `OrderStatusChip` + `orderEtaDisplay` consume it; `markPickedUp` now (a) writes the correct `'picked_up'` statusHistory label and (b) emits an explicit customer push (`type: 'order_picked_up'`) since `markPickedUp` doesn't change top-level `status` and the existing trigger watches `status` diffs only. 36 new helper tests pin the matrix.

### #11 — "Delivered" status not propagating to shopkeeper; no push to shop/admin

- **Severity:** **Pilot-blocker** — shopkeeper doesn't know order is done; can't update their books.
- **Platform:** Both.
- **Symptom:** Delivery partner taps "Delivered" → customer's view still shows "Out for delivery" (related to #10 UI inconsistency) → shopkeeper's view still shows "Ready for pickup" → no push to shopkeeper.
- **Root cause:** `markDelivered` (functions/src/index.ts ~3324) DOES update `order.status` to `'delivered'` and fire the existing `sendOrderStatusPush` trigger to the customer. But:
  - The trigger pushes only to the customer ("Order delivered. Enjoy!") — no push to shopkeeper or admin.
  - Shopkeeper's dashboard list query may exclude `'delivered'` orders, so the delivered order disappears from the active-orders view without explicitly signaling "this completed." Worse: if the dashboard caches the prior status, the shop sees stale "Ready for pickup" until manual refresh.
  - The customer-side `'Out for delivery'` ghost label is the same as #10 — fixed by the displayOrderStatus helper.
- **Fix approach:**
  1. Extend `sendOrderStatusPush` to fan out to shopkeeper + admin on `delivered` transition (and on `cancelled`, see #2).
  2. Audit shop dashboard query to ensure delivered orders appear in a "Delivered today" section (or at least disappear cleanly from active without the stale label).
- **Status:** ✅ **SHIPPED in PR-NEXT-1** (May 31 2026, partial). The push fan-out half landed: `markDelivered` now emits explicit `pushToOwner` + `pushToAdmins` calls (in addition to the customer push from the existing `sendOrderStatusPush` trigger). The shopkeeper / customer / admin order-detail labels also resolve through `displayOrderStatus` so the stale "Ready for pickup" / "Out for delivery" ghost labels are gone. The shop-dashboard "Delivered today" section enhancement (#16(d)) stays deferred to a later PR — not pilot-blocking once the push fires.

### #12 — COD payment: customer conversion + delivery-partner confirmation

- **Severity:** **Pilot-blocker for COD-only customers** — two related gaps in the COD flow; together they account for the entire payment-trust story for any order placed as COD.
- **Platform:** Both.
- **Scope (two parts, ship together as PR-NEXT-3):**
  - **Part A — Customer-initiated COD → online conversion (Sudhir, May 31).** Customer placed a COD order but wants to pay online any time before delivery (forgot cash, prefers UPI now, etc.). Mirrors Swiggy/Zomato. Add a "Pay online now" button on Customer OrderDetailScreen, gated on `paymentMethod === 'cod'` AND `paymentStatus !== 'paid'` AND status not in `{delivered, cancelled}`. Server mints a fresh Razorpay session → existing `confirmPayment` flips paymentStatus to `paid`.
  - **Part B — Delivery-partner COD confirmation (original finding).** When the partner arrives with a still-COD order (customer didn't convert), the "Delivered" CTA is gated behind a mandatory "Mark as paid (Cash) / Mark as paid (UPI partner-collected)" step. Server stamps `paymentStatus: 'paid'` + `paidMethod` + `paidAt`. Online-prepaid orders skip this step entirely.
- **Fix approach:**
  - New callable `payCodOrder({orderId})` for Part A (separate from `retryPayment`, which has different "online attempt failed" semantics). Transaction-guarded refusal if already paid (race with partner's Part B path).
  - **Design decisions locked by Sudhir (May 31):**
    - **`paymentMethod` stays `'cod'`** on conversion. New field `paidMethod: 'cash' | 'online'` captures actual settlement. Preserves the original-intent signal for analytics ("how often do COD customers convert?").
    - **No reverse path** (online → COD not supported).
    - **Fan-out push on COD → online conversion** to shop owner + admin + delivery partner (if `deliveryPersonId` already set). Either piggyback on the existing `sendOrderStatusPush` trigger (extend to fire on `paymentStatus` 'pending' → 'paid' AND `paymentMethod === 'cod'`), or fire directly from inside `confirmPayment` when the order was originally COD. Direct-fire is cleaner — no risk of double-firing for new online-from-the-start orders. Audience-mapping helper to be exhaustively unit-tested same as PR-NEXT-1's pattern.
  - Tests pin: the convert-while-already-paid race, the partner-flow skip when already paid, the status-gate on the conversion button, and the fan-out audience on `cod → online` conversion (specifically: does NOT push to anyone on regular online order payment).
- **Status:** ✅ **SHIPPED in PR-NEXT-3** (May 31 2026). Both parts landed:
  - **Part A** — new `payCodOrder` callable + `Pay online now` button on `OrderDetailScreen` mints a fresh Razorpay session for a COD order; on success the existing `confirmPayment` callable stamps `paidMethod: 'online'` (new field) atomically with `paymentStatus: 'paid'` and fans out an `order_cod_converted` push to shop owner + admin + assigned delivery partner. `paymentMethod` stays `'cod'` as a locked-design analytics signal.
  - **Part B** — new `confirmCodPayment` callable + Cash/UPI selector pills on `ActiveDeliveryCard` (`DeliveryDashboardScreen`). The "Delivered" CTA is now gated by `markDelivered`'s new `validateMarkDeliveredCodGate` precondition for COD-unpaid orders; the partner must call `confirmCodPayment({orderId, paidMethod})` first, which stamps `paymentStatus: 'paid'` + `paidMethod` + `paidAt`. Server returns `{alreadyPaid: true}` on the Part A race-guard so the partner UI shows a "Customer paid online" toast and falls through to Delivered on the next watcher tick.
  - Deep-link: `AuthBootstrap` routes the new `order_cod_converted` push type with the same audience precedence as `order_delivered` / `order_cancelled`.
  - Tests: 37 new cases in `tests/functions/codPaymentHelpers.test.ts` pin the precondition matrix for all three callables + the fan-out decision. Suite at **1016 / 1016** (was 979).

### #13 — Delivery proof photo

- **Severity:** **Enhancement** but high value for dispute resolution.
- **Platform:** Both (camera capture).
- **Symptom:** No photographic record of delivery; "items missing / never received" disputes have no evidence.
- **Fix approach:** Optional photo capture step in the delivery-completion flow. Upload to Firebase Storage at `delivery-proofs/{orderId}.jpg`. Shopkeeper + admin can view from order detail. Make it optional initially; can make required later if disputes warrant.
- **Status:** Logged. Standalone PR-NEXT-6 (combine with #12 since both touch the deliver-completion flow).

### #14 — Reorder: unavailable item's X button doesn't work

- **Severity:** **High** — blocks reorder flow completely if any item is unavailable.
- **Platform:** Both.
- **Symptom:** Reorder flow shows previous order; if an item is "no longer offered by the shop," it's listed with a red X to remove. Tapping the X does nothing.
- **Root cause:** TBD — likely the onPress handler on the X icon isn't wired, or the handler doesn't update the local state used to render the line items.
- **Fix approach:** Trace the X press handler in the reorder screen (likely `RepeatOrderScreen` or similar; PR 13 from earlier). Wire to a local state mutation that filters the item out of the planned cart.
- **Status:** Logged. Folding into PR-NEXT-8 (reorder UX cluster).

### #15 — "Order Again" home card: confusing label vs content

- **Severity:** **Medium** — UX confusion.
- **Platform:** Both.
- **Symptom:** Home shows "Order Again" card with "3 orders" subtitle. Tap → shows items (not orders), with Cancel / "Add 3 items to cart" buttons. The "3 orders" label suggests a list of past orders, but it's actually showing a single bundle of items.
- **Fix approach:** Either: (a) change the subtitle to "X items from your most recent order" so it accurately describes the next screen, OR (b) make the destination actually show a list of past orders the customer can pick from.
- **Status:** Logged. Folding into PR-NEXT-8 (reorder UX cluster).

### #16 — Notify shopkeeper + customer + admin on Delivered; surface payment + photo evidence

- **Severity:** **High** (composite enhancement — partial overlap with #11, #12, #13).
- **Platform:** Both.
- **Symptom:** Delivery completion is opaque to shop and admin. No verification of payment received or delivery executed.
- **Fix approach:** Composite: (a) push fan-out to shop + admin on Delivered (overlap with #11), (b) payment confirmation step (#12), (c) photo capture (#13), (d) admin/shopkeeper order-detail view shows the payment method + photo for verification.
- **Status:** **Partially shipped.** Sub-(a) shop + admin push on Delivered ✅ **SHIPPED in PR-NEXT-1** (May 31 2026) via `markDelivered`'s explicit `pushToOwner` + `pushToAdmins` calls. Sub-(b) COD payment confirmation ✅ **SHIPPED in PR-NEXT-3** (May 31 2026) — `confirmCodPayment` callable + Cash/UPI pills on the delivery dashboard now gate `markDelivered` for COD-unpaid orders. Sub-(c) photo capture + sub-(d) order-detail evidence view → PR-NEXT-6.

---

## Enhancements / nice-to-haves

(See #5, #6, #9, #13 above — each tagged with the cluster it belongs to.)

---

## How to add a finding

For each new bug or enhancement, copy the template:

```
### #N — short title

- **Severity:** Pilot-blocker / High / Medium / Low
- **Platform:** iOS / Android / Both
- **Symptom:** what the tester sees
- **Root cause:** *(fill in after diagnosis; OK to leave "TBD")*
- **Scope:** files / surfaces affected
- **Fix approach:** brief direction
- **Status:** Logged / Diagnosed / Prompt drafted / In progress /
  Shipped / Verified
- **Workaround:** if any
```

Keep entries terse — this file is for tracking, not documenting.
Detailed diagnostic notes belong in the Windsurf prompt for the fix,
not here.
