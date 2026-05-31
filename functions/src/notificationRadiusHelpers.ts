/**
 * PR 50 — Delivery partner notification radius filter.
 *
 * Decides which online delivery partners receive a push for a new
 * pickup, based on each partner's distance from the shop and their
 * per-partner notification-radius preference. Pure decision logic;
 * lives outside the trigger so it's unit-testable without
 * firebase-admin (same pattern as `deliveryChargeHelpers`,
 * `geoVisibilityHelpers`, `distanceMatrixHelpers`).
 *
 * Server-only — unlike PR 47 / PR 48's helpers there is NO client
 * mirror, because the filter runs inside the push-fanout trigger
 * and partners never see the decision logic. (PR 49's
 * `deliveryRoutingHelpers` is the inverse case — client-only.)
 */

import { haversineKm, type LatLng } from './distanceMatrixHelpers';

/**
 * Default radius seeded onto a partner's `users/{uid}` doc on first
 * `approveDeliveryRole` AND used as the fallback inside the filter
 * whenever a partner's stored `notificationRadiusKm` is absent or
 * invalid. Per design doc decision (PR 50 §A) + Sudhir's "only
 * within 2 km" requirement translated to a configurable 3 km
 * default. Sync the dashboard's local fallback in
 * `DeliveryDashboardScreen.tsx` to this value.
 */
export const DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM = 3;

export type PartnerRow = {
  uid: string;
  currentLocation?: LatLng | null;
  notificationRadiusKm?: number;
  fcmTokens?: string[];
};

/**
 * Filter the set of online partners down to those within their
 * notification radius of the given shop.
 *
 * Fail-OPEN rules (never silently exclude a partner from work
 * because of missing data):
 *   - `shopLocation` absent           → keep ALL partners (legacy
 *     order without PR 49's shopLocation stamp; better to push
 *     than to silently miss the work).
 *   - `partner.currentLocation` absent → keep partner (they haven't
 *     opened the dashboard with location grant yet; falls through
 *     to current "all online partners get pushed" behavior).
 *   - `partner.notificationRadiusKm` absent / invalid → use
 *     `DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM`.
 *
 * Boundary is INCLUSIVE (distance === radius → kept), matching the
 * boundary convention from PR 47 + PR 48.
 *
 * Does NOT mutate the input array.
 */
export function filterPartnersByNotificationRadius(
  partners: PartnerRow[],
  shopLocation: LatLng | undefined | null,
): PartnerRow[] {
  if (
    !shopLocation ||
    typeof shopLocation.lat !== 'number' ||
    !Number.isFinite(shopLocation.lat) ||
    typeof shopLocation.lng !== 'number' ||
    !Number.isFinite(shopLocation.lng)
  ) {
    // No way to measure → fail-open: fanout to everyone, matching
    // pre-PR-50 behavior for legacy orders without `shopLocation`.
    return partners.slice();
  }
  return partners.filter(p => {
    const loc = p.currentLocation;
    if (
      !loc ||
      typeof loc.lat !== 'number' ||
      !Number.isFinite(loc.lat) ||
      typeof loc.lng !== 'number' ||
      !Number.isFinite(loc.lng)
    ) {
      // Partner hasn't reported a location yet (never opened the
      // dashboard with location grant, or perm denied). Fail-open
      // so we don't silently exclude them from work.
      return true;
    }
    const radius =
      typeof p.notificationRadiusKm === 'number' &&
      Number.isFinite(p.notificationRadiusKm) &&
      p.notificationRadiusKm > 0
        ? p.notificationRadiusKm
        : DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM;
    const distanceKm = haversineKm(loc, shopLocation);
    return distanceKm <= radius;
  });
}
