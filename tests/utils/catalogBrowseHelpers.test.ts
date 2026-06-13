/**
 * PR-NEXT-BUNDLE-K — Unit tests for catalogBrowseHelpers.ts.
 * 13 tests covering all pure client-side browse helpers.
 */

import {
  buildBulkCommitItems,
  classifyVoiceUtterance,
  computeCategoryProgress,
  computeRemainingByCategory,
  decideVoiceCapture,
  deriveCardAction,
  filterCatalogByExistingMenu,
  findFirstUnpricedRow,
  findNextUnpricedRow,
  formatPackLabel,
  isCategoryComplete,
  mapMasterProductToRow,
  nextItemIndex,
  nextStopSignal,
  partitionDraftsForBulkCommit,
  validateInlinePrice,
  type CategoryListItemRow,
} from '../../src/utils/catalogBrowseHelpers';
import type { MasterProduct, PriceDraft } from '../../src/types';

// PR-NEXT-BUNDLE-K.1 — table-view row fixture.
const makeRow = (productId: string, mrp = 100): CategoryListItemRow => ({
  productId,
  name: productId,
  packSize: { value: 1, unit: 'kg' },
  mrp,
  imageUrl: '',
});

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

describe('computeCategoryProgress (K.1 table view)', () => {
  const rows = [makeRow('a'), makeRow('b'), makeRow('c'), makeRow('d')];

  it('computes priced/total/percentage', () => {
    const drafts = new Map<string, number>([['a', 50], ['c', 80]]);
    const p = computeCategoryProgress(rows, drafts);
    expect(p.priced).toBe(2);
    expect(p.total).toBe(4);
    expect(p.percentage).toBe(50);
  });

  it('returns 0% for empty item list', () => {
    const p = computeCategoryProgress([], new Map());
    expect(p.percentage).toBe(0);
    expect(p.total).toBe(0);
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

// ── PR-NEXT-BUNDLE-K.1 — table-view + voice auto-advance helpers ──────────────

describe('findNextUnpricedRow', () => {
  const rows = [makeRow('a'), makeRow('b'), makeRow('c'), makeRow('d')];

  it('finds first un-priced from start when focus is null', () => {
    const drafts = new Map<string, number>([['a', 50]]);
    expect(findNextUnpricedRow(rows, drafts, null)?.productId).toBe('b');
  });

  it('finds next un-priced AFTER the focused row', () => {
    const drafts = new Map<string, number>([['c', 80]]);
    // focus on 'b' → next un-priced after b is 'd' (c is priced)
    expect(findNextUnpricedRow(rows, drafts, 'b')?.productId).toBe('d');
  });

  it('returns null when focused row is the last row', () => {
    expect(findNextUnpricedRow(rows, new Map(), 'd')).toBeNull();
  });

  it('returns null when every later row is priced', () => {
    const drafts = new Map<string, number>([['c', 1], ['d', 1]]);
    expect(findNextUnpricedRow(rows, drafts, 'b')).toBeNull();
  });

  it('returns null for an empty item list', () => {
    expect(findNextUnpricedRow([], new Map(), null)).toBeNull();
  });
});

describe('findFirstUnpricedRow', () => {
  const rows = [makeRow('a'), makeRow('b'), makeRow('c')];

  it('returns the first row when none priced', () => {
    expect(findFirstUnpricedRow(rows, new Map())?.productId).toBe('a');
  });

  it('skips priced rows from the top', () => {
    const drafts = new Map<string, number>([['a', 10], ['b', 20]]);
    expect(findFirstUnpricedRow(rows, drafts)?.productId).toBe('c');
  });

  it('returns null when all rows are priced', () => {
    const drafts = new Map<string, number>([['a', 1], ['b', 1], ['c', 1]]);
    expect(findFirstUnpricedRow(rows, drafts)).toBeNull();
  });
});

describe('validateInlinePrice', () => {
  it('rejects zero / negative prices', () => {
    expect(validateInlinePrice(0, 100).ok).toBe(false);
    expect(validateInlinePrice(-5, 100).ok).toBe(false);
  });

  it('rejects a price more than 10x MRP', () => {
    const r = validateInlinePrice(1001, 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('100');
  });

  it('accepts a sane price at or below 10x MRP', () => {
    expect(validateInlinePrice(120, 100).ok).toBe(true);
    expect(validateInlinePrice(1000, 100).ok).toBe(true);
  });
});

describe('mapMasterProductToRow', () => {
  it('maps id→productId and defaults brand/image', () => {
    const product: MasterProduct = {
      id: 'p1',
      name: 'Aashirvaad Atta',
      category: 'atta_rice_dal',
      packSize: { value: 5, unit: 'kg' },
      mrp: 280,
      status: 'approved',
    };
    const row = mapMasterProductToRow(product);
    expect(row.productId).toBe('p1');
    expect(row.imageUrl).toBe('');
    expect(row.brand).toBeUndefined();
    expect(row.mrp).toBe(280);
  });
});

describe('classifyVoiceUtterance', () => {
  it('classifies skip / next (en + hi)', () => {
    expect(classifyVoiceUtterance('skip')).toBe('skip');
    expect(classifyVoiceUtterance('next please')).toBe('skip');
    expect(classifyVoiceUtterance('अगला')).toBe('skip');
  });

  it('classifies stop / done (en + hi)', () => {
    expect(classifyVoiceUtterance('stop')).toBe('stop');
    expect(classifyVoiceUtterance('done')).toBe('stop');
    expect(classifyVoiceUtterance('बस')).toBe('stop');
  });

  it('treats a spoken number as a price reading', () => {
    expect(classifyVoiceUtterance('two hundred fifty')).toBe('price');
  });
});

describe('decideVoiceCapture', () => {
  it('commits a high-confidence number', () => {
    const d = decideVoiceCapture('250 rupees', 'en');
    expect(d.action).toBe('commit');
    if (d.action === 'commit') expect(d.price).toBe(250);
  });

  it('returns skip on "skip" before parsing a number', () => {
    expect(decideVoiceCapture('skip', 'en').action).toBe('skip');
  });

  it('returns stop on "stop"', () => {
    expect(decideVoiceCapture('stop', 'en').action).toBe('stop');
  });

  it('returns retry on an unparseable / no-number utterance', () => {
    expect(decideVoiceCapture('hmm uhh', 'en').action).toBe('retry');
  });

  it('returns retry on low-confidence (multiple numbers)', () => {
    // two numbers → parser yields low confidence → no auto-commit
    expect(decideVoiceCapture('100 200', 'en').action).toBe('retry');
  });
});

describe('buildBulkCommitItems', () => {
  it('flattens the draft map and drops non-positive prices', () => {
    const drafts = new Map<string, number>([
      ['a', 50],
      ['b', 0],
      ['c', 120],
    ]);
    const out = buildBulkCommitItems(drafts);
    expect(out).toEqual([
      { productId: 'a', price: 50 },
      { productId: 'c', price: 120 },
    ]);
  });

  it('returns empty array for empty drafts', () => {
    expect(buildBulkCommitItems(new Map())).toEqual([]);
  });
});

// ── HOTFIX-K1 §A/§B — filter + remaining counts + stop-signal ────────────────

describe('filterCatalogByExistingMenu', () => {
  const catalog = [makeRow('a'), makeRow('b'), makeRow('c')];

  it('empty existing set → all items returned', () => {
    expect(filterCatalogByExistingMenu(catalog, new Set())).toHaveLength(3);
  });

  it('existing set covers all → empty array', () => {
    const all = new Set(['a', 'b', 'c']);
    expect(filterCatalogByExistingMenu(catalog, all)).toEqual([]);
  });

  it('partial overlap → only the not-yet-added subset', () => {
    const some = new Set(['a', 'c']);
    const out = filterCatalogByExistingMenu(catalog, some);
    expect(out.map(r => r.productId)).toEqual(['b']);
  });

  it('existing IDs not present in catalog are ignored', () => {
    const extra = new Set(['x', 'y', 'a']);
    const out = filterCatalogByExistingMenu(catalog, extra);
    expect(out.map(r => r.productId)).toEqual(['b', 'c']);
  });
});

describe('computeRemainingByCategory', () => {
  it('single category, partial overlap → correct counts', () => {
    const byCat = new Map<string, CategoryListItemRow[]>([
      ['atta_rice_dal', [makeRow('a'), makeRow('b'), makeRow('c')]],
    ]);
    const existing = new Set(['a']);
    const result = computeRemainingByCategory(byCat, existing);
    const info = result.get('atta_rice_dal')!;
    expect(info.total).toBe(3);
    expect(info.remaining).toBe(2);
    expect(info.allAdded).toBe(false);
  });

  it('multiple categories with mixed coverage', () => {
    const byCat = new Map<string, CategoryListItemRow[]>([
      ['dairy_eggs', [makeRow('d1'), makeRow('d2')]],
      ['beverages', [makeRow('b1')]],
      ['bakery', []],
    ]);
    const existing = new Set(['d1', 'd2', 'b1']);
    const result = computeRemainingByCategory(byCat, existing);
    expect(result.get('dairy_eggs')!.allAdded).toBe(true);
    expect(result.get('beverages')!.remaining).toBe(0);
    // empty category never reports allAdded (no items to add).
    expect(result.get('bakery')!.allAdded).toBe(false);
    expect(result.get('bakery')!.total).toBe(0);
  });

  it('allAdded is true exactly when remaining === 0 and total > 0', () => {
    const byCat = new Map<string, CategoryListItemRow[]>([
      ['household', [makeRow('h1'), makeRow('h2')]],
    ]);
    const result = computeRemainingByCategory(byCat, new Set(['h1', 'h2']));
    const info = result.get('household')!;
    expect(info.remaining).toBe(0);
    expect(info.allAdded).toBe(true);
  });
});

describe('nextStopSignal', () => {
  it("decision='stop' → returns true", () => {
    expect(nextStopSignal({ action: 'stop' }, false)).toBe(true);
  });

  it("decision='commit' → returns currentStop unchanged", () => {
    expect(nextStopSignal({ action: 'commit', price: 50 }, false)).toBe(false);
    expect(nextStopSignal({ action: 'commit', price: 50 }, true)).toBe(true);
  });

  it("decision='skip' / 'retry' → returns currentStop unchanged", () => {
    expect(nextStopSignal({ action: 'skip' }, false)).toBe(false);
    expect(nextStopSignal({ action: 'retry' }, true)).toBe(true);
  });
});
