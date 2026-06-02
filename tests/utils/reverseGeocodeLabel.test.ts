/**
 * PR-NEXT-ADDRESS-UX.1 (Case 10 retest) — tests for the pure
 * `buildGeocodeSuggestion` projection. Pinning the empty / partial
 * / district-merge behaviour here keeps `SaveCurrentLocationModal`'s
 * pre-filled defaults stable across `expo-location` payload tweaks.
 *
 * The async `reverseGeocodeLabel` wrapper is covered by acceptance
 * (it's a 4-line glue around `Location.reverseGeocodeAsync`) — we
 * unit-test the projection, not the SDK call.
 */
// PR-NEXT-ADDRESS-UX.1 — stub `expo-location` at the module-resolver
// level so importing `reverseGeocodeLabel.ts` (which `import * as
// Location from 'expo-location'`s) doesn't drag the package's ESM
// surface through Jest's CommonJS pipeline. `buildGeocodeSuggestion`
// is the only export this file tests and it doesn't touch the SDK.
jest.mock(
  'expo-location',
  () => ({ reverseGeocodeAsync: jest.fn() }),
  { virtual: true },
);

import {
  buildGeocodeSuggestion,
  EMPTY_GEOCODE_SUGGESTION,
} from '../../src/utils/reverseGeocodeLabel';

describe('buildGeocodeSuggestion', () => {
  test('happy path: district + city → "Sector 10, Ballabgarh"', () => {
    const result = buildGeocodeSuggestion({
      name: '24',
      street: 'Main Road',
      district: 'Sector 10',
      city: 'Ballabgarh',
      subregion: 'Faridabad',
      postalCode: '121004',
    } as any);
    expect(result).toEqual({
      label: 'Sector 10, Faridabad',
      line1: '24, Main Road',
      city: 'Ballabgarh',
      pincode: '121004',
    });
  });

  test('undefined input → EMPTY fallback', () => {
    expect(buildGeocodeSuggestion(undefined)).toEqual(EMPTY_GEOCODE_SUGGESTION);
  });

  test('missing district falls back to name; subregion === city collapses', () => {
    // Common shape in dense urban centres where Google returns city
    // as both `city` and `subregion`. Avoid the "Bengaluru, Bengaluru"
    // doubled label.
    const result = buildGeocodeSuggestion({
      name: 'MG Road',
      street: 'MG Road',
      district: null,
      city: 'Bengaluru',
      subregion: 'Bengaluru',
      postalCode: '560001',
    } as any);
    expect(result.label).toBe('MG Road, Bengaluru');
    expect(result.city).toBe('Bengaluru');
    expect(result.pincode).toBe('560001');
  });

  test('all label fields missing → defaults to "Current location" label', () => {
    // Geocoder returned a row with coords-only data (rural / pin in
    // the middle of a field). Modal must still open with a usable
    // default label rather than an empty string.
    const result = buildGeocodeSuggestion({
      name: null,
      street: null,
      district: null,
      city: null,
      subregion: null,
      postalCode: null,
    } as any);
    expect(result.label).toBe('Current location');
    expect(result.line1).toBe('');
    expect(result.city).toBe('');
    expect(result.pincode).toBe('');
  });

  test('postalCode null becomes empty string (not the literal "null")', () => {
    // Defensive: TextInput would render "null" if we forwarded the
    // null value directly. Helper must coerce.
    const result = buildGeocodeSuggestion({
      name: 'Park',
      street: 'Lane 5',
      district: 'Block A',
      city: 'Gurgaon',
      subregion: 'Gurgaon',
      postalCode: null,
    } as any);
    expect(result.pincode).toBe('');
  });
});
