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
 *
 * This module is intentionally free of firebase-admin so the
 * decision matrix can be unit-pinned. The wrapper callable in
 * `index.ts` (`updateShopDeliveryTiers`) handles persistence; the
 * placeOrder callable calls `chargeForDistance` directly.
 */

export type DeliveryChargeTier = {
  /**
   * Upper bound of this band, inclusive, in km. `null` means
   * "the catch-all band — anything beyond the last numbered band".
   * Exactly one entry per tier table is allowed to have null.
   */
  maxKm: number | null;
  /** Charge for this band, in ₹ (whole or fractional rupees). */
  charge: number;
};

/**
 * Admin-default tier table, seeded onto every newly-approved shop
 * (see `approveShop` in index.ts). Mirrors the testing-team
 * baseline from the PR 47 prompt: ≤1km = ₹20, 1–3 km = ₹40,
 * 3–5 km = ₹60, beyond = ₹100. Shop owners can override via the
 * Shop Settings tier editor; this is just the starting point.
 */
export const DEFAULT_DELIVERY_CHARGE_TIERS: DeliveryChargeTier[] = [
  { maxKm: 1, charge: 20 },
  { maxKm: 3, charge: 40 },
  { maxKm: 5, charge: 60 },
  { maxKm: null, charge: 100 },
];

/**
 * Validate a single tier entry's shape (used by both
 * `chargeForDistance` for defensive runtime checks AND
 * `validateDeliveryChargeTiers` for the editor's save path).
 */
function isWellFormedTier(t: unknown): t is DeliveryChargeTier {
  if (!t || typeof t !== 'object') return false;
  const tt = t as { maxKm?: unknown; charge?: unknown };
  const maxKmOk =
    tt.maxKm === null ||
    (typeof tt.maxKm === 'number' &&
      Number.isFinite(tt.maxKm) &&
      tt.maxKm > 0);
  const chargeOk =
    typeof tt.charge === 'number' &&
    Number.isFinite(tt.charge) &&
    tt.charge >= 0;
  return maxKmOk && chargeOk;
}

/**
 * Map a distance (km) to a charge using the shop's tier table.
 *
 * @param tiers The shop's stored tier table. May be undefined / null
 *   on legacy (pre-PR-47) shops.
 * @param distanceKm The order's `deliveryDistanceKm` (PR 46 stamp).
 *   Negative values are clamped to 0.
 * @param fallbackFlat The shop's legacy flat `deliveryFee`. Returned
 *   when `tiers` is empty / malformed so legacy shops keep charging
 *   their old fee until their owner configures tiers.
 */
export function chargeForDistance(
  tiers: DeliveryChargeTier[] | null | undefined,
  distanceKm: number,
  fallbackFlat: number,
): number {
  // 1. Validate tiers: must be a non-empty array of well-formed
  //    entries. Anything else → legacy fallback.
  if (!Array.isArray(tiers) || tiers.length === 0) return fallbackFlat;
  const valid = tiers.filter(isWellFormedTier);
  if (valid.length === 0) return fallbackFlat;

  // 2. Defensive: clamp negative distance to 0 (haversine can't
  //    produce negative numbers but a tampered payload could).
  //    Non-finite distance → treat as 0; first tier wins, which
  //    is the safest under-charge.
  const d =
    Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0;

  // 3. Sort a COPY ascending by maxKm. `null` (catch-all) sorts last.
  //    Sorting the input would mutate the shop doc on subsequent
  //    re-reads — pure-function discipline.
  const sorted = [...valid].sort((a, b) => {
    if (a.maxKm === null && b.maxKm === null) return 0;
    if (a.maxKm === null) return 1;
    if (b.maxKm === null) return -1;
    return a.maxKm - b.maxKm;
  });

  // 4. First tier where maxKm === null OR distanceKm <= maxKm wins.
  for (const t of sorted) {
    if (t.maxKm === null) return t.charge;
    if (d <= t.maxKm) return t.charge;
  }

  // 5. No catch-all + distance beyond every band — fall back to the
  //    LAST tier's charge so we don't silently under-charge ₹0.
  //    `validateDeliveryChargeTiers` rejects this configuration on
  //    save, but a hand-edited Firestore doc could still reach here.
  return sorted[sorted.length - 1]!.charge;
}

/**
 * Validate a tier array submitted from the Shop Settings editor.
 *
 * Rules:
 * - Non-empty array
 * - Each entry: charge is a non-negative finite number; maxKm is
 *   either a positive finite number OR null
 * - Exactly ONE null-maxKm entry (the catch-all). Reject if missing
 *   so the owner consciously sets the "beyond X km" price rather
 *   than us silently auto-appending one.
 * - Numbered maxKm values strictly ascending (no duplicates / overlap)
 * - Catch-all (null) is the highest band — i.e. it must be the last
 *   entry after sorting, equivalently no numbered band may follow it.
 */
export function validateDeliveryChargeTiers(
  tiers: unknown,
):
  | { ok: true; tiers: DeliveryChargeTier[] }
  | { ok: false; message: string } {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return { ok: false, message: 'At least one delivery tier is required' };
  }

  // Per-entry shape check.
  const cleaned: DeliveryChargeTier[] = [];
  for (let i = 0; i < tiers.length; i += 1) {
    const t = tiers[i];
    if (!isWellFormedTier(t)) {
      return {
        ok: false,
        message: `Tier ${i + 1} is invalid: maxKm must be a positive number or null, charge must be a non-negative number`,
      };
    }
    cleaned.push({ maxKm: t.maxKm, charge: t.charge });
  }

  // Exactly one catch-all.
  const catchAlls = cleaned.filter(t => t.maxKm === null);
  if (catchAlls.length === 0) {
    return {
      ok: false,
      message:
        'Add a "beyond the last band" catch-all tier so far-away customers always have a price',
    };
  }
  if (catchAlls.length > 1) {
    return {
      ok: false,
      message: 'Only one catch-all tier (no max distance) is allowed',
    };
  }

  // Numbered bands strictly ascending by maxKm.
  const numbered = cleaned.filter(
    (t): t is DeliveryChargeTier & { maxKm: number } => t.maxKm !== null,
  );
  // Order-independent: sort then check strict ascent. We accept any
  // input order (the editor renders in input order; Firestore reads
  // are also unordered) and let chargeForDistance handle the runtime
  // sort.
  const sortedNumbered = [...numbered].sort((a, b) => a.maxKm - b.maxKm);
  for (let i = 1; i < sortedNumbered.length; i += 1) {
    if (sortedNumbered[i]!.maxKm <= sortedNumbered[i - 1]!.maxKm) {
      return {
        ok: false,
        message: `Tier distances must be strictly ascending (got ${sortedNumbered[i - 1]!.maxKm}km and ${sortedNumbered[i]!.maxKm}km)`,
      };
    }
  }

  // Return the cleaned (per-entry-validated) array. Caller may
  // store as-is; chargeForDistance sorts at read time.
  return { ok: true, tiers: cleaned };
}
