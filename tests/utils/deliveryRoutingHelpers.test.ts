/**
 * PR 49 — pure helper tests for `rideLegsForOrder` +
 * `sortPickupsByProximity`.
 *
 * Client-only helper (the server doesn't sort pickups), so these
 * live under `tests/utils/` alongside the other client-helper
 * specs (`buildReorderPlan`, `pickActiveOrders`, etc.). No
 * firebase-admin / no React Native — pure decision logic.
 */

import type { GeoPoint, Order } from '../../src/types';
import { haversineKm } from '../../src/utils/distance';
import {
  rideLegsForOrder,
  sortPickupsByProximity,
} from '../../src/utils/deliveryRoutingHelpers';

// Minimal Order-shaped fixtures. The helper only reads two fields
// (`shopLocation`, `deliveryDistanceKm`) so we typecast around the
// rest — pinning the helper's narrow input contract is part of
// what these tests assert.
type Pickup = Pick<Order, 'shopLocation' | 'deliveryDistanceKm'> & {
  id: string;
};

const PARTNER: GeoPoint = { lat: 28.5, lng: 77.2 }; // Delhi-ish
const NEAR_SHOP: GeoPoint = { lat: 28.51, lng: 77.21 }; // ~1.4 km
const FAR_SHOP: GeoPoint = { lat: 28.7, lng: 77.4 }; // ~30 km

describe('PR 49 — rideLegsForOrder', () => {
  test('both coords + deliveryDistanceKm present → all three legs computed', () => {
    const order: Pickup = {
      id: 'a',
      shopLocation: NEAR_SHOP,
      deliveryDistanceKm: 2,
    };
    void order.id; // pin: helper ignores extra fields, accepts our Pickup
    const legs = rideLegsForOrder(order, PARTNER);
    const expectedShop = haversineKm(PARTNER, NEAR_SHOP);
    expect(legs.toShopKm).toBeCloseTo(expectedShop, 5);
    expect(legs.toCustomerKm).toBe(2);
    expect(legs.totalKm).toBeCloseTo(expectedShop + 2, 5);
  });

  test('partner null → toShopKm + totalKm null; toCustomerKm preserved', () => {
    const order: Pickup = {
      id: 'a',
      shopLocation: NEAR_SHOP,
      deliveryDistanceKm: 2,
    };
    const legs = rideLegsForOrder(order, null);
    expect(legs.toShopKm).toBeNull();
    expect(legs.toCustomerKm).toBe(2);
    expect(legs.totalKm).toBeNull();
  });

  test('shopLocation missing → toShopKm + totalKm null; toCustomerKm preserved', () => {
    const order: Pickup = { id: 'a', deliveryDistanceKm: 2 };
    const legs = rideLegsForOrder(order, PARTNER);
    expect(legs.toShopKm).toBeNull();
    expect(legs.toCustomerKm).toBe(2);
    expect(legs.totalKm).toBeNull();
  });

  test('deliveryDistanceKm missing → toCustomerKm + totalKm null even when toShopKm known', () => {
    const order: Pickup = { id: 'a', shopLocation: NEAR_SHOP };
    const legs = rideLegsForOrder(order, PARTNER);
    expect(legs.toShopKm).not.toBeNull();
    expect(legs.toCustomerKm).toBeNull();
    expect(legs.totalKm).toBeNull();
  });

  test('deliveryDistanceKm non-finite (NaN / Infinity) → treated as missing', () => {
    const nanOrder: Pickup = {
      id: 'a',
      shopLocation: NEAR_SHOP,
      deliveryDistanceKm: Number.NaN,
    };
    const nan = rideLegsForOrder(nanOrder, PARTNER);
    expect(nan.toCustomerKm).toBeNull();
    expect(nan.totalKm).toBeNull();

    const infOrder: Pickup = {
      id: 'b',
      shopLocation: NEAR_SHOP,
      deliveryDistanceKm: Number.POSITIVE_INFINITY,
    };
    const inf = rideLegsForOrder(infOrder, PARTNER);
    expect(inf.toCustomerKm).toBeNull();
    expect(inf.totalKm).toBeNull();
  });

  test('legacy order (both fields absent) + no partner → all null', () => {
    const order: Pickup = { id: 'legacy' };
    const legs = rideLegsForOrder(order, null);
    expect(legs.toShopKm).toBeNull();
    expect(legs.toCustomerKm).toBeNull();
    expect(legs.totalKm).toBeNull();
  });

  test('does not mutate input order', () => {
    const order: Pickup = {
      id: 'a',
      shopLocation: NEAR_SHOP,
      deliveryDistanceKm: 2,
    };
    const before = JSON.stringify(order);
    rideLegsForOrder(order, PARTNER);
    expect(JSON.stringify(order)).toBe(before);
  });
});

describe('PR 49 — sortPickupsByProximity', () => {
  test('nearer shop sorts before farther', () => {
    const orders: Pickup[] = [
      { id: 'far', shopLocation: FAR_SHOP },
      { id: 'near', shopLocation: NEAR_SHOP },
    ];
    const out = sortPickupsByProximity(orders, PARTNER);
    expect(out.map(o => o.id)).toEqual(['near', 'far']);
  });

  test('orders without shopLocation sort to the bottom', () => {
    const orders: Pickup[] = [
      { id: 'no-loc-a' },
      { id: 'far', shopLocation: FAR_SHOP },
      { id: 'no-loc-b' },
      { id: 'near', shopLocation: NEAR_SHOP },
    ];
    const out = sortPickupsByProximity(orders, PARTNER);
    expect(out.map(o => o.id)).toEqual([
      'near',
      'far',
      'no-loc-a',
      'no-loc-b',
    ]);
  });

  test('partner null → original order preserved (stable, all infinite)', () => {
    const orders: Pickup[] = [
      { id: 'b', shopLocation: FAR_SHOP },
      { id: 'a', shopLocation: NEAR_SHOP },
      { id: 'c' },
    ];
    const out = sortPickupsByProximity(orders, null);
    expect(out.map(o => o.id)).toEqual(['b', 'a', 'c']);
  });

  test('stable for ties — equal-distance pickups preserve original index order', () => {
    // Two distinct shop coords that resolve to the same haversine
    // distance from PARTNER would be hard to construct; instead use
    // identical shopLocation on multiple pickups.
    const orders: Pickup[] = [
      { id: 'first', shopLocation: NEAR_SHOP },
      { id: 'second', shopLocation: NEAR_SHOP },
      { id: 'third', shopLocation: NEAR_SHOP },
    ];
    const out = sortPickupsByProximity(orders, PARTNER);
    expect(out.map(o => o.id)).toEqual(['first', 'second', 'third']);
  });

  test('does NOT mutate the input array', () => {
    const orders: Pickup[] = [
      { id: 'far', shopLocation: FAR_SHOP },
      { id: 'near', shopLocation: NEAR_SHOP },
    ];
    const before = orders.map(o => o.id);
    sortPickupsByProximity(orders, PARTNER);
    expect(orders.map(o => o.id)).toEqual(before);
  });

  test('empty array → empty array', () => {
    expect(sortPickupsByProximity<Pickup>([], PARTNER)).toEqual([]);
    expect(sortPickupsByProximity<Pickup>([], null)).toEqual([]);
  });

  test('mixed list with partner — known-distance bubbles up; unknowns cluster at bottom in original order', () => {
    const orders: Pickup[] = [
      { id: 'unknown-1' },
      { id: 'far', shopLocation: FAR_SHOP },
      { id: 'unknown-2' },
      { id: 'near', shopLocation: NEAR_SHOP },
      { id: 'unknown-3' },
    ];
    const out = sortPickupsByProximity(orders, PARTNER);
    expect(out.map(o => o.id)).toEqual([
      'near',
      'far',
      'unknown-1',
      'unknown-2',
      'unknown-3',
    ]);
  });
});
