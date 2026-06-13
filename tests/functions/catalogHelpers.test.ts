/**
 * PR-NEXT-BUNDLE-K — Unit tests for catalogHelpers.ts.
 * 19 tests covering all pure helpers.
 */

import {
  buildCatalogPage,
  buildShopMenuItemFromMasterProduct,
  partitionBulkCommitItems,
  summarizePendingItems,
  validateCatalogReviewAction,
  validateMasterCatalogProposal,
  validatePrice,
  type MasterProductDoc,
} from '../../functions/src/catalogHelpers';

// ── validatePrice ────────────────────────────────────────────────────────────

describe('validatePrice', () => {
  it('accepts a valid price', () => {
    expect(validatePrice(45)).toEqual({ ok: true });
  });

  it('accepts max price', () => {
    expect(validatePrice(99999)).toEqual({ ok: true });
  });

  it('rejects zero', () => {
    const r = validatePrice(0);
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe('not_positive');
  });

  it('rejects negative', () => {
    expect(validatePrice(-1)).toMatchObject({ ok: false });
  });

  it('rejects Infinity', () => {
    const r = validatePrice(Infinity);
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe('not_finite');
  });

  it('rejects string', () => {
    expect(validatePrice('45' as any)).toMatchObject({ ok: false });
  });

  it('rejects above max', () => {
    const r = validatePrice(100000);
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe('above_max');
  });
});

// ── partitionBulkCommitItems ─────────────────────────────────────────────────

describe('partitionBulkCommitItems', () => {
  it('partitions valid and invalid items', () => {
    const items = [
      { productId: 'p1', price: 50 },
      { productId: '', price: 30 },
      { productId: 'p3', price: -1 },
      { productId: 'p4', price: 99 },
    ];
    const r = partitionBulkCommitItems(items);
    expect(r.valid).toHaveLength(2);
    expect(r.skipped).toHaveLength(2);
    expect(r.tooLarge).toBe(false);
    expect(r.valid.map(v => v.productId)).toEqual(['p1', 'p4']);
  });

  it('sets tooLarge when > 100 items', () => {
    const items = Array.from({ length: 105 }, (_, i) => ({
      productId: `p${i}`,
      price: 10,
    }));
    const r = partitionBulkCommitItems(items);
    expect(r.tooLarge).toBe(true);
    expect(r.valid.length).toBeLessThanOrEqual(100);
  });

  it('handles empty array', () => {
    const r = partitionBulkCommitItems([]);
    expect(r.valid).toHaveLength(0);
    expect(r.tooLarge).toBe(false);
  });
});

// ── validateMasterCatalogProposal ────────────────────────────────────────────

describe('validateMasterCatalogProposal', () => {
  const valid = {
    name: 'Amul Butter',
    category: 'dairy_eggs',
    mrp: 55,
    packSizeValue: 100,
    packSizeUnit: 'g',
  };

  it('accepts a valid proposal', () => {
    expect(validateMasterCatalogProposal(valid)).toEqual({ ok: true });
  });

  it('rejects missing name', () => {
    const r = validateMasterCatalogProposal({ ...valid, name: '' });
    expect(r).toMatchObject({ ok: false, code: 'name_required' });
  });

  it('rejects name too long', () => {
    const r = validateMasterCatalogProposal({ ...valid, name: 'x'.repeat(121) });
    expect(r).toMatchObject({ ok: false, code: 'name_too_long' });
  });

  it('rejects invalid category', () => {
    const r = validateMasterCatalogProposal({ ...valid, category: 'unknown_cat' });
    expect(r).toMatchObject({ ok: false, code: 'category_invalid' });
  });

  it('rejects zero mrp', () => {
    const r = validateMasterCatalogProposal({ ...valid, mrp: 0 });
    expect(r).toMatchObject({ ok: false, code: 'mrp_invalid' });
  });

  it('rejects invalid packSizeValue', () => {
    const r = validateMasterCatalogProposal({ ...valid, packSizeValue: -1 });
    expect(r).toMatchObject({ ok: false, code: 'pack_size_invalid' });
  });
});

// ── validateCatalogReviewAction ───────────────────────────────────────────────

describe('validateCatalogReviewAction', () => {
  it('accepts approved action', () => {
    expect(validateCatalogReviewAction({ productId: 'p1', action: 'approved' }))
      .toEqual({ ok: true });
  });

  it('accepts rejected with reason', () => {
    expect(
      validateCatalogReviewAction({
        productId: 'p1',
        action: 'rejected',
        rejectionReason: 'Duplicate',
      }),
    ).toEqual({ ok: true });
  });

  it('rejects missing productId', () => {
    const r = validateCatalogReviewAction({ productId: '', action: 'approved' });
    expect(r).toMatchObject({ ok: false, code: 'product_id_required' });
  });

  it('rejects invalid action', () => {
    const r = validateCatalogReviewAction({ productId: 'p1', action: 'maybe' });
    expect(r).toMatchObject({ ok: false, code: 'invalid_action' });
  });

  it('rejects rejected without reason', () => {
    const r = validateCatalogReviewAction({ productId: 'p1', action: 'rejected' });
    expect(r).toMatchObject({ ok: false, code: 'rejection_reason_required' });
  });
});

// ── buildCatalogPage ──────────────────────────────────────────────────────────

describe('buildCatalogPage', () => {
  const makeDocs = (n: number): MasterProductDoc[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      name: `Product ${i}`,
      category: 'dairy_eggs' as const,
      packSize: { value: 500, unit: 'g' },
      mrp: 50,
      status: 'approved' as const,
    }));

  it('returns all items when under page size', () => {
    const page = buildCatalogPage(makeDocs(3), 10);
    expect(page.items).toHaveLength(3);
    expect(page.hasMore).toBe(false);
    expect(page.cursor).toBe('p2');
  });

  it('sets hasMore and trims when over page size', () => {
    const page = buildCatalogPage(makeDocs(11), 10);
    expect(page.items).toHaveLength(10);
    expect(page.hasMore).toBe(true);
    expect(page.cursor).toBe('p9');
  });

  it('returns null cursor for empty list', () => {
    const page = buildCatalogPage([], 10);
    expect(page.cursor).toBeNull();
    expect(page.hasMore).toBe(false);
  });
});

// ── summarizePendingItems ─────────────────────────────────────────────────────

describe('summarizePendingItems', () => {
  it('counts total and by category', () => {
    const docs: MasterProductDoc[] = [
      { id: 'a', name: 'A', category: 'dairy_eggs', packSize: { value: 1, unit: 'g' }, mrp: 10, status: 'pending', proposedAt: 1000 },
      { id: 'b', name: 'B', category: 'dairy_eggs', packSize: { value: 1, unit: 'g' }, mrp: 10, status: 'pending', proposedAt: 2000 },
      { id: 'c', name: 'C', category: 'beverages', packSize: { value: 1, unit: 'g' }, mrp: 10, status: 'pending', proposedAt: 500 },
    ];
    const s = summarizePendingItems(docs);
    expect(s.total).toBe(3);
    expect(s.byCategory['dairy_eggs']).toBe(2);
    expect(s.byCategory['beverages']).toBe(1);
    expect(s.oldestProposedAt).toBe(500);
  });

  it('returns null oldestProposedAt for empty list', () => {
    const s = summarizePendingItems([]);
    expect(s.oldestProposedAt).toBeNull();
    expect(s.total).toBe(0);
  });
});

// ── buildShopMenuItemFromMasterProduct ────────────────────────────────────────

describe('buildShopMenuItemFromMasterProduct', () => {
  const product: MasterProductDoc = {
    id: 'prod1',
    name: 'Amul Milk',
    brand: 'Amul',
    category: 'dairy_eggs',
    packSize: { value: 500, unit: 'ml' },
    mrp: 28,
    imageUrl: 'https://example.com/milk.jpg',
    status: 'approved',
  };

  it('builds correct menu item', () => {
    const item = buildShopMenuItemFromMasterProduct(product, 'shop1', 25, 1000);
    expect(item.productId).toBe('prod1');
    expect(item.name).toBe('Amul Milk');
    expect(item.price).toBe(25);
    expect(item.mrp).toBe(28);
    expect(item.packLabel).toBe('500ml');
    expect(item.shopId).toBe('shop1');
    expect(item.isCustom).toBe(false);
    expect(item.available).toBe(true);
    expect(item.stock).toBeNull();
    expect(item.deletedAt).toBeNull();
  });
});
