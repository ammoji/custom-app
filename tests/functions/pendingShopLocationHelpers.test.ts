/**
 * PR-NEXT-SHOP-LOCATION-EDIT — pure-helper tests for the four
 * pending-shop-location gates. Each helper returns a discriminated-
 * union Result; callable maps to HttpsError at the IO boundary.
 */
import {
  validateApprovePendingShopLocation,
  validateCancelPendingShopLocation,
  validateRejectPendingShopLocation,
  validateSubmitPendingShopLocation,
  type ShopForPendingGate,
} from '../../functions/src/pendingShopLocationHelpers';

const activeShop = (over?: Partial<ShopForPendingGate>): ShopForPendingGate => ({
  ownerUid: 'owner-1',
  status: 'active',
  location: { lat: 28.6139, lng: 77.209 },
  ...over,
});

describe('PR-NEXT-SHOP-LOCATION-EDIT — validateSubmitPendingShopLocation', () => {
  test('happy path → ok', () => {
    const r = validateSubmitPendingShopLocation({
      shop: activeShop(),
      callerUid: 'owner-1',
      newLocation: { lat: 28.62, lng: 77.21 },
    });
    expect(r).toEqual({ ok: true });
  });

  test('shop missing → shop_not_found', () => {
    const r = validateSubmitPendingShopLocation({
      shop: null,
      callerUid: 'owner-1',
      newLocation: { lat: 28.62, lng: 77.21 },
    });
    expect(r).toEqual({ ok: false, code: 'shop_not_found' });
  });

  test('caller is not the owner → not_owner', () => {
    const r = validateSubmitPendingShopLocation({
      shop: activeShop(),
      callerUid: 'other-uid',
      newLocation: { lat: 28.62, lng: 77.21 },
    });
    expect(r).toEqual({ ok: false, code: 'not_owner' });
  });

  test('shop is pending (not yet approved) → shop_not_active', () => {
    const r = validateSubmitPendingShopLocation({
      shop: activeShop({ status: 'pending' }),
      callerUid: 'owner-1',
      newLocation: { lat: 28.62, lng: 77.21 },
    });
    expect(r).toEqual({ ok: false, code: 'shop_not_active' });
  });

  test('coords out of earth range (swapped lat/lng) → invalid_coords + detail', () => {
    const r = validateSubmitPendingShopLocation({
      shop: activeShop(),
      callerUid: 'owner-1',
      newLocation: { lat: 91, lng: 28.6 }, // lat > 90
    });
    expect(r).toEqual({
      ok: false,
      code: 'invalid_coords',
      detail: 'lat_out_of_range',
    });
  });

  test('coords NaN → invalid_coords with detail mapping', () => {
    const r = validateSubmitPendingShopLocation({
      shop: activeShop(),
      callerUid: 'owner-1',
      newLocation: { lat: Number.NaN, lng: 77.2 },
    });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ code: 'invalid_coords', detail: 'lat_invalid' });
  });

  test('byte-identical to current pin → identical_to_current', () => {
    const r = validateSubmitPendingShopLocation({
      shop: activeShop(),
      callerUid: 'owner-1',
      newLocation: { lat: 28.6139, lng: 77.209 },
    });
    expect(r).toEqual({ ok: false, code: 'identical_to_current' });
  });
});

describe('PR-NEXT-SHOP-LOCATION-EDIT — validateCancelPendingShopLocation', () => {
  test('happy path → ok', () => {
    const r = validateCancelPendingShopLocation({
      shop: activeShop({ pendingLocationStatus: 'pending' }),
      callerUid: 'owner-1',
    });
    expect(r).toEqual({ ok: true });
  });

  test('not the owner → not_owner (gate before pending check)', () => {
    const r = validateCancelPendingShopLocation({
      shop: activeShop({ pendingLocationStatus: 'pending' }),
      callerUid: 'other-uid',
    });
    expect(r).toEqual({ ok: false, code: 'not_owner' });
  });

  test('no pending change present → no_pending_change', () => {
    const r = validateCancelPendingShopLocation({
      shop: activeShop({ pendingLocationStatus: null }),
      callerUid: 'owner-1',
    });
    expect(r).toEqual({ ok: false, code: 'no_pending_change' });
  });
});

describe('PR-NEXT-SHOP-LOCATION-EDIT — validateApprovePendingShopLocation', () => {
  test('happy path → ok with narrowed newLocation', () => {
    const r = validateApprovePendingShopLocation({
      shop: activeShop({
        pendingLocationStatus: 'pending',
        pendingLocation: { lat: 38.6, lng: -90.5 },
      }),
    });
    expect(r).toEqual({ ok: true, newLocation: { lat: 38.6, lng: -90.5 } });
  });

  test('no pending change → no_pending_change', () => {
    const r = validateApprovePendingShopLocation({
      shop: activeShop({ pendingLocationStatus: null }),
    });
    expect(r).toEqual({ ok: false, code: 'no_pending_change' });
  });

  test('pending pin out of earth range → pending_invalid_coords + detail', () => {
    const r = validateApprovePendingShopLocation({
      shop: activeShop({
        pendingLocationStatus: 'pending',
        pendingLocation: { lat: 99, lng: -90.5 },
      }),
    });
    expect(r).toEqual({
      ok: false,
      code: 'pending_invalid_coords',
      detail: 'lat_out_of_range',
    });
  });

  test('pending pin missing entirely → pending_invalid_coords (no_location)', () => {
    const r = validateApprovePendingShopLocation({
      shop: activeShop({
        pendingLocationStatus: 'pending',
        pendingLocation: null,
      }),
    });
    expect(r).toEqual({
      ok: false,
      code: 'pending_invalid_coords',
      detail: 'no_location',
    });
  });

  test('shop missing → shop_not_found', () => {
    const r = validateApprovePendingShopLocation({ shop: null });
    expect(r).toEqual({ ok: false, code: 'shop_not_found' });
  });
});

describe('PR-NEXT-SHOP-LOCATION-EDIT — validateRejectPendingShopLocation', () => {
  test('happy path → ok', () => {
    const r = validateRejectPendingShopLocation({
      shop: activeShop({ pendingLocationStatus: 'pending' }),
    });
    expect(r).toEqual({ ok: true });
  });

  test('no pending change → no_pending_change', () => {
    const r = validateRejectPendingShopLocation({
      shop: activeShop({ pendingLocationStatus: null }),
    });
    expect(r).toEqual({ ok: false, code: 'no_pending_change' });
  });

  test('shop missing → shop_not_found', () => {
    const r = validateRejectPendingShopLocation({ shop: null });
    expect(r).toEqual({ ok: false, code: 'shop_not_found' });
  });
});
