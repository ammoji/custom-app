/**
 * Pure validation helpers extracted from listShopOrders and
 * placeOrder so they can be unit-tested without booting the
 * firebase-functions runtime (same pattern as profileHelpers).
 *
 * IMPORTANT: keep this file free of firebase-functions imports —
 * the Cloud Function wraps the result in HttpsError, this module
 * just returns plain { ok } discriminated unions.
 *
 * Pinned by tests/functions/listShopOrdersValidation.test.ts and
 * tests/functions/placeOrderMenuValidation.test.ts.
 */

// ────────────────────────────────────────────────────────────
// listShopOrders access validation
// ────────────────────────────────────────────────────────────
//
// The Cloud Function accepts an optional `shopId` body param and
// falls back to the caller's own shopId claim. Admins can read any
// shop; shop-owners only their own. Anything else → reject.
//
// Pulled out as a separate helper because the original inline check
// in the callable failed to communicate the "shopId missing" case
// distinctly from the "permission-denied" case — both ended up
// inside a string concat that the RNFB SDK sometimes serialised as
// `INTERNAL`. The discriminated `code` field below lets the
// callable raise the right HttpsError code every time.

// Index signature so this type is compatible with firebase-admin's
// DecodedIdToken (which carries arbitrary `[key: string]: any`
// claims) without forcing the callable to do an `as any` cast.
export type ShopOrdersClaims = {
  admin?: unknown;
  shopOwner?: unknown;
  shopId?: unknown;
  [key: string]: unknown;
};

export type ShopOrdersAccessInput = {
  claims: ShopOrdersClaims;
  /**
   * The shopId in the request body. Optional — when absent we
   * fall back to the caller's own shopId claim (shop-owner case).
   */
  requestedShopId?: unknown;
};

export type ShopOrdersAccessResult =
  | { ok: true; targetShopId: string }
  | {
      ok: false;
      code: 'invalid-argument' | 'permission-denied';
      message: string;
    };

export function validateShopOrdersAccess(
  input: ShopOrdersAccessInput,
): ShopOrdersAccessResult {
  const claims = input.claims ?? {};
  const isAdmin = claims.admin === true;
  const isShopOwner = claims.shopOwner === true;
  const ownedShopId =
    typeof claims.shopId === 'string' && claims.shopId.length > 0
      ? claims.shopId
      : undefined;
  const requested =
    typeof input.requestedShopId === 'string' && input.requestedShopId.length > 0
      ? input.requestedShopId
      : undefined;

  const targetShopId = requested ?? ownedShopId;
  if (!targetShopId) {
    return {
      ok: false,
      code: 'invalid-argument',
      message:
        'shopId required. Pass it in the request body, or sign in as a shop owner whose claim carries one.',
    };
  }

  if (!isAdmin && !(isShopOwner && targetShopId === ownedShopId)) {
    return {
      ok: false,
      code: 'permission-denied',
      message: "You don't have access to this shop's orders.",
    };
  }

  return { ok: true, targetShopId };
}

// ────────────────────────────────────────────────────────────
// placeOrder cart-line path dispatch
// ────────────────────────────────────────────────────────────
//
// Phase 12a-v2-iii introduced the per-shop menu subcollection and
// `menuItemId` on cart lines. New carts carry it; older carts
// persisted in AsyncStorage from before the rollout do not. The
// callable dispatches on `menuItemId` presence: present → validate
// against shops/{shopId}/menu, absent → legacy products-collection
// path with the well-known "not in this shop" error.
//
// Extracted as a one-liner so the dispatch contract has its own
// test — easy to regress when refactoring the giant placeOrder
// function and not obvious from a code review.

export function pickCartLinePath(ci: {
  menuItemId?: unknown;
}): 'menu' | 'legacy' {
  return typeof ci.menuItemId === 'string' && ci.menuItemId.length > 0
    ? 'menu'
    : 'legacy';
}
