/**
 * HOTFIX-6 (Case 1) — tests for the customer-facing delivery
 * charge display helper. Pinning here keeps the shop card / shop
 * detail consistent with CheckoutScreen's `chargeForDistance` math
 * across legacy + tiered shops.
 */
import { displayDeliveryCharge } from '../../src/utils/displayDeliveryCharge';
import type { Shop } from '../../src/types';

const tiers = [
  { maxKm: 1, charge: 20 },
  { maxKm: 3, charge: 40 },
  { maxKm: 5, charge: 60 },
  { maxKm: null, charge: 100 },
];

const shopWithTiers: Pick<
  Shop,
  'deliveryFee' | 'deliveryChargeTiers' | 'distanceKm' | 'location'
> = {
  deliveryFee: 25,
  deliveryChargeTiers: tiers,
  distanceKm: undefined,
  location: { lat: 12.9716, lng: 77.5946 },
};

const legacyShop: Pick<
  Shop,
  'deliveryFee' | 'deliveryChargeTiers' | 'distanceKm' | 'location'
> = {
  deliveryFee: 30,
  deliveryChargeTiers: undefined,
  distanceKm: 4,
  location: { lat: 12.9716, lng: 77.5946 },
};

describe('displayDeliveryCharge', () => {
  test('tiered shop + customer location → tier-based charge', () => {
    // Customer ~4 km away (Bengaluru offset by ~0.036 lat ≈ 4 km)
    const customer = { lat: 12.9716 + 0.036, lng: 77.5946 };
    expect(displayDeliveryCharge(shopWithTiers, customer)).toBe(60);
  });

  test('tiered shop + only stamped shop.distanceKm → tier-based charge', () => {
    const shop = { ...shopWithTiers, distanceKm: 2 };
    expect(displayDeliveryCharge(shop, null)).toBe(40);
  });

  test('legacy shop without tiers → flat deliveryFee', () => {
    expect(displayDeliveryCharge(legacyShop, { lat: 12.9716, lng: 77.5946 }))
      .toBe(30);
  });

  test('tiered shop + no customer location AND no distanceKm → flat fallback', () => {
    const shop = { ...shopWithTiers, distanceKm: undefined };
    expect(displayDeliveryCharge(shop, null)).toBe(25);
  });

  test('boundary distance (== maxKm) lands on that tier', () => {
    // chargeForDistance uses d <= t.maxKm — at exactly 3 km the
    // 3-km tier wins (₹40), not the 5-km tier.
    const shop = { ...shopWithTiers, distanceKm: 3 };
    expect(displayDeliveryCharge(shop, null)).toBe(40);
  });

  test('invalid customer coords fall through to shop.distanceKm', () => {
    const shop = { ...shopWithTiers, distanceKm: 6 };
    const badCustomer = { lat: NaN, lng: 77 };
    // Falls through to stamped distanceKm (6km → catch-all 100)
    expect(displayDeliveryCharge(shop, badCustomer)).toBe(100);
  });

  // PR-NEXT-HOTFIX-6.1 (Case 1 retest) — `CartScreen` passes a
  // snapshot built from the cart store: it has `location` + tiers
  // but NEVER has `distanceKm` (that's a `listShopsPublic` stamp
  // the cart never captures). Verify the helper still hits the
  // tier path via haversine, AND that null on tiers/location
  // (legacy persisted cart) falls through to the flat fee — the
  // exact shape Zustand will hydrate from a pre-PR cart.
  test('cart-store snapshot shape (no distanceKm) hits haversine tier branch', () => {
    const snapshot = {
      deliveryFee: 25,
      deliveryChargeTiers: tiers,
      location: { lat: 28.5, lng: 77.3 },
      // distanceKm intentionally omitted
    };
    // ~5.5 km north-east of the shop → catch-all 100 tier.
    const customer = { lat: 28.5 + 0.045, lng: 77.3 + 0.025 };
    expect(displayDeliveryCharge(snapshot, customer)).toBe(100);
  });

  test('cart-store snapshot with null tiers AND null location → flat fee', () => {
    // Legacy persisted cart (pre-PR-NEXT-HOTFIX-6.1): neither
    // `shopLocation` nor `deliveryChargeTiers` was captured. Helper
    // must short-circuit to the flat `deliveryFee` rather than
    // throwing on the missing fields.
    const snapshot = {
      deliveryFee: 25,
      deliveryChargeTiers: null,
      location: null,
    };
    const customer = { lat: 28.5, lng: 77.3 };
    expect(displayDeliveryCharge(snapshot, customer)).toBe(25);
  });
});
