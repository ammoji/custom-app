/**
 * Pure-helper tests for `pickActiveOrders` (PR 15 — Home active
 * orders rail).
 *
 * Pinned because the picker decides what shows on the home screen's
 * highest-priority surface (above the Order Again rail). A regression
 * here either hides a customer's in-flight order from them or
 * surfaces a stale terminal one — both are confidence-destroying.
 */
import { pickActiveOrders } from '../../src/utils/pickActiveOrders';
import type { Order } from '../../src/types';

function makeOrder(over: Partial<Order>): Order {
  return {
    id: over.id ?? 'o1',
    shopId: 'shop_a',
    shopName: 'Shop A',
    customerUid: 'u1',
    items: [],
    subtotal: 0,
    deliveryFee: 0,
    total: 0,
    deliveryAddress: {} as any,
    paymentMethod: 'cod',
    status: over.status ?? 'pending',
    createdAt: over.createdAt ?? 1000,
    estimatedDeliveryAt: 0,
    ...over,
  } as Order;
}

describe('pickActiveOrders', () => {
  test('returns empty when no orders', () => {
    expect(pickActiveOrders([])).toEqual([]);
  });

  test('includes all four non-terminal statuses', () => {
    const orders = [
      makeOrder({ id: 'o1', status: 'pending' }),
      makeOrder({ id: 'o2', status: 'accepted' }),
      makeOrder({ id: 'o3', status: 'preparing' }),
      makeOrder({ id: 'o4', status: 'ready_for_pickup' }),
    ];
    expect(pickActiveOrders(orders)).toHaveLength(4);
  });

  test('excludes delivered and cancelled', () => {
    const orders = [
      makeOrder({ id: 'o1', status: 'delivered' }),
      makeOrder({ id: 'o2', status: 'cancelled' }),
    ];
    expect(pickActiveOrders(orders)).toEqual([]);
  });

  test('sorts by createdAt desc (newest first)', () => {
    const orders = [
      makeOrder({ id: 'old', status: 'pending', createdAt: 100 }),
      makeOrder({ id: 'new', status: 'pending', createdAt: 500 }),
      makeOrder({ id: 'mid', status: 'preparing', createdAt: 300 }),
    ];
    const result = pickActiveOrders(orders);
    expect(result.map(o => o.id)).toEqual(['new', 'mid', 'old']);
  });

  test('mixes active + terminal in input, returns active only', () => {
    const orders = [
      makeOrder({ id: 'a1', status: 'pending', createdAt: 100 }),
      makeOrder({ id: 't1', status: 'delivered', createdAt: 200 }),
      makeOrder({ id: 'a2', status: 'preparing', createdAt: 150 }),
      makeOrder({ id: 't2', status: 'cancelled', createdAt: 250 }),
    ];
    const result = pickActiveOrders(orders);
    expect(result.map(o => o.id)).toEqual(['a2', 'a1']);
  });

  test('does not mutate the input array', () => {
    // Defensive: the helper sorts a copy. If a future refactor
    // accidentally sorts in-place, callers downstream of the picker
    // see their data shuffled — caught by this test.
    const orders = [
      makeOrder({ id: 'o1', status: 'pending', createdAt: 100 }),
      makeOrder({ id: 'o2', status: 'pending', createdAt: 200 }),
    ];
    const snapshot = orders.map(o => o.id);
    pickActiveOrders(orders);
    expect(orders.map(o => o.id)).toEqual(snapshot);
  });

  test('handles unknown statuses gracefully (treats as terminal)', () => {
    // If a future server-side change introduces a status the client
    // doesn't recognise, it shouldn't appear in the active rail.
    // The ACTIVE_STATUSES allowlist is deliberately strict — fail
    // closed, never open.
    const orders = [
      makeOrder({ id: 'o1', status: 'unknown_status' as any }),
    ];
    expect(pickActiveOrders(orders)).toEqual([]);
  });
});
