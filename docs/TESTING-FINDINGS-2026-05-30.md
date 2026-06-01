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
  tests stay green. OTA ship via `eas update --branch production`. **Cart + Checkout bottom CTA Android-overlap (different button from PR-NEXT-2's floating bar) → ✅ SHIPPED in PR-NEXT-HOTFIX-3** (June 1 2026): Sudhir's second smoke pass showed the Cart screen's "Proceed to Checkout · ₹X" button (and Checkout's "Pay" / "Place Order") still partly under the Android gesture-nav pill. Different button from PR-NEXT-2's territory — those four screens have a `position: 'absolute'` floating cart bar that escapes SafeAreaView's natural flow and so needs the manual `bottom: insets.bottom + spacing.sm` offset. CartScreen + CheckoutScreen's CTAs are in NORMAL flow inside `<SafeAreaView edges={['top']}>` — the `edges={['top']}` prop tells the library to skip the bottom inset entirely. Fix is the cleaner expression for in-flow content: `<SafeAreaView edges={['top', 'bottom']}>` on both `CartScreen.tsx:32, 48` and `CheckoutScreen.tsx:749, 765` (empty-cart branch + populated branch each). No style block changes, no new hooks, no `useSafeAreaInsets` import; the library handles the bottom padding from the device's real inset. iOS unchanged in practice (home-indicator inset already small enough that `spacing.lg` padding cleared it). 1155/1155 tests stay green. Pure OTA: `eas update --branch production --message "HOTFIX-3 Android cart + checkout bottom CTA"`. **Lesson for future bottom CTAs:** floating (`position: 'absolute'`) → `useSafeAreaInsets()` + `bottom: insets.bottom + spacing.X`; in-flow (sibling of scroll content) → `<SafeAreaView edges={['top', 'bottom']}>`. Never ship a bottom CTA with `edges={['top']}` alone.
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
- **Status:** ✅ **SHIPPED in PR-NEXT-9** (May 31 2026). Two surfaces wired (customer `ShopDetailScreen`, shopkeeper `ShopMenuScreen`); admin surface deferred since `ShopDetailManagementScreen` doesn't render a menu list today (it's metadata + KYC only — no menu list to search). Pure client OTA: name-only case-insensitive substring filter in a new pure helper `@c:\Users\dahiy\grocery-mvp\src\utils\menuSearchHelpers.ts` (`normalizeSearchQuery` + `filterMenuByQuery` + `pushToSearchHistory`); thin AsyncStorage wrapper `@c:\Users\dahiy\grocery-mvp\src\services\menuSearchHistory.ts` keyed by `search-history:menu:{role}:{shopId}` so customer + shopkeeper histories at the same shop stay independent. Reusable `@c:\Users\dahiy\grocery-mvp\src\components\menu\MenuSearchBar.tsx` is uncontrolled — parent owns the value — and surfaces a focus-only chip row that collapses the moment the user starts typing (`keyboardShouldPersistTaps="handled"` so chip taps land cleanly). Customer side filters menu BEFORE the category grouping so empty categories disappear; shopkeeper side composes search BEFORE the status-filter (`available/unavailable/custom`) so chip counts reflect what's visible. Per-`(role, shopId)` history caps at 5 with dedup-then-move-to-front semantics; history writes fire on blur OR `onSubmitEditing` (first wins) AND on chip re-tap. Query-driven empty state renders an inline "No items match …" block distinct from the genuine no-menu-yet copy. Devanagari names work (no lower-case fold needed). Pinned by 20 new tests in `@c:\Users\dahiy\grocery-mvp\tests\utils\menuSearchHelpers.test.ts` covering whitespace collapse, reference-equality returns on no-op, mixed-script normalisation, defensive non-string-name drops, custom-max truncation, and pre-normalised dedup. Suite at **1151 / 1151** (was 1131). Deferred: admin-side menu search (no surface), server-side `searchShopMenu` callable (client filter is sub-ms at pilot scale), pack-label / description search, fuzzy/typo-tolerant matching, sticky bar on scroll.

### #7 — Delivery dashboard: frequent "Network connection lost" errors

- **Severity:** **High** — disrupts the partner's primary workflow.
- **Platform:** iOS at least (screenshot attached); probably Android too.
- **Symptom:** Delivery dashboard repeatedly shows "The network connection was lost. Retry." over a few minutes. Network is otherwise fine.
- **Root cause:** TBD. Watchers (watchAvailableDeliveries, watchMyDeliveries) poll at 10/15s intervals; transient HTTP failures may be surfacing as a banner instead of being silently retried. Or it's an RNFB callable issue specific to delivery callables.
- **Fix approach:** Diagnose first — add a Sentry breadcrumb on each watcher fetch error with HTTP code + message. Then either: (a) silence transient errors and only show the banner after N consecutive failures, OR (b) fix the underlying network issue if it's reproducible. Likely (a) — defensive UX.
- **Status:** ✅ **SHIPPED in PR-NEXT-5** (May 31 2026). Diagnosis: the existing reconciler in `DeliveryDashboardScreen` already required BOTH watchers (`watchAvailableDeliveries` + `watchMyDeliveries`) to be in error state before showing the banner — but had no temporal defense. A single shared blip (Cloud Run cold start, iOS TCP idle reap, brief Wi-Fi/cellular hand-off) put both watchers in error on the same tick → banner showed instantly → next 10–15s poll succeeded → banner cleared → another blip brought it back. Fixed with a per-watcher consecutive-failure counter via the new pure helper `applyPollOutcome` in `src/utils/pollFailureGate.ts` (17 unit tests pinning the matrix). Banner now only shows once BOTH watchers reach `POLL_FAILURE_THRESHOLD = 3` consecutive failures (~45s of real outage at the slower 15s cadence). Single success on either watcher resets that watcher's counter. Sentry signal: `captureMessage` fires once per outage event (gated by the helper's `justTripped` flag), with breadcrumbs on every failed poll capturing the `consecutiveFailures` count + `functionsCode` for diagnostic context.

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
- **Status:** ✅ **SHIPPED in PR-NEXT-7** (May 31 2026). New shop-owner-only callable `getOnlinePartnersNearMyShop` (auth: `claims.shopOwner` + `claims.shopId`; admins do NOT get this surface — they have `getOnlineDeliveryCount` on AdminOrdersScreen) that reuses **PR 50's `filterPartnersByNotificationRadius` verbatim** so the count cannot disagree with `sendNewPickupPushToDelivery`'s push fanout. Wired into a new `useOnlinePartnersNearMyShop` hook (mirror of `useOnlineDeliveryCount`'s 30s polling + 3-strike stale-clear discipline) and a chip on `ShopOwnerDashboardScreen` directly under the Today KPIs. Copy: `Checking partner availability…` (loading / permanent-fail) / `No delivery partners online nearby` / `N delivery partner(s) online nearby`. Fail-open posture: when the shop has no `location`, the helper returns `filtered: false` + the unfiltered total online count (matching the push fanout's behavior for legacy shops), and the chip surfaces a hint nudging the owner to set a location for an accurate count. Privacy: callable returns `{count, filtered}` only — no partner UIDs / names / FCM tokens / locations leak. Pure helper `computeNearbyOnlinePartnerCount` in `functions/src/nearbyPartnersCountHelpers.ts` pinned by 14 tests; hook state machine `nextNearbyPartnersState` pinned by 9 tests.

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
- **Status:** ✅ **SHIPPED in PR-NEXT-6** (May 31 2026). Three new callables (`getDeliveryProofUploadUrl`, `recordDeliveryProofUpload`, `getDeliveryProofReadUrl`) implement a v4-signed-PUT → record → v4-signed-READ pipeline mirroring PR 6.1 (`/menu/`) and PR 31 (`/shop-kyc/`). Storage path is deterministic `delivery-proofs/{orderId}.jpg` (one photo per order; re-upload overwrites). Auth gates: upload + record require `claims.delivery === true` AND assignee match AND `pickedUpAt > 0`; reads role-mixed (customer of order / shop owner of shop / admin / assigned partner — each independently checked). Photo is OPTIONAL by design — `markDelivered` does NOT require it (door-handoff / camera-permission-denied cases). Storage rules add explicit `/delivery-proofs/` deny-all alongside `/menu/` and `/shop-kyc/`. Two schema-additive `Order` fields (`deliveryProofStoragePath`, `deliveryProofUploadedAt`). Client: `pickAndResizeImage('camera')` (already wired for menu + KYC — no permission/native changes) → `uploadDeliveryProof` orchestrator → optional photo button on `ActiveDeliveryCard` (lower visual weight, parallel to Delivered CTA, never blocks delivery). Reusable `DeliveryProofViewer` component renders thumbnail + tap-to-zoom modal on shop / customer order detail. Pinned by 19 helper tests + 5 upload-orchestration smoke tests + 7 `formatPaymentMethod` tests; suite at **1131 / 1131** (was 1089). **Photo upload Timestamp-vs-number bug → ✅ SHIPPED in PR-NEXT-HOTFIX-1** (May 31 2026): during testing, every upload attempt failed with `failed-precondition: "Pick up the order before…"` even on demonstrably picked-up orders. Root cause: `markPickedUp` writes `pickedUpAt: FieldValue.serverTimestamp()`, which the Admin SDK reads back as a `Timestamp` object (not millis) — but `validateDeliveryProofUploadAuth` gated on `typeof order.pickedUpAt !== 'number'`, so the strict-typeof check rejected every real production read. The test fixture used a millis number and masked the bug. Fix widens the validator to accept both shapes (plain millis number OR Timestamp-like with `.toMillis()` method) and normalises via `.toMillis()` before the `> 0` + `Number.isFinite` gate; null/undefined/wrong-shape/NaN/Infinity/0 still reject. 4 new test cases cover the production Timestamp shape, zero-millis Timestamp, NaN-millis Timestamp, and non-Timestamp object. Suite at **1155 / 1155** (was 1151). Server-only deploy (`firebase deploy --only "functions:getDeliveryProofUploadUrl,functions:recordDeliveryProofUpload"`); no client OTA. **Defensive sweep finding (filed for follow-up, not fixed in HOTFIX-1):** `customerCancelWindowHelpers.ts:136` has the SAME bug pattern on `paidAt` — `cancelMyRecentPaidOrder` passes raw `orderSnap.data()` into `canCustomerCancelPaidOrder`, which gates `typeof order.paidAt !== 'number'`; production `paidAt` is written via `FieldValue.serverTimestamp()` (`index.ts:1383, 3930`), so the cancel-paid-order flow may currently mis-gate. `index.ts:7055-7056` (`getMyProfile`) silently coerces `out.createdAt`/`out.updatedAt` Timestamp objects to `null` instead of millis (data-quality, not gate). Other matches are safe: `orderStatusTransitionHelpers.ts:90` validates a CLIENT-supplied `readyByEstimate` (not a server timestamp); `index.ts:3293` already uses `data.createdAt?.toMillis?.() ??` fallback; `index.ts:4785, 4817` are diagnostic logs only; `customerCrmHelpers.ts:80` is called after the caller pre-normalises via `.toMillis?.()`. **Partner-accept customer push + identity surface → ✅ SHIPPED in PR-NEXT-13a** (June 1 2026): Sudhir's smoke testing surfaced a gap — when the delivery partner accepted a pickup, the customer got no notification and the partner's identity wasn't visible until the actual pickup event. The gap can be 5–30 minutes of customer-side opacity ("Out for delivery" push had fired on the status flip to `ready_for_pickup`, but no partner had necessarily claimed yet). Fix extends `claimDelivery` (`@c:\Users\dahiy\grocery-mvp\functions\src\index.ts:3480`) to do two post-transaction best-effort steps: (1) read the partner's `users/{uid}.displayName` via the new pure helper `pickPartnerDisplayName` (`@c:\Users\dahiy\grocery-mvp\functions\src\claimDeliveryHelpers.ts`) and denormalise it onto the order as `deliveryPersonName`, and (2) fire `pushToUser(customerUid, …, type: 'order_partner_accepted')` with body `"<partnerName> will pick up your order from <shopName>."` Both steps wrapped in `try/catch` so a name-lookup or push failure cannot roll back the successful atomic claim. New schema-additive `Order.deliveryPersonName?: string` field (legacy + mid-flight orders absent → fallback copy). Client adds the new `PartnerIdentityCard` component (`@c:\Users\dahiy\grocery-mvp\src\components\order\PartnerIdentityCard.tsx`) which renders an initials-in-coloured-circle avatar + display name + state-aware subtitle (📦 Heading to the shop / 🛵 On the way to you) on `OrderDetailScreen` whenever `deliveryPersonId` is set. Phone number stays gated to post-pickup (no change to existing privacy posture). Real partner profile photos deferred — KYC selfie is PII; initials are the v1 stand-in. Push routing added to `AuthBootstrap.tsx` as a customer-only single-target case (same posture as `order_picked_up`). Pure helper `initialsFor` (`@c:\Users\dahiy\grocery-mvp\src\utils\partnerInitials.ts`) lives in its own pure `.ts` file so the test suite can pin the avatar-glyph logic without dragging the `.tsx` component through the JSX-free `tests/tsconfig.json`. Pinned by 8 `pickPartnerDisplayName` tests + 9 `initialsFor` tests; suite at **1172 / 1172** (was 1155). Deploy: server-first `firebase deploy --only "functions:claimDelivery"` + IAM verification on the `claimdelivery` Cloud Run service + client OTA.

### #14 — Reorder: unavailable item's X button doesn't work

- **Severity:** **High** — blocks reorder flow completely if any item is unavailable.
- **Platform:** Both.
- **Symptom:** Reorder flow shows previous order; if an item is "no longer offered by the shop," it's listed with a red X to remove. Tapping the X does nothing.
- **Root cause:** TBD — likely the onPress handler on the X icon isn't wired, or the handler doesn't update the local state used to render the line items.
- **Fix approach:** Trace the X press handler in the reorder screen (likely `RepeatOrderScreen` or similar; PR 13 from earlier). Wire to a local state mutation that filters the item out of the planned cart.
- **Status:** ✅ **SHIPPED in PR-NEXT-8** (May 31 2026). Smoking gun confirmed in `src/components/order/ReorderModal.tsx:255` — the ✕ was a static `<Text>`, not a `Pressable`, no `onPress` handler. The underlying availability filtering was already correct (`planToCartItems` already drops anything that isn't `available_*`); the bug was purely that the ✕ had no meaning that matched what users expected when they tapped it. Fixed by wiring the ✕ to a real `Pressable` with `hitSlop={12}` + `accessibilityLabel`; tap adds the row's `menuItemId` to a modal-local `Set<string>`, render path filters dismissed IDs out of the visible Unavailable list, section title decrements then disappears when all rows are dismissed. CTA copy + cart contents are unaffected (dismissal is presentation-only). State is ephemeral — closing/reopening the modal restores the full Unavailable list (effect resets on `buildPlanKey(plan)` change). Pure helper `addDismissedId` + `buildPlanKey` in `src/utils/reorderModalDismissals.ts` pinned by 14 tests (covers immutable update, idempotent re-dismissal, null/undefined/empty-string no-op, plan-key stability, line-order sensitivity).

### #15 — "Order Again" home card: confusing label vs content

- **Severity:** **Medium** — UX confusion.
- **Platform:** Both.
- **Symptom:** Home shows "Order Again" card with "3 orders" subtitle. Tap → shows items (not orders), with Cancel / "Add 3 items to cart" buttons. The "3 orders" label suggests a list of past orders, but it's actually showing a single bundle of items.
- **Fix approach:** Either: (a) change the subtitle to "X items from your most recent order" so it accurately describes the next screen, OR (b) make the destination actually show a list of past orders the customer can pick from.
- **Status:** ✅ **SHIPPED in PR-NEXT-8** (May 31 2026). Picked option (a) — change the subtext to be action-predictive ("Last order · {N} items") and drop the lifetime count from the card. Lifetime frequency is still implicit in the rail ordering itself (most-frequent shop comes first; PR 14's sort is unchanged), so no information is lost. Required a new optional `lastOrderItemCount: number` field on `FrequentShopEntry`, populated client-side from `mostRecent.items.length` inside the existing pure-helper loop; defensive `Array.isArray` guard so a malformed order doc renders "Last order · 0 items" rather than crashing the rail. Schema-additive only (no callable / Firestore changes). 4 new pinned tests in `tests/utils/pickFrequentlyOrderedShops.test.ts` covering most-recent-not-lifetime semantics, missing/non-array `items` field, and empty-array baseline.

### #16 — Notify shopkeeper + customer + admin on Delivered; surface payment + photo evidence

- **Severity:** **High** (composite enhancement — partial overlap with #11, #12, #13).
- **Platform:** Both.
- **Symptom:** Delivery completion is opaque to shop and admin. No verification of payment received or delivery executed.
- **Fix approach:** Composite: (a) push fan-out to shop + admin on Delivered (overlap with #11), (b) payment confirmation step (#12), (c) photo capture (#13), (d) admin/shopkeeper order-detail view shows the payment method + photo for verification.
- **Status:** ✅ **FULLY SHIPPED.** Sub-(a) shop + admin push on Delivered ✅ **SHIPPED in PR-NEXT-1** (May 31 2026) via `markDelivered`'s explicit `pushToOwner` + `pushToAdmins` calls. Sub-(b) COD payment confirmation ✅ **SHIPPED in PR-NEXT-3** (May 31 2026) — `confirmCodPayment` callable + Cash/UPI pills on the delivery dashboard gate `markDelivered` for COD-unpaid orders. Sub-(c) photo capture ✅ **SHIPPED in PR-NEXT-6** (May 31 2026) via the three signed-URL callables + `DeliveryProofViewer` component (see #13 for the full description). Sub-(d) order-detail payment + photo evidence ✅ **SHIPPED in PR-NEXT-6** (May 31 2026) — a new `formatPaymentMethod` pure helper renders the actual settlement method (`Cash on delivery — paid online (converted)`, `Cash on delivery — paid in cash`, `Online (paid up front)`, etc.) on both `ShopOrderDetailScreen` and customer `OrderDetailScreen`, replacing the old display that mislabelled COD-converted orders as `Cash on Delivery` even when Razorpay had actually settled them. The `DeliveryProofViewer` component renders on both screens with on-mount signed-READ minting. Admin UI integration ✅ **SHIPPED in PR-NEXT-6.1** (May 31 2026) — `AdminOrdersScreen` now renders the same `formatPaymentMethod`-driven `Paid via …` line on every card AND a third per-card disclosure (`📸 Delivery proof`) alongside the existing Manual-override + Full-timeline disclosures, only shown when `deliveryProofStoragePath` is stamped (no dead trigger on proof-less orders). The three disclosures intentionally keep INDEPENDENT one-card-at-a-time state so an admin can review the photo with the timeline simultaneously — the cross-reference flow dispute resolution needs. Single-file change; reuses `DeliveryProofViewer` + `formatPaymentMethod` verbatim; no new helpers, no new tests.

### #17 — Conflicting "Pickup ready in/ago" countdown shows alongside the new ready-for-pickup status label

- **Severity:** **Medium** — UX inconsistency, not a pilot-blocker, but contradictory labels erode customer trust in real time.
- **Platform:** Both.
- **Symptom:** Customer places an order. Shop marks `ready_for_pickup`. On `OrderDetailScreen` the customer sees TWO lines simultaneously:
  1. Top status block: `Ready — Partner is picking up` (correct, post-PR-NEXT-1 unified status display).
  2. Below it: `Pickup ready in X minutes` while still in-window, then `Pickup ready X minutes ago` once past the ETA. **This second line is the pre-ready ETA countdown that should have been retired the moment the order actually became ready.** Customer has to read both, decide which to believe, and the "ago" wording makes it feel like the system is contradicting itself.
- **Root cause (likely):** PR-NEXT-1 unified the order-status display vocabulary via `src/utils/orderStatusDisplay.ts` and wired `OrderStatusChip` + `orderEtaDisplay` to consume it. But the `readyByEstimate` countdown sub-line on `OrderDetailScreen` appears to be a SEPARATE render path (probably an inline `formatRelativeReadyBy(order.readyByEstimate)` or similar) that wasn't updated when PR-NEXT-1 unified the top label. Both render independently from the same `order` doc; only the top label respects the synthetic `ready_for_pickup` semantics. **Half the job got done.**
- **Scope:** `src/screens/OrderDetailScreen.tsx` — find the inline "Pickup ready in/ago" render block (search for `readyByEstimate` or `Pickup ready` in that file).
- **Fix approach:** When `order.status === 'ready_for_pickup'`, suppress the countdown line entirely (the order IS ready — no time-based ETA copy is meaningful). Alternative: replace the countdown with a fresh-context message like `📦 Delivery partner on the way` (matches the PartnerIdentityCard subtitle from PR-NEXT-13a once that ships). Cleanest v1 is suppress; can layer the fresh-context message in a follow-up if pilot feedback wants it. Pure client OTA.
- **Status:** Logged. Queue position: **after PR-NEXT-13d, before HOTFIX-4 / #11&#16**. Drafting deferred until #13d ships.
- **Workaround until fix ships:** customer ignores the lower line; trust the top status block.

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
