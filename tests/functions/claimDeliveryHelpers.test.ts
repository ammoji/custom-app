/**
 * PR-NEXT-13a — pure-helper tests for `pickPartnerDisplayName` from
 * `functions/src/claimDeliveryHelpers.ts`. The callable wrapper
 * (`claimDelivery`) is integration-territory (transaction +
 * post-transaction reads); this helper is the only bit of logic
 * that's worth pinning in isolation.
 */
import {
  denormalizePartnerTrust,
  pickPartnerDisplayName,
} from '../../functions/src/claimDeliveryHelpers';

describe('pickPartnerDisplayName', () => {
  test('valid name → trimmed string', () => {
    expect(pickPartnerDisplayName('Sudhir Davim')).toBe('Sudhir Davim');
  });

  test('name with surrounding whitespace → trimmed', () => {
    expect(pickPartnerDisplayName('  Aman  ')).toBe('Aman');
  });

  test('empty string → null', () => {
    expect(pickPartnerDisplayName('')).toBeNull();
  });

  test('whitespace-only string → null', () => {
    expect(pickPartnerDisplayName('   ')).toBeNull();
  });

  test('undefined → null', () => {
    expect(pickPartnerDisplayName(undefined)).toBeNull();
  });

  test('null → null', () => {
    expect(pickPartnerDisplayName(null)).toBeNull();
  });

  test('non-string (number) → null (defensive against historical writes)', () => {
    expect(pickPartnerDisplayName(42)).toBeNull();
  });

  test('non-string (object) → null', () => {
    expect(pickPartnerDisplayName({ first: 'X' })).toBeNull();
  });
});

describe('denormalizePartnerTrust', () => {
  test('full partner doc → all three fields populated', () => {
    expect(
      denormalizePartnerTrust({
        deliveryRatingAvg: 4.7,
        deliveryRatingCount: 142,
        vehicleType: 'motorbike',
        // Unrelated fields are ignored — defensive against unrelated
        // partner-doc shape evolution.
        fcmTokens: ['abc'],
        currentLocation: { lat: 12.97, lng: 77.59 },
      }),
    ).toEqual({
      rating: 4.7,
      deliveriesCount: 142,
      vehicleType: 'motorbike',
    });
  });

  test('missing fields → all nulls (legacy partner doc)', () => {
    // Pre-PR-42 / pre-onboarding-form partners may have NONE of
    // the three fields. Helper must return a stable shape so the
    // claimDelivery update writes consistent values.
    expect(denormalizePartnerTrust({})).toEqual({
      rating: null,
      deliveriesCount: null,
      vehicleType: null,
    });
  });

  test('out-of-whitelist vehicleType → null (defensive)', () => {
    // Onboarding form's whitelist is `motorbike|bicycle|on_foot|car`.
    // Anything else (typo, future value not yet in the icon map) is
    // dropped so the sheet's `formatPartnerTrust` falls back cleanly
    // to the default motorbike glyph rather than rendering blank.
    expect(
      denormalizePartnerTrust({
        deliveryRatingAvg: 4.5,
        deliveryRatingCount: 10,
        vehicleType: 'truck',
      }),
    ).toEqual({
      rating: 4.5,
      deliveriesCount: 10,
      vehicleType: null,
    });
  });

  test('non-finite / negative count → null (defensive)', () => {
    // NaN / Infinity / negative values shouldn't reach Firestore
    // but a corrupt historical write must not poison the
    // denormalization. `Math.floor` strips any fractional drift
    // from rolling-average math too.
    expect(
      denormalizePartnerTrust({
        deliveryRatingAvg: NaN,
        deliveryRatingCount: -1,
        vehicleType: 'bicycle',
      }),
    ).toEqual({
      rating: null,
      deliveriesCount: null,
      vehicleType: 'bicycle',
    });
    expect(
      denormalizePartnerTrust({
        deliveryRatingAvg: Infinity,
        deliveryRatingCount: 7.6,
        vehicleType: 'on_foot',
      }),
    ).toEqual({
      rating: null,
      deliveriesCount: 7,
      vehicleType: 'on_foot',
    });
  });

  test('null / undefined input → all nulls (no crash)', () => {
    // Defensive — `partnerSnap.data()` can be `undefined` when the
    // partner doc somehow doesn't exist (claimed via emulator with
    // stub auth, etc.). Helper must tolerate.
    expect(denormalizePartnerTrust(undefined)).toEqual({
      rating: null,
      deliveriesCount: null,
      vehicleType: null,
    });
    expect(denormalizePartnerTrust(null)).toEqual({
      rating: null,
      deliveriesCount: null,
      vehicleType: null,
    });
  });
});
