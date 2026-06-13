/**
 * PR-NEXT-BUNDLE-K §I — Customer-side verification tests.
 *
 * Verifies that pending/rejected proposed catalog items never leak
 * into a customer-facing browse surface — the same predicate the
 * Firestore rule on `products/` enforces.
 */

import {
  filterCustomerVisibleProducts,
  isCustomerVisibleProduct,
  type MasterProductDoc,
} from '../../functions/src/catalogHelpers';

const make = (id: string, status: MasterProductDoc['status']): MasterProductDoc => ({
  id,
  name: id,
  category: 'dairy_eggs',
  packSize: { value: 1, unit: 'g' },
  mrp: 10,
  status,
});

describe('isCustomerVisibleProduct', () => {
  it('approved items are visible', () => {
    expect(isCustomerVisibleProduct(make('a', 'approved'))).toBe(true);
  });

  it('pending items are hidden', () => {
    expect(isCustomerVisibleProduct(make('b', 'pending'))).toBe(false);
  });

  it('rejected items are hidden', () => {
    expect(isCustomerVisibleProduct(make('c', 'rejected'))).toBe(false);
  });

  it('null/undefined is hidden', () => {
    expect(isCustomerVisibleProduct(null)).toBe(false);
    expect(isCustomerVisibleProduct(undefined)).toBe(false);
  });
});

describe('filterCustomerVisibleProducts', () => {
  it('keeps only approved items, preserving order', () => {
    const docs = [
      make('a', 'approved'),
      make('b', 'pending'),
      make('c', 'approved'),
      make('d', 'rejected'),
    ];
    const visible = filterCustomerVisibleProducts(docs);
    expect(visible.map(d => d.id)).toEqual(['a', 'c']);
  });

  it('returns empty when no approved items', () => {
    const docs = [make('b', 'pending'), make('d', 'rejected')];
    expect(filterCustomerVisibleProducts(docs)).toHaveLength(0);
  });
});
