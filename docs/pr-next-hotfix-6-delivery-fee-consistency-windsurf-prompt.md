# HOTFIX-6 — Delivery fee inconsistency: shop list shows ₹25, checkout shows ₹100

**Source:** Case 1 in Sudhir's June 1 testing pass. *"When customer selects the shop, it shows delivery fee 25 but during checkout it shows 100, it is wrong information for customer."*

**Deploy class:** pure client OTA. No callable, no schema. Ships via `eas update --branch production`.

**Read first**

1. `CLAUDE.md`
2. `.windsurf/code-discipline.md` Rules 1, 2
3. `src/utils/deliveryChargeHelpers.ts` — existing `chargeForDistance(tiers, distance, fallbackFlat)` pure helper (PR 47 mirror of the server one)
4. `src/screens/CheckoutScreen.tsx` lines 28, 60, 178 — the CORRECT call site (uses `chargeForDistance`)
5. `src/screens/ShopDetailScreen.tsx` line 284 — the BROKEN call site (displays raw `shop.deliveryFee`)
6. `src/screens/HomeScreen.tsx` lines 78, 231 — shop list rendering (also shows `shop.deliveryFee` likely)
7. `src/components/shop/ShopCard.tsx` — if it shows delivery fee, fix here too
8. `src/store/useLocationStore.ts` — `location` field (customer's current coords)
9. `src/types/index.ts` Shop type — confirm `deliveryFee`, `deliveryChargeTiers`, `distanceKm`, `location` fields are present

---

## Root cause

PR 47 introduced distance-based delivery charges via `chargeForDistance(tiers, distanceKm, fallbackFlat)`. CheckoutScreen calls it correctly (line 178). **ShopDetailScreen line 284 still displays `shop.deliveryFee` directly** — the flat fallback field. Same for HomeScreen's shop list rail and probably `ShopCard`.

So the customer sees:
- Shop list / detail card: **₹25** (`shop.deliveryFee` — the legacy flat field, never updated when shop adopted tiers)
- Checkout: **₹100** (`chargeForDistance` against the actual `shop.deliveryChargeTiers` at the customer's distance)

Pricing-trust failure. Customer assumes ₹25, hits ₹100 at checkout, abandons.

---

## Plan

### §A — New pure helper `src/utils/displayDeliveryCharge.ts`

Tiny wrapper around `chargeForDistance` that pulls fields off the `Shop` object — keeps every consumer's call site to a single line:

```ts
/**
 * HOTFIX-6 (Case 1) — uniform delivery-charge display.
 * Pre-PR every screen displayed `shop.deliveryFee` (flat legacy
 * fallback) and customers were surprised by a different number at
 * checkout. This helper computes the same charge CheckoutScreen
 * would surface, so the shop list, shop detail, and any future
 * surface stay consistent.
 *
 * Returns `chargeForDistance(shop.deliveryChargeTiers, distance, shop.deliveryFee)`:
 *   - distance comes from `shop.distanceKm` (stamped by listShopsPublic)
 *     OR computed via haversine if customer location is available
 *   - falls back to `shop.deliveryFee` when tiers are missing
 *     (legacy shops pre-PR-47 — same fallback `chargeForDistance` uses)
 *
 * Pure; pinned by tests/utils/displayDeliveryCharge.test.ts.
 */
import { chargeForDistance } from './deliveryChargeHelpers';
import { haversineKm } from './distance';
import type { Shop } from '../types';

export function displayDeliveryCharge(
  shop: Pick<Shop, 'deliveryFee' | 'deliveryChargeTiers' | 'distanceKm' | 'location'>,
  customerLocation: { lat: number; lng: number } | null | undefined,
): number {
  // Prefer the freshest distance: customer's live location → haversine
  // against the shop's location. Falls back to `shop.distanceKm` (stamped
  // server-side by `listShopsPublic` against a known location) if customer
  // location isn't available yet.
  let distanceKm: number;
  if (
    customerLocation &&
    typeof customerLocation.lat === 'number' &&
    typeof customerLocation.lng === 'number' &&
    shop.location
  ) {
    distanceKm = haversineKm(customerLocation, shop.location);
  } else if (typeof shop.distanceKm === 'number' && Number.isFinite(shop.distanceKm)) {
    distanceKm = shop.distanceKm;
  } else {
    // No distance — return the flat fallback; `chargeForDistance`
    // would too via its `distanceKm <= 0` branch.
    return shop.deliveryFee;
  }
  return chargeForDistance(
    shop.deliveryChargeTiers ?? null,
    distanceKm,
    shop.deliveryFee,
  );
}
```

### §B — Tests `tests/utils/displayDeliveryCharge.test.ts`

~6 cases:

1. shop with tiers + customer location → tier-based charge
2. shop with tiers + only `shop.distanceKm` (no customer location) → tier-based charge from stamped distance
3. shop without tiers → returns `shop.deliveryFee` flat fallback
4. shop with tiers but customer location missing AND `shop.distanceKm` missing → flat fallback
5. customer at boundary distance (== maxKm) → next tier (inclusive boundary, matches `chargeForDistance` semantics from PR 47)
6. shop with invalid `location` (non-finite lat/lng) → flat fallback

### §C — Replace every direct `shop.deliveryFee` display with the helper

Grep `shop.deliveryFee` in `src/`. For each render site that shows the value to a CUSTOMER (i.e. not the shop owner's own settings screen), wire through the new helper:

#### §C.1 — `src/screens/ShopDetailScreen.tsx` line 284

Current:
```tsx
{formatDistance(shop.distanceKm)} · {shop.etaMinutes} min ·{' '}
{formatRupees(shop.deliveryFee)} delivery · Min{' '}
{formatRupees(shop.minOrder)}
```

Change to:
```tsx
{formatDistance(shop.distanceKm)} · {shop.etaMinutes} min ·{' '}
{formatRupees(displayDeliveryCharge(shop, location))} delivery · Min{' '}
{formatRupees(shop.minOrder)}
```

`location` is already pulled from `useLocationStore(s => s.location)` at line 80 of the file — reuse it.

Add the import at the top:
```ts
// HOTFIX-6 (Case 1) — DO NOT REMOVE. Distance-based display charge.
import { displayDeliveryCharge } from '../utils/displayDeliveryCharge';
```

#### §C.2 — `src/screens/HomeScreen.tsx` line 231 (and anywhere else `shop.deliveryFee` is shown in the shop list rail)

Same swap. Grep for `deliveryFee` in `HomeScreen.tsx` — replace each customer-facing display with `displayDeliveryCharge(shop, location)`. The customer location is already in scope via `useLocationStore`.

#### §C.3 — `src/components/shop/ShopCard.tsx`

Grep for `deliveryFee` in this file. Same swap. If the card receives `shop` + `customerLocation` as props (most likely), use those.

If it receives only `shop` and not customer location, either:
- Add `customerLocation` as a new prop and pass it through from the parent (HomeScreen / ShopListScreen)
- OR call `useLocationStore` inside the card (acceptable; it's a Zustand hook and shouldn't cause render churn since the location reference is stable when unset)

Prefer the prop-threading approach — it keeps the card a pure presentation component.

#### §C.4 — `src/screens/ShopListScreen.tsx`

Same swap if there's a direct display there. (May not be — depends on whether ShopList shows the fee inline or relies on ShopCard.)

### §D — Don't touch the shop owner's own settings screen

`src/screens/shop/ShopSettingsScreen.tsx` shows the shop owner their `deliveryFee` field for editing. That's the source-of-truth value the owner sets; keep it as-is.

### §E — Don't touch CheckoutScreen

Already uses `chargeForDistance` correctly. The new helper is the same logic with the customer-location lookup baked in, but CheckoutScreen has special needs (PR 46 `getDeliveryEstimate` + the locked address with distance from the chosen address, not customer's live location). Leave it alone.

---

## Discipline checklist

1. **Rule 1** — `displayDeliveryCharge` import carries "DO NOT REMOVE" comment.
2. **Rule 2** — No new hooks beyond the existing `useLocationStore` consumers.
3. **No schema, no callable.**
4. **Test discipline** — §B adds ~6 tests. Suite count +6.
5. **OTA classification** — pure JS.

---

## Acceptance checklist

Need one customer device + a shop with tiered delivery charges (your pilot shop should already have tiers from ShopSettings).

1. Sign in as customer. Open HomeScreen. Shop list rail shows each shop's distance-based charge — NOT the flat `shop.deliveryFee`. If your test shop has tiers [{maxKm:1,charge:20}, {maxKm:3,charge:40}, {maxKm:5,charge:60}, {maxKm:null,charge:100}] and you're 4 km away, the card should read `₹60` not `₹25`.
2. Tap into ShopDetailScreen. Meta line under the shop name shows the same `₹60`.
3. Add items to cart, proceed to CheckoutScreen. Delivery fee preview reads `₹60`. **All three surfaces match.**
4. Place the order. Order detail screen + shopkeeper dashboard both show the same `₹60` charge.
5. Edge case: switch the customer's "deliver to" address to one 8 km away. Re-open CheckoutScreen. Now shows `₹100` (catch-all tier). Re-open ShopDetailScreen (the customer's `useLocationStore` location is still their original 4 km position). Shows `₹60`. **Documented behavior — shop list uses customer's current GPS location; checkout uses the chosen delivery address. Mention in the doc trail.**
6. Legacy shop without tiers — falls back to flat `shop.deliveryFee`. Customer sees the same number across surfaces.
7. `npx tsc --noEmit` clean. `npm run test:unit` clean; suite +6.

---

## Out of scope

- **Reconciling shop-detail's display distance to the checkout's chosen-address distance.** Two different reference points by design (shop browse vs. specific delivery). Logged in step 5 above.
- **Showing the tier breakdown** on the shop card (e.g. "₹60 (4 km tier)"). Customer doesn't need to see the math; just the consistent number.
- **Server-side `listShopsPublic` already computes `shop.distanceKm` per request.** Don't redundantly recompute on the server.

---

## Deploy plan

```
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "HOTFIX-6 delivery fee consistency"
```

## Doc trail

- `docs/TESTING-FINDINGS-2026-05-30.md` — log Case 1 as Finding **#19** (or next number) → `✅ SHIPPED in HOTFIX-6`.
- `docs/SESSION_LOG.md` — one paragraph: pricing-trust bug, `displayDeliveryCharge` helper, every customer surface now uses it, checkout left alone (already correct).
- `CLAUDE.md` — bump date.
