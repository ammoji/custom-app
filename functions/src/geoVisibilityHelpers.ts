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
 * Mixed-fail posture (PR-NEXT-SHOP-LOCATION-REQUIRED): the missing-
 * distance branch now distinguishes WHICH side is missing.
 *   - Customer-side gap (customer hasn't granted location) → fail-
 *     OPEN: keep all shops uniformly. The alternative (hide on
 *     missing customer location) would silently strand a customer
 *     who hasn't enabled GPS yet.
 *   - Shop-side gap (shop has no `location` so `distanceKm` came back
 *     undefined despite a present customer location) → fail-CLOSED:
 *     drop that shop. This is defense layer 3 of 3 closing Sudhir's
 *     June 2 finding *"Shop current location is optional so how can
 *     we calculate shop distance?"* — RegisterShop's client gate +
 *     approveShop's server gate are layers 1 and 2; this is the
 *     last-resort hide if a misconfigured shop somehow lands in the
 *     active set (legacy data, manual Firestore edit, future refactor
 *     regression).
 *
 * Pre-PR posture (commented out for the historical record): a single
 * fail-OPEN branch on missing `distanceKm` regardless of cause —
 * which produced shops without `location` being globally visible.
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
 *     non-finite                 → branch on `customerHasLocation`:
 *                                    • false → KEEP (customer-side gap;
 *                                      fail-open so we don't strand)
 *                                    • true  → DROP (shop-side gap;
 *                                      shop has no `location` pin —
 *                                      defense layer 3)
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
  opts: { showAll: boolean; customerHasLocation: boolean },
): T[] {
  if (opts.showAll) return shops.slice();
  return shops.filter(s => {
    if (
      typeof s.distanceKm !== 'number' ||
      !Number.isFinite(s.distanceKm)
    ) {
      // PR-NEXT-SHOP-LOCATION-REQUIRED — split the missing-distance
      // branch. Customer-side gap → keep (fail-open; don't strand
      // a customer without GPS). Shop-side gap → drop (the shop is
      // misconfigured; defense layer 3 of 3 — RegisterShop client
      // gate + approveShop server gate are layers 1 and 2).
      return opts.customerHasLocation === false;
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
