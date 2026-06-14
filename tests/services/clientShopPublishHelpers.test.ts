/**
 * PR-NEXT-BUNDLE-M §E/§H — tests for the client mirror of the
 * publish-gate helper. Covers the banner-copy formatter and the
 * Rule 5 fail-closed `isShopPublishable` read.
 *
 * The client file (`src/utils/shopPublishHelpers.ts`) is a
 * byte-identical mirror of `functions/src/shopPublishHelpers.ts`; these
 * tests pin the consumer-facing surface the UI actually renders.
 */
import {
  formatPublishMissingForBanner,
  isShopPublishable,
} from '../../src/utils/shopPublishHelpers';

describe('formatPublishMissingForBanner', () => {
  test('menu only missing → primary CTA "Add items"', () => {
    const out = formatPublishMissingForBanner(
      ['menu_items_below_minimum'],
      2,
      5,
    );
    expect(out.lines).toEqual(['Add 3 more items to your menu']);
    expect(out.primaryCta).toEqual({ label: 'Add items', route: 'BuildCatalog' });
  });

  test('hours only missing → primary CTA "Set hours"', () => {
    const out = formatPublishMissingForBanner(['hours_not_set'], 5, 5);
    expect(out.lines).toEqual(['Set your opening hours']);
    expect(out.primaryCta).toEqual({ label: 'Set hours', route: 'ShopSettings' });
  });

  test('3 missing → 3 bullet lines + first actionable as primary', () => {
    const out = formatPublishMissingForBanner(
      ['menu_items_below_minimum', 'hours_not_set', 'location_not_verified'],
      3,
      5,
    );
    expect(out.lines).toHaveLength(3);
    expect(out.primaryCta).toEqual({ label: 'Add items', route: 'BuildCatalog' });
  });

  test('1 menu item short → "1 more item" not "1 more items"', () => {
    const out = formatPublishMissingForBanner(
      ['menu_items_below_minimum'],
      4,
      5,
    );
    expect(out.lines[0]).toBe('Add 1 more item to your menu');
  });
});

describe('isShopPublishable (Rule 5 fail-closed)', () => {
  test('undefined → false', () => {
    expect(isShopPublishable({})).toBe(false);
  });

  test('false → false', () => {
    expect(isShopPublishable({ isPublishable: false })).toBe(false);
  });

  test('true → true', () => {
    expect(isShopPublishable({ isPublishable: true })).toBe(true);
  });
});
