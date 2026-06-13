/**
 * PR-NEXT-BUNDLE-K §J — Unit tests for cleanup-master-catalog-price-field.ts
 * pure helper `hasLegacyPriceField`.
 */

import { hasLegacyPriceField } from '../../scripts/cleanup-master-catalog-price-field';

describe('hasLegacyPriceField', () => {
  it('returns true when price field is present', () => {
    expect(hasLegacyPriceField({ name: 'Amul Milk', price: 28, mrp: 30 })).toBe(true);
  });

  it('returns false when price field is absent', () => {
    expect(hasLegacyPriceField({ name: 'Amul Milk', mrp: 30 })).toBe(false);
  });

  it('returns true even when price is 0', () => {
    expect(hasLegacyPriceField({ price: 0 })).toBe(true);
  });

  it('returns false for undefined data', () => {
    expect(hasLegacyPriceField(undefined)).toBe(false);
  });
});
