/**
 * PR-NEXT-SHOP-LOCATION-EDIT — pure helper for the admin
 * "pending location change" surface: the difference between the
 * live `shop.location` pin and the owner's proposed
 * `shop.pendingLocation`.
 *
 * Returns BOTH the raw meters value (so a future automated rule
 * — e.g., "drift > 500m needs an explicit reason" — can read it)
 * AND a human label tuned for the three brackets we actually
 * see in shop-location edits:
 *   - sub-meter   → "Same location" (haversine quantization /
 *                   GPS jitter on a re-capture from the same
 *                   shop counter)
 *   - sub-1km     → "<N> meters" (typical owner refining a
 *                   slightly-off pin without moving the shop)
 *   - 1km+        → "<N.N> km" (suspicious — the owner moved or
 *                   the original was a fallback leak; admin
 *                   should look closely)
 *
 * Pure; pinned by `tests/utils/distanceBetweenPins.test.ts`.
 */
import { haversineKm } from './distance';

export type DistanceBetweenPins = {
  meters: number;
  label: string;
};

export function distanceBetweenPins(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): DistanceBetweenPins {
  const km = haversineKm(a, b);
  const m = km * 1000;
  if (m < 1) return { meters: m, label: 'Same location' };
  if (m < 1000) return { meters: m, label: `${Math.round(m)} meters` };
  return { meters: m, label: `${km.toFixed(1)} km` };
}
