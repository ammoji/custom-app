/**
 * PR 39 — Pin the brand constants in `src/constants/branding.ts`
 * to their expected literal values.
 *
 * The point isn't to test the strings themselves (they're already
 * static); it's to make every rename a deliberate, two-step change:
 * edit the constant, then edit this test. An accidental edit to
 * `APP_NAME` (autocomplete typo, find-and-replace gone wrong) trips
 * CI and forces a review. Same trick we use in
 * `tests/scripts/reset-pilot-data.test.ts` for the wipe-collection
 * exclusions.
 *
 * Server-side strings (Cloud Functions prompt, hosted legal docs)
 * don't import from `branding.ts` — they live in their own source
 * files. Keep them in sync by hand; this test only guards the
 * client-side source of truth.
 */
import {
  APP_NAME,
  APP_NAME_DEVANAGARI,
  LEGAL_JURISDICTION,
  OPERATING_CITY,
  OPERATING_DISTRICT,
  OPERATING_ENTITY,
  OPERATING_STATE,
  SUPPORT_EMAIL,
  TAGLINE,
} from '../../src/constants/branding';

describe('PR 39 — branding constants', () => {
  test('APP_NAME is the locked HamaraSetu brand', () => {
    expect(APP_NAME).toBe('HamaraSetu');
  });

  test('APP_NAME_DEVANAGARI is हमारा सेतु', () => {
    expect(APP_NAME_DEVANAGARI).toBe('हमारा सेतु');
  });

  test('TAGLINE is the locked "Shop Smart, Shop Local"', () => {
    expect(TAGLINE).toBe('Shop Smart, Shop Local');
  });

  test('SUPPORT_EMAIL is the personal pilot address (Sara Stack Labs migration is post-pilot)', () => {
    expect(SUPPORT_EMAIL).toBe('sudhir.davim@gmail.com');
  });

  test('OPERATING_ENTITY is Sara Stack Labs', () => {
    expect(OPERATING_ENTITY).toBe('Sara Stack Labs');
  });

  test('operating city/district/state pin Ballabgarh → Faridabad → Haryana', () => {
    expect(OPERATING_CITY).toBe('Ballabgarh');
    expect(OPERATING_DISTRICT).toBe('Faridabad');
    expect(OPERATING_STATE).toBe('Haryana');
  });

  test('LEGAL_JURISDICTION matches §13 of the Terms ("Faridabad, Haryana")', () => {
    expect(LEGAL_JURISDICTION).toBe('Faridabad, Haryana');
  });
});
