/**
 * HOTFIX-6 (Case 1) — uniform delivery-charge display.
 *
 * Pre-PR every customer-facing surface displayed `shop.deliveryFee`
 * (the flat legacy fallback) directly, while `CheckoutScreen`
 * already used `chargeForDistance(...)` against the shop's tier
 * table. The customer saw `₹25` on the shop card / detail and
 * `₹100` at checkout — pricing-trust failure.
 *
 * This helper computes the same charge `CheckoutScreen` would
 * surface, so the shop list, shop detail, and any future
 * customer-facing surface stay consistent. CheckoutScreen itself
 * is intentionally NOT switched to this helper because it has
 * additional concerns (PR 46 `getDeliveryEstimate` against the
 * customer's CHOSEN delivery address, not their live GPS) — the
 * two surfaces can disagree by design when those references differ
 * (documented in the HOTFIX-6 acceptance step 5).
 *
 * Distance preference order:
 *   1. Customer's live location (`useLocationStore`) → haversine
 *      against `shop.location`. Freshest reference; matches what
 *      `listShopsPublic` would have stamped if called with the same
 *      coords.
 *   2. `shop.distanceKm` — stamped server-side by `listShopsPublic`
 *      against the location passed at request time. Falls back to
 *      this when the customer's location store hasn't hydrated yet
 *      (e.g. cold launch into a deep-linked shop screen).
 *   3. Flat `shop.deliveryFee` — when neither distance source is
 *      available the result is the same one `chargeForDistance`
 *      would return for `distanceKm <= 0`, so we short-circuit.
 *
 * Pure; pinned by tests/utils/displayDeliveryCharge.test.ts.
 */
import type { Shop } from '../types';
import { chargeForDistance } from './deliveryChargeHelpers';
import { haversineKm } from './distance';

export function displayDeliveryCharge(
  // PR-NEXT-HOTFIX-6.1 — relaxed from `Pick<Shop, ...>` to a
  // structural shape so cart-store snapshots (where `location` and
  // `deliveryChargeTiers` can be null) satisfy the input type. The
  // runtime already handled undefined / null on both fields via the
  // `shop.location && ...` and `?? null` guards below; this change
  // just aligns the static types with what the body already does.
  shop: {
    deliveryFee: Shop['deliveryFee'];
    deliveryChargeTiers?: Shop['deliveryChargeTiers'] | null;
    distanceKm?: Shop['distanceKm'];
    location?: Shop['location'] | null;
  },
  customerLocation: { lat: number; lng: number } | null | undefined,
): number {
  let distanceKm: number;
  if (
    customerLocation &&
    typeof customerLocation.lat === 'number' &&
    Number.isFinite(customerLocation.lat) &&
    typeof customerLocation.lng === 'number' &&
    Number.isFinite(customerLocation.lng) &&
    shop.location &&
    typeof shop.location.lat === 'number' &&
    Number.isFinite(shop.location.lat) &&
    typeof shop.location.lng === 'number' &&
    Number.isFinite(shop.location.lng)
  ) {
    distanceKm = haversineKm(customerLocation, shop.location);
  } else if (
    typeof shop.distanceKm === 'number' &&
    Number.isFinite(shop.distanceKm)
  ) {
    distanceKm = shop.distanceKm;
  } else {
    return shop.deliveryFee;
  }
  return chargeForDistance(
    shop.deliveryChargeTiers ?? null,
    distanceKm,
    shop.deliveryFee,
  );
}
