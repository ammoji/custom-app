/**
 * Parity check between firestore.rules and the function-side
 * canReadOrder helper.
 *
 * Order reads are enforced TWICE by necessity:
 *   1. firestore.rules `match /orders/{orderId}.allow read` — gates
 *      web SDK and admin-console reads
 *   2. functions/src/getOrderAuth.ts `canReadOrder()` — gates the
 *      getOrder callable that watchOrder polls on native
 *
 * The two MUST agree. Sudhir's "Not your order" repro was caused
 * by them disagreeing — the function was stricter than the rules
 * and rejected legitimate shop-owner reads on native.
 *
 * This file enumerates every read category from the rules clause
 * once, runs each case through canReadOrder, and asserts the
 * expected verdict. The same matrix is exercised on the rules
 * side by tests/rules/orders.test.ts. If either side's expected
 * result changes, BOTH test files should be updated in the same
 * PR — the matrix below documents the contract.
 */
import { canReadOrder } from '../../functions/src/getOrderAuth';

type Case = {
  /**
   * Human-readable name. Match these against the test names in
   * tests/rules/orders.test.ts so a code reviewer can verify
   * parity by eyeballing both files.
   */
  name: string;
  uid: string;
  claims: Record<string, unknown>;
  order: {
    customerUid?: string;
    shopId?: string;
    status?: string;
    deliveryPersonId?: string | null;
  };
  expected: boolean;
};

const CUSTOMER = 'cust_001';
const OTHER_CUSTOMER = 'cust_002';
const ADMIN = 'admin_001';
const SHOP_OWNER_A = 'shopOwner_A';
const SHOP_OWNER_B = 'shopOwner_B';
const DELIVERY_A = 'delivery_A';
const DELIVERY_B = 'delivery_B';
const SHOP_A = 'shop_A';
const SHOP_B = 'shop_B';

const orderPlaced = {
  customerUid: CUSTOMER,
  shopId: SHOP_A,
  status: 'pending' as const,
  deliveryPersonId: null,
};
const orderOfdUnclaimed = {
  customerUid: CUSTOMER,
  shopId: SHOP_A,
  status: 'out_for_delivery' as const,
  deliveryPersonId: null,
};
const orderOfdClaimed = {
  customerUid: CUSTOMER,
  shopId: SHOP_A,
  status: 'out_for_delivery' as const,
  deliveryPersonId: DELIVERY_A,
};

const matrix: Case[] = [
  // ── Customer ────────────────────────────────────────────────
  {
    name: 'placing customer can read their order',
    uid: CUSTOMER,
    claims: {},
    order: orderPlaced,
    expected: true,
  },
  {
    name: "different customer cannot read someone else's order",
    uid: OTHER_CUSTOMER,
    claims: {},
    order: orderPlaced,
    expected: false,
  },
  // ── Admin ───────────────────────────────────────────────────
  {
    name: 'admin can read any order',
    uid: ADMIN,
    claims: { admin: true },
    order: orderPlaced,
    expected: true,
  },
  // ── Shop owner ──────────────────────────────────────────────
  {
    name: 'shop owner with matching shopId claim can read order',
    uid: SHOP_OWNER_A,
    claims: { shopOwner: true, shopId: SHOP_A },
    order: orderPlaced,
    expected: true,
  },
  {
    name: 'shop owner of a different shop cannot read order',
    uid: SHOP_OWNER_B,
    claims: { shopOwner: true, shopId: SHOP_B },
    order: orderPlaced,
    expected: false,
  },
  {
    name: 'shop owner claim present but shopId wrong cannot read order',
    uid: SHOP_OWNER_A,
    claims: { shopOwner: true, shopId: 'totally-different-shop' },
    order: orderPlaced,
    expected: false,
  },
  // ── Delivery — assigned ─────────────────────────────────────
  {
    name: 'assigned delivery person can read their claimed order',
    uid: DELIVERY_A,
    claims: { delivery: true },
    order: orderOfdClaimed,
    expected: true,
  },
  {
    name: 'different delivery person cannot read a claimed order',
    uid: DELIVERY_B,
    claims: { delivery: true },
    order: orderOfdClaimed,
    expected: false,
  },
  // ── Delivery — unassigned pickups board ─────────────────────
  {
    name: 'delivery person can read unassigned out_for_delivery order',
    uid: DELIVERY_B,
    claims: { delivery: true },
    order: orderOfdUnclaimed,
    expected: true,
  },
  {
    name: 'delivery person cannot read pending unassigned order (wrong status)',
    uid: DELIVERY_B,
    claims: { delivery: true },
    order: { ...orderPlaced, status: 'pending' },
    expected: false,
  },
];

describe('canReadOrder ↔ firestore.rules parity matrix', () => {
  test.each(matrix)('$name', ({ uid, claims, order, expected }) => {
    expect(canReadOrder({ uid, claims, order })).toBe(expected);
  });
});
