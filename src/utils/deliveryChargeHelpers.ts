/**
 * PR 47 — client-side mirror of `functions/src/deliveryChargeHelpers.ts`.
 *
 * The repo convention (see `functions/src/profileHelpers.ts` ↔
 * `src/screens/AddressEditScreen.tsx` validate(), the order state
 * machine, etc.) is that the server owns the canonical helper and
 * the client keeps a same-shape copy for instant inline feedback.
 * The two MUST stay in sync; the server is the source of truth and
 * will reject anything the client lets through.
 *
 * Used by:
 *   - `ShopSettingsScreen` — pre-flight validate the tier table
 *     before the round-trip to `updateShopDeliveryTiers`.
 *   - `CheckoutScreen` — compute the preview delivery charge from
 *     the shop's tiers + the live distance estimate.
 */

import type { DeliveryChargeTier } from '../types';

export const DEFAULT_DELIVERY_CHARGE_TIERS: DeliveryChargeTier[] = [
  { maxKm: 1, charge: 20 },
  { maxKm: 3, charge: 40 },
  { maxKm: 5, charge: 60 },
  { maxKm: null, charge: 100 },
];

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
 * See `functions/src/deliveryChargeHelpers.ts` for the canonical
 * version + invariants. Falls back to `fallbackFlat` for legacy
 * shops without a tier table.
 */
export function chargeForDistance(
  tiers: DeliveryChargeTier[] | null | undefined,
  distanceKm: number,
  fallbackFlat: number,
): number {
  if (!Array.isArray(tiers) || tiers.length === 0) return fallbackFlat;
  const valid = tiers.filter(isWellFormedTier);
  if (valid.length === 0) return fallbackFlat;
  const d =
    Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0;
  const sorted = [...valid].sort((a, b) => {
    if (a.maxKm === null && b.maxKm === null) return 0;
    if (a.maxKm === null) return 1;
    if (b.maxKm === null) return -1;
    return a.maxKm - b.maxKm;
  });
  for (const t of sorted) {
    if (t.maxKm === null) return t.charge;
    if (d <= t.maxKm) return t.charge;
  }
  return sorted[sorted.length - 1]!.charge;
}

/**
 * Validate a tier array submitted from the Shop Settings editor.
 * Same rules as the server-side helper.
 */
export function validateDeliveryChargeTiers(
  tiers: unknown,
):
  | { ok: true; tiers: DeliveryChargeTier[] }
  | { ok: false; message: string } {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return { ok: false, message: 'At least one delivery tier is required' };
  }
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
  const numbered = cleaned.filter(
    (t): t is DeliveryChargeTier & { maxKm: number } => t.maxKm !== null,
  );
  const sortedNumbered = [...numbered].sort((a, b) => a.maxKm - b.maxKm);
  for (let i = 1; i < sortedNumbered.length; i += 1) {
    if (sortedNumbered[i]!.maxKm <= sortedNumbered[i - 1]!.maxKm) {
      return {
        ok: false,
        message: `Tier distances must be strictly ascending (got ${sortedNumbered[i - 1]!.maxKm}km and ${sortedNumbered[i]!.maxKm}km)`,
      };
    }
  }
  return { ok: true, tiers: cleaned };
}
