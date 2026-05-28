/**
 * PR 49 — delivery-partner routing math (client-only).
 *
 * Pure decision logic for the dashboard's nearest-first sort + the
 * per-card ride-distance line. Lives outside the screen so the
 * routing math is unit-testable without React / RN. The server does
 * NOT sort pickups — partner location is foreground-only and the
 * sort is per-partner — so this helper has no `functions/` mirror,
 * unlike `geoVisibilityHelpers` (PR 48) and `deliveryChargeHelpers`
 * (PR 47).
 *
 * All functions are pure: no input mutation, no side effects.
 */

import type { GeoPoint, Order } from '../types';
import { haversineKm } from './distance';

export type RideLegs = {
  /** Partner → shop. `null` when either coord is missing. */
  toShopKm: number | null;
  /**
   * Shop → customer. Mirrors `order.deliveryDistanceKm` (server-
   * authoritative, stamped at placeOrder time per PR 46). `null`
   * for legacy / pre-PR-46 orders that don't carry it.
   */
  toCustomerKm: number | null;
  /**
   * Sum of both legs. `null` unless BOTH legs are known — we never
   * partial-render a "total" that only counts one leg, since that
   * would mislead a partner deciding whether to claim.
   */
  totalKm: number | null;
};

/**
 * Compute the two ride legs for a single pickup.
 *
 * Pure. Pass `partner = null` when the partner's GPS hasn't been
 * captured yet (permission not granted, or first focus before the
 * Location API resolves) — both `toShopKm` and `totalKm` come back
 * `null` and the card omits the ride line.
 */
export function rideLegsForOrder(
  order: Pick<Order, 'shopLocation' | 'deliveryDistanceKm'>,
  partner: GeoPoint | null,
): RideLegs {
  const toShopKm =
    partner && order.shopLocation
      ? haversineKm(partner, order.shopLocation)
      : null;
  const toCustomerKm =
    typeof order.deliveryDistanceKm === 'number' &&
    Number.isFinite(order.deliveryDistanceKm)
      ? order.deliveryDistanceKm
      : null;
  const totalKm =
    toShopKm != null && toCustomerKm != null
      ? toShopKm + toCustomerKm
      : null;
  return { toShopKm, toCustomerKm, totalKm };
}

/**
 * Stable nearest-shop-first sort.
 *
 * Orders whose partner→shop distance is unknown (no partner GPS, or
 * legacy order without `shopLocation`) sort to the BOTTOM, preserving
 * their relative order via the original index tiebreaker. This way:
 *   - First-focus before GPS resolves → list keeps its server order
 *     (every distance is `Infinity`; original index breaks ties).
 *   - GPS denied permanently → behaves the same.
 *   - Mixed list (some have shopLocation, some don't) → known-distance
 *     pickups float to the top in distance order; legacy ones cluster
 *     at the bottom in their original order.
 *
 * Does NOT mutate the input array.
 */
export function sortPickupsByProximity<
  T extends Pick<Order, 'shopLocation'>,
>(orders: T[], partner: GeoPoint | null): T[] {
  return orders
    .map((o, i) => ({
      o,
      i,
      d:
        partner && o.shopLocation
          ? haversineKm(partner, o.shopLocation)
          : Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map(x => x.o);
}
