/**
 * PR-NEXT-BUNDLE-L §G — tests for `mergeScannedPrices` (the
 * multi-photo dedup helper for the paper-scan workflow).
 */
import {
  mergeScannedPrices,
  type ScannedPage,
} from '../../src/utils/catalogScanHelpers';

const page = (
  rows: Array<[string, number, 'high' | 'medium' | 'low']>,
  droppedCount = 0,
): ScannedPage => ({
  prices: rows.map(([productId, sellPrice, confidence]) => ({
    productId,
    sellPrice,
    confidence,
  })),
  droppedCount,
});

describe('mergeScannedPrices', () => {
  it('2 pages, no overlap → all prices returned, no duplicates', () => {
    const res = mergeScannedPrices([
      page([['a', 100, 'high'], ['b', 200, 'high']]),
      page([['c', 300, 'medium']]),
    ]);
    expect(res.merged).toHaveLength(3);
    expect(res.duplicates).toBe(0);
    expect(res.merged).toContainEqual({ productId: 'a', sellPrice: 100 });
    expect(res.merged).toContainEqual({ productId: 'c', sellPrice: 300 });
  });

  it('2 pages, full overlap (duplicate photo) → one set, duplicates=N', () => {
    const res = mergeScannedPrices([
      page([['a', 100, 'high'], ['b', 200, 'high']]),
      page([['a', 100, 'high'], ['b', 200, 'high']]),
    ]);
    expect(res.merged).toHaveLength(2);
    expect(res.duplicates).toBe(2);
  });

  it('partial overlap → higher-confidence reading wins', () => {
    const res = mergeScannedPrices([
      page([['a', 100, 'low']]),
      page([['a', 105, 'high'], ['b', 200, 'medium']]),
    ]);
    expect(res.merged).toHaveLength(2);
    expect(res.merged).toContainEqual({ productId: 'a', sellPrice: 105 });
    expect(res.duplicates).toBe(1);
  });

  it('same productId both high → first occurrence wins (stable)', () => {
    const res = mergeScannedPrices([
      page([['a', 100, 'high']]),
      page([['a', 999, 'high']]),
    ]);
    expect(res.merged).toEqual([{ productId: 'a', sellPrice: 100 }]);
    expect(res.duplicates).toBe(1);
  });

  it('empty input → empty output, no throw, totals zero', () => {
    const res = mergeScannedPrices([]);
    expect(res.merged).toEqual([]);
    expect(res.duplicates).toBe(0);
    expect(res.totalDropped).toBe(0);
  });

  it('sums droppedCount across pages', () => {
    const res = mergeScannedPrices([
      page([['a', 100, 'high']], 2),
      page([['b', 200, 'high']], 3),
    ]);
    expect(res.totalDropped).toBe(5);
  });
});
