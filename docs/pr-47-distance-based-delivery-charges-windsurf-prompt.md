# PR 47 — Distance-based delivery charges (Windsurf prompt)

> Second PR of the geo/distance system (see
> `docs/GEO_DISTANCE_SYSTEM_DESIGN.md`). Builds directly on PR 46:
> it reads the `deliveryDistanceKm` that PR 46 now stamps on every
> order and turns it into a per-shop, tiered delivery charge —
> replacing the flat `shop.deliveryFee`.

## Why this PR exists

Today the delivery charge is a flat per-shop constant
(`shop.deliveryFee`, used in `placeOrder` ~line 500). A customer
1 km from the shop pays the same as one 8 km away — wrong for
both the customer (over-charged when close) and the economics
(under-charged when far).

PR 47 makes the charge scale with distance via **per-shop
configurable tiers**, exactly as the testing team requested:

> ≤1 km = X, 1–3 km = Y, 3–5 km = Z, else A — and the distance
> thresholds AND amounts both configurable.

The distance input is already solved: PR 46 stamps
`order.deliveryDistanceKm` (haversine × 1.4 during pilot;
Distance-Matrix-accurate when the flag flips later). PR 47 just
maps that number to a charge via the shop's tier table.

## Read first

- `docs/GEO_DISTANCE_SYSTEM_DESIGN.md` — the "PR 47" section + the
  `Shop.deliveryChargeTiers` data model.
- `functions/src/index.ts` ~line 500 — `placeOrder`, where
  `deliveryFee` + `total` are computed and the order doc is
  written. This is where the tiered charge replaces the flat fee.
- `functions/src/index.ts` ~line 3414 (`approveShop`) — where new
  shop docs are created. The admin-default tier table seeds here.
- `src/types/index.ts` — `Shop` type. Add `deliveryChargeTiers`.
- `src/screens/shop/ShopSettingsScreen.tsx` — where the shop owner
  edits shop config (hours, status, KYC). The tier editor lands
  here.
- `src/screens/CheckoutScreen.tsx` — PR 46 already shows the
  `~N min · X.X km` estimate. PR 47 adds the computed delivery
  charge to the bill summary.
- `.windsurf/code-discipline.md` — Rule 10 (Firestore reads-
  before-writes) if placeOrder's transaction is touched.
- `.windsurf/deploy-discipline.md` — Cloud Run IAM verification
  for any modified/new callable.

## Scope of changes

### A. `Shop` type — delivery charge tiers

`src/types/index.ts`:

```ts
export type DeliveryChargeTier = {
  // Upper bound of this band, inclusive, in km. `null` = the
  // catch-all "everything beyond the last numbered band".
  maxKm: number | null;
  charge: number;   // ₹
};

// On Shop:
deliveryChargeTiers?: DeliveryChargeTier[];   // optional for
  // back-compat: legacy shops without it fall back to deliveryFee
```

`deliveryChargeTiers` is OPTIONAL. Legacy shops (and the existing
Sudhir Grocery Store) won't have it; the charge logic falls back
to their flat `deliveryFee` (see helper below). New shops get the
admin default at approve time.

### B. Pure helper — `functions/src/deliveryChargeHelpers.ts`

The core logic, fully testable without firebase-admin.

```ts
/**
 * PR 47 — pure delivery-charge tier resolution.
 *
 * Maps a distance (km) to a charge using the shop's tier table.
 * Tiers are ordered ascending by maxKm; the first tier whose
 * maxKm >= distance wins; a `maxKm: null` tier is the catch-all
 * for anything beyond the last numbered band.
 *
 * Boundary semantics: maxKm is INCLUSIVE. "≤1km" means a 1.0km
 * delivery falls in the first band. 1.0001km falls in the next.
 *
 * Back-compat: if `tiers` is empty/undefined/malformed, the caller
 * passes the shop's legacy flat `deliveryFee` as `fallbackFlat`
 * and we return that — so a pre-PR-47 shop keeps charging its old
 * flat fee until its owner configures tiers.
 */

export const DEFAULT_DELIVERY_CHARGE_TIERS: DeliveryChargeTier[] = [
  { maxKm: 1, charge: 20 },
  { maxKm: 3, charge: 40 },
  { maxKm: 5, charge: 60 },
  { maxKm: null, charge: 100 },
];

export function chargeForDistance(
  tiers: DeliveryChargeTier[] | null | undefined,
  distanceKm: number,
  fallbackFlat: number,
): number {
  // 1. Validate tiers: must be a non-empty array of well-formed
  //    { maxKm: number|null, charge: number }. If not → return
  //    fallbackFlat (legacy behavior).
  // 2. Defensive: clamp negative distance to 0.
  // 3. Sort a COPY ascending by maxKm (null sorts last).
  // 4. First tier where maxKm === null OR distanceKm <= maxKm → its charge.
  // 5. If somehow none match (no null catch-all + distance beyond
  //    all bands) → return the last tier's charge (don't under-charge).
}

/** Validate a tier array submitted from the Shop Settings editor. */
export function validateDeliveryChargeTiers(
  tiers: unknown,
): { ok: true; tiers: DeliveryChargeTier[] } | { ok: false; message: string } {
  // - must be a non-empty array
  // - each entry: charge is a non-negative finite number; maxKm is
  //   either a positive finite number or null
  // - exactly ONE null-maxKm entry, and it must be the highest band
  //   (catch-all). If the owner didn't add a catch-all, reject with
  //   a clear message OR auto-append one — prefer REJECT with a
  //   helpful message so the owner consciously sets the "beyond X km"
  //   price.
  // - numbered maxKm values strictly ascending (no duplicates/overlap)
}
```

### C. `placeOrder` — compute the tiered charge server-side

`functions/src/index.ts` placeOrder (~line 500):

```ts
// Was: const deliveryFee = shop.deliveryFee;
// Now:
const deliveryCharge = chargeForDistance(
  shop.deliveryChargeTiers,
  order.deliveryDistanceKm ?? 0,   // from PR 46; 0 if somehow absent
  shop.deliveryFee ?? 0,            // legacy fallback
);
const total = subtotal + deliveryCharge;
```

- Stamp `deliveryCharge` onto the order doc.
- ALSO set `deliveryFee = deliveryCharge` on the order so any
  existing reader of `deliveryFee` (admin screens, receipts,
  refund logic) gets the correct number without needing to know
  about the new field. (Back-compat shim — deprecate
  `deliveryFee` later once all readers move to `deliveryCharge`.)
- **Server-authoritative**: the charge is computed from the
  server's `order.deliveryDistanceKm` (which PR 46 already re-
  derives server-side) and the shop's stored tiers. The client's
  displayed charge is never trusted for the actual total — same
  anti-tamper posture as PR 46's distance.

If placeOrder uses a transaction, keep all reads before writes
(Rule 10).

### D. `approveShop` — seed default tiers for new shops

`functions/src/index.ts` approveShop (~line 3414, where the shop
doc is written with `status: 'active'`):

- When creating the shop doc, if it has no `deliveryChargeTiers`,
  set `deliveryChargeTiers: DEFAULT_DELIVERY_CHARGE_TIERS`.
- This way every newly-approved shop has working tiers
  immediately; the owner can customize later.

### E. Shop Settings — tier editor

`src/screens/shop/ShopSettingsScreen.tsx`:

A "Delivery charges" section. The owner sees their tier bands and
can edit both the distance thresholds and the amounts:

```
Delivery charges (by distance)
  Up to [1.0] km        ₹ [20]    [✕]
  Up to [3.0] km        ₹ [40]    [✕]
  Up to [5.0] km        ₹ [60]    [✕]
  Beyond the last band  ₹ [100]            ← the null catch-all, km not editable
  [ + Add band ]
  [ Save delivery charges ]
```

- Each numbered band: editable `maxKm` (number input) + editable
  `charge` (₹ input) + remove button.
- The catch-all band (maxKm null): editable charge only, labeled
  "Beyond the last band" / "More than X km" where X is the last
  numbered band's maxKm. Always present, can't be removed.
- "Add band" inserts a new numbered band above the catch-all.
- On Save: run `validateDeliveryChargeTiers` client-side first for
  a friendly inline error (ascending, catch-all present, positive
  numbers), then call a callable to persist.
- Helper text: "Customers are charged based on how far they are
  from your shop. Set your own distances and prices."

### F. Persistence callable — `updateShopDeliveryTiers`

`functions/src/index.ts`:

```ts
export const updateShopDeliveryTiers = onCall<{
  tiers: DeliveryChargeTier[];
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    // 1. require shop-owner role; resolve caller's shopId from claims
    // 2. validateDeliveryChargeTiers(request.data.tiers) — throw
    //    invalid-argument with the message on failure
    // 3. write tiers to shops/{shopId}.deliveryChargeTiers
    // 4. return { ok: true }
  },
);
```

(Shop owner edits only their own shop — scope to `claims.shopId`,
same single-shop model as the rest of the app.)

### G. Checkout — show the computed charge

`src/screens/CheckoutScreen.tsx`:

- PR 46 already computes the estimate (`~N min · X.X km`) via
  `getDeliveryEstimate`. PR 47 also computes the charge:
  `chargeForDistance(shop.deliveryChargeTiers, estimate.distanceKm,
  shop.deliveryFee)` and shows it in the bill:
  ```
  Subtotal        ₹240
  Delivery (2.3 km)  ₹40
  Total           ₹280
  ```
- The charge shown is a preview; placeOrder re-computes
  authoritatively. If they differ (shouldn't, but distance could
  re-derive slightly differently server-side), the server value
  wins and the order reflects it.

The client needs the shop's tiers to show the preview — they're
on the shop doc the customer already loaded for the menu, so no
extra fetch.

## Tests

1. `tests/functions/deliveryChargeHelpers.test.ts`:
   - `chargeForDistance` band selection: 0.5km→tier1, exactly
     1.0km→tier1 (inclusive), 1.0001km→tier2, 4km→tier3, 10km→
     catch-all.
   - empty/undefined/malformed tiers → returns `fallbackFlat`.
   - negative distance → clamps to 0 → tier1.
   - no catch-all + distance beyond all bands → last tier's charge
     (no under-charge).
   - unsorted input tiers → sorted internally, correct band wins.
   - `validateDeliveryChargeTiers`: valid passes; empty rejects;
     missing catch-all rejects; two catch-alls rejects; non-
     ascending rejects; negative charge rejects; non-number maxKm
     rejects.
2. `tests/functions/updateShopDeliveryTiers.test.ts` (or fold into
   an existing callable test file): shop-owner caller persists;
   non-owner rejected; invalid tiers → invalid-argument.
3. Update any `placeOrder` test that asserted the flat
   `deliveryFee` to expect the tiered `deliveryCharge`.

Target ~15 new cases. Suite should land ~873+.

## Discipline checklist

- [ ] `deliveryChargeTiers` OPTIONAL on Shop — legacy shops fall
      back to flat `deliveryFee` via the helper.
- [ ] placeOrder computes charge from SERVER-side distance + shop
      tiers; client preview never trusted for the total.
- [ ] `deliveryFee` on the ORDER set = `deliveryCharge` for
      back-compat with existing readers.
- [ ] Firestore reads-before-writes if placeOrder transaction
      touched (Rule 10).
- [ ] Hooks above conditional returns in ShopSettingsScreen.
- [ ] Cloud Run IAM verify for `updateShopDeliveryTiers` +
      re-verify `placeOrder` + `approveShop` post-deploy.
- [ ] No native rebuild (OTA-eligible).

## Deploy plan

1. `npm run test:unit` — green.
2. **Server:** `firebase deploy --only functions:placeOrder,functions:approveShop,functions:updateShopDeliveryTiers`.
3. **Cloud Run IAM verify** all three:
   ```powershell
   gcloud run services get-iam-policy updateshopdeliverytiers --region=asia-south1 --project=grocery-mvp-dev
   gcloud run services get-iam-policy placeorder --region=asia-south1 --project=grocery-mvp-dev
   gcloud run services get-iam-policy approveshop --region=asia-south1 --project=grocery-mvp-dev
   ```
   Add `allUsers`/`run.invoker` to any missing.
4. **Client OTA:** `eas update --branch production --message "PR 47 distance-based delivery charges"`.
5. Force-quit + reopen twice; run smoke.

## Smoke acceptance (add to PILOT_SMOKE_TEST_PLAN.md)

1. **Shop owner edits tiers.** Sign in as shop owner → Settings →
   Delivery charges → see the default tiers → change ≤1km to ₹15,
   add a band, save → re-open Settings → values persisted.
2. **Invalid tiers rejected.** Try to save with a non-ascending
   band or no catch-all → inline error, not saved.
3. **Charge scales with distance (near).** As customer with a
   delivery location ~0.5km from shop → checkout bill shows the
   tier-1 charge (₹20 default).
4. **Charge scales with distance (far).** Use a delivery location
   ~4km away → bill shows the tier-3 charge (₹60 default). The
   total updates accordingly.
5. **Order locks the charge.** Place the order → order doc has
   `deliveryCharge` matching the tier for its `deliveryDistanceKm`,
   and `deliveryFee` mirrors it. Total = subtotal + deliveryCharge.
6. **Legacy shop fallback.** If any pre-PR-47 shop without tiers
   exists, an order to it still charges its old flat `deliveryFee`
   (no crash, no ₹0).
7. **New shop gets defaults.** Register + approve a fresh shop →
   its doc has `deliveryChargeTiers` = the default table.

## Out of scope (later geo PRs)

- Shop service radius + customer distance display (PR 48).
- Partner routing / total ride distance (PR 49).
- Partner notification radius (PR 50).
- Who the delivery charge is paid out to (shop vs partner split) —
  that's an economics/payout design, separate from computing the
  charge. Not in the geo system.

## Definition of done

- `Shop.deliveryChargeTiers` + `chargeForDistance` +
  `validateDeliveryChargeTiers` shipped and tested.
- placeOrder computes the tiered charge server-side from PR 46's
  distance; stamps `deliveryCharge` (+ mirrors `deliveryFee`).
- approveShop seeds default tiers for new shops.
- Shop Settings has a working tier editor (thresholds + amounts,
  add/remove, catch-all, validation).
- Checkout shows the computed charge in the bill.
- Legacy shops without tiers fall back to flat fee (no crash).
- ~15 new tests; suite green (~873+).
- Cloud Run IAM verified for the new/modified callables.
- Doc trail updated; design doc PR 47 marked shipped.
