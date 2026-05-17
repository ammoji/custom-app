# PR 4 — Customer search rewrite + cart integrity (Windsurf prompt)

## Why this PR exists

Two related gaps surfaced during family-style testing on May 17 2026:

1. **Search and category tabs find nothing in newly-registered shops.**
   The `SearchScreen` and the HomeScreen category chips still read
   from the legacy global `/products` collection — the data source
   that existed before Phase 12a-v2-iii moved customer-facing menu
   reads to the per-shop `shops/{shopId}/menu` subcollection. The 8
   seeded demo shops happen to have items that match the global
   catalog (their menus were bootstrapped from it), so search appears
   to work for them. Any shop registered post-v2-iii has its own
   per-shop menu items that the search code never queries. Customer
   typing "atta" in a real shop's catchment gets zero results even
   though the shop carries atta. Confidence-destroying.

2. **Multi-shop cart guard missing on server.** The cart store
   prevents adding items from a second shop client-side, but the
   server's `placeOrder` does NOT validate that every line item's
   resolved menu belongs to the same shop as the order's
   `shopId`. A malicious or buggy client could submit a cart whose
   lines span shops; the per-line check (does this menu item exist
   in this shop?) is correct per-item but not collectively. This
   was flagged as a deferred follow-up from v2-iii.

Both fixes belong together because they share the per-shop menu
data model and customer-purchase context. JS-only client changes
plus one new Cloud Function and a one-line addition to `placeOrder`.

## Read first

- `.windsurf/test-discipline.md` and `.windsurf/deploy-discipline.md`.
- `src/screens/SearchScreen.tsx` — current implementation, queries
  legacy `/products`. Will be rewritten.
- `src/services/searchService.ts` (or wherever the current search
  lives) — find via grep for `getNearbyShops` and `/products`. Note:
  this is one of the files flagged in the baseline TypeScript-error
  list because it called `getNearbyShops()` without an argument. PR
  4 should fix that too as a tag-along since we're touching the
  search code path anyway.
- `src/screens/HomeScreen.tsx` — category chips navigate to
  `Search` with a `category` route param. Reuse the same callable.
- `functions/src/index.ts` — `listShopMenuPublic` is the closest
  pattern for the new search callable (no-auth, status-gated, runs
  in asia-south1). Copy that posture.
- `src/store/useCartStore.ts` — existing client-side multi-shop
  guard logic. Need to confirm it's actually preventing the bug;
  if it is, server-side guard is defense-in-depth.
- `firestore.rules` — collection group reads on `menu` need a rule
  (currently the rule is scoped to specific shopId path; a
  collection group query needs `match /{path=**}/menu/{menuItemId}`
  with the same active-shop predicate).
- `tests/functions/listShopsPublic.test.ts` — pattern for testing
  public callables that filter by status / availability.

## Scope (in)

### Part 1 — Server: new `searchMenuPublic` callable

New Cloud Function in `functions/src/index.ts`:

```ts
export const searchMenuPublic = onCall<{
  query?: string;
  category?: string;
  location?: { lat: number; lng: number };
}>(
  { cors: true, enforceAppCheck: false },
  async (request) => {
    // No auth required — customer browsing.
    const { query, category, location } = request.data ?? {};
    // ...
  }
);
```

Implementation:

1. **Get candidate shops first.** Reuse the existing nearby-shops
   logic (1km filter when location is provided, all active shops
   otherwise). Cap candidate set at 30 shops (Firestore `in` query
   limit). Drop any shop where `status !== 'active'`.
2. **Collection-group query on menu** filtered by the candidate
   shop IDs:
   ```ts
   db.collectionGroup('menu')
     .where('shopId', 'in', candidateShopIds.slice(0, 30))
     .where('available', '==', true)
   ```
3. **In-memory filter** on the result:
   - If `query` is set: keep items where `name.toLowerCase().includes(query.toLowerCase().trim())` OR matches any tag.
   - If `category` is set: keep items where `category === category`.
   - Drop items where `stock === 0` (in stock).
4. **Cap result at 50 items** to keep payloads small (mirrors
   `listShopMenuPublic`'s 50-item cap).
5. **Join with shop info** for each result so the client can show
   "Atta · Sharma Kirana Store · ₹260". Build a `{ shopId →
   { name, address, distanceKm } }` map from the candidate shops
   set; attach to each menu item.
6. **Return shape**:
   ```ts
   {
     items: Array<{
       menuItem: MenuItem; // existing type
       shop: { id: string; name: string; address: string; distanceKm?: number };
     }>;
   }
   ```

**Sort posture**: client decides display order. Server returns by
insertion order from the collection-group query. Don't add an
`orderBy` clause — it would force composite indexes per filter
combination and limit future flexibility.

### Part 2 — Server: rules update for collection-group menu reads

In `firestore.rules`, add a collection-group rule mirroring the
existing per-shop rule:

```
match /{path=**}/menu/{menuItemId} {
  allow read: if isAdmin()
    || (resource.data.shopId is string
        && get(/databases/$(database)/documents/shops/$(resource.data.shopId))
             .data.status == 'active');
  allow create, update, delete: if false;
}
```

This lets web-SDK clients run collection-group queries without
hitting permission errors. Native clients route through the new
callable so the rule is mostly for symmetry + web SDK + admin
console.

### Part 3 — Server: index for the collection-group query

Add to `firestore.indexes.json`:
```json
{
  "collectionGroup": "menu",
  "queryScope": "COLLECTION_GROUP",
  "fields": [
    { "fieldPath": "shopId", "order": "ASCENDING" },
    { "fieldPath": "available", "order": "ASCENDING" }
  ]
}
```

### Part 4 — Server: multi-shop cart guard in `placeOrder`

In `placeOrder` (after the existing per-line menu lookup), add:

```ts
// Defense-in-depth: every resolved menu item must belong to the
// order's shopId. Client-side multi-shop guard exists in
// useCartStore but a buggy or malicious client could ship a cart
// spanning shops. The per-line lookup already rejects
// "menu item X doesn't exist in this shop" — this check makes the
// collective intent explicit and easier to grep for in security
// review.
for (const resolved of resolvedItems) {
  if (resolved.shopId !== input.shopId) {
    throw new HttpsError(
      'failed-precondition',
      `Cart item ${resolved.menuItemId} belongs to a different shop. Clear cart and try again.`,
    );
  }
}
```

Also add a pure helper for testability:
`functions/src/cartIntegrityHelpers.ts` with
`validateAllItemsInSameShop(resolvedItems, expectedShopId): { ok } | { ok: false; offendingMenuItemId }`.

### Part 5 — Client: `orderService.searchMenuPublic`

Standard dual-dispatch method in `src/services/orderService.ts`:

```ts
async searchMenuPublic(input: {
  query?: string;
  category?: string;
  location?: { lat: number; lng: number };
}): Promise<{ items: Array<{ menuItem: MenuItem; shop: { id, name, address, distanceKm? } }> }> { ... }
```

Native uses RNFB, web uses web SDK callable — same posture as
`listShopMenuPublic`.

### Part 6 — Client: SearchScreen rewrite

Rewrite `src/screens/SearchScreen.tsx`:

- Remove the call to `shopService.getNearbyShops()` (the broken
  no-argument call that's been a baseline tsc error). Removes one
  of the pre-existing TypeScript errors as a tag-along win.
- On mount and on query/category change, debounce 250ms then call
  `orderService.searchMenuPublic({ query, category, location })`.
- Render results as a flat list:
  - Each row: item image, item name, shop name + distance, price,
    "Add to cart" button.
- Empty state: "No items match" with subtitle showing query +
  category.
- Tapping a result: navigate to `ShopDetail` with `shopId =
  result.shop.id`. (V2 could deep-link to the item; for MVP just
  open the shop.)
- Show shop's `minOrder` and `deliveryFee` somewhere if useful
  (skip if it complicates layout).

Don't try to add the "Add to cart" affordance inline — that
requires duplicating the cart-handling logic from ShopDetailScreen.
Just navigate to the shop and let them add from there. Simpler,
matches user mental model ("I want THIS shop's atta").

### Part 7 — Client: category-tabs use the same callable

HomeScreen category chips navigate to `Search` with
`{ category: cat.id }` param. SearchScreen reads the param and
calls `searchMenuPublic({ category, location })` with no query.
Already works once Part 6 ships — verify the param wiring is
intact. No client code change beyond what Part 6 already does.

### Part 8 — Tests

Pure helper tests:
- `tests/functions/cartIntegrityHelpers.test.ts` (≥4 tests):
  - All items match shopId → ok.
  - Single item mismatches → not ok, returns offendingMenuItemId.
  - Empty items array → ok.
  - All items mismatch → returns first offender.

Callable contract tests:
- `tests/functions/searchMenuPublic.test.ts` (≥6 tests, mock
  Firestore reads):
  - No query, no category → returns all available items in
    candidate shops up to 50.
  - Query matches case-insensitively.
  - Category filter.
  - Excludes `available === false`.
  - Excludes `stock === 0`.
  - Excludes items from non-active shops even if they were in
    candidates (defensive).

Parity test extension in
`tests/contracts/orderReadAuth.parity.test.ts`: add
`searchMenuPublic` to the matrix (no auth required; same shape as
`listShopMenuPublic`).

## Scope (out — explicitly defer)

- **Full-text search / typo tolerance / Algolia / Typesense.** MVP
  uses substring matching on `name` and `tags`. Already noted in
  the prelaunch checklist as a 10k-DAU trigger.
- **Search analytics / "most searched"**. Post-launch.
- **Item-level deep-link from search result to a specific item**
  on the shop's detail screen. Just navigate to the shop for now.
- **Showing "Add to cart" inline on search results.** Adds
  complexity (cart store dispatch, shop context), defer to V2.
- **Sorted results by relevance.** Server returns insertion order;
  client could sort but stay simple for MVP.
- **Cross-category fuzzy match.** If category is "Beverages" and a
  Chocobar is in "Frozen", it won't show. Correct behavior — let
  customer use query for cross-category search.

## Acceptance checklist

- [ ] `searchMenuPublic` callable deployed in asia-south1.
- [ ] `firestore.rules` collection-group menu rule added; rules
      compile clean.
- [ ] `firestore.indexes.json` has the new composite (shopId +
      available); `npm run audit:indexes` passes.
- [ ] `placeOrder` rejects multi-shop carts with
      failed-precondition; `cartIntegrityHelpers` pure helper
      extracted + tested.
- [ ] `SearchScreen` rewritten — no longer reads `/products`. The
      broken `shopService.getNearbyShops()` call (no args) is
      removed. Pre-existing tsc error count drops by 1.
- [ ] Category tabs on HomeScreen still route correctly to the new
      search.
- [ ] `npm test` passes — total ≥ baseline + ~10 new tests.
- [ ] Deliberate-break demo: weaken `cartIntegrityHelpers` to
      always return ok (the "no guard" buggy state). Confirm a
      specific test fails by name. Revert.
- [ ] `npx tsc --noEmit` — 0 new errors; baseline drops by 1 (the
      SearchScreen call-site fix).
- [ ] `npm run audit:indexes` passes — new collection-group index
      recognized.

## Deploy plan (hand to user — NOT executed)

Per `.windsurf/deploy-discipline.md`, one target per command.

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# Rules + indexes first
firebase deploy --only firestore:rules --project grocery-mvp-dev
firebase deploy --only firestore:indexes --project grocery-mvp-dev

# Wait for indexes to build (~2-5 min). Check status at:
# https://console.firebase.google.com/project/grocery-mvp-dev/firestore/indexes

# Functions
firebase deploy --only functions:searchMenuPublic --project grocery-mvp-dev
firebase deploy --only functions:placeOrder --project grocery-mvp-dev

# Verify
firebase functions:list --project grocery-mvp-dev

# OTA preview first (test on your phone before family)
eas update --branch preview --message "PR 4: customer search rewrite + cart integrity"
```

After preview-testing:
- Tap a category chip on Home → results from your test shop appear.
- Search "Chocobar" → finds the item in your test shop with shop name + price.
- Tap a result → opens the shop's detail screen.
- Try to manually craft a multi-shop cart (would need to bypass
  client guard) → server rejects with `failed-precondition`.

If all clean: `eas update --branch production --message "PR 4..."`.

## Reporting back

- Output of `npm test` (one final run).
- Output of `npx tsc --noEmit` — baseline count should drop by 1
  (the SearchScreen tag-along fix). Confirm.
- Deliberate-break demo: test name that failed, line you weakened.
- New files + line counts.
- Per-step deploy outputs to be handed back to me.

## Design notes for Windsurf

- The category filter on `MenuItem.category` is a string. Make
  sure the comparison is `===` exact-match, not includes — category
  IDs are stable enums.
- The shop's distance calculation should NOT be re-run client-side
  in the search results. Server computes it once when building
  the candidate set and includes it in the shop join. Saves a per-
  result calc.
- The collection-group query needs the shop's location for the
  distance display. Either denormalize shop location into menu
  items (more disk, simpler query) or join in-memory from the
  candidate-shops map (what the spec calls for). Use the in-memory
  join — denormalization here doesn't pull its weight and would
  need a migration for existing menu items.
- Auto-formatter import-stripping: same as PRs 1, 2, 12c. Verify
  helper imports survived after save.
- The pre-existing tsc error
  `SearchScreen.tsx:49 — Expected 1 arguments, but got 0` should
  disappear after this PR. If you're rewriting that file from
  scratch, just don't reintroduce the call.
