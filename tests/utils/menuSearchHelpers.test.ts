/**
 * PR-NEXT-9 (finding #6) — unit tests for the menu-search pure
 * helpers. Pins normalisation, substring filtering, and the
 * dedup-then-move-to-front history update contract.
 */
import {
  DEFAULT_HISTORY_MAX,
  filterMenuByQuery,
  normalizeSearchQuery,
  pushToSearchHistory,
} from '../../src/utils/menuSearchHelpers';

describe('normalizeSearchQuery', () => {
  it('returns empty string for null / undefined / non-string', () => {
    expect(normalizeSearchQuery(null)).toBe('');
    expect(normalizeSearchQuery(undefined)).toBe('');
    // @ts-expect-error — defensive runtime branch
    expect(normalizeSearchQuery(42)).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeSearchQuery('')).toBe('');
    expect(normalizeSearchQuery('   ')).toBe('');
    expect(normalizeSearchQuery('\t\n  ')).toBe('');
  });

  it('trims leading + trailing whitespace', () => {
    expect(normalizeSearchQuery('  atta  ')).toBe('atta');
  });

  it('collapses internal whitespace to single spaces', () => {
    expect(normalizeSearchQuery('a  b   c')).toBe('a b c');
  });

  it('lowercases ASCII', () => {
    expect(normalizeSearchQuery('ATTA WHOLE WHEAT')).toBe('atta whole wheat');
  });

  it('leaves Devanagari codepoints unchanged (no upper/lower in script)', () => {
    expect(normalizeSearchQuery('आटा')).toBe('आटा');
  });

  it('handles mixed-script input', () => {
    expect(normalizeSearchQuery('  Atta WHEAT  आटा  ')).toBe('atta wheat आटा');
  });
});

describe('filterMenuByQuery', () => {
  const items = [
    { name: 'Atta whole wheat' },
    { name: 'Milk full cream' },
    { name: 'Chai masala' },
    { name: 'Bread brown' },
  ];

  it('returns input array by REFERENCE when query is empty', () => {
    expect(filterMenuByQuery(items, '')).toBe(items);
    expect(filterMenuByQuery(items, '   ')).toBe(items);
    expect(filterMenuByQuery(items, null)).toBe(items);
    expect(filterMenuByQuery(items, undefined)).toBe(items);
  });

  it('matches case-insensitive substring', () => {
    expect(filterMenuByQuery(items, 'AT')).toEqual([
      { name: 'Atta whole wheat' },
    ]);
  });

  it('preserves input order across multiple matches', () => {
    const list = [
      { name: 'Milk' },
      { name: 'Atta' },
      { name: 'Milky way' },
    ];
    expect(filterMenuByQuery(list, 'milk')).toEqual([
      { name: 'Milk' },
      { name: 'Milky way' },
    ]);
  });

  it('returns empty array when nothing matches', () => {
    expect(filterMenuByQuery(items, 'zzz')).toEqual([]);
  });

  it('drops items with non-string names silently', () => {
    // Defensive runtime branch for malformed docs — cast the mixed
    // array up to the expected shape so the test can poke at the
    // `typeof name === 'string'` guard.
    const list = [
      { name: 'Atta' },
      { name: null },
      { name: 42 },
      { name: 'Atta whole' },
    ] as unknown as { name: string }[];
    expect(filterMenuByQuery(list, 'atta')).toEqual([
      { name: 'Atta' },
      { name: 'Atta whole' },
    ]);
  });

  it('handles Devanagari substring matches', () => {
    const list = [{ name: 'आटा whole wheat' }, { name: 'Milk' }];
    expect(filterMenuByQuery(list, 'आटा')).toEqual([
      { name: 'आटा whole wheat' },
    ]);
  });
});

describe('pushToSearchHistory', () => {
  it('returns input by REFERENCE for empty query', () => {
    const h = ['atta', 'milk'];
    expect(pushToSearchHistory(h, '')).toBe(h);
    expect(pushToSearchHistory(h, '   ')).toBe(h);
    expect(pushToSearchHistory(h, null)).toBe(h);
    expect(pushToSearchHistory(h, undefined)).toBe(h);
  });

  it('returns input by REFERENCE when query is already at position 0', () => {
    const h = ['atta', 'milk'];
    expect(pushToSearchHistory(h, 'atta')).toBe(h);
    // Pre-normalised match — '  ATTA  ' normalises to 'atta'.
    expect(pushToSearchHistory(h, '  ATTA  ')).toBe(h);
  });

  it('unshifts a new query onto the front', () => {
    expect(pushToSearchHistory(['atta'], 'milk')).toEqual(['milk', 'atta']);
  });

  it('moves a duplicate from the middle to the front', () => {
    expect(pushToSearchHistory(['milk', 'atta', 'chai'], 'atta')).toEqual([
      'atta',
      'milk',
      'chai',
    ]);
  });

  it('truncates to DEFAULT_HISTORY_MAX', () => {
    const h = ['a', 'b', 'c', 'd', 'e']; // length 5
    const next = pushToSearchHistory(h, 'f');
    expect(next).toEqual(['f', 'a', 'b', 'c', 'd']);
    expect(next.length).toBe(DEFAULT_HISTORY_MAX);
  });

  it('honours a custom max cap', () => {
    expect(pushToSearchHistory(['a', 'b'], 'c', 2)).toEqual(['c', 'a']);
  });

  it('normalises before dedup', () => {
    // History has 'atta'; saving '  ATTA  ' should be a no-op at idx 0.
    const h = ['atta', 'milk'];
    expect(pushToSearchHistory(h, '  ATTA  ')).toBe(h);
  });
});
