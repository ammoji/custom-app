/**
 * Pure unit tests for canReadOrder in functions/src/getOrderAuth.ts.
 *
 * The function mirrors the `match /orders/{orderId}.allow read`
 * clause in firestore.rules. Both gates exist by necessity:
 * callable invocations bypass Firestore rules. They MUST agree —
 * Sudhir hit a real "rules say yes, function says no" rejection
 * as a shop owner trying to view his own shop's order on native
 * (where watchOrder polls getOrder instead of using onSnapshot).
 *
 * Pin every category from the rules clause:
 *   1. Customer of the order
 *   2. Admin
 *   3. Shop owner whose claim shopId matches order.shopId
 *   4. Delivery person already assigned to this order
 *   5. Any delivery person, IF the order is unassigned and
 *      currently ready_for_pickup (the available-pickups board)
 */
import { canReadOrder } from '../../functions/src/getOrderAuth';

const baseOrder = {
  customerUid: 'cust_001',
  shopId: 'shop_001',
  status: 'pending' as const,
  deliveryPersonId: null,
};

describe('canReadOrder — accepts', () => {
  test('the customer of the order', () => {
    expect(
      canReadOrder({
        uid: 'cust_001',
        claims: {},
        order: baseOrder,
      }),
    ).toBe(true);
  });

  test('an admin (regardless of order owner)', () => {
    expect(
      canReadOrder({
        uid: 'admin_001',
        claims: { admin: true },
        order: baseOrder,
      }),
    ).toBe(true);
  });

  test('the shop owner whose claim shopId matches order.shopId — THE regression', () => {
    // The bug Sudhir hit: getOrder rejected this case even though
    // the rules accept it, leaving the dashboard's order tap broken
    // on native. Pin it explicitly.
    expect(
      canReadOrder({
        uid: 'shopOwner_001',
        claims: { shopOwner: true, shopId: 'shop_001' },
        order: baseOrder,
      }),
    ).toBe(true);
  });

  test('the delivery person assigned to this order', () => {
    expect(
      canReadOrder({
        uid: 'delivery_001',
        claims: { delivery: true },
        order: {
          ...baseOrder,
          status: 'preparing',
          deliveryPersonId: 'delivery_001',
        },
      }),
    ).toBe(true);
  });

  test('any delivery person when the order is unassigned + ready_for_pickup (available pickups)', () => {
    expect(
      canReadOrder({
        uid: 'delivery_002',
        claims: { delivery: true },
        order: {
          ...baseOrder,
          status: 'ready_for_pickup',
          deliveryPersonId: null,
        },
      }),
    ).toBe(true);
  });
});

describe('canReadOrder — rejects', () => {
  test('a different customer (shop_001 customer asking for shop_002 order)', () => {
    expect(
      canReadOrder({
        uid: 'cust_002',
        claims: {},
        order: baseOrder,
      }),
    ).toBe(false);
  });

  test('a shop owner whose claim shopId differs from order.shopId — cross-shop guard', () => {
    // The user-facing point of this whole module: shop A's owner
    // CANNOT read shop B's orders. Pin it.
    expect(
      canReadOrder({
        uid: 'shopOwner_002',
        claims: { shopOwner: true, shopId: 'shop_002' },
        order: baseOrder, // shop_001 order
      }),
    ).toBe(false);
  });

  test('a shop owner with no shopId claim (stale-claim edge case)', () => {
    expect(
      canReadOrder({
        uid: 'shopOwner_003',
        claims: { shopOwner: true },
        order: baseOrder,
      }),
    ).toBe(false);
  });

  test('a delivery person looking at a non-assigned, pending order (outside the pool)', () => {
    // PR 12 broadened the pool to {accepted, preparing,
    // ready_for_pickup}. `pending` and `cancelled` / `delivered`
    // are still off-limits to non-assigned delivery people.
    expect(
      canReadOrder({
        uid: 'delivery_003',
        claims: { delivery: true },
        order: { ...baseOrder, status: 'pending', deliveryPersonId: null },
      }),
    ).toBe(false);
  });

  test('a delivery person looking at a non-assigned, delivered order', () => {
    expect(
      canReadOrder({
        uid: 'delivery_003',
        claims: { delivery: true },
        order: { ...baseOrder, status: 'delivered', deliveryPersonId: null },
      }),
    ).toBe(false);
  });

  test('a delivery person looking at an ready_for_pickup order already assigned to someone else', () => {
    expect(
      canReadOrder({
        uid: 'delivery_004',
        claims: { delivery: true },
        order: {
          ...baseOrder,
          status: 'ready_for_pickup',
          deliveryPersonId: 'delivery_001',
        },
      }),
    ).toBe(false);
  });

  test('an unauthenticated-style empty claims object on a stranger order', () => {
    expect(
      canReadOrder({
        uid: 'random_user',
        claims: {},
        order: baseOrder,
      }),
    ).toBe(false);
  });
});
