/**
 * PR 39 — Single source of truth for brand strings.
 *
 * Every user-visible "HamaraSetu" / "Shop Smart, Shop Local" /
 * support email / operating-entity reference in the client reads
 * from this file. The point: when (not if) we rename again —
 * Sara Stack Labs goes public as the operating entity, the
 * tagline shifts post-pilot, etc. — it's a one-line change here
 * instead of a 20-file find-and-replace.
 *
 * Server-side strings (Cloud Functions prompts, hosted legal
 * docs) deliberately do NOT import this module — they live in
 * their own files where they're authored. The constants on the
 * server side must be kept in sync manually; the unit test in
 * `tests/constants/branding.test.ts` pins each value here against
 * the literal it should hold so an accidental edit to the source
 * of truth trips CI and forces a deliberate update everywhere.
 */
export const APP_NAME = 'HamaraSetu';
export const APP_NAME_DEVANAGARI = 'हमारा सेतु';
export const TAGLINE = 'Shop Smart, Shop Local';
export const SUPPORT_EMAIL = 'sudhir.davim@gmail.com';
export const OPERATING_ENTITY = 'Sara Stack Labs';
export const OPERATING_CITY = 'Ballabgarh';
export const OPERATING_DISTRICT = 'Faridabad';
export const OPERATING_STATE = 'Haryana';
export const LEGAL_JURISDICTION = 'Faridabad, Haryana';
