/**
 * PR 36 — pure-helper tests for the Customer CRM aggregator.
 *
 * The PR 36 prompt drafted these against `userId` + `address`, but
 * verified-against-source schema fields are `customerUid` +
 * `deliveryAddress` (see header of customerCrmHelpers.ts for the
 * provenance note). Tests pin the corrected shape so the next
 * editor doesn't reintroduce the prompt's drift.
 */
import {
  aggregateShopCustomers,
  viewShopCustomers,
  type ShopCustomer,
  type ShopOrderRaw,
} from '../../functions/src/customerCrmHelpers';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function customer(overrides: Partial<ShopCustomer>): ShopCustomer {
  return {
    uid: 'u',
    phone: null,
    displayName: null,
    orderCount: 1,
    totalSpent: 0,
    firstOrderAt: NOW,
    lastOrderAt: NOW,
    ...overrides,
  };
}

describe('PR 36 — customerCrmHelpers', () => {
  describe('aggregateShopCustomers', () => {
    test('aggregates orders by customerUid with correct totals', () => {
      const orders: ShopOrderRaw[] = [
        {
          id: '1',
          customerUid: 'u1',
          total: 100,
          status: 'delivered',
          createdAt: NOW - 10 * DAY,
          deliveryAddress: { name: 'Amit', phone: '+919876543210' },
        },
        {
          id: '2',
          customerUid: 'u1',
          total: 200,
          status: 'delivered',
          createdAt: NOW - 5 * DAY,
          deliveryAddress: { name: 'Amit', phone: '+919876543210' },
        },
        {
          id: '3',
          customerUid: 'u2',
          total: 50,
          status: 'delivered',
          createdAt: NOW - 8 * DAY,
          deliveryAddress: { name: 'Bharti', phone: '+919811111111' },
        },
      ];
      const customers = aggregateShopCustomers(orders);
      expect(customers).toHaveLength(2);
      const u1 = customers.find(c => c.uid === 'u1')!;
      expect(u1.orderCount).toBe(2);
      expect(u1.totalSpent).toBe(300);
      expect(u1.firstOrderAt).toBe(NOW - 10 * DAY);
      expect(u1.lastOrderAt).toBe(NOW - 5 * DAY);
      expect(u1.displayName).toBe('Amit');
      expect(u1.phone).toBe('+919876543210');
    });

    test('excludes cancelled/refunded orders from totalSpent but counts them in orderCount', () => {
      const orders: ShopOrderRaw[] = [
        {
          id: '1',
          customerUid: 'u1',
          total: 100,
          status: 'delivered',
          createdAt: NOW - 5 * DAY,
          deliveryAddress: {},
        },
        {
          id: '2',
          customerUid: 'u1',
          total: 200,
          status: 'cancelled',
          createdAt: NOW - 3 * DAY,
          deliveryAddress: {},
        },
        {
          id: '3',
          customerUid: 'u1',
          total: 75,
          status: 'refunded',
          createdAt: NOW - 1 * DAY,
          deliveryAddress: {},
        },
      ];
      const customers = aggregateShopCustomers(orders);
      expect(customers[0].orderCount).toBe(3);
      expect(customers[0].totalSpent).toBe(100);
    });

    test('skips orders missing customerUid or createdAt', () => {
      const orders: ShopOrderRaw[] = [
        {
          id: '1',
          customerUid: 'u1',
          total: 100,
          status: 'delivered',
          createdAt: NOW,
          deliveryAddress: {},
        },
        // missing customerUid
        {
          id: '2',
          total: 200,
          status: 'delivered',
          createdAt: NOW,
          deliveryAddress: {},
        } as ShopOrderRaw,
        // missing createdAt
        {
          id: '3',
          customerUid: 'u2',
          total: 50,
          status: 'delivered',
          deliveryAddress: {},
        } as ShopOrderRaw,
      ];
      expect(aggregateShopCustomers(orders)).toHaveLength(1);
    });

    test('phone/displayName come from the most recent order with non-empty values', () => {
      // The OLDER order has only a phone; the NEWER order has a
      // new phone + a name. Both fields should land on the
      // aggregate with the newer values.
      const orders: ShopOrderRaw[] = [
        {
          id: '1',
          customerUid: 'u1',
          total: 100,
          status: 'delivered',
          createdAt: NOW - 10 * DAY,
          deliveryAddress: { phone: '+91old' },
        },
        {
          id: '2',
          customerUid: 'u1',
          total: 200,
          status: 'delivered',
          createdAt: NOW - 5 * DAY,
          deliveryAddress: { phone: '+91new', name: 'Amit' },
        },
      ];
      const customers = aggregateShopCustomers(orders);
      expect(customers[0].phone).toBe('+91new');
      expect(customers[0].displayName).toBe('Amit');
    });

    test('does NOT blank out an older populated name when the newest order has an empty deliveryAddress', () => {
      // Regression guard: a newer order with an empty address
      // shouldn't wipe a populated older name/phone.
      const orders: ShopOrderRaw[] = [
        {
          id: '1',
          customerUid: 'u1',
          total: 100,
          status: 'delivered',
          createdAt: NOW - 10 * DAY,
          deliveryAddress: { name: 'Amit', phone: '+919876543210' },
        },
        {
          id: '2',
          customerUid: 'u1',
          total: 200,
          status: 'delivered',
          createdAt: NOW - 1 * DAY,
          deliveryAddress: {},
        },
      ];
      const customers = aggregateShopCustomers(orders);
      expect(customers[0].displayName).toBe('Amit');
      expect(customers[0].phone).toBe('+919876543210');
    });
  });

  describe('viewShopCustomers', () => {
    test('top_revenue sorts by totalSpent descending and respects limit', () => {
      const customers: ShopCustomer[] = [
        customer({ uid: 'a', totalSpent: 100 }),
        customer({ uid: 'b', totalSpent: 500 }),
        customer({ uid: 'c', totalSpent: 300 }),
      ];
      const top2 = viewShopCustomers(
        customers,
        { sortBy: 'top_revenue', limit: 2 },
        NOW,
      );
      expect(top2.map(c => c.uid)).toEqual(['b', 'c']);
    });

    test('recent sorts by lastOrderAt descending', () => {
      const customers: ShopCustomer[] = [
        customer({ uid: 'a', lastOrderAt: NOW - 10 * DAY }),
        customer({ uid: 'b', lastOrderAt: NOW - 1 * DAY }),
      ];
      const recent = viewShopCustomers(
        customers,
        { sortBy: 'recent' },
        NOW,
      );
      expect(recent.map(c => c.uid)).toEqual(['b', 'a']);
    });

    test('stopped returns only customers older than minDaysSinceLastOrder, most-recently-lapsed first', () => {
      const customers: ShopCustomer[] = [
        customer({ uid: 'a', lastOrderAt: NOW - 60 * DAY }),
        customer({ uid: 'b', lastOrderAt: NOW - 10 * DAY }),
        customer({ uid: 'c', lastOrderAt: NOW - 40 * DAY }),
      ];
      const stopped = viewShopCustomers(
        customers,
        { sortBy: 'stopped', minDaysSinceLastOrder: 30 },
        NOW,
      );
      expect(stopped.map(c => c.uid)).toEqual(['c', 'a']);
    });

    test('stopped defaults minDays to 30', () => {
      const customers: ShopCustomer[] = [
        customer({ uid: 'a', lastOrderAt: NOW - 31 * DAY }),
        customer({ uid: 'b', lastOrderAt: NOW - 29 * DAY }),
      ];
      const stopped = viewShopCustomers(
        customers,
        { sortBy: 'stopped' },
        NOW,
      );
      expect(stopped.map(c => c.uid)).toEqual(['a']);
    });
  });
});
