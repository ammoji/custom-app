/**
 * Tests for the `listShopsPublic` Cloud Function (post-v2-iii hotfix).
 *
 * The callable's only non-trivial logic is the rank/filter step, which
 * is exported as a pure helper `rankShopsByDistance` from
 * `functions/src/index.ts`. Testing the helper directly avoids
 * spinning up firebase-admin / the emulator and keeps the suite fast.
 *
 * The Firestore query (`where('status', '==', 'active')`) is verified
 * via integration testing in `tests/rules/shops.test.ts` — that suite
 * pins the rule that legacy no-status shops are excluded, which is
 * the same shape as the function's filter.
 */
import { rankShopsByDistance } from '../../functions/src/index';

type Shop = {
  id: string;
  name: string;
  status?: 'active' | 'pending' | 'rejected' | 'suspended';
  location?: { lat: number; lng: number };
};

const userLocation = { lat: 28.6139, lng: 77.209 }; // Connaught Place

const shopAt = (id: string, lat: number, lng: number, status: any = 'active'): Shop => ({
  id,
  name: id,
  status,
  location: { lat, lng },
});

describe('rankShopsByDistance (listShopsPublic core)', () => {
  test('returns shops sorted ascending by distance when userLocation provided', () => {
    const input: Shop[] = [
      shopAt('far', 28.7041, 77.1025), // ~14 km north-west
      shopAt('mid', 28.65, 77.23), // ~5 km north-east
      shopAt('near', 28.6149, 77.2095), // ~100 m
    ];

    const out = rankShopsByDistance(input, userLocation);

    expect(out.map(s => s.id)).toEqual(['near', 'mid', 'far']);
    // distanceKm populated on every row
    expect(out.every(s => typeof s.distanceKm === 'number')).toBe(true);
    // Ascending
    expect(out[0].distanceKm!).toBeLessThan(out[1].distanceKm!);
    expect(out[1].distanceKm!).toBeLessThan(out[2].distanceKm!);
  });

  test('omits distanceKm and preserves input order when userLocation absent', () => {
    const input: Shop[] = [
      shopAt('a', 28.7, 77.1),
      shopAt('b', 28.65, 77.23),
      shopAt('c', 28.6149, 77.2095),
    ];

    const out = rankShopsByDistance(input, undefined);

    expect(out.map(s => s.id)).toEqual(['a', 'b', 'c']);
    expect(out.every(s => s.distanceKm === undefined)).toBe(true);
  });

  test('falls back to "no distance" path on malformed userLocation', () => {
    const input: Shop[] = [
      shopAt('a', 28.7, 77.1),
      shopAt('b', 28.65, 77.23),
    ];

    // Caller passed strings instead of numbers. Should not throw,
    // should not fill distanceKm, should preserve order.
    const out = rankShopsByDistance(input, {
      lat: 'oops' as any,
      lng: 0,
    });

    expect(out.map(s => s.id)).toEqual(['a', 'b']);
    expect(out.every(s => s.distanceKm === undefined)).toBe(true);
  });

  test('rows missing location still appear in the output (last)', () => {
    const input: Shop[] = [
      { id: 'no-loc', name: 'no-loc', status: 'active' },
      shopAt('near', 28.6149, 77.2095),
    ];

    const out = rankShopsByDistance(input, userLocation);

    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('near');
    // No-location shop sorts to end via Infinity sentinel.
    expect(out[1].id).toBe('no-loc');
    expect(out[1].distanceKm).toBeUndefined();
  });

  test('does not mutate the input array', () => {
    const input: Shop[] = [
      shopAt('a', 28.7, 77.1),
      shopAt('b', 28.6149, 77.2095),
    ];
    const inputCopy = JSON.parse(JSON.stringify(input));

    rankShopsByDistance(input, userLocation);

    expect(input).toEqual(inputCopy);
  });
});
