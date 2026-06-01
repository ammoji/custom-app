/**
 * Pure-helper tests for `computeNearbyOnlinePartnerCount` in
 * `functions/src/nearbyPartnersCountHelpers.ts` (PR-NEXT-7,
 * finding #9).
 *
 * Same posture as `computeOnlineDeliveryCount` — extract the auth
 * check + count assembly into a pure helper so the wrapping
 * callable in index.ts is a thin Firestore + HttpsError shell, and
 * tests inject fake fetchers so the suite runs in plain Node
 * without an emulator.
 *
 * The contract under test that matters most: the count surfaced to
 * the shop-owner UI MUST agree with what the push fanout would do.
 * `filterPartnersByNotificationRadius` is reused verbatim by both;
 * these tests pin every fail-open branch + the auth boundary so a
 * future "optimisation" can't silently widen or narrow the count
 * away from the fanout.
 */
import {
  computeNearbyOnlinePartnerCount,
  NEARBY_PARTNER_HARD_CAP,
} from '../../functions/src/nearbyPartnersCountHelpers';
import type { PartnerRow } from '../../functions/src/notificationRadiusHelpers';

const SHOP_LOC = { lat: 28.330, lng: 77.318 }; // Ballabgarh-ish
const NEAR_PARTNER: PartnerRow = {
  uid: 'p_near',
  currentLocation: { lat: 28.331, lng: 77.319 }, // ~150m away
  notificationRadiusKm: 3,
};
const FAR_PARTNER: PartnerRow = {
  uid: 'p_far',
  currentLocation: { lat: 28.450, lng: 77.500 }, // >25km away
  notificationRadiusKm: 3,
};
const NO_LOC_PARTNER: PartnerRow = {
  uid: 'p_noloc',
  // No currentLocation — fail-open per PR 50 contract.
};

describe('computeNearbyOnlinePartnerCount — auth boundary', () => {
  test('unauthenticated → unauthenticated error', async () => {
    const result = await computeNearbyOnlinePartnerCount({
      auth: null,
      fetchShop: async () => ({ location: SHOP_LOC }),
      fetchOnlinePartners: async () => [],
    });
    expect(result).toEqual({
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    });
  });

  test('caller without shopOwner claim → permission-denied (admins do NOT get this surface)', async () => {
    // Admins are intentionally excluded — they have the admin
    // `getOnlineDeliveryCount` (total online count) on
    // AdminOrdersScreen. Mixing surfaces would confuse the auth
    // boundary.
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { admin: true } },
      fetchShop: async () => ({ location: SHOP_LOC }),
      fetchOnlinePartners: async () => [NEAR_PARTNER],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('permission-denied');
  });

  test('shopOwner without shopId claim → permission-denied', async () => {
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { shopOwner: true } },
      fetchShop: async () => ({ location: SHOP_LOC }),
      fetchOnlinePartners: async () => [NEAR_PARTNER],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('permission-denied');
  });

  test('shopOwner with empty-string shopId → permission-denied', async () => {
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { shopOwner: true, shopId: '' } },
      fetchShop: async () => ({ location: SHOP_LOC }),
      fetchOnlinePartners: async () => [NEAR_PARTNER],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('permission-denied');
  });

  test('caller may be both shopOwner AND admin — shopOwner path wins, scoped to claims.shopId', async () => {
    // Pilot account holds both claims. The shopOwner branch must
    // fire and the call must be scoped to the shopId claim — not
    // a cross-shop admin view.
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { shopOwner: true, admin: true, shopId: 'shop_1' } },
      fetchShop: async () => ({ location: SHOP_LOC }),
      fetchOnlinePartners: async () => [NEAR_PARTNER],
    });
    expect(result).toEqual({ ok: true, count: 1, filtered: true });
  });
});

describe('computeNearbyOnlinePartnerCount — shop existence', () => {
  test('shop doc missing → not-found', async () => {
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { shopOwner: true, shopId: 'shop_1' } },
      fetchShop: async () => null,
      fetchOnlinePartners: async () => [NEAR_PARTNER],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not-found');
  });
});

describe('computeNearbyOnlinePartnerCount — happy paths', () => {
  test('mixed near/far partners → count = near only', async () => {
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { shopOwner: true, shopId: 'shop_1' } },
      fetchShop: async () => ({ location: SHOP_LOC }),
      fetchOnlinePartners: async () => [NEAR_PARTNER, FAR_PARTNER],
    });
    expect(result).toEqual({ ok: true, count: 1, filtered: true });
  });

  test('no online partners → count 0, filtered true (shop has location)', async () => {
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { shopOwner: true, shopId: 'shop_1' } },
      fetchShop: async () => ({ location: SHOP_LOC }),
      fetchOnlinePartners: async () => [],
    });
    expect(result).toEqual({ ok: true, count: 0, filtered: true });
  });

  test('partner without currentLocation is fail-open kept (matches push fanout)', async () => {
    // A partner who hasn't reported a location yet is included so
    // the count never silently drops them — same contract the push
    // fanout enforces. Otherwise a partner would think they're
    // online but the count would say "0 nearby".
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { shopOwner: true, shopId: 'shop_1' } },
      fetchShop: async () => ({ location: SHOP_LOC }),
      fetchOnlinePartners: async () => [NO_LOC_PARTNER],
    });
    expect(result).toEqual({ ok: true, count: 1, filtered: true });
  });

  test('partner with custom larger radius covering shop → kept', async () => {
    const farButWideRadius: PartnerRow = {
      uid: 'p_wide',
      currentLocation: { lat: 28.380, lng: 77.318 }, // ~5.5km
      notificationRadiusKm: 10, // partner opted into a wider net
    };
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { shopOwner: true, shopId: 'shop_1' } },
      fetchShop: async () => ({ location: SHOP_LOC }),
      fetchOnlinePartners: async () => [farButWideRadius],
    });
    expect(result).toEqual({ ok: true, count: 1, filtered: true });
  });
});

describe('computeNearbyOnlinePartnerCount — fail-open posture', () => {
  test('shop has no location (legacy) → unfiltered total online count, filtered=false', async () => {
    // Matches push fanout's fail-open posture for legacy shops
    // without a location. Count reflects "everyone who would be
    // pushed to" + the UI surfaces the `filtered: false` hint.
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { shopOwner: true, shopId: 'shop_1' } },
      fetchShop: async () => ({ location: null }),
      fetchOnlinePartners: async () => [
        NEAR_PARTNER,
        FAR_PARTNER,
        NO_LOC_PARTNER,
      ],
    });
    expect(result).toEqual({ ok: true, count: 3, filtered: false });
  });

  test('shop location with non-finite lat → fail-open, filtered=false', async () => {
    // Defensive: corrupt shop location data shouldn't reduce the
    // count. Mirrors the predicate inside
    // filterPartnersByNotificationRadius itself.
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { shopOwner: true, shopId: 'shop_1' } },
      fetchShop: async () => ({ location: { lat: NaN, lng: 77.318 } }),
      fetchOnlinePartners: async () => [NEAR_PARTNER, FAR_PARTNER],
    });
    expect(result).toEqual({ ok: true, count: 2, filtered: false });
  });

  test('shop has explicit undefined location → fail-open, filtered=false', async () => {
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { shopOwner: true, shopId: 'shop_1' } },
      fetchShop: async () => ({}),
      fetchOnlinePartners: async () => [NEAR_PARTNER],
    });
    expect(result).toEqual({ ok: true, count: 1, filtered: false });
  });
});

describe('computeNearbyOnlinePartnerCount — bounds', () => {
  test('hard cap clamps absurd counts to NEARBY_PARTNER_HARD_CAP', async () => {
    const many: PartnerRow[] = Array.from(
      { length: NEARBY_PARTNER_HARD_CAP + 50 },
      (_, i) => ({
        uid: `p${i}`,
        currentLocation: SHOP_LOC,
        notificationRadiusKm: 3,
      }),
    );
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { shopOwner: true, shopId: 'shop_1' } },
      fetchShop: async () => ({ location: SHOP_LOC }),
      fetchOnlinePartners: async () => many,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.count).toBe(NEARBY_PARTNER_HARD_CAP);
  });
});
