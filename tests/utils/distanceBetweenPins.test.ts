/**
 * PR-NEXT-SHOP-LOCATION-EDIT — pure-helper tests for the admin
 * pending-location-change distance display.
 */
import { distanceBetweenPins } from '../../src/utils/distanceBetweenPins';

describe('PR-NEXT-SHOP-LOCATION-EDIT — distanceBetweenPins', () => {
  test('identical pins → "Same location" sentinel', () => {
    const r = distanceBetweenPins(
      { lat: 28.6139, lng: 77.209 },
      { lat: 28.6139, lng: 77.209 },
    );
    expect(r.label).toBe('Same location');
    expect(r.meters).toBeLessThan(1);
  });

  test('sub-meter drift (haversine quantization) → "Same location"', () => {
    // Two pins ~0.1m apart: a 0.000001 deg shift in lat ≈ 0.11m.
    const r = distanceBetweenPins(
      { lat: 28.6139, lng: 77.209 },
      { lat: 28.6139001, lng: 77.209 },
    );
    expect(r.label).toBe('Same location');
  });

  test('~12 meters drift → "12 meters" (rounded)', () => {
    // 0.0001 deg lat ≈ 11.13m at the equator; at lat 28.6 the
    // pure lat shift is ~11.1m. We want a label like "11 meters"
    // or "12 meters" — accept either by asserting the integer
    // shape with `meters` regex.
    const r = distanceBetweenPins(
      { lat: 28.6139, lng: 77.209 },
      { lat: 28.614, lng: 77.209 },
    );
    expect(r.label).toMatch(/^\d+ meters$/);
    expect(r.meters).toBeGreaterThan(5);
    expect(r.meters).toBeLessThan(20);
  });

  test('999m boundary → still "meters" formatting', () => {
    // ~999m via a small lng shift at lat 28.6: cos(28.6°) ≈ 0.878.
    // 1° lng ≈ 111.32 km × 0.878 ≈ 97.76 km. 999m → ~0.01022°.
    const r = distanceBetweenPins(
      { lat: 28.6, lng: 77.0 },
      { lat: 28.6, lng: 77.01022 },
    );
    expect(r.meters).toBeLessThan(1000);
    expect(r.label).toMatch(/^\d+ meters$/);
  });

  test('cross-city km bracket → "N.N km" formatting', () => {
    // Delhi (28.61, 77.21) to Faridabad (28.40, 77.31) ≈ ~25 km.
    // The fallback-leak bug case the admin needs to spot.
    const r = distanceBetweenPins(
      { lat: 28.6139, lng: 77.209 },
      { lat: 28.4089, lng: 77.3178 },
    );
    expect(r.meters).toBeGreaterThan(20000);
    expect(r.label).toMatch(/^\d+\.\d km$/);
  });
});
