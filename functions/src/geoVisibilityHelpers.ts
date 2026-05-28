/**
 * PR 48 — shop service-radius visibility gate.
 *
 * Pure decision logic for which active shops a customer at a given
 * location should see. Lives outside index.ts so it's unit-testable
 * without firebase-admin or the emulator (same posture as
 * `deliveryChargeHelpers`, `shopSettingsHelpers`,
 * `distanceMatrixHelpers`).
 *
 * Inputs are already-ranked shops (`rankShopsByDistance` has stamped
 * `distanceKm` + sorted). This helper ONLY decides inclusion.
 *
 * Fail-OPEN posture: when we cannot measure a distance (no customer
 * location, no shop location, non-finite haversine) we KEEP the
 * shop. The alternative (hide on missing data) would silently strand
 * customers — worse UX than over-including a few shops. Real
 * over-inclusion is bounded because `rankShopsByDistance` only feeds
 * us active shops anyway.
 */

export const DEFAULT_SERVICE_RADIUS_KM = 5;

type RadiusFilterable = {
  distanceKm?: number;
  serviceRadiusKm?: number;
};

/**
 * Keep a shop iff it's within its own service radius of the customer.
 *
 * Rules:
 *   - `showAll === true`         → keep every shop (testing override).
 *   - `distanceKm` undefined /
 *     non-finite                 → KEEP (fail-open; can't measure).
 *   - `serviceRadiusKm` missing /
 *     zero / negative / NaN      → fall back to
 *                                  `DEFAULT_SERVICE_RADIUS_KM`.
 *   - otherwise                  → keep iff `distanceKm <= radius`.
 *
 * Boundary is INCLUSIVE (exactly at the radius → visible) matching
 * the tier-boundary convention from PR 47's `chargeForDistance`.
 *
 * Pure: returns a new array; never mutates the input. The `showAll`
 * path returns `shops.slice()` for the same reason.
 */
export function filterShopsByServiceRadius<T extends RadiusFilterable>(
  shops: T[],
  opts: { showAll: boolean },
): T[] {
  if (opts.showAll) return shops.slice();
  return shops.filter(s => {
    if (
      typeof s.distanceKm !== 'number' ||
      !Number.isFinite(s.distanceKm)
    ) {
      return true; // fail-open: can't measure → don't hide
    }
    const radius =
      typeof s.serviceRadiusKm === 'number' &&
      Number.isFinite(s.serviceRadiusKm) &&
      s.serviceRadiusKm > 0
        ? s.serviceRadiusKm
        : DEFAULT_SERVICE_RADIUS_KM;
    return s.distanceKm <= radius;
  });
}
