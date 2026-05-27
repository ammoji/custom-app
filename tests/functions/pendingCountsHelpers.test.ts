/**
 * PR 41 — Unit tests for the pure helpers behind
 * `getPendingApprovalCounts`. Validates the role-based projection,
 * the defensive `'pending'` filter, and the count cap.
 */
import {
  capPendingCount,
  countPendingDocs,
  PENDING_COUNT_HARD_CAP,
  projectPendingCounts,
  type PendingCountsRequestRole,
  type PendingCountsResult,
} from '../../functions/src/pendingCountsHelpers';

const RAW: PendingCountsResult = {
  shopCount: 3,
  deliveryCount: 2,
  pendingOrderCount: 7,
};

const ADMIN_ONLY: PendingCountsRequestRole = {
  isAdmin: true,
  isShopOwner: false,
};

const SHOP_OWNER_ONLY: PendingCountsRequestRole = {
  isAdmin: false,
  isShopOwner: true,
  shopId: 'shop_123',
};

const BOTH: PendingCountsRequestRole = {
  isAdmin: true,
  isShopOwner: true,
  shopId: 'shop_123',
};

const NEITHER: PendingCountsRequestRole = {
  isAdmin: false,
  isShopOwner: false,
};

describe('PR 41 — projectPendingCounts', () => {
  test('admin-only caller sees shopCount + deliveryCount, NOT pendingOrderCount', () => {
    expect(projectPendingCounts(ADMIN_ONLY, RAW)).toEqual({
      shopCount: 3,
      deliveryCount: 2,
      pendingOrderCount: 0,
    });
  });

  test('shop-owner-only caller sees pendingOrderCount, NOT shop/delivery counts', () => {
    expect(projectPendingCounts(SHOP_OWNER_ONLY, RAW)).toEqual({
      shopCount: 0,
      deliveryCount: 0,
      pendingOrderCount: 7,
    });
  });

  test('shop-owner caller without a shopId gets pendingOrderCount=0 (defensive)', () => {
    expect(
      projectPendingCounts({ isAdmin: false, isShopOwner: true }, RAW),
    ).toEqual({ shopCount: 0, deliveryCount: 0, pendingOrderCount: 0 });
  });

  test('caller with BOTH roles sees all three counts', () => {
    expect(projectPendingCounts(BOTH, RAW)).toEqual(RAW);
  });

  test('caller with NEITHER role sees all zeros (no permission-denied)', () => {
    expect(projectPendingCounts(NEITHER, RAW)).toEqual({
      shopCount: 0,
      deliveryCount: 0,
      pendingOrderCount: 0,
    });
  });
});

describe('PR 41 — countPendingDocs', () => {
  const mkDoc = (status: unknown) => ({ data: () => ({ status }) });

  test('counts only docs whose status is the literal "pending"', () => {
    const docs = [
      mkDoc('pending'),
      mkDoc('approved'),
      mkDoc('pending'),
      mkDoc('rejected'),
      mkDoc('pending'),
    ];
    expect(countPendingDocs(docs)).toBe(3);
  });

  test('returns 0 for an empty iterable', () => {
    expect(countPendingDocs([])).toBe(0);
  });

  test('ignores docs with missing or malformed data (defensive)', () => {
    const docs = [
      { data: () => undefined as unknown },
      { data: () => null as unknown },
      { data: () => ({ status: 'pending' }) },
      { data: () => ({ status: 42 }) }, // non-string
      { data: () => ({}) }, // no status field
    ];
    expect(countPendingDocs(docs)).toBe(1);
  });
});

describe('PR 41 — capPendingCount', () => {
  test('returns the count untouched when below the cap', () => {
    expect(capPendingCount(0)).toBe(0);
    expect(capPendingCount(5)).toBe(5);
    expect(capPendingCount(99)).toBe(99);
  });

  test(`caps at the hard cap (${PENDING_COUNT_HARD_CAP}) for runaway values`, () => {
    expect(capPendingCount(PENDING_COUNT_HARD_CAP + 1)).toBe(
      PENDING_COUNT_HARD_CAP,
    );
    expect(capPendingCount(1_000_000)).toBe(PENDING_COUNT_HARD_CAP);
  });

  test('floors fractional inputs and clamps negatives to 0', () => {
    expect(capPendingCount(3.9)).toBe(3);
    expect(capPendingCount(-1)).toBe(0);
  });

  test('rejects NaN / Infinity inputs (returns 0)', () => {
    expect(capPendingCount(Number.NaN)).toBe(0);
    expect(capPendingCount(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
