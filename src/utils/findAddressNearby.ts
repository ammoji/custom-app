/**
 * PR-NEXT-HOTFIX-10 — pure address-dedupe lookup. Returns the
 * closest existing address within `thresholdM` of the target
 * coords, or null if none. Centralizes the comparison so the
 * `SaveCurrentLocationModal` flow + any future address-editor
 * dedupe (e.g. `AddressEditScreen` could warn before saving an
 * obvious duplicate) reuse the same matching logic.
 *
 * Pure; pinned by `tests/utils/findAddressNearby.test.ts`.
 *
 * Threshold rationale (Sudhir, June 2 2026): 25m collapses pins
 * that are essentially identical (typical urban outdoor GPS
 * accuracy is 5-20m; same-building indoor accuracy 30-50m).
 * Aggressive enough that two orders from the same building won't
 * duplicate; lenient enough that next-door neighbours still save
 * as separate rows.
 *
 * Boundary is INCLUSIVE (`distM <= thresholdM`) — matches the
 * `chargeForDistance` tier-boundary convention used elsewhere in
 * the app, so an address sitting exactly on the threshold is
 * treated as the same place rather than a new one.
 *
 * Operates on `SavedAddress[]` (the shape stored under
 * `profile.addresses`) — `Address` (the order-side recipient
 * shape) doesn't carry `lat/lng/label`.
 */
import type { SavedAddress } from '../types';
import { haversineKm } from './distance';

export const DEFAULT_DEDUPE_THRESHOLD_M = 25;

export function findAddressNearby(
  addresses: SavedAddress[],
  target: { lat: number; lng: number },
  thresholdM: number = DEFAULT_DEDUPE_THRESHOLD_M,
): SavedAddress | null {
  if (
    typeof target.lat !== 'number' ||
    !Number.isFinite(target.lat) ||
    typeof target.lng !== 'number' ||
    !Number.isFinite(target.lng)
  ) {
    return null;
  }
  let closest: { addr: SavedAddress; distM: number } | null = null;
  for (const a of addresses) {
    if (
      typeof a.lat !== 'number' ||
      !Number.isFinite(a.lat) ||
      typeof a.lng !== 'number' ||
      !Number.isFinite(a.lng)
    ) {
      // Address has no pin (pre-PR-46 row, or form-only entry) →
      // not comparable. Skip rather than treat-as-far so the next
      // candidate gets a chance.
      continue;
    }
    const distKm = haversineKm({ lat: a.lat, lng: a.lng }, target);
    const distM = distKm * 1000;
    if (distM <= thresholdM && (!closest || distM < closest.distM)) {
      closest = { addr: a, distM };
    }
  }
  return closest?.addr ?? null;
}
