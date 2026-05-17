/**
 * Pure-helper tests for `filterAndSortUsers` (Phase 12c).
 *
 * The helper backs the UserManagementScreen role chips, search
 * box, and sort toggle. Tests pin all five role buckets, the
 * search-substring contract, and both sort directions.
 *
 * `customer` is the absence of any role flag — admin / shopOwner
 * / delivery all false. Anonymous users count as customers in
 * the same sense.
 */
import {
  filterAndSortUsers,
  type RoleFilter,
} from '../../src/utils/userListFilters';
import type { UserInfo } from '../../src/types';

function mkUser(overrides: Partial<UserInfo>): UserInfo {
  return {
    uid: 'u1',
    phoneNumber: '+910000000000',
    isAnonymous: false,
    isAdmin: false,
    isShopOwner: false,
    shopId: null,
    isDelivery: false,
    createdAt: 0,
    lastSignInAt: 0,
    ...overrides,
  };
}

const ALICE_ADMIN = mkUser({
  uid: 'admin1',
  phoneNumber: '+919876543210',
  isAdmin: true,
  lastSignInAt: 5000,
});
const BOB_OWNER = mkUser({
  uid: 'own1',
  phoneNumber: '+919812345678',
  isShopOwner: true,
  shopId: 'shop_001',
  lastSignInAt: 4000,
});
const CARL_DELIVERY = mkUser({
  uid: 'del1',
  phoneNumber: '+918765432109',
  isDelivery: true,
  lastSignInAt: 3000,
});
const DANA_CUSTOMER = mkUser({
  uid: 'cust1',
  phoneNumber: '+917654321098',
  lastSignInAt: 2000,
});
const EVE_CUSTOMER_NEWER = mkUser({
  uid: 'cust2',
  phoneNumber: '+916543210987',
  lastSignInAt: 6000,
});

const ALL = [
  ALICE_ADMIN,
  BOB_OWNER,
  CARL_DELIVERY,
  DANA_CUSTOMER,
  EVE_CUSTOMER_NEWER,
];

describe('filterAndSortUsers', () => {
  test('filter by `admin` role returns only admins', () => {
    const out = filterAndSortUsers(ALL, 'admin', 'newest', '');
    expect(out.map(u => u.uid)).toEqual(['admin1']);
  });

  test('filter by `shopOwner` role returns only shop owners', () => {
    const out = filterAndSortUsers(ALL, 'shopOwner', 'newest', '');
    expect(out.map(u => u.uid)).toEqual(['own1']);
  });

  test('filter by `delivery` role returns only delivery partners', () => {
    const out = filterAndSortUsers(ALL, 'delivery', 'newest', '');
    expect(out.map(u => u.uid)).toEqual(['del1']);
  });

  test('filter by `customer` returns users with no extra role flags', () => {
    const out = filterAndSortUsers(ALL, 'customer', 'newest', '');
    // EVE has lastSignInAt=6000 (newer), DANA has 2000.
    expect(out.map(u => u.uid)).toEqual(['cust2', 'cust1']);
  });

  test('filter `all` returns everybody', () => {
    const out = filterAndSortUsers(ALL, 'all', 'newest', '');
    expect(out.length).toBe(5);
  });

  test('search query matches phone substring (case-insensitive)', () => {
    // Bob's number 919812345678 — search by tail digits.
    const out = filterAndSortUsers(ALL, 'all', 'newest', '5678');
    expect(out.map(u => u.uid)).toEqual(['own1']);
  });

  test('search query matches uid substring (case-insensitive)', () => {
    // 'CUST' should match both customer uids regardless of case.
    const out = filterAndSortUsers(ALL, 'all', 'newest', 'CUST');
    // Sorted by lastSignInAt desc: cust2 (6000) before cust1 (2000).
    expect(out.map(u => u.uid)).toEqual(['cust2', 'cust1']);
  });

  test('sort by `newest` puts highest lastSignInAt first', () => {
    const out = filterAndSortUsers(ALL, 'all', 'newest', '');
    // Order by lastSignInAt desc: cust2(6000), admin1(5000),
    // own1(4000), del1(3000), cust1(2000).
    expect(out.map(u => u.uid)).toEqual([
      'cust2',
      'admin1',
      'own1',
      'del1',
      'cust1',
    ]);
  });

  test('sort by `oldest` reverses the order', () => {
    const out = filterAndSortUsers(ALL, 'all', 'oldest', '');
    expect(out.map(u => u.uid)).toEqual([
      'cust1',
      'del1',
      'own1',
      'admin1',
      'cust2',
    ]);
  });

  test('null lastSignInAt sorts to the end regardless of direction', () => {
    const ghost = mkUser({ uid: 'ghost', lastSignInAt: null });
    const withGhost = [...ALL, ghost];
    const newest = filterAndSortUsers(withGhost, 'all', 'newest', '');
    const oldest = filterAndSortUsers(withGhost, 'all', 'oldest', '');
    expect(newest[newest.length - 1].uid).toBe('ghost');
    expect(oldest[oldest.length - 1].uid).toBe('ghost');
  });

  test('does not mutate input array (regression guard)', () => {
    const before = ALL.map(u => u.uid);
    filterAndSortUsers(ALL, 'all', 'oldest', '');
    expect(ALL.map(u => u.uid)).toEqual(before);
  });

  test('empty role filter handling: every value behaves', () => {
    const roles: RoleFilter[] = [
      'all',
      'admin',
      'shopOwner',
      'delivery',
      'customer',
    ];
    for (const r of roles) {
      const out = filterAndSortUsers(ALL, r, 'newest', '');
      // Smoke-call: each role just needs to return an array without
      // throwing; specific membership is pinned in the tests above.
      expect(Array.isArray(out)).toBe(true);
    }
  });
});
