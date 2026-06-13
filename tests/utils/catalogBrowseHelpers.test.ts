/**
 * PR-NEXT-BUNDLE-K — Unit tests for catalogBrowseHelpers.ts.
 * 13 tests covering all pure client-side browse helpers.
 */

import {
  computeCategoryProgress,
  deriveCardAction,
  formatPackLabel,
  isCategoryComplete,
  nextItemIndex,
  partitionDraftsForBulkCommit,
} from '../../src/utils/catalogBrowseHelpers';
import type { MasterProduct, PriceDraft } from '../../src/types';

// ── deriveCardAction ──────────────────────────────────────────────────────────

describe('deriveCardAction', () => {
  it('returns add for positive velocity above threshold', () => {
    expect(deriveCardAction(90, 80)).toBe('add');
  });

  it('returns skip for negative velocity below threshold', () => {
    expect(deriveCardAction(-90, 80)).toBe('skip');
  });

  it('returns none within threshold', () => {
    expect(deriveCardAction(50, 80)).toBe('none');
    expect(deriveCardAction(-50, 80)).toBe('none');
  });

  it('returns none for zero velocity', () => {
    expect(deriveCardAction(0)).toBe('none');
  });
});

// ── nextItemIndex ─────────────────────────────────────────────────────────────

const makeProduct = (id: string): MasterProduct => ({
  id,
  name: id,
  category: 'dairy_eggs',
  packSize: { value: 1, unit: 'g' },
  mrp: 10,
  status: 'approved',
});

describe('nextItemIndex', () => {
  const items = [makeProduct('a'), makeProduct('b'), makeProduct('c'), makeProduct('d')];

  it('returns next unprocessed index', () => {
    const processed = new Set(['b']);
    expect(nextItemIndex(items, 0, processed)).toBe(2);
  });

  it('returns -1 when all remaining are processed', () => {
    const processed = new Set(['b', 'c', 'd']);
    expect(nextItemIndex(items, 0, processed)).toBe(-1);
  });

  it('returns -1 at end of list', () => {
    expect(nextItemIndex(items, 3, new Set())).toBe(-1);
  });
});

// ── partitionDraftsForBulkCommit ──────────────────────────────────────────────

describe('partitionDraftsForBulkCommit', () => {
  const makeDraft = (productId: string, price: number): PriceDraft => ({
    productId,
    price,
    product: makeProduct(productId),
  });

  it('separates ready from missing-price drafts', () => {
    const drafts = [
      makeDraft('a', 50),
      makeDraft('b', 0),
      makeDraft('c', 100),
      makeDraft('d', -1),
    ];
    const { ready, missingPrice } = partitionDraftsForBulkCommit(drafts);
    expect(ready.map(d => d.productId)).toEqual(['a', 'c']);
    expect(missingPrice.map(d => d.productId)).toEqual(['b', 'd']);
  });

  it('handles empty drafts', () => {
    const { ready, missingPrice } = partitionDraftsForBulkCommit([]);
    expect(ready).toHaveLength(0);
    expect(missingPrice).toHaveLength(0);
  });
});

// ── computeCategoryProgress ───────────────────────────────────────────────────

describe('computeCategoryProgress', () => {
  const catalog = {
    dairy_eggs: [makeProduct('d1'), makeProduct('d2'), makeProduct('d3')],
    beverages: [makeProduct('b1')],
  };

  it('computes percentage correctly', () => {
    const added = new Set(['d1', 'd2']);
    const progress = computeCategoryProgress(added, catalog);
    expect(progress['dairy_eggs'].done).toBe(2);
    expect(progress['dairy_eggs'].total).toBe(3);
    expect(progress['dairy_eggs'].pct).toBe(67);
    expect(progress['beverages'].done).toBe(0);
    expect(progress['beverages'].pct).toBe(0);
  });

  it('returns 0% for empty category', () => {
    const progress = computeCategoryProgress(new Set(), { empty_cat: [] });
    expect(progress['empty_cat'].pct).toBe(0);
  });
});

// ── isCategoryComplete ────────────────────────────────────────────────────────

describe('isCategoryComplete', () => {
  const products = [makeProduct('x'), makeProduct('y')];

  it('returns false when some unprocessed', () => {
    expect(isCategoryComplete(products, new Set(['x']))).toBe(false);
  });

  it('returns true when all processed', () => {
    expect(isCategoryComplete(products, new Set(['x', 'y']))).toBe(true);
  });

  it('returns true for empty product list', () => {
    expect(isCategoryComplete([], new Set())).toBe(true);
  });
});

// ── formatPackLabel ───────────────────────────────────────────────────────────

describe('formatPackLabel', () => {
  it('formats value + unit', () => {
    expect(formatPackLabel({ value: 500, unit: 'g' })).toBe('500g');
    expect(formatPackLabel({ value: 1, unit: 'litre' })).toBe('1litre');
  });

  it('handles falsy packSize gracefully', () => {
    expect(formatPackLabel(null as any)).toBe('');
  });
});
