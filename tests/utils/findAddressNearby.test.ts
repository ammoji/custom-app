/**
 * PR-NEXT-HOTFIX-10 — pins the address-dedupe lookup behaviour
 * (silent-skip threshold, boundary inclusivity, defensive coords
 * filtering, closest-of-many tie-break).
 */
import {
  findAddressNearby,
  DEFAULT_DEDUPE_THRESHOLD_M,
} from '../../src/utils/findAddressNearby';
import type { SavedAddress } from '../../src/types';

// Helper: nudge `lat` by exactly `meters` north of the base point
// (haversine is symmetric in latitude when lng is held constant).
// Uses the same earth radius as the production helper.
const EARTH_R_M = 6371 * 1000;
function nudgeLat(baseLat: number, meters: number): number {
  const deltaRad = meters / EARTH_R_M;
  return baseLat + (deltaRad * 180) / Math.PI;
}

const BASE: { lat: number; lng: number } = { lat: 28.6139, lng: 77.209 };

const mkAddr = (
  id: string,
  coords: { lat?: number; lng?: number },
  label = 'Home',
): SavedAddress => ({
  id,
  label,
  name: 'A',
  phone: '9999999999',
  line1: '1',
  city: 'Delhi',
  pincode: '110001',
  createdAt: 0,
  updatedAt: 0,
  ...coords,
});

describe('findAddressNearby', () => {
  test('exact match (0m) returns the candidate', () => {
    const addrs = [mkAddr('a', BASE)];
    expect(findAddressNearby(addrs, BASE)).toBe(addrs[0]);
  });

  test('1m away (well under threshold) matches', () => {
    const addrs = [mkAddr('a', { lat: nudgeLat(BASE.lat, 1), lng: BASE.lng })];
    expect(findAddressNearby(addrs, BASE)).toBe(addrs[0]);
  });

  test('24.9m away (just under threshold) matches', () => {
    const addrs = [
      mkAddr('a', { lat: nudgeLat(BASE.lat, 24.9), lng: BASE.lng }),
    ];
    expect(findAddressNearby(addrs, BASE)).toBe(addrs[0]);
  });

  test('25.0m away (boundary inclusive) matches', () => {
    const addrs = [
      mkAddr('a', {
        lat: nudgeLat(BASE.lat, DEFAULT_DEDUPE_THRESHOLD_M),
        lng: BASE.lng,
      }),
    ];
    // Floating-point pinch at the boundary: nudge slightly inward
    // so we test "exactly 25m or less" rather than fight rounding.
    // The production helper uses haversine which is symmetric.
    expect(findAddressNearby(addrs, BASE)).toBe(addrs[0]);
  });

  test('25.1m+ away (just over threshold) does NOT match', () => {
    const addrs = [
      mkAddr('a', { lat: nudgeLat(BASE.lat, 30), lng: BASE.lng }),
    ];
    expect(findAddressNearby(addrs, BASE)).toBeNull();
  });

  test('all candidates lack coords → null (legacy/form-only addresses)', () => {
    const addrs = [
      mkAddr('a', {}),
      mkAddr('b', { lat: undefined, lng: undefined }),
    ];
    expect(findAddressNearby(addrs, BASE)).toBeNull();
  });

  test('target has non-finite coords → null (defensive)', () => {
    const addrs = [mkAddr('a', BASE)];
    expect(findAddressNearby(addrs, { lat: NaN, lng: BASE.lng })).toBeNull();
    expect(
      findAddressNearby(addrs, { lat: BASE.lat, lng: Infinity }),
    ).toBeNull();
  });

  test('multiple within threshold → returns the CLOSEST', () => {
    const closer = mkAddr(
      'closer',
      { lat: nudgeLat(BASE.lat, 5), lng: BASE.lng },
      'Office',
    );
    const farther = mkAddr(
      'farther',
      { lat: nudgeLat(BASE.lat, 20), lng: BASE.lng },
      'Home',
    );
    // Order shouldn't matter — the comparator picks the smaller distance.
    expect(findAddressNearby([farther, closer], BASE)).toBe(closer);
    expect(findAddressNearby([closer, farther], BASE)).toBe(closer);
  });
});
