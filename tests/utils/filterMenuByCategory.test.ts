/**
 * PR-NEXT-ENH-3 (finding #6 follow-up) — tests for the category
 * filter helper that powers the chip row on `ShopDetailScreen`.
 * Pinning here means the screen can rely on the helper's
 * reference-equality contract (no useMemo churn on `selectedCategory
 * = null`) without re-asserting via render tests.
 */
import { filterMenuByCategory } from '../../src/utils/filterMenuByCategory';

const items = [
  { id: 'a', category: 'atta_rice_dal' },
  { id: 'b', category: 'bakery' },
  { id: 'c', category: 'atta_rice_dal' },
  { id: 'd', category: 'dairy_eggs' },
];

describe('filterMenuByCategory', () => {
  test('null category returns input array by REFERENCE', () => {
    expect(filterMenuByCategory(items, null)).toBe(items);
  });

  test('matching category returns only items in that category', () => {
    expect(filterMenuByCategory(items, 'atta_rice_dal' as any)).toEqual([
      { id: 'a', category: 'atta_rice_dal' },
      { id: 'c', category: 'atta_rice_dal' },
    ]);
  });

  test('non-matching category returns empty array', () => {
    expect(filterMenuByCategory(items, 'personal_care' as any)).toEqual([]);
  });

  test('preserves input order across multiple matches', () => {
    const result = filterMenuByCategory(items, 'atta_rice_dal' as any);
    expect(result.map(i => i.id)).toEqual(['a', 'c']);
  });

  test('drops items with non-string category silently', () => {
    const malformed = [
      { id: 'a', category: 'bakery' },
      { id: 'b', category: null as any },
      { id: 'c', category: 42 as any },
      { id: 'd', category: 'bakery' },
    ];
    expect(filterMenuByCategory(malformed, 'bakery' as any)).toEqual([
      { id: 'a', category: 'bakery' },
      { id: 'd', category: 'bakery' },
    ]);
  });

  test('empty items list returns empty array', () => {
    expect(filterMenuByCategory([], 'bakery' as any)).toEqual([]);
  });
});
