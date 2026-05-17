/**
 * Pure unit tests for pickCartLinePath in
 * functions/src/shopOrdersHelpers.ts.
 *
 * This is the one-line dispatch that decides whether a cart line is
 * validated against the per-shop menu (Phase 12a-v2-iii) or the
 * legacy products collection. The Phase 12a-v2-iv hotfix to
 * useCartStore stamps menuItemId on every cart line so the legacy
 * path is now only reachable from genuinely-stale persisted carts.
 * Pin that contract so future cart-store refactors don't silently
 * regress to the legacy path.
 */
import { pickCartLinePath } from '../../functions/src/shopOrdersHelpers';

describe('pickCartLinePath', () => {
  test('returns `menu` when menuItemId is a non-empty string', () => {
    expect(
      pickCartLinePath({ menuItemId: 'shops/shop_001/menu/p_001_atta_5kg' }),
    ).toBe('menu');
  });

  test('returns `legacy` when menuItemId is absent', () => {
    expect(pickCartLinePath({})).toBe('legacy');
  });

  test('returns `legacy` when menuItemId is an empty string', () => {
    // Empty string would be coerced to truthy in some refactors;
    // pin the predicate so a `String(menuItemId).length > 0` check
    // can't accidentally regress here.
    expect(pickCartLinePath({ menuItemId: '' })).toBe('legacy');
  });

  test('returns `legacy` when menuItemId is the wrong type (number)', () => {
    // Defensive: the cart store is typed, but persisted state from
    // older app versions could rehydrate as `unknown`. Helper must
    // reject anything that isn't a non-empty string.
    expect(pickCartLinePath({ menuItemId: 42 as unknown as string })).toBe(
      'legacy',
    );
  });
});
