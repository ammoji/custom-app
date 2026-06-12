/**
 * HOTFIX-REVIEW-DENORM — tests for buildOrderReviewDenormPayload
 * and deriveDenormFromReview.
 *
 * +5 on the helper, +4 integration-style (callable scenarios),
 * +1 on the backfill helper. Total = 10.
 *
 * Deliberate-break demo:
 *   Remove the `if (input.nextState === 'published')` block from
 *   buildOrderReviewDenormPayload. Test 2 (published + publishedReason)
 *   must fail (publishedAt / publishedReason absent). Restore. Tests pass.
 */
import {
  buildOrderReviewDenormPayload,
  deriveDenormFromReview,
} from '../../functions/src/reviewDenormHelpers';

const NOW = 1_700_000_000_000;

// ─── Pure helper: buildOrderReviewDenormPayload (+5) ────────────────────────

describe('buildOrderReviewDenormPayload', () => {
  it('responded + response fields → payload includes all response keys', () => {
    const p = buildOrderReviewDenormPayload({
      nextState: 'responded',
      nowMs: NOW,
      responseText: 'We are sorry to hear that.',
      responseBy: 'shop',
      responseAt: NOW,
    });
    expect(p.correctionState).toBe('responded');
    expect(p.responseText).toBe('We are sorry to hear that.');
    expect(p.responseBy).toBe('shop');
    expect(p.responseAt).toBe(NOW);
    // published fields must NOT be set for responded state
    expect(p.publishedAt).toBeUndefined();
    expect(p.publishedReason).toBeUndefined();
  });

  it('published + customer_amended + newShopStars → publishedAt + shopRating set', () => {
    const p = buildOrderReviewDenormPayload({
      nextState: 'published',
      nowMs: NOW,
      publishedReason: 'customer_amended',
      newShopStars: 4,
    });
    expect(p.correctionState).toBe('published');
    expect(p.publishedAt).toBe(NOW);
    expect(p.publishedReason).toBe('customer_amended');
    expect(p.shopRating).toBe(4);
    expect(p.deliveryRating).toBeUndefined();
  });

  it('published + timeout → publishedAt + publishedReason: timeout, no star keys', () => {
    const p = buildOrderReviewDenormPayload({
      nextState: 'published',
      nowMs: NOW,
      publishedReason: 'timeout',
    });
    expect(p.correctionState).toBe('published');
    expect(p.publishedAt).toBe(NOW);
    expect(p.publishedReason).toBe('timeout');
    expect(p.shopRating).toBeUndefined();
    expect(p.deliveryRating).toBeUndefined();
  });

  it('published + both newShopStars + newDeliveryStars → both shopRating + deliveryRating', () => {
    const p = buildOrderReviewDenormPayload({
      nextState: 'published',
      nowMs: NOW,
      publishedReason: 'customer_amended',
      newShopStars: 5,
      newDeliveryStars: 3,
    });
    expect(p.shopRating).toBe(5);
    expect(p.deliveryRating).toBe(3);
  });

  it('minimal input (only nextState + nowMs) → only correctionState + updatedAt, no extra keys', () => {
    const p = buildOrderReviewDenormPayload({
      nextState: 'flagged_low',
      nowMs: NOW,
    });
    expect(p.correctionState).toBe('flagged_low');
    expect(p.updatedAt).toBeDefined();
    expect(p.responseText).toBeUndefined();
    expect(p.responseBy).toBeUndefined();
    expect(p.responseAt).toBeUndefined();
    expect(p.shopRating).toBeUndefined();
    expect(p.deliveryRating).toBeUndefined();
    expect(p.publishedAt).toBeUndefined();
    expect(p.publishedReason).toBeUndefined();
  });
});

// ─── Integration-style: callable scenarios (+4) ─────────────────────────────

describe('buildOrderReviewDenormPayload — callable scenarios', () => {
  it('respondToReview scenario: nextState responded + all response fields', () => {
    const trimmedResponse = 'Thank you for the feedback.';
    const nowMs = NOW;
    const responseBy: 'shop' | 'partner' = 'partner';
    const p = buildOrderReviewDenormPayload({
      nextState: 'responded',
      nowMs,
      responseText: trimmedResponse,
      responseBy,
      responseAt: nowMs,
    });
    // What the order doc must look like after respondToReview
    expect(p.correctionState).toBe('responded');
    expect(p.responseText).toBe(trimmedResponse);
    expect(p.responseBy).toBe('partner');
    expect(p.responseAt).toBe(nowMs);
    expect(typeof p.updatedAt).toBe('object'); // FieldValue sentinel
  });

  it('amendRating scenario: nextState published + customer_amended + new stars', () => {
    const p = buildOrderReviewDenormPayload({
      nextState: 'published',
      nowMs: NOW,
      publishedReason: 'customer_amended',
      newShopStars: 4,
      newDeliveryStars: 5,
    });
    // What the order doc must look like after amendRating
    expect(p.correctionState).toBe('published');
    expect(p.publishedReason).toBe('customer_amended');
    expect(p.shopRating).toBe(4);
    expect(p.deliveryRating).toBe(5);
  });

  it('acknowledgeReview scenario: nextState published + customer_acknowledged, no stars', () => {
    const p = buildOrderReviewDenormPayload({
      nextState: 'published',
      nowMs: NOW,
      publishedReason: 'customer_acknowledged',
    });
    // Stars must NOT be changed on acknowledge (customer kept original)
    expect(p.correctionState).toBe('published');
    expect(p.publishedReason).toBe('customer_acknowledged');
    expect(p.shopRating).toBeUndefined();
    expect(p.deliveryRating).toBeUndefined();
  });

  it('publishTimedOutReviews scenario: nextState published + timeout + publishedAt = nowMs', () => {
    const cronNowMs = 1_710_000_000_000;
    const p = buildOrderReviewDenormPayload({
      nextState: 'published',
      nowMs: cronNowMs,
      publishedReason: 'timeout',
    });
    expect(p.correctionState).toBe('published');
    expect(p.publishedAt).toBe(cronNowMs);
    expect(p.publishedReason).toBe('timeout');
  });
});

// ─── Backfill helper: deriveDenormFromReview (+1) ───────────────────────────

describe('deriveDenormFromReview', () => {
  it('review in responded state → payload mirrors respondToReview denorm', () => {
    const review: Record<string, unknown> = {
      correctionState: 'responded',
      responseText: 'We apologise for the delay.',
      responseBy: 'shop',
      responseAt: NOW,
      orderId: 'order-1',
    };
    const p = deriveDenormFromReview(review);
    expect(p.correctionState).toBe('responded');
    expect(p.responseText).toBe('We apologise for the delay.');
    expect(p.responseBy).toBe('shop');
    expect(p.responseAt).toBe(NOW);
    expect(p.publishedAt).toBeUndefined();
  });

  it('review in published state → payload includes publishedAt + publishedReason + stars', () => {
    const review: Record<string, unknown> = {
      correctionState: 'published',
      publishedAt: NOW,
      publishedReason: 'customer_amended',
      shopStars: 4,
      deliveryStars: 5,
      responseText: 'Thanks.',
      responseBy: 'partner',
      responseAt: NOW - 1000,
      orderId: 'order-2',
    };
    const p = deriveDenormFromReview(review);
    expect(p.correctionState).toBe('published');
    expect(p.publishedAt).toBe(NOW);
    expect(p.publishedReason).toBe('customer_amended');
    expect(p.shopRating).toBe(4);
    expect(p.deliveryRating).toBe(5);
  });
});
