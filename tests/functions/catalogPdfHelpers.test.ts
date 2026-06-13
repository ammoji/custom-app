/**
 * PR-NEXT-BUNDLE-L §G — tests for the printable-catalog PDF pure
 * helpers (`catalogPdfHelpers.ts`).
 *
 * The PDF byte-buffer is verified structurally (non-empty, `%PDF`
 * magic header) rather than by parsing pages — pdfkit compresses
 * its content streams, so page-count assertions are made against
 * `groupItemsByCategory` (which deterministically decides the page
 * count) instead.
 */
import {
  buildCatalogPdfBuffer,
  groupItemsByCategory,
  formatItemRow,
  buildQrPayload,
  resolveCategoryIdsForPdf,
  type CatalogPdfItem,
} from '../../functions/src/catalogPdfHelpers';
import {
  CATEGORY_LABELS,
  CATEGORY_LABELS_ORDERED,
  VALID_CATEGORIES,
} from '../../functions/src/categoryConstants';

const item = (over: Partial<CatalogPdfItem> = {}): CatalogPdfItem => ({
  id: 'ABCD-1234',
  name: 'Aashirvaad Atta',
  brand: 'Aashirvaad',
  packLabel: '10 kg',
  mrp: 520,
  category: 'atta_rice_dal',
  ...over,
});

const allCategoryItems = (): CatalogPdfItem[] =>
  CATEGORY_LABELS_ORDERED.map((c, i) =>
    item({ id: `ID-${i}`, name: `Item ${i}`, category: c.id }),
  );

describe('buildCatalogPdfBuffer', () => {
  it('throws on empty input', async () => {
    await expect(
      buildCatalogPdfBuffer([], 'TestShop', new Date()),
    ).rejects.toThrow(/no items/);
  });

  it('1 category, 3 items → a non-empty PDF buffer', async () => {
    const items = [
      item({ id: 'a', name: 'A' }),
      item({ id: 'b', name: 'B' }),
      item({ id: 'c', name: 'C' }),
    ];
    const buf = await buildCatalogPdfBuffer(items, 'TestShop', new Date());
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('all 10 categories → a non-empty PDF buffer', async () => {
    const buf = await buildCatalogPdfBuffer(
      allCategoryItems(),
      'TestShop',
      new Date(),
    );
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});

describe('groupItemsByCategory', () => {
  it('bins items into their categories and drops empty categories', () => {
    const grouped = groupItemsByCategory([
      item({ id: '1', category: 'atta_rice_dal' }),
      item({ id: '2', category: 'atta_rice_dal' }),
      item({ id: '3', category: 'beverages' }),
    ]);
    expect(grouped.size).toBe(2);
    expect(grouped.get('atta_rice_dal')).toHaveLength(2);
    expect(grouped.get('beverages')).toHaveLength(1);
  });

  it('all 10 categories present → 10 groups (= 10 PDF pages)', () => {
    expect(groupItemsByCategory(allCategoryItems()).size).toBe(10);
  });

  it('preserves canonical category order', () => {
    const grouped = groupItemsByCategory([
      item({ id: '1', category: 'beverages' }),
      item({ id: '2', category: 'atta_rice_dal' }),
    ]);
    // atta_rice_dal is first in CATEGORY_LABELS_ORDERED, so it leads.
    expect([...grouped.keys()]).toEqual(['atta_rice_dal', 'beverages']);
  });
});

describe('formatItemRow', () => {
  it('includes brand when present', () => {
    expect(formatItemRow(item())).toBe('Aashirvaad Atta (Aashirvaad · 10 kg)');
  });

  it('omits brand when missing', () => {
    expect(formatItemRow(item({ brand: null }))).toBe(
      'Aashirvaad Atta (10 kg)',
    );
  });

  it('truncates an unusually long name with an ellipsis', () => {
    const longName = 'X'.repeat(80);
    const row = formatItemRow(item({ name: longName }));
    // Name portion truncated to 60 chars (59 X's + ellipsis).
    expect(row.startsWith('X'.repeat(59) + '…')).toBe(true);
    expect(row).toContain('(Aashirvaad · 10 kg)');
  });
});

describe('buildQrPayload', () => {
  it('produces deterministic JSON output', () => {
    const a = buildQrPayload('shop1', 1, 'atta_rice_dal', ['p1', 'p2']);
    const b = buildQrPayload('shop1', 1, 'atta_rice_dal', ['p1', 'p2']);
    expect(a).toBe(b);
    expect(JSON.parse(a)).toEqual({
      shopId: 'shop1',
      pageNumber: 1,
      categoryId: 'atta_rice_dal',
      productIds: ['p1', 'p2'],
    });
  });
});

describe('resolveCategoryIdsForPdf', () => {
  it('empty/undefined → all 10 categories in canonical order', () => {
    expect(resolveCategoryIdsForPdf()).toEqual(
      CATEGORY_LABELS_ORDERED.map(c => c.id),
    );
    expect(resolveCategoryIdsForPdf([])).toHaveLength(10);
  });

  it('filters out unknown category ids', () => {
    expect(
      resolveCategoryIdsForPdf(['beverages', 'not_a_real_category']),
    ).toEqual(['beverages']);
  });

  it('returns requested ids in canonical order regardless of input order', () => {
    expect(resolveCategoryIdsForPdf(['beverages', 'atta_rice_dal'])).toEqual([
      'atta_rice_dal',
      'beverages',
    ]);
  });
});

describe('CATEGORY_LABELS parity', () => {
  it('label keys exactly match VALID_CATEGORIES', () => {
    const labelKeys = new Set(Object.keys(CATEGORY_LABELS));
    expect(labelKeys.size).toBe(VALID_CATEGORIES.size);
    for (const id of VALID_CATEGORIES) {
      expect(labelKeys.has(id)).toBe(true);
    }
  });
});
