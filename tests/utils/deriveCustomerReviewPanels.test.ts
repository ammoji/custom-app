/**
 * PR-NEXT-BUNDLE-J §H — +8 tests for deriveCustomerReviewPanels. The shop +
 * delivery panels are independent (Sudhir 2026-06-10): one side resolving
 * must not change the other's panel.
 */
import { deriveCustomerReviewPanels } from '../../src/utils/deriveCustomerReviewResponseView';

const BASE = {
  id: 'order-1',
  shopName: 'Test Shop',
  shopRating: 2,
  deliveryRating: 1,
  ratingId: 'rating-abc',
  deliveryPersonName: 'Rahul Kumar',
  deliveryPersonPhotoUrl: 'https://example.com/p.jpg',
};

describe('deriveCustomerReviewPanels', () => {
  it('legacy order (no per-dimension fields) → shop slot uses legacy view, delivery none', () => {
    const p = deriveCustomerReviewPanels({
      ...BASE,
      correctionState: 'responded',
      responseBy: 'shop',
      responseText: 'Sorry about that',
    });
    expect(p.shop.kind).toBe('responded');
    expect(p.delivery.kind).toBe('none');
  });

  it('shop responded, delivery still flagged → independent panels', () => {
    const p = deriveCustomerReviewPanels({
      ...BASE,
      shopCorrectionState: 'responded',
      shopResponseText: 'We refunded you',
      deliveryCorrectionState: 'flagged_low',
    });
    expect(p.shop.kind).toBe('responded');
    if (p.shop.kind === 'responded') {
      expect(p.shop.responder.kind).toBe('shop');
      expect(p.shop.responseText).toBe('We refunded you');
      expect(p.shop.dimension).toBe('shop');
      expect(p.shop.stars).toBe(2);
    }
    expect(p.delivery.kind).toBe('awaiting');
  });

  it('delivery responded carries partner identity + partner response text', () => {
    const p = deriveCustomerReviewPanels({
      ...BASE,
      shopCorrectionState: 'published',
      deliveryCorrectionState: 'responded',
      partnerResponseText: 'On time next time!',
      partnerRespondedAt: 555,
    });
    expect(p.shop.kind).toBe('published');
    expect(p.delivery.kind).toBe('responded');
    if (p.delivery.kind === 'responded') {
      expect(p.delivery.responder.kind).toBe('partner');
      expect(p.delivery.responder.name).toBe('Rahul Kumar');
      expect(p.delivery.responseText).toBe('On time next time!');
      expect(p.delivery.dimension).toBe('delivery');
      expect(p.delivery.stars).toBe(1);
      expect(p.delivery.responseAt).toBe(555);
    }
  });

  it('delivery n_a (no delivery rating) → delivery panel none', () => {
    const p = deriveCustomerReviewPanels({
      ...BASE,
      deliveryRating: undefined,
      shopCorrectionState: 'flagged_low',
      deliveryCorrectionState: 'n_a',
    });
    expect(p.shop.kind).toBe('awaiting');
    expect(p.delivery.kind).toBe('none');
  });

  it('both published → both published panels', () => {
    const p = deriveCustomerReviewPanels({
      ...BASE,
      shopCorrectionState: 'published',
      deliveryCorrectionState: 'published',
    });
    expect(p.shop.kind).toBe('published');
    expect(p.delivery.kind).toBe('published');
  });

  it('shop amended, delivery responded → amended + responded', () => {
    const p = deriveCustomerReviewPanels({
      ...BASE,
      shopCorrectionState: 'amended',
      deliveryCorrectionState: 'responded',
      partnerResponseText: 'Apologies',
    });
    expect(p.shop.kind).toBe('amended');
    expect(p.delivery.kind).toBe('responded');
  });

  it('responded but missing response text → none (safe no-render)', () => {
    const p = deriveCustomerReviewPanels({
      ...BASE,
      shopCorrectionState: 'responded',
      // no shopResponseText
      deliveryCorrectionState: 'n_a',
    });
    expect(p.shop.kind).toBe('none');
    expect(p.delivery.kind).toBe('none');
  });

  it('both flagged → both awaiting', () => {
    const p = deriveCustomerReviewPanels({
      ...BASE,
      shopCorrectionState: 'flagged_low',
      deliveryCorrectionState: 'flagged_low',
    });
    expect(p.shop.kind).toBe('awaiting');
    expect(p.delivery.kind).toBe('awaiting');
  });
});
