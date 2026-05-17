/**
 * PR 5 — Shop owner self-service settings.
 *
 * Pure helper for the `updateShopSettings` callable. Returns a tagged
 * union so the callable wrapper does nothing but `throw HttpsError`
 * + `db.update` — all validation is here and unit-testable without
 * firebase-admin (same posture as deliveryRequestHelpers,
 * profileHelpers).
 *
 * Two whitelisted fields, both with sanity caps to keep a fat-fingered
 * shop owner from setting a ₹50,000 delivery fee or a ₹1cr minimum
 * order. The caps are intentionally generous — real shops won't hit
 * them — but tight enough that obviously-wrong values get caught
 * server-side before customers see them in the checkout summary.
 *
 * Sanity caps (deliberately permissive):
 *   - deliveryFee: 0..500 (real shops: 0..80). Includes 0 for free
 *     delivery promotions.
 *   - minOrder:    0..10000 (real shops: 0..500). Includes 0 for
 *     "any size order" shops.
 *
 * Integer-only because rupee fractions don't render cleanly in the
 * existing formatRupees helper and the order summary, and partial-
 * rupee fees aren't a thing in this market.
 */

export type ShopSettingsInput = {
  auth: {
    uid: string;
    token?: { shopOwner?: unknown; shopId?: unknown };
  } | null;
  deliveryFee?: unknown;
  minOrder?: unknown;
};

export type ShopSettingsResult =
  | {
      ok: true;
      shopId: string;
      updates: { deliveryFee?: number; minOrder?: number };
    }
  | {
      ok: false;
      code: 'unauthenticated' | 'permission-denied' | 'invalid-argument';
      message: string;
    };

const DELIVERY_FEE_MAX = 500;
const MIN_ORDER_MAX = 10000;

function isFiniteInteger(v: unknown): v is number {
  return (
    typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)
  );
}

export function validateShopSettings(
  input: ShopSettingsInput,
): ShopSettingsResult {
  const { auth, deliveryFee, minOrder } = input;

  // 1. Auth gate.
  if (!auth) {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    };
  }
  // 2. Role gate — strict equality on shopOwner claim (truthy checks
  //    have bitten us; see Design notes in the PR 5 prompt).
  if (auth.token?.shopOwner !== true) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Shop owner role required',
    };
  }
  const shopId = auth.token.shopId;
  if (typeof shopId !== 'string' || shopId.length === 0) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'No shopId on your account',
    };
  }

  // 3. At least one field must be present. We accept partial updates
  //    so a shop can change just `minOrder` without re-submitting
  //    deliveryFee (mirrors ShopMenuItemEdit's dirty-field pattern).
  const hasDelivery = deliveryFee !== undefined;
  const hasMinOrder = minOrder !== undefined;
  if (!hasDelivery && !hasMinOrder) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'At least one of deliveryFee or minOrder is required',
    };
  }

  const updates: { deliveryFee?: number; minOrder?: number } = {};

  if (hasDelivery) {
    if (!isFiniteInteger(deliveryFee)) {
      return {
        ok: false,
        code: 'invalid-argument',
        message: 'deliveryFee must be a finite integer',
      };
    }
    if (deliveryFee < 0 || deliveryFee > DELIVERY_FEE_MAX) {
      return {
        ok: false,
        code: 'invalid-argument',
        message: `deliveryFee must be between 0 and ${DELIVERY_FEE_MAX}`,
      };
    }
    updates.deliveryFee = deliveryFee;
  }

  if (hasMinOrder) {
    if (!isFiniteInteger(minOrder)) {
      return {
        ok: false,
        code: 'invalid-argument',
        message: 'minOrder must be a finite integer',
      };
    }
    if (minOrder < 0 || minOrder > MIN_ORDER_MAX) {
      return {
        ok: false,
        code: 'invalid-argument',
        message: `minOrder must be between 0 and ${MIN_ORDER_MAX}`,
      };
    }
    updates.minOrder = minOrder;
  }

  return { ok: true, shopId, updates };
}
