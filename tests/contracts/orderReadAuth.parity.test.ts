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

// ────────────────────────────────────────────────────────────
// PR 1 — Security hardening: auth-boundary matrix for the new
// delivery-approval callables + cross-reference to the existing
// callables that PR 1 did NOT extract into helpers.
// ────────────────────────────────────────────────────────────
//
// The auth checks on requestDeliveryRole / approveDeliveryRole /
// rejectDeliveryRole / listPendingDeliveryRequests live in
// functions/src/deliveryRequestHelpers.ts and are exercised in
// detail by tests/functions/deliveryRequestHelpers.test.ts (23
// tests pinning every code path). This block adds a parity-style
// matrix that asserts the SAME auth verdicts using the helpers,
// so reviewers can eyeball role × callable → allow/deny in one
// place — the existing canReadOrder posture above.
//
// Existing-callable auth (NOT refactored in PR 1 to keep diff
// focused — those check inline in functions/src/index.ts; the
// inline checks are documented here as ground truth):
//
//   listShopOrders        → admin OR (shopOwner AND requested
//                                     shopId == claims.shopId).
//                            Helper: validateShopOrdersAccess
//                            (already pinned by
//                            listShopOrdersValidation.test.ts).
//   listMyOrders          → any signed-in caller; scoped by
//                            customerUid == auth.uid in the
//                            Firestore query, not in an auth
//                            check (rules + query together
//                            enforce isolation).
//   listAvailableDeliveries → delivery claim required.
//                            requireDeliveryRole inline.
//   listShopMenuPublic    → no auth required; server filters
//                            non-active shops + unavailable
//                            items. Rules now ALSO enforce
//                            active-shop gate on direct reads
//                            (firestore.rules /shops/*/menu).
//   searchMenuPublic      → PR 4. No auth required. Server picks
//                            active candidate shops (capped at 30
//                            for Firestore `in` query limit), runs
//                            collection-group query on `menu`,
//                            filters by query/category/stock, joins
//                            shop info, caps at 50. Same posture as
//                            listShopMenuPublic — pure browse path.
//                            Rules: collection-group rule
//                            `match /{path=**}/menu/{menuItemId}`
//                            gates direct web-SDK reads with the
//                            same active-shop predicate.
//   listAllUsers,
//   listAllShops          → admin claim required. Inline.
//   getMyDeliveryRequest  → any signed-in caller; returns the
//                            caller's own doc only. Scoped by
//                            db.doc(`deliveryRequests/${uid}`).
//
// New callables (extracted helpers, matrix below):
//   requestDeliveryRole         → validateRequestDeliveryRole
//   approveDeliveryRole         → canApproveDeliveryRequest
//   rejectDeliveryRole          → canRejectDeliveryRequest
//   listPendingDeliveryRequests → requireAdminCaller
//
// The matrix below sweeps the four canonical caller roles
// (anon, customer, delivery, admin) through each new helper
// and asserts allow/deny. Any drift between this matrix and the
// callable's actual behaviour means a reviewer should update
// BOTH this file AND tests/functions/deliveryRequestHelpers.test.ts.
import {
    canApproveDeliveryRequest,
    canRejectDeliveryRequest,
    requireAdminCaller,
    validateRequestDeliveryRole,
} from '../../functions/src/deliveryRequestHelpers';

type Caller =
  | { kind: 'anon' }
  | { kind: 'customer'; uid: string }
  | { kind: 'delivery'; uid: string }
  | { kind: 'admin'; uid: string };

function authFor(c: Caller) {
  if (c.kind === 'anon') return null;
  const token: Record<string, unknown> = {};
  if (c.kind === 'delivery') token.delivery = true;
  if (c.kind === 'admin') token.admin = true;
  return { uid: c.uid, token } as const;
}

const CALLERS: Caller[] = [
  { kind: 'anon' },
  { kind: 'customer', uid: 'cust1' },
  { kind: 'delivery', uid: 'del1' },
  { kind: 'admin', uid: 'admin1' },
];

describe('PR 1 — delivery-approval callables × caller-role matrix', () => {
  describe('requestDeliveryRole', () => {
    // Allow iff (signed in) AND (caller does NOT already hold the
    // delivery claim). hasExistingPendingRequest is the Firestore
    // dedup; we exercise it === false here so the matrix only
    // varies on auth + role.
    test.each(CALLERS)('caller=$kind allow/deny', caller => {
      const auth = authFor(caller);
      const r = validateRequestDeliveryRole({
        auth,
        hasExistingPendingRequest: false,
      });
      if (caller.kind === 'anon') {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('unauthenticated');
      } else if (caller.kind === 'delivery') {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('failed-precondition');
      } else {
        // customer + admin can apply (admins applying to themselves
        // is unusual but not blocked by the helper — the policy is
        // "no self-revocation" not "no self-apply").
        expect(r.ok).toBe(true);
      }
    });
  });

  describe('approveDeliveryRole', () => {
    // Allow iff admin AND target doc is pending. Vary caller; pin
    // currentRequestStatus='pending' + targetUid='someUser' so the
    // matrix is purely about role.
    test.each(CALLERS)('caller=$kind allow/deny', caller => {
      const auth = authFor(caller);
      const r = canApproveDeliveryRequest({
        auth,
        targetUid: 'someUser',
        currentRequestStatus: 'pending',
      });
      if (caller.kind === 'admin') {
        expect(r.ok).toBe(true);
      } else if (caller.kind === 'anon') {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('unauthenticated');
      } else {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('permission-denied');
      }
    });
  });

  describe('rejectDeliveryRole', () => {
    // Same role contract as approve; reason is required and non-empty.
    test.each(CALLERS)('caller=$kind allow/deny', caller => {
      const auth = authFor(caller);
      const r = canRejectDeliveryRequest({
        auth,
        targetUid: 'someUser',
        currentRequestStatus: 'pending',
        reason: 'missing ID',
      });
      if (caller.kind === 'admin') {
        expect(r.ok).toBe(true);
      } else if (caller.kind === 'anon') {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('unauthenticated');
      } else {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('permission-denied');
      }
    });
  });

  describe('listPendingDeliveryRequests', () => {
    // Admin-only. Pure auth helper; no resource-state dependency.
    test.each(CALLERS)('caller=$kind allow/deny', caller => {
      const auth = authFor(caller);
      const r = requireAdminCaller({ auth });
      if (caller.kind === 'admin') {
        expect(r.ok).toBe(true);
      } else if (caller.kind === 'anon') {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('unauthenticated');
      } else {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('permission-denied');
      }
    });
  });
});
