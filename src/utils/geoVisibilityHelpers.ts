/**
 * PR 48 — client-side mirror of
 * `functions/src/geoVisibilityHelpers.ts`.
 *
 * Repo convention (see `src/utils/deliveryChargeHelpers.ts` ↔
 * `functions/src/deliveryChargeHelpers.ts`): the server owns the
 * canonical helper and the client keeps a same-shape copy because
 * the client can't import from `functions/`. The two MUST stay in
 * sync; the server is the source of truth.
 *
 * Used by `shopService.ts` (web Plan B branch only — native trusts
 * the server-side filter applied inside `listShopsPublic`).
 */

export const DEFAULT_SERVICE_RADIUS_KM = 5;

type RadiusFilterable = {
  distanceKm?: number;
  serviceRadiusKm?: number;
};

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
      // PR-NEXT-SHOP-LOCATION-REQUIRED — mirror of server-side fail
      // posture split. Customer-side gap → keep (fail-open; don't
      // strand a customer without GPS). Shop-side gap → drop (the
      // shop is misconfigured; defense layer 3 of 3). Server's
      // `geoVisibilityHelpers.ts` is the source of truth — KEEP THE
      // BRANCHES IDENTICAL.
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
