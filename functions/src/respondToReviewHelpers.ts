/**
 * HOTFIX-RATING-RESPONSE — DO NOT REMOVE. Pure auth helper for
 * respondToReview callable. Extracted so the role-gate logic can be
 * unit-tested without Firebase emulator. The Firestore shop ownership
 * lookup stays in the callable; the resolved callerShopId is passed in.
 */

export type RespondAuthResult =
  | { ok: true; responseBy: 'shop' | 'partner' }
  | { ok: false; code: 'not_authorized'; message: string };

export function validateRespondToReviewAuth(opts: {
  callerClaims: Record<string, unknown> | null | undefined;
  callerUid: string;
  review: {
    shopId?: string | null;
    deliveryPersonId?: string | null;
  };
  callerShopId?: string | null;
}): RespondAuthResult {
  const claims = opts.callerClaims ?? {};
  const isShopOwner = (claims as any).shopOwner === true;
  const isDelivery = (claims as any).delivery === true;

  if (!isShopOwner && !isDelivery) {
    return {
      ok: false,
      code: 'not_authorized',
      message: 'Shop owner or delivery partner role required',
    };
  }

  if (isShopOwner) {
    if (!opts.callerShopId || opts.callerShopId !== opts.review.shopId) {
      return {
        ok: false,
        code: 'not_authorized',
        message: 'Not the owner of this shop',
      };
    }
    return { ok: true, responseBy: 'shop' };
  }

  // isDelivery path
  if (opts.review.deliveryPersonId !== opts.callerUid) {
    return {
      ok: false,
      code: 'not_authorized',
      message: 'Not the delivery partner for this order',
    };
  }

  return { ok: true, responseBy: 'partner' };
}
