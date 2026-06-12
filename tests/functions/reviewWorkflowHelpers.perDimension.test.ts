/**
 * PR-NEXT-BUNDLE-J §A — +10 tests pinning the per-dimension state-machine
 * helpers. Covers Sudhir's 2026-06-10 bug: shop+delivery both 1★, shop
 * corrected, delivery side auto-resolved without the partner responding.
 */
import {
  decideInitialPerDimension,
  computeLegacyState,
  canRespondPerDimension,
  canAmendPerDimension,
  canAcknowledgePerDimension,
} from '../../functions/src/reviewWorkflowHelpers';

describe('decideInitialPerDimension', () => {
  it('both above threshold → both published', () => {
    expect(
      decideInitialPerDimension({
        shopStars: 5,
        deliveryStars: 4,
        shopThreshold: 3,
        partnerThreshold: 3,
      }),
    ).toEqual({ shopState: 'published', deliveryState: 'published' });
  });

  it('shop low only → shop flagged, delivery published', () => {
    expect(
      decideInitialPerDimension({
        shopStars: 1,
        deliveryStars: 5,
        shopThreshold: 3,
        partnerThreshold: 3,
      }),
    ).toEqual({ shopState: 'flagged_low', deliveryState: 'published' });
  });

  it('delivery low only → shop published, delivery flagged', () => {
    expect(
      decideInitialPerDimension({
        shopStars: 5,
        deliveryStars: 1,
        shopThreshold: 3,
        partnerThreshold: 3,
      }),
    ).toEqual({ shopState: 'published', deliveryState: 'flagged_low' });
  });

  it('both low → both flagged (Sudhir scenario)', () => {
    expect(
      decideInitialPerDimension({
        shopStars: 1,
        deliveryStars: 1,
        shopThreshold: 3,
        partnerThreshold: 3,
      }),
    ).toEqual({ shopState: 'flagged_low', deliveryState: 'flagged_low' });
  });

  it('delivery not rated → delivery n_a', () => {
    expect(
      decideInitialPerDimension({
        shopStars: 1,
        deliveryStars: null,
        shopThreshold: 3,
        partnerThreshold: 3,
      }),
    ).toEqual({ shopState: 'flagged_low', deliveryState: 'n_a' });
    expect(
      decideInitialPerDimension({
        shopStars: 5,
        deliveryStars: undefined,
        shopThreshold: 3,
        partnerThreshold: 3,
      }),
    ).toEqual({ shopState: 'published', deliveryState: 'n_a' });
  });
});

describe('computeLegacyState (worst-of)', () => {
  it('flagged_low wins over published', () => {
    expect(computeLegacyState('published', 'flagged_low')).toBe('flagged_low');
    expect(computeLegacyState('flagged_low', 'published')).toBe('flagged_low');
  });

  it('responded wins over amended/published; flagged wins over responded', () => {
    expect(computeLegacyState('responded', 'published')).toBe('responded');
    expect(computeLegacyState('amended', 'responded')).toBe('responded');
    expect(computeLegacyState('flagged_low', 'responded')).toBe('flagged_low');
  });

  it('both published → published', () => {
    expect(computeLegacyState('published', 'published')).toBe('published');
  });

  it('n_a delivery → reflects shop only', () => {
    expect(computeLegacyState('flagged_low', 'n_a')).toBe('flagged_low');
    expect(computeLegacyState('published', 'n_a')).toBe('published');
    expect(computeLegacyState('responded', 'n_a')).toBe('responded');
  });
});

describe('per-dimension gates', () => {
  it('canRespond only while flagged_low', () => {
    expect(canRespondPerDimension('flagged_low')).toBe(true);
    expect(canRespondPerDimension('responded')).toBe(false);
    expect(canRespondPerDimension('published')).toBe(false);
    expect(canRespondPerDimension('n_a')).toBe(false);
    expect(canRespondPerDimension(undefined)).toBe(false);
  });

  it('canAmend / canAcknowledge only while responded', () => {
    expect(canAmendPerDimension('responded')).toBe(true);
    expect(canAmendPerDimension('flagged_low')).toBe(false);
    expect(canAcknowledgePerDimension('responded')).toBe(true);
    expect(canAcknowledgePerDimension('published')).toBe(false);
    expect(canAcknowledgePerDimension(null)).toBe(false);
  });
});
