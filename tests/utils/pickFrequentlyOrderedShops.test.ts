/**
 * Pure-helper tests for `pickFrequentlyOrderedShops` (PR 14 — Home
 * "Order again" rail).
 *
 * Pinned because the picker drives the rail's order, which directly
 * impacts what the customer sees first when they open the app.
 * Regressions here would silently demote a customer's actual
 * favourite shop below a less-used one.
 */
import { pickFrequentlyOrderedShops } from '../../src/utils/pickFrequentlyOrderedShops';
import type { Order } from '../../src/types';

function makeOrder(over: Partial<Order>): Order {
  return {
    id: over.id ?? 'o1',
    shopId: over.shopId ?? 'shop_a',
    shopName: over.shopName ?? 'Shop A',
    customerUid: 'u1',
    status: over.status ?? 'delivered',
    createdAt: over.createdAt ?? 1000,
    deliveredAt: over.deliveredAt ?? null,
    items: [],
    subtotal: 0,
    deliveryFee: 0,
    total: 0,
    deliveryAddress: {} as any,
    paymentMethod: 'cod',
    estimatedDeliveryAt: 0,
    ...over,
  } as Order;
}

describe('pickFrequentlyOrderedShops', () => {
  test('returns empty array when no delivered orders', () => {
    expect(pickFrequentlyOrderedShops([])).toEqual([]);
  });

  test('excludes in-flight orders (pending / accepted / preparing / ready_for_pickup)', () => {
    const orders = [
      makeOrder({ id: 'o1', status: 'pending', shopId: 'shop_a' }),
      makeOrder({ id: 'o2', status: 'accepted', shopId: 'shop_b' }),
      makeOrder({ id: 'o3', status: 'preparing', shopId: 'shop_c' }),
      makeOrder({ id: 'o4', status: 'ready_for_pickup', shopId: 'shop_d' }),
    ];
    expect(pickFrequentlyOrderedShops(orders)).toEqual([]);
  });

  test('excludes cancelled orders', () => {
    const orders = [
      makeOrder({ id: 'o1', status: 'cancelled', shopId: 'shop_a' }),
    ];
    expect(pickFrequentlyOrderedShops(orders)).toEqual([]);
  });

  test('returns one entry per unique shop', () => {
    const orders = [
      makeOrder({ id: 'o1', shopId: 'shop_a' }),
      makeOrder({ id: 'o2', shopId: 'shop_a' }),
      makeOrder({ id: 'o3', shopId: 'shop_b' }),
    ];
    const result = pickFrequentlyOrderedShops(orders);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.shopId).sort()).toEqual(['shop_a', 'shop_b']);
  });

  test('orders by orderCount desc', () => {
    const orders = [
      makeOrder({ id: 'o1', shopId: 'shop_a' }),
      makeOrder({ id: 'o2', shopId: 'shop_b' }),
      makeOrder({ id: 'o3', shopId: 'shop_b' }),
      makeOrder({ id: 'o4', shopId: 'shop_b' }),
      makeOrder({ id: 'o5', shopId: 'shop_c' }),
      makeOrder({ id: 'o6', shopId: 'shop_c' }),
    ];
    const result = pickFrequentlyOrderedShops(orders);
    expect(result[0].shopId).toBe('shop_b'); // 3 orders
    expect(result[1].shopId).toBe('shop_c'); // 2 orders
    expect(result[2].shopId).toBe('shop_a'); // 1 order
  });

  test('breaks orderCount ties by most-recent delivery', () => {
    const orders = [
      makeOrder({
        id: 'o1',
        shopId: 'shop_old',
        createdAt: 100,
        deliveredAt: 200,
      }),
      makeOrder({
        id: 'o2',
        shopId: 'shop_new',
        createdAt: 100,
        deliveredAt: 500,
      }),
    ];
    const result = pickFrequentlyOrderedShops(orders);
    expect(result[0].shopId).toBe('shop_new');
    expect(result[1].shopId).toBe('shop_old');
  });

  test('falls back to createdAt when deliveredAt is missing (legacy orders)', () => {
    // Legacy orders predate the deliveredAt field; toOrder coerces
    // it to null. Picker must still order them by createdAt.
    const orders = [
      makeOrder({
        id: 'o1',
        shopId: 'shop_a',
        createdAt: 200,
        deliveredAt: null,
      }),
      makeOrder({
        id: 'o2',
        shopId: 'shop_b',
        createdAt: 500,
        deliveredAt: null,
      }),
    ];
    const result = pickFrequentlyOrderedShops(orders);
    expect(result[0].shopId).toBe('shop_b');
  });

  test('lastOrderId points at the most-recent order from that shop', () => {
    const orders = [
      makeOrder({ id: 'o_old', shopId: 'shop_a', deliveredAt: 100 }),
      makeOrder({ id: 'o_new', shopId: 'shop_a', deliveredAt: 500 }),
    ];
    const result = pickFrequentlyOrderedShops(orders);
    expect(result[0].lastOrderId).toBe('o_new');
    expect(result[0].orderCount).toBe(2);
    expect(result[0].mostRecentDeliveredAt).toBe(500);
  });

  test('respects the limit parameter', () => {
    const orders = [
      makeOrder({ id: 'o1', shopId: 'shop_a' }),
      makeOrder({ id: 'o2', shopId: 'shop_b' }),
      makeOrder({ id: 'o3', shopId: 'shop_c' }),
      makeOrder({ id: 'o4', shopId: 'shop_d' }),
      makeOrder({ id: 'o5', shopId: 'shop_e' }),
    ];
    expect(pickFrequentlyOrderedShops(orders, 2)).toHaveLength(2);
    expect(pickFrequentlyOrderedShops(orders, 0)).toHaveLength(0);
  });

  test('defaults limit to 3', () => {
    const orders = Array.from({ length: 5 }, (_, i) =>
      makeOrder({ id: `o${i}`, shopId: `shop_${i}` }),
    );
    expect(pickFrequentlyOrderedShops(orders)).toHaveLength(3);
  });

  test('mixes delivered with in-flight in same history (only delivered count)', () => {
    // Real-world case: customer just placed a fresh order from
    // shop_b (still pending) and has 2 historical delivered from
    // shop_a. Rail should still rank shop_a first — the pending
    // order doesn't graduate shop_b above it until it's delivered.
    const orders = [
      makeOrder({ id: 'o1', shopId: 'shop_a', status: 'delivered' }),
      makeOrder({ id: 'o2', shopId: 'shop_a', status: 'delivered' }),
      makeOrder({ id: 'o3', shopId: 'shop_b', status: 'pending' }),
    ];
    const result = pickFrequentlyOrderedShops(orders);
    expect(result).toHaveLength(1);
    expect(result[0].shopId).toBe('shop_a');
    expect(result[0].orderCount).toBe(2);
  });
});
