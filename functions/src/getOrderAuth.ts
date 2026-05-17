/**
 * Pure auth check for getOrder, mirroring the `match /orders/{orderId}`
 * read rule in firestore.rules. Extracted so the
 * "rules and Cloud Function disagree" bug class — which Sudhir hit
 * as a shop owner trying to view his own shop's order on native —
 * has a single source of truth that's pinned by tests.
 *
 * Why a separate Cloud-Function-level check at all (when rules
 * already allow these reads via the web SDK)?
 *   - On native, watchOrder polls the getOrder callable instead of
 *     using onSnapshot (RNFB Firestore is incompatible with the
 *     current Expo SDK setup; see services/firebase.ts notes).
 *   - The function does its own auth check on top of the implicit
 *     "called by signed-in user" guarantee, because callable
 *     invocations bypass Firestore's `match` rules.
 *
 * The two MUST agree. This module is the function-side mirror.
 *
 * Pinned by tests/functions/getOrderAuth.test.ts.
 */

export type OrderForAuth = {
  customerUid?: unknown;
  shopId?: unknown;
  status?: unknown;
  deliveryPersonId?: unknown;
};

export type GetOrderAuthClaims = {
  admin?: unknown;
  shopOwner?: unknown;
  shopId?: unknown;
  delivery?: unknown;
  [key: string]: unknown;
};

export type GetOrderAuthInput = {
  uid: string;
  claims: GetOrderAuthClaims;
  order: OrderForAuth;
};

/**
 * Returns true iff the caller is allowed to read this order under
 * the same rules clause that gates web-SDK reads. Categories
 * (matching firestore.rules):
 *
 *   1. The customer who placed the order
 *   2. Any admin
 *   3. The shop owner whose shopId claim matches order.shopId
 *   4. The delivery person already assigned to this order
 *   5. Any delivery person, IF the order is unassigned and
 *      currently out_for_delivery (the "available pickups" board)
 */
export function canReadOrder(input: GetOrderAuthInput): boolean {
  const { uid, claims, order } = input;
  const isOwner =
    typeof order.customerUid === 'string' && order.customerUid === uid;
  if (isOwner) return true;

  if (claims.admin === true) return true;

  const shopOwnerMatch =
    claims.shopOwner === true &&
    typeof claims.shopId === 'string' &&
    typeof order.shopId === 'string' &&
    claims.shopId === order.shopId;
  if (shopOwnerMatch) return true;

  const isDeliveryPerson = claims.delivery === true;
  if (isDeliveryPerson) {
    if (
      typeof order.deliveryPersonId === 'string' &&
      order.deliveryPersonId === uid
    ) {
      return true;
    }
    if (
      order.status === 'out_for_delivery' &&
      (order.deliveryPersonId == null || order.deliveryPersonId === '')
    ) {
      return true;
    }
  }

  return false;
}
