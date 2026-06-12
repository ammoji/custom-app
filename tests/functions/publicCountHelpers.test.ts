/**
 * PR-NEXT-BUNDLE-G §C — DO NOT REMOVE. Tests for computePublicCountDelta
 * and count helpers. +8 tests. Deliberate-break: change next === 'published'
 * guard to next !== 'published' in the helper; all delta tests must fail.
 */

import {
  computePublicCountDelta,
  countPublishedShopReviews,
  countPublishedPartnerReviews,
} from '../../functions/src/publicCountHelpers';

describe('computePublicCountDelta', () => {
  it('flagged_low → published returns 1', () => {
    expect(computePublicCountDelta('flagged_low', 'published')).toBe(1);
  });

  it('responded → published returns 1', () => {
    expect(computePublicCountDelta('responded', 'published')).toBe(1);
  });

  it('amended → published returns 1', () => {
    expect(computePublicCountDelta('amended', 'published')).toBe(1);
  });

  it('published → published is idempotent — returns 0', () => {
    expect(computePublicCountDelta('published', 'published')).toBe(0);
  });

  it('null prev → published returns 1 (fresh high-rated review)', () => {
    expect(computePublicCountDelta(null, 'published')).toBe(1);
  });

  it('undefined prev → published returns 1', () => {
    expect(computePublicCountDelta(undefined, 'published')).toBe(1);
  });

  it('flagged_low → responded returns 0 (not a publish transition)', () => {
    expect(computePublicCountDelta('flagged_low', 'responded')).toBe(0);
  });

  it('flagged_low → acknowledged returns 0', () => {
    expect(computePublicCountDelta('flagged_low', 'acknowledged')).toBe(0);
  });
});

describe('countPublishedShopReviews', () => {
  const reviews = [
    { shopId: 'shop-1', correctionState: 'published' },
    { shopId: 'shop-1', correctionState: 'flagged_low' },
    { shopId: 'shop-1', correctionState: 'published' },
    { shopId: 'shop-2', correctionState: 'published' },
  ];

  it('counts only published reviews for the given shop', () => {
    expect(countPublishedShopReviews(reviews, 'shop-1')).toBe(2);
    expect(countPublishedShopReviews(reviews, 'shop-2')).toBe(1);
  });

  it('returns 0 for unknown shop', () => {
    expect(countPublishedShopReviews(reviews, 'shop-99')).toBe(0);
  });
});

describe('countPublishedPartnerReviews', () => {
  const reviews = [
    { deliveryPersonId: 'uid-1', correctionState: 'published' },
    { deliveryPersonId: 'uid-1', correctionState: 'flagged_low' },
    { deliveryPersonId: 'uid-2', correctionState: 'published' },
  ];

  it('counts only published reviews for the given partner', () => {
    expect(countPublishedPartnerReviews(reviews, 'uid-1')).toBe(1);
    expect(countPublishedPartnerReviews(reviews, 'uid-2')).toBe(1);
  });
});
