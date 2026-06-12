/**
 * HOTFIX-RATING-RESPONSE — DO NOT REMOVE. Tests for validateRespondToReviewAuth.
 * Pin: +6 tests for the role-gate helper (§B). Deliberate-break demo: revert
 * claims.shopOwner → claims.isShopOwner in the helper; test #1 must fail.
 */

import { validateRespondToReviewAuth } from '../../functions/src/respondToReviewHelpers';

const SHOP_ID = 'shop-abc';
const DELIVERY_UID = 'uid-delivery-1';
const REVIEW_BASE = { shopId: SHOP_ID, deliveryPersonId: DELIVERY_UID };

describe('validateRespondToReviewAuth', () => {
  it('shop owner of the rated shop → ok, responseBy shop', () => {
    const result = validateRespondToReviewAuth({
      callerClaims: { shopOwner: true },
      callerUid: 'uid-shop-owner',
      review: REVIEW_BASE,
      callerShopId: SHOP_ID,
    });
    expect(result).toEqual({ ok: true, responseBy: 'shop' });
  });

  it('shop owner of a DIFFERENT shop → not_authorized', () => {
    const result = validateRespondToReviewAuth({
      callerClaims: { shopOwner: true },
      callerUid: 'uid-other-owner',
      review: REVIEW_BASE,
      callerShopId: 'shop-xyz',
    });
    expect(result).toEqual({
      ok: false,
      code: 'not_authorized',
      message: 'Not the owner of this shop',
    });
  });

  it('delivery partner who delivered the order → ok, responseBy partner', () => {
    const result = validateRespondToReviewAuth({
      callerClaims: { delivery: true },
      callerUid: DELIVERY_UID,
      review: REVIEW_BASE,
    });
    expect(result).toEqual({ ok: true, responseBy: 'partner' });
  });

  it('delivery partner who did NOT deliver this order → not_authorized', () => {
    const result = validateRespondToReviewAuth({
      callerClaims: { delivery: true },
      callerUid: 'uid-other-partner',
      review: REVIEW_BASE,
    });
    expect(result).toEqual({
      ok: false,
      code: 'not_authorized',
      message: 'Not the delivery partner for this order',
    });
  });

  it('no role claim at all → not_authorized', () => {
    const result = validateRespondToReviewAuth({
      callerClaims: {},
      callerUid: 'uid-customer',
      review: REVIEW_BASE,
    });
    expect(result).toEqual({
      ok: false,
      code: 'not_authorized',
      message: 'Shop owner or delivery partner role required',
    });
  });

  it('multi-role (shopOwner + delivery): shop branch wins when callerShopId matches', () => {
    const result = validateRespondToReviewAuth({
      callerClaims: { shopOwner: true, delivery: true },
      callerUid: 'uid-multi-role',
      review: REVIEW_BASE,
      callerShopId: SHOP_ID,
    });
    expect(result).toEqual({ ok: true, responseBy: 'shop' });
  });

  it('null claims → not_authorized (no crash)', () => {
    const result = validateRespondToReviewAuth({
      callerClaims: null,
      callerUid: 'uid-anon',
      review: REVIEW_BASE,
    });
    expect(result).toEqual({
      ok: false,
      code: 'not_authorized',
      message: 'Shop owner or delivery partner role required',
    });
  });
});
