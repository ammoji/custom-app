/**
 * PR-NEXT-STATIC-MAP-PREVIEW — unit tests for buildStaticMapUrl.
 *
 * Test plan (8 cases):
 *   1. Full valid inputs → returns URL containing expected params
 *   2. Missing shopPin  → null
 *   3. Missing dropPin  → null
 *   4. Missing apiKey   → null
 *   5. Non-finite lat on shopPin → null
 *   6. Non-finite lng on dropPin → null
 *   7. Default dimensions applied (320x160)
 *   8. Custom dimensions applied
 */
import { buildStaticMapUrl } from '../../src/utils/buildStaticMapUrl';

const SHOP: { lat: number; lng: number } = { lat: 28.4089, lng: 77.3178 }; // Faridabad
const DROP: { lat: number; lng: number } = { lat: 28.4052, lng: 77.3201 }; // ~500m away
const KEY = 'TEST_KEY_DO_NOT_USE';

describe('buildStaticMapUrl', () => {
  test('full valid inputs returns URL with expected params', () => {
    const url = buildStaticMapUrl({ shopPin: SHOP, dropPin: DROP, apiKey: KEY });
    expect(url).not.toBeNull();
    expect(url).toContain('maps.googleapis.com/maps/api/staticmap');
    expect(url).toContain('TEST_KEY_DO_NOT_USE');
    expect(url).toContain('28.4089');
    expect(url).toContain('28.4052');
    expect(url).toContain('label%3AS'); // URL-encoded label:S
    expect(url).toContain('label%3AD'); // URL-encoded label:D
  });

  test('missing shopPin returns null', () => {
    expect(buildStaticMapUrl({ shopPin: null, dropPin: DROP, apiKey: KEY })).toBeNull();
    expect(buildStaticMapUrl({ shopPin: undefined, dropPin: DROP, apiKey: KEY })).toBeNull();
  });

  test('missing dropPin returns null', () => {
    expect(buildStaticMapUrl({ shopPin: SHOP, dropPin: null, apiKey: KEY })).toBeNull();
    expect(buildStaticMapUrl({ shopPin: SHOP, dropPin: undefined, apiKey: KEY })).toBeNull();
  });

  test('missing apiKey returns null', () => {
    expect(buildStaticMapUrl({ shopPin: SHOP, dropPin: DROP, apiKey: null })).toBeNull();
    expect(buildStaticMapUrl({ shopPin: SHOP, dropPin: DROP, apiKey: '' })).toBeNull();
    expect(buildStaticMapUrl({ shopPin: SHOP, dropPin: DROP, apiKey: undefined })).toBeNull();
  });

  test('non-finite lat on shopPin returns null', () => {
    expect(buildStaticMapUrl({ shopPin: { lat: NaN, lng: 77.3178 }, dropPin: DROP, apiKey: KEY })).toBeNull();
    expect(buildStaticMapUrl({ shopPin: { lat: Infinity, lng: 77.3178 }, dropPin: DROP, apiKey: KEY })).toBeNull();
  });

  test('non-finite lng on dropPin returns null', () => {
    expect(buildStaticMapUrl({ shopPin: SHOP, dropPin: { lat: 28.4052, lng: NaN }, apiKey: KEY })).toBeNull();
  });

  test('default dimensions are 320x160', () => {
    const url = buildStaticMapUrl({ shopPin: SHOP, dropPin: DROP, apiKey: KEY });
    expect(url).toContain('size=320x160');
  });

  test('custom dimensions applied', () => {
    const url = buildStaticMapUrl({
      shopPin: SHOP,
      dropPin: DROP,
      apiKey: KEY,
      width: 400,
      height: 200,
    });
    expect(url).toContain('size=400x200');
  });
});
