# Phase 12a-v2-iii — Customer-facing per-shop menu (Windsurf prompt)

## Context (read first)

Phases v2-i (registration + admin approval), v2-i-bis (admin governance:
revoke/suspend), and v2-ii (per-shop menu management) are all deployed.
Right now the **owner side** of the menu works end-to-end:

- `approveShop` bootstraps `shops/{shopId}/menu` from the global `products`
  collection.
- Shop owners can toggle availability, edit price/MRP/stock, and add
  custom items via `ShopMenuScreen`, `ShopMenuItemEditScreen`, and
  `AddCustomMenuItemScreen`.

But the **customer side** still reads the legacy global `products`
collection — so customers see every product at the same global price and
have no idea whether a given shop actually stocks it. v2-iii fixes that.

After v2-iii is done, we will test v2-iii together with **Phase 12b
(delivery panel)** in a single family role-play session. See the
companion file `phase-12b-and-v2-iii-test-plan.md` for the test script —
do not skip anything that test plan depends on.

## Goal of v2-iii

Wire the customer flow to the per-shop menu subcollection so each shop
shows its own catalogue, its own price, its own stock, and only active
shops are visible.

## Scope (in)

1. **Public reads of `shops/{shopId}/menu`** via a new Cloud Function
   `listShopMenuPublic(shopId)`.
2. **`ShopListScreen` filter** — only `status == 'active'` shops are
   shown to customers.
3. **`ShopDetailScreen` rewrite** — reads from `shops/{shopId}/menu`
   (not global `products`), groups by category, shows shop-specific
   price/MRP, hides items where `available == false` or
   `stock === 0`.
4. **Cart schema additive change** — cart items must carry
   `menuItemId`, `shopId`, and the **menu price snapshot** at the time
   of add. Existing cart items without `menuItemId` keep working
   (treat as legacy product-priced).
5. **`placeOrder` server-side validation** — when a line item has
   `menuItemId`, re-read the menu doc and validate the price within ±1
   paise; reject if menu item is `available == false` or out of stock.
   When no `menuItemId` is present (legacy), keep existing
   product-based validation as a fallback.
6. **`PRELAUNCH_CHECKLIST.md`** — append v2-iii items.

## Scope (out — explicitly defer)

- Search screen rewrite (still reads global products — acceptable for
  now; flag a TODO).
- Multi-shop cart enforcement (a cart may already mix shops in legacy
  data — keep current behaviour, do not add new validation here).
- Image upload for custom items (already deferred).
- Real-time menu listeners on web (we use polled refetch — leave alone).

## Deliverables

### 1. `functions/src/index.ts` — new callable

```ts
export const listShopMenuPublic = onCall(
  { region: 'asia-south1', cors: true },
  async (req) => {
    const shopId = String(req.data?.shopId || '').trim();
    if (!shopId) {
      throw new HttpsError('invalid-argument', 'shopId required');
    }
    const shopSnap = await db.doc(`shops/${shopId}`).get();
    if (!shopSnap.exists) {
      throw new HttpsError('not-found', 'Shop not found');
    }
    const shop = shopSnap.data() as any;
    // Customers can only browse active shops; pending/suspended/rejected
    // 404 from their POV.
    if (shop.status && shop.status !== 'active') {
      throw new HttpsError('not-found', 'Shop not found');
    }
    const menuSnap = await db
      .collection(`shops/${shopId}/menu`)
      .where('available', '==', true)
      .get();
    const items = menuSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((i: any) => i.stock === null || i.stock > 0);
    return { items, shop: { id: shopSnap.id, ...shop } };
  },
);
```

Notes:
- Public — no auth required. Anonymous Auth users hit it from the home /
  shop screens.
- Filters out unavailable + zero-stock at the edge so callers don't
  re-implement that logic.
- Returns the shop doc too so the detail screen can show name / hours /
  address without a second round trip.

### 2. `functions/src/index.ts` — placeOrder validation update

In the existing `placeOrder` callable, where each line item is validated:

```ts
// Pseudocode — wire into actual code structure.
for (const line of items) {
  if (line.menuItemId) {
    const menuDoc = await db
      .doc(`shops/${line.shopId}/menu/${line.menuItemId}`)
      .get();
    if (!menuDoc.exists) {
      throw new HttpsError(
        'failed-precondition',
        `Item ${line.menuItemId} no longer on this shop's menu`,
      );
    }
    const menu = menuDoc.data() as any;
    if (!menu.available) {
      throw new HttpsError(
        'failed-precondition',
        `${menu.name} is currently unavailable`,
      );
    }
    if (menu.stock !== null && menu.stock < line.quantity) {
      throw new HttpsError(
        'failed-precondition',
        `${menu.name} only has ${menu.stock} in stock`,
      );
    }
    if (Math.abs(menu.price - line.priceSnapshot) > 0.01) {
      throw new HttpsError(
        'failed-precondition',
        `${menu.name} price changed. Please refresh and try again.`,
      );
    }
    // Use server-side menu.price as the canonical price.
    line.unitPrice = menu.price;
  } else {
    // Legacy path: validate against products collection (existing code).
  }
}
```

### 3. `src/services/orderService.ts` — client wrapper

Add a single new method (Platform.OS dispatch as usual):

```ts
async listShopMenuPublic(shopId: string): Promise<{
  items: MenuItem[];
  shop: Shop;
}> {
  const fn = Platform.OS === 'web'
    ? httpsCallable(webFunctions, 'listShopMenuPublic')
    : getNativeFunctions().httpsCallable('listShopMenuPublic');
  const res: any = await fn({ shopId });
  return Platform.OS === 'web' ? res.data : res.data;
}
```

### 4. `src/screens/ShopListScreen.tsx` — filter to active

The current screen reads shops; just filter visible shops to
`status === 'active'` **or** `status === undefined` (legacy safety —
some pre-v2-i shops have no status field; treat them as active).

Add a comment explaining the filter and pointing at this prompt.

### 5. `src/screens/ShopDetailScreen.tsx` — rewrite menu source

Replace the global-products fetch with `orderService.listShopMenuPublic(shopId)`.

- Group items by category (reuse `CATEGORIES` order from
  `constants/categories.ts`).
- Show shop's `price`; if `mrp > price`, render the strike-through MRP
  + "Save ₹X" badge (match existing visual treatment).
- Add-to-cart must include:
  - `menuItemId: item.id`
  - `shopId`
  - `priceSnapshot: item.price`
  - existing fields (`productId` if `!isCustom`, `name`, `imageUrl`,
    `packLabel`, `quantity`).
- If the menu list is empty, render the existing `EmptyState`
  ("This shop has no items right now").

### 6. `src/store/useCartStore.ts` (or wherever cart state lives) —
schema additive change

- Add `menuItemId?: string` and `priceSnapshot?: number` to the cart line
  type.
- Migration: existing AsyncStorage cart entries without these fields
  keep working. Don't force a clear-cart on upgrade.

### 7. `PRELAUNCH_CHECKLIST.md` — append

Under the v2-iii section:

- [x] `listShopMenuPublic` deployed
- [x] `placeOrder` validates menu prices when `menuItemId` is present
- [x] `ShopListScreen` filters to active shops
- [x] `ShopDetailScreen` reads from per-shop menu
- [x] Cart carries `menuItemId` + `priceSnapshot`
- [ ] (deferred) `SearchScreen` rewrite to per-shop menu
- [ ] (deferred) Multi-shop cart guard

## Deploy discipline (reminder)

Per `.windsurf/deploy-discipline.md`:

1. Run `npm run audit` first. Stop on any error.
2. Deploy the Cloud Function on its own:
   `firebase deploy --only functions:listShopMenuPublic --project grocery-mvp-dev`
3. Deploy the updated `placeOrder` on its own:
   `firebase deploy --only functions:placeOrder --project grocery-mvp-dev`
4. Verify both with `firebase functions:list --project grocery-mvp-dev`.
5. **Do not pipe deploy output through `Select-Object` or `Out-File`.**
   Firebase prompts you mid-deploy if anything is deleted; piping
   hides the prompt and hangs. (Sudhir lost 5h to this in v2-i —
   don't repeat.)
6. After functions land, push the JS bundle:
   `eas update --branch preview --message "v2-iii customer menu"`.
7. If a TypeScript error shows up in `claude_files/`, `SearchScreen`,
   `firebase.ts`, or `useOrderStore.ts` — those are pre-existing and
   tracked. Leave them alone; don't auto-fix in this PR.

## Acceptance checklist (Windsurf must verify before reporting done)

- [ ] `audit` passes.
- [ ] `listShopMenuPublic` returns expected payload for an active shop
      (smoke test via Functions emulator or one curl).
- [ ] An anonymous user opening a pending shop's detail page gets a
      "Shop not found" error (not a leak).
- [ ] `ShopListScreen` no longer shows the `shop_pending_test_*` rows
      (admin can still see them via Shop Management).
- [ ] Adding an item to cart writes `menuItemId` + `priceSnapshot` to
      cart state.
- [ ] If you toggle an item to **Unavailable** in `ShopMenuScreen` and
      then try to place an order with it still in your cart, the
      placeOrder call rejects with a clear message.
- [ ] If you edit price in `ShopMenuItemEditScreen` to ₹999 and then try
      to place the order with a stale ₹50 snapshot, placeOrder rejects.
- [ ] OTA update published.
- [ ] `PRELAUNCH_CHECKLIST.md` updated and committed.

## When done — report back with

- The two `firebase functions:list` lines for `listShopMenuPublic` +
  `placeOrder` showing their updated `updateTime`.
- The `eas update` ID / URL.
- A 1-line confirmation that the 7 acceptance items above all pass.
- Any TypeScript or audit warnings that surfaced and were intentionally
  left in (file:line + reason).

Don't summarise files you didn't touch.
