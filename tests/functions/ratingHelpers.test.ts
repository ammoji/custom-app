/**
 * PR 20 — tests for the rating pure helpers.
 *
 * Validation surface gets 12 cases (each rejection branch + happy
 * paths with/without comment + whitespace-collapse). Rolling
 * average gets 4 cases including the explicit fresh-shop branch
 * and the negative-coercion defense.
 */
import { describe, expect, it } from '@jest/globals';
import {
    computeNewRollingAverage,
    validateRatingSubmission,
} from '../../functions/src/ratingHelpers';

const BASE_ORDER = {
  customerUid: 'u1',
  status: 'delivered',
  shopId: 'shop_1',
};

describe('validateRatingSubmission', () => {
  it('rejects unauthenticated', () => {
    const r = validateRatingSubmission({
      auth: null,
      order: BASE_ORDER,
      stars: 5,
      comment: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  it('rejects missing order (not found)', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: null,
      stars: 5,
      comment: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not-found');
  });

  it('rejects rating an order belonging to a different customer', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u2' },
      order: BASE_ORDER,
      stars: 5,
      comment: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  it('rejects rating a non-delivered order', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: { ...BASE_ORDER, status: 'preparing' },
      stars: 5,
      comment: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('failed-precondition');
  });

  it('rejects re-rating an already-rated order', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: { ...BASE_ORDER, rating: { stars: 4, ratedAt: 1000 } },
      stars: 5,
      comment: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('failed-precondition');
  });

  it('rejects an order missing shopId', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: { customerUid: 'u1', status: 'delivered' },
      stars: 5,
      comment: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('rejects stars below 1', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: BASE_ORDER,
      stars: 0,
      comment: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('rejects stars above 5', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: BASE_ORDER,
      stars: 6,
      comment: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('rejects non-integer stars', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: BASE_ORDER,
      stars: 4.5,
      comment: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('rejects non-string comment', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: BASE_ORDER,
      stars: 5,
      comment: 42,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('rejects oversized comment', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: BASE_ORDER,
      stars: 5,
      comment: 'x'.repeat(501),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('accepts a clean valid submission with comment (and trims)', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: BASE_ORDER,
      stars: 5,
      comment: '  Great service  ',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.stars).toBe(5);
      expect(r.comment).toBe('Great service');
      expect(r.shopId).toBe('shop_1');
      expect(r.uid).toBe('u1');
    }
  });

  it('accepts a submission without comment', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: BASE_ORDER,
      stars: 3,
      comment: undefined,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.comment).toBeUndefined();
  });

  it('treats whitespace-only comment as empty (no field stored)', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: BASE_ORDER,
      stars: 5,
      comment: '   ',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.comment).toBeUndefined();
  });
});

describe('computeNewRollingAverage', () => {
  it('handles first rating on a fresh shop (undefined avg + count)', () => {
    expect(computeNewRollingAverage(undefined, undefined, 5)).toEqual({
      newAvg: 5,
      newCount: 1,
    });
    expect(computeNewRollingAverage(undefined, undefined, 3)).toEqual({
      newAvg: 3,
      newCount: 1,
    });
  });

  it('rolls a 5-star into an existing 4.0 / 3 ratings shop', () => {
    // (4.0*3 + 5) / 4 = 17/4 = 4.25 → rounds to 4.3 (banker's rounding
    // in Math.round actually rounds 4.25 → 4 in some locales, but
    // multiplying by 10 first → 42.5 → Math.round → 43 → /10 = 4.3
    // because JS Math.round of .5 rounds toward +Infinity).
    const r = computeNewRollingAverage(4.0, 3, 5);
    expect(r.newCount).toBe(4);
    expect(r.newAvg).toBe(4.3);
  });

  it('rolls a 1-star into a 5.0 / 10 shop', () => {
    // (5.0*10 + 1) / 11 = 51/11 = 4.636... → rounds to 4.6
    const r = computeNewRollingAverage(5.0, 10, 1);
    expect(r.newCount).toBe(11);
    expect(r.newAvg).toBe(4.6);
  });

  it('treats negative / garbage avg + count as zero', () => {
    expect(computeNewRollingAverage(-1, -5, 5)).toEqual({
      newAvg: 5,
      newCount: 1,
    });
  });

  it('rounds to exactly 1 decimal place', () => {
    // Many ratings — confirm we never see >1 decimal sneaking out.
    const r = computeNewRollingAverage(3.7, 100, 4);
    expect(Math.round(r.newAvg * 10)).toBe(r.newAvg * 10);
  });
});
