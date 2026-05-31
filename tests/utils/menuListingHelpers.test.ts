/**
 * PR-NEXT-4 — pin the soft-delete filter contract used by every
 * menu-listing site. See `src/utils/menuListingHelpers.ts` for
 * why we do the filter in-memory instead of via Firestore
 * `where('deletedAt', '==', null)`.
 */

import {
  excludeDeleted,
  isMenuItemDeleted,
} from '../../src/utils/menuListingHelpers';

describe('PR-NEXT-4 — isMenuItemDeleted', () => {
  test('absent deletedAt → live (legacy back-compat)', () => {
    expect(isMenuItemDeleted({})).toBe(false);
  });

  test('explicit null → live', () => {
    expect(isMenuItemDeleted({ deletedAt: null })).toBe(false);
  });

  test('explicit undefined → live', () => {
    expect(isMenuItemDeleted({ deletedAt: undefined })).toBe(false);
  });

  test('zero → live (defensive against tooling slip writing 0)', () => {
    // The server uses serverTimestamp(), never 0; if we ever see 0
    // it's a bug upstream and the safer behavior is "show the item"
    // (so the shopkeeper can investigate) rather than "silently hide".
    expect(isMenuItemDeleted({ deletedAt: 0 })).toBe(false);
  });

  test('positive epoch ms → deleted', () => {
    expect(isMenuItemDeleted({ deletedAt: 1717180800000 })).toBe(true);
  });

  test('Date-like object (defensive against raw Firestore SDK reads) → deleted', () => {
    // The server normalizer converts Timestamp → number, but a
    // direct firestore web SDK read could hand us a Timestamp.
    // We treat any non-null truthy value as deleted to avoid
    // the "Timestamp slipped through, item visible" failure mode.
    expect(isMenuItemDeleted({ deletedAt: new Date() })).toBe(true);
  });

  test('string (also defensive) → deleted', () => {
    expect(isMenuItemDeleted({ deletedAt: '2026-05-31' })).toBe(true);
  });
});

describe('PR-NEXT-4 — excludeDeleted', () => {
  test('returns empty array on null input (defensive)', () => {
    expect(excludeDeleted(null)).toEqual([]);
  });

  test('returns empty array on undefined input', () => {
    expect(excludeDeleted(undefined)).toEqual([]);
  });

  test('returns empty array on non-array (TS-bypass)', () => {
    // @ts-expect-error — proving we don't crash on bad input
    expect(excludeDeleted('not-an-array')).toEqual([]);
  });

  test('preserves order of live items', () => {
    const items = [
      { id: 'a', deletedAt: null },
      { id: 'b' },
      { id: 'c', deletedAt: undefined },
    ];
    expect(excludeDeleted(items).map(i => i.id)).toEqual(['a', 'b', 'c']);
  });

  test('drops deleted items', () => {
    const items = [
      { id: 'a' },
      { id: 'b', deletedAt: 1717180800000 },
      { id: 'c', deletedAt: null },
      { id: 'd', deletedAt: 1717180900000 },
    ];
    expect(excludeDeleted(items).map(i => i.id)).toEqual(['a', 'c']);
  });

  test('empty array → empty array', () => {
    expect(excludeDeleted([])).toEqual([]);
  });

  test('all deleted → empty array', () => {
    expect(
      excludeDeleted([
        { deletedAt: 1 },
        { deletedAt: 2 },
        { deletedAt: 3 },
      ]),
    ).toEqual([]);
  });

  test('preserves arbitrary fields on live items (generic shape)', () => {
    const items = [
      { id: 'a', name: 'Milk', price: 50 },
      { id: 'b', name: 'Bread', price: 40, deletedAt: 1717180800000 },
    ];
    const out = excludeDeleted(items);
    expect(out).toEqual([{ id: 'a', name: 'Milk', price: 50 }]);
  });
});
