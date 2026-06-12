/**
 * PR-NEXT-BUNDLE-J §J — +5 tests pinning deriveBackfillPerDimension, the
 * best-effort legacy→per-dimension reconstruction the backfill replays.
 * Critical case: a legacy 'responded' review where the SHOP responded must
 * leave a low delivery side as 'flagged_low' (Sudhir's bug victim), not
 * auto-publish it.
 */
import { deriveBackfillPerDimension } from '../../functions/src/reviewDenormHelpers';

describe('deriveBackfillPerDimension', () => {
  it('published legacy → both published (delivery n_a when unrated)', () => {
    expect(
      deriveBackfillPerDimension({
        correctionState: 'published',
        shopStars: 5,
        deliveryStars: null,
      }),
    ).toEqual({ shopCorrectionState: 'published', deliveryCorrectionState: 'n_a' });
  });

  it('flagged_low legacy → low sides flagged, non-low published', () => {
    expect(
      deriveBackfillPerDimension({
        correctionState: 'flagged_low',
        shopStars: 1,
        deliveryStars: 5,
      }),
    ).toEqual({
      shopCorrectionState: 'flagged_low',
      deliveryCorrectionState: 'published',
    });
  });

  it('responded by shop with low delivery → shop responded, delivery STAYS flagged (bug victim)', () => {
    expect(
      deriveBackfillPerDimension({
        correctionState: 'responded',
        shopStars: 1,
        deliveryStars: 1,
        responseBy: 'shop',
        responseText: 'Sorry!',
        responseAt: 1234,
      }),
    ).toEqual({
      shopCorrectionState: 'responded',
      deliveryCorrectionState: 'flagged_low',
      shopResponseText: 'Sorry!',
      shopRespondedAt: 1234,
    });
  });

  it('responded by partner → delivery responded, low shop stays flagged + partner response fields', () => {
    expect(
      deriveBackfillPerDimension({
        correctionState: 'responded',
        shopStars: 2,
        deliveryStars: 1,
        responseBy: 'partner',
        responseText: 'On my way next time',
        responseAt: 999,
      }),
    ).toEqual({
      shopCorrectionState: 'flagged_low',
      deliveryCorrectionState: 'responded',
      partnerResponseText: 'On my way next time',
      partnerRespondedAt: 999,
    });
  });

  it('responded with unknown responder defaults to shop', () => {
    expect(
      deriveBackfillPerDimension({
        correctionState: 'responded',
        shopStars: 1,
        deliveryStars: 1,
      }),
    ).toEqual({
      shopCorrectionState: 'responded',
      deliveryCorrectionState: 'flagged_low',
    });
  });
});
