/**
 * PR-NEXT-BUNDLE-H §D — +3 tests for derivePushTitle.
 */
import {
  derivePushTitle,
  deriveResponseDimension,
} from '../../functions/src/respondToReviewPushHelpers';

describe('derivePushTitle', () => {
  it('shop → "💬 Shop responded to your review"', () => {
    expect(derivePushTitle('shop')).toBe('💬 Shop responded to your review');
  });

  it('partner → "💬 Delivery partner responded to your review"', () => {
    expect(derivePushTitle('partner')).toBe('💬 Delivery partner responded to your review');
  });

  it('null / undefined / unknown → defaults to shop copy', () => {
    expect(derivePushTitle(null)).toBe('💬 Shop responded to your review');
    expect(derivePushTitle(undefined)).toBe('💬 Shop responded to your review');
    expect(derivePushTitle('unknown')).toBe('💬 Shop responded to your review');
  });
});

// PR-NEXT-BUNDLE-J §K — +2 tests for deriveResponseDimension.
describe('deriveResponseDimension', () => {
  it('partner → delivery (deep-link scopes to the delivery side)', () => {
    expect(deriveResponseDimension('partner')).toBe('delivery');
  });

  it('shop / null / unknown → shop (safe default)', () => {
    expect(deriveResponseDimension('shop')).toBe('shop');
    expect(deriveResponseDimension(null)).toBe('shop');
    expect(deriveResponseDimension(undefined)).toBe('shop');
    expect(deriveResponseDimension('weird')).toBe('shop');
  });
});
