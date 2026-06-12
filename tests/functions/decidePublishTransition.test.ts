/**
 * PR-NEXT-BUNDLE-J §F — +8 tests pinning the publish-transition decision
 * used by _publishReview. The unpublished dimension MUST keep its prior
 * state (Sudhir 2026-06-10: amending/acking/timing-out one side never
 * closes the other).
 */
import { decidePublishTransition } from '../../functions/src/reviewWorkflowHelpers';

describe('decidePublishTransition', () => {
  it('publishes shop only — delivery keeps its responded state', () => {
    expect(
      decidePublishTransition({
        priorShopState: 'responded',
        priorDeliveryState: 'responded',
        applyShop: true,
        applyDelivery: false,
      }),
    ).toEqual({
      finalShopState: 'published',
      finalDeliveryState: 'responded',
      legacyState: 'responded', // worst-of
    });
  });

  it('publishes delivery only — shop keeps its flagged_low state', () => {
    expect(
      decidePublishTransition({
        priorShopState: 'flagged_low',
        priorDeliveryState: 'responded',
        applyShop: false,
        applyDelivery: true,
      }),
    ).toEqual({
      finalShopState: 'flagged_low',
      finalDeliveryState: 'published',
      legacyState: 'flagged_low',
    });
  });

  it('publishes both — legacy is published', () => {
    expect(
      decidePublishTransition({
        priorShopState: 'responded',
        priorDeliveryState: 'responded',
        applyShop: true,
        applyDelivery: true,
      }),
    ).toEqual({
      finalShopState: 'published',
      finalDeliveryState: 'published',
      legacyState: 'published',
    });
  });

  it('publishes nothing — both keep prior, legacy worst-of', () => {
    expect(
      decidePublishTransition({
        priorShopState: 'responded',
        priorDeliveryState: 'flagged_low',
        applyShop: false,
        applyDelivery: false,
      }),
    ).toEqual({
      finalShopState: 'responded',
      finalDeliveryState: 'flagged_low',
      legacyState: 'flagged_low',
    });
  });

  it('n_a delivery stays n_a even if applyDelivery requested (caller AND-guards, but defensive)', () => {
    expect(
      decidePublishTransition({
        priorShopState: 'responded',
        priorDeliveryState: 'n_a',
        applyShop: true,
        applyDelivery: false,
      }),
    ).toEqual({
      finalShopState: 'published',
      finalDeliveryState: 'n_a',
      legacyState: 'published', // n_a ignored in worst-of
    });
  });

  it('shop publish when delivery already published → both published', () => {
    expect(
      decidePublishTransition({
        priorShopState: 'responded',
        priorDeliveryState: 'published',
        applyShop: true,
        applyDelivery: false,
      }),
    ).toEqual({
      finalShopState: 'published',
      finalDeliveryState: 'published',
      legacyState: 'published',
    });
  });

  it('amend shop from responded → published, delivery flagged stays flagged', () => {
    const r = decidePublishTransition({
      priorShopState: 'responded',
      priorDeliveryState: 'flagged_low',
      applyShop: true,
      applyDelivery: false,
    });
    expect(r.finalShopState).toBe('published');
    expect(r.finalDeliveryState).toBe('flagged_low');
    expect(r.legacyState).toBe('flagged_low');
  });

  it('timeout publishes a still-flagged delivery side without touching responded shop', () => {
    const r = decidePublishTransition({
      priorShopState: 'responded',
      priorDeliveryState: 'flagged_low',
      applyShop: false,
      applyDelivery: true,
    });
    expect(r.finalShopState).toBe('responded');
    expect(r.finalDeliveryState).toBe('published');
    expect(r.legacyState).toBe('responded');
  });
});
