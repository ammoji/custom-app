# PR-NEXT-HOTFIX-6.1 — CartScreen Bill Details delivery fee (₹25 → ₹100 still happening on cart)

**Source:** Sudhir's June 1 retest of HOTFIX-6. *"At menu page, it shows rupees 100 as delivery charges but on next page 'Your cart' 'Bill Details' section still shows 25, and final checkout screen shows 100 again."*

HOTFIX-6 patched `ShopCard` + `ShopDetailScreen` to use `displayDeliveryCharge` and CheckoutScreen already used `chargeForDistance` against the live estimate. **`CartScreen` was missed** — it still reads `useCartStore(s => s.deliveryFee)`, which is the flat `shop.deliveryFee` snapshot taken at add-to-cart time. So the customer's bill flow shows:

| Surface | Source | Value |
| --- | --- | --- |
| Shop card / detail | `displayDeliveryCharge(shop, location)` | ₹100 (tier) |
| **Cart Bill Details** | **`cartStore.deliveryFee`** | **₹25 (flat fallback)** ← bug |
| Checkout Bill Details | `chargeForDistance(tiers, estimate.distanceKm, flat)` | ₹100 (tier) |

**Deploy class:** pure client OTA.

**Read first**

1. `CLAUDE.md`
2. `.windsurf/code-discipline.md` Rules 1, 2
3. `src/screens/CartScreen.tsx` lines 17 + 72 — the broken display
4. `src/store/useCartStore.ts` — the snapshot store; needs one new optional field (`shopLocation`) so CartScreen can call `displayDeliveryCharge`
5. `src/utils/displayDeliveryCharge.ts` — the helper that already does the right thing (no edit needed)
6. `src/screens/CheckoutScreen.tsx` lines 167–183 — the reference implementation we're matching

---

## Root cause

`useCartStore` snapshots `shop.deliveryFee` + `shop.deliveryChargeTiers` at add-to-cart time (`forceAddItem`, `forceAddMenuItem`, `replaceCartWithItems`) but does NOT snapshot `shop.location`. CartScreen has no way to compute a distance-based charge — so it falls through to the flat fee.

Two fixes possible:

**A. Snapshot `shop.location` in the cart store too**, then CartScreen uses `displayDeliveryCharge(snapshot, customerLocation)`. Matches ShopDetailScreen exactly. ← **chosen path**

**B. Skip the Bill Details "Delivery fee" line entirely on CartScreen** ("Delivery fee · Calculated at checkout"). Less surprising than ₹25 but loses the bill-details preview the user expects. Worse UX. Reject.

---

## Plan

### §A — Add optional `shopLocation` to cart store

In `src/store/useCartStore.ts`, add an optional `shopLocation` field on `CartState`:

```ts
type CartState = {
  shopId: string | null;
  shopName: string | null;
  deliveryFee: number;
  deliveryChargeTiers: DeliveryChargeTier[] | null;
  // PR-NEXT-HOTFIX-6.1 — snapshot the shop's geo pin at add-to-cart
  // time so CartScreen's Bill Details can call `displayDeliveryCharge`
  // (same path as ShopCard / ShopDetailScreen). Without this the cart
  // can only render the flat `deliveryFee` fallback, producing the
  // ₹25 → ₹100 mismatch Sudhir hit in HOTFIX-6.1.
  // Optional / nullable so a legacy persisted cart from before this
  // PR hydrates cleanly; CartScreen falls back to flat in that case.
  shopLocation: { lat: number; lng: number } | null;
  items: CartItem[];
  // … rest unchanged
};
```

Default to `null` in the initial state and in every `clearCart`/empty-out branch (decrement-to-zero, removeItem-to-zero).

Add `shopLocation: shop.location ?? null` in:
- `forceAddItem` `set(...)` return
- `forceAddMenuItem` `set(...)` return
- `replaceCartWithItems` `set(...)` return — extend the `shop` arg type to accept an optional `location`

Also extend the `partialize` block at the bottom of the persist config to include `shopLocation`.

### §B — Use it in CartScreen

Replace lines 17 + 72 of `src/screens/CartScreen.tsx`:

```tsx
// Before:
const deliveryFee = useCartStore(s => s.deliveryFee);
// …
<Row label="Delivery fee" value={formatRupees(deliveryFee)} />
```

```tsx
// After — PR-NEXT-HOTFIX-6.1. Match ShopDetailScreen's charge by
// running the same `displayDeliveryCharge` against the snapshotted
// shop fields + customer's live location. Legacy carts (pre-PR
// snapshot, missing `shopLocation`) fall through to the flat
// `deliveryFee` via the helper's third-tier branch — same as today.
const deliveryFee = useCartStore(s => s.deliveryFee);
const deliveryChargeTiers = useCartStore(s => s.deliveryChargeTiers);
const shopLocation = useCartStore(s => s.shopLocation);
const customerLocation = useLocationStore(s => s.location);

const previewDeliveryCharge = displayDeliveryCharge(
  {
    deliveryFee,
    deliveryChargeTiers,
    location: shopLocation ?? undefined,
    // `distanceKm` is a listShopsPublic stamp the cart never has;
    // null falls through to the customer-haversine branch when
    // shopLocation is present, or the flat fallback otherwise.
    distanceKm: undefined,
  },
  customerLocation,
);
const total = subtotal + (previewDeliveryCharge - deliveryFee);
// …
<Row label="Delivery fee" value={formatRupees(previewDeliveryCharge)} />
<Row label="To pay" value={formatRupees(subtotal + previewDeliveryCharge)} bold />
```

Note: don't read `useCartStore.total()` for the "To pay" line — that selector still adds the flat `deliveryFee`. Compute `subtotal + previewDeliveryCharge` inline so the bill stays consistent.

Add imports:

```tsx
import { displayDeliveryCharge } from '../utils/displayDeliveryCharge';
import { useLocationStore } from '../store/useLocationStore';
```

Both carry the standard "PR-NEXT-HOTFIX-6.1 — DO NOT REMOVE" comment per Rule 1.

### §C — Pure helper signature compatibility

`displayDeliveryCharge` already takes `Pick<Shop, 'deliveryFee' | 'deliveryChargeTiers' | 'distanceKm' | 'location'>` — the structurally-typed snapshot we pass from cart-store satisfies this without a cast. Verify by reading `src/utils/displayDeliveryCharge.ts` lines 38–42.

### §D — Test pin extension

Add one case to `tests/utils/displayDeliveryCharge.test.ts`:

```ts
it('uses customer-haversine path when called with a cart-store snapshot (no distanceKm)', () => {
  // PR-NEXT-HOTFIX-6.1 regression: CartScreen passes a snapshot
  // built from the cart store, which has location + tiers but
  // NEVER has distanceKm (that's a listShopsPublic stamp). Verify
  // the helper still hits the tier path via haversine.
  const snapshot = {
    deliveryFee: 25,
    deliveryChargeTiers: [
      { maxKm: 2, charge: 25 },
      { maxKm: 5, charge: 60 },
      { maxKm: null, charge: 100 },
    ],
    location: { lat: 28.50, lng: 77.30 },
    // distanceKm intentionally omitted
  } as const;
  const customer = { lat: 28.48, lng: 77.35 }; // ~5.5 km
  expect(displayDeliveryCharge(snapshot, customer)).toBe(100);
});
```

---

## Discipline checklist

1. **Rule 1** — `displayDeliveryCharge` + `useLocationStore` imports carry "DO NOT REMOVE" comments.
2. **Rule 2** — N/A (no conditional returns added; selectors stay at top).
3. **No schema change** — cart store version stays `cart-v2`; `shopLocation` is optional and nullable; legacy persisted carts hydrate with `undefined` which the helper handles via the flat fallback.
4. **No callable change.**
5. **Test discipline** — +1 helper test pinning the cart-store-shape path.
6. **OTA classification** — pure JS, no plugin/permission changes.

---

## Acceptance checklist

1. **Fresh-add path** — customer signs in fresh (so live location is captured), adds an item from a shop the customer is ~5 km from. Cart Bill Details shows the same ₹X as the shop detail header, NOT the legacy flat fee.
2. **Distance-tier match** — open the same shop's settings (as the owner) and verify the 3–5 km tier matches what Cart shows.
3. **CheckoutScreen consistency** — proceed from Cart to Checkout. Bill Details shows the SAME ₹X (or differs only because Checkout uses the delivery target's coords, not live GPS, e.g. if customer picks "Home" 7 km away — that's by design and documented).
4. **Legacy cart hydration** — sign in on a build that persisted a pre-PR cart (or wipe AsyncStorage `cart-v2` and inject a fixture without `shopLocation`). CartScreen falls back to the flat `deliveryFee` rather than crashing; no red box.
5. **Add second item, remove first → empty → re-add** — `shopLocation` clears on empty and re-snapshots on re-add. Verify via React DevTools or a temporary log.
6. **Cold launch into a deep-linked cart** — kill the app, relaunch, open Cart directly. `shopLocation` is hydrated from AsyncStorage; bill matches the shop detail.
7. **Regression — `useCartStore.total()` callers** — grep the codebase for `useCartStore.*total\b`. Any caller other than the new CartScreen inline computation must still get the legacy "subtotal + flat fee" result (we did NOT change the selector). Document this in a one-line comment over the `total()` selector for the next reader.
8. `npx tsc --noEmit` clean; `npm run test:unit` clean; suite +1.

---

## Out of scope

- **Migrating `useCartStore.total()` to the tiered charge.** Side effects on placeOrder's local-balance check, Analytics, etc. Punt — CartScreen has the only Bill Details surface that mattered for the bug.
- **CartScreen showing a distance-aware "≈ ₹X · 3.2 km" subline.** Could be a follow-up Phase B UX polish; keep this PR focused on parity.
- **Tier-table edit during a live cart.** Charge is computed off the cart-store snapshot; if the shopkeeper changes tiers between add-to-cart and checkout, placeOrder server-side re-derives anyway. Acceptable.

---

## Deploy

```
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "PR-NEXT-HOTFIX-6.1 CartScreen Bill Details uses tier charge"
```

## Doc trail

- `docs/TESTING-FINDINGS-2026-05-30.md` — Case 1 (HOTFIX-6 reopened) → `⚠️ PARTIAL — completed in PR-NEXT-HOTFIX-6.1`.
- `docs/SESSION_LOG.md` — one paragraph.
- `CLAUDE.md` — bump date.
