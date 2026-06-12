/**
 * PR-NEXT-BUNDLE-H §A — +6 tests for deriveCustomerReviewResponseView.
 *
 * Deliberate-break demo:
 *   Change `if (state === 'responded')` to `if (state === 'NEVER')` →
 *   tests 2 and 3 fail (responded states return 'none' instead).
 *   Restore. Tests pass.
 */
import { deriveCustomerReviewResponseView } from '../../src/utils/deriveCustomerReviewResponseView';

const BASE_ORDER = {
  id: 'order-1',
  shopName: 'Test Shop',
  shopRating: 3,
  deliveryPersonName: 'Rahul Kumar',
  deliveryPersonPhotoUrl: 'https://example.com/photo.jpg',
  responseText: 'Thank you for the feedback.',
  responseAt: 1700000000,
  ratingId: 'rating-abc',
};

describe('deriveCustomerReviewResponseView', () => {
  it('flagged_low → awaiting', () => {
    const v = deriveCustomerReviewResponseView({ ...BASE_ORDER, correctionState: 'flagged_low' });
    expect(v.kind).toBe('awaiting');
  });

  it('responded + responseBy shop → responded with shop responder', () => {
    const v = deriveCustomerReviewResponseView({
      ...BASE_ORDER,
      correctionState: 'responded',
      responseBy: 'shop',
    });
    expect(v.kind).toBe('responded');
    if (v.kind !== 'responded') return;
    expect(v.responder.kind).toBe('shop');
    expect(v.responder.name).toBe('Test Shop');
    expect(v.responseText).toBe('Thank you for the feedback.');
  });

  it('responded + responseBy partner → responded with partner responder + photo', () => {
    const v = deriveCustomerReviewResponseView({
      ...BASE_ORDER,
      correctionState: 'responded',
      responseBy: 'partner',
    });
    expect(v.kind).toBe('responded');
    if (v.kind !== 'responded') return;
    expect(v.responder.kind).toBe('partner');
    expect(v.responder.name).toBe('Rahul Kumar');
    expect(v.responder.photoUrl).toBe('https://example.com/photo.jpg');
    expect(v.ratingId).toBe('rating-abc');
  });

  it('amended → amended', () => {
    const v = deriveCustomerReviewResponseView({ ...BASE_ORDER, correctionState: 'amended' });
    expect(v.kind).toBe('amended');
  });

  it('published → published', () => {
    const v = deriveCustomerReviewResponseView({ ...BASE_ORDER, correctionState: 'published' });
    expect(v.kind).toBe('published');
  });

  it('missing correctionState / ratingId → none (safe no-render)', () => {
    const v = deriveCustomerReviewResponseView({ id: 'order-2', shopName: 'Shop' });
    expect(v.kind).toBe('none');
  });
});
