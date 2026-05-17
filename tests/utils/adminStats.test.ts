/**
 * Pure-helper tests for `computeAdminOrderStats` (Phase 12c).
 *
 * The helper drives the AdminOrdersScreen stats card. The two
 * non-obvious rules pinned here:
 *   1. GMV excludes cancelled orders even on the same calendar day.
 *      A cancellation should never inflate today's number.
 *   2. Active count is independent of the calendar day — it covers
 *      every order that still needs attention regardless of when it
 *      was placed (yesterday's accepted-but-not-delivered still
 *      shows up).
 */
import { computeAdminOrderStats } from '../../src/utils/adminStats';
import type { Order } from '../../src/types';

const NOW = new Date(2026, 4, 15, 14, 30).getTime(); // Fri May 15 14:30 local

function mkOrder(overrides: Partial<Order>): Order {
  // Minimal Order shape — only the fields the helper reads. Casting
  // the rest as any keeps the test concise without weakening the
  // helper's public type contract.
  return {
    id: 'ord_x',
    shopId: 'shop_001',
    shopName: 'Test',
    items: [],
    subtotal: 0,
    deliveryFee: 0,
    total: 0,
    deliveryAddress: {} as any,
    paymentMethod: 'cod',
    status: 'pending',
    createdAt: NOW,
    estimatedDeliveryAt: NOW + 30 * 60_000,
    deliveryPersonId: null,
    pickedUpAt: null,
    deliveredAt: null,
    ...overrides,
  };
}

describe('computeAdminOrderStats', () => {
  test("today's GMV sums non-cancelled orders from today only", () => {
    const orders: Order[] = [
      mkOrder({ id: 'a', total: 200, status: 'delivered', createdAt: NOW }),
      mkOrder({ id: 'b', total: 350, status: 'preparing', createdAt: NOW }),
      // Yesterday's order should NOT count toward today's GMV.
      mkOrder({
        id: 'c',
        total: 999,
        status: 'delivered',
        createdAt: new Date(2026, 4, 14, 22, 0).getTime(),
      }),
    ];
    const stats = computeAdminOrderStats(orders, NOW);
    expect(stats.gmvToday).toBe(550);
  });

  test("cancelled orders don't count toward GMV (regression guard)", () => {
    const orders: Order[] = [
      mkOrder({ id: 'a', total: 500, status: 'delivered', createdAt: NOW }),
      // Cancelled today — must NOT be added.
      mkOrder({ id: 'b', total: 1000, status: 'cancelled', createdAt: NOW }),
    ];
    const stats = computeAdminOrderStats(orders, NOW);
    expect(stats.gmvToday).toBe(500);
  });

  test('active orders count excludes delivered and cancelled', () => {
    const orders: Order[] = [
      mkOrder({ id: 'a', status: 'pending', createdAt: NOW }),
      mkOrder({ id: 'b', status: 'accepted', createdAt: NOW }),
      mkOrder({ id: 'c', status: 'preparing', createdAt: NOW }),
      mkOrder({ id: 'd', status: 'out_for_delivery', createdAt: NOW }),
      mkOrder({ id: 'e', status: 'delivered', createdAt: NOW }),
      mkOrder({ id: 'f', status: 'cancelled', createdAt: NOW }),
    ];
    const stats = computeAdminOrderStats(orders, NOW);
    expect(stats.activeCount).toBe(4);
  });

  test('empty orders array returns zeros (defensive)', () => {
    const stats = computeAdminOrderStats([], NOW);
    expect(stats.gmvToday).toBe(0);
    expect(stats.activeCount).toBe(0);
  });
});
