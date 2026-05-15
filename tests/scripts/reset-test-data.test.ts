/**
 * Unit tests for scripts/reset-test-data.helpers.ts.
 *
 * Per the cleanup-script spec, the destructive logic is split into
 * pure helpers (project guard, admin-UID filter, flag parser,
 * deletion plan) so blast-radius decisions can be pinned by tests
 * without booting firebase-admin or reading a service account.
 *
 * The main()-level wiring (firebase-admin init, deleteRefsInBatches,
 * interactive readline prompt) stays untested at the unit level —
 * those are proved by the dry-run + abort-path manual demos in
 * §Acceptance.
 *
 * Test count target per the spec: ≥10 tests.
 */
import {
  assertProjectAllowed,
  buildDeletionPlan,
  parseFlags,
  protectAdminFromUserList,
} from '../../scripts/reset-test-data.helpers';

describe('assertProjectAllowed', () => {
  test('accepts grocery-mvp-dev', () => {
    expect(() => assertProjectAllowed('grocery-mvp-dev')).not.toThrow();
  });

  test('rejects grocery-mvp (prod-looking)', () => {
    expect(() => assertProjectAllowed('grocery-mvp')).toThrow(
      /REFUSING TO RUN/,
    );
  });

  test('rejects an empty string', () => {
    expect(() => assertProjectAllowed('')).toThrow(/REFUSING TO RUN/);
  });

  test('rejects undefined', () => {
    expect(() => assertProjectAllowed(undefined)).toThrow(/REFUSING TO RUN/);
  });

  test('rejects a random project name', () => {
    expect(() => assertProjectAllowed('some-other-project')).toThrow(
      /REFUSING TO RUN/,
    );
  });
});

describe('protectAdminFromUserList', () => {
  test('filters out the admin UID and returns the rest', () => {
    const out = protectAdminFromUserList(['admin', 'a', 'b'], 'admin');
    expect(out).toEqual(['a', 'b']);
  });

  test('throws when adminUid is empty (operator forgot ADMIN_PROTECT_UID)', () => {
    expect(() => protectAdminFromUserList(['a', 'b'], '')).toThrow(
      /ADMIN_PROTECT_UID env var must be set/,
    );
  });

  test('throws when adminUid is not in a non-empty list (wrong UID)', () => {
    expect(() =>
      protectAdminFromUserList(['a', 'b'], 'admin-that-does-not-exist'),
    ).toThrow(/no\s+record with that UID exists/);
  });

  test('returns [] silently for an empty input list', () => {
    // Nothing to protect, nothing to delete — empty input is fine.
    expect(protectAdminFromUserList([], 'admin')).toEqual([]);
  });

  test('preserves order of remaining UIDs', () => {
    const out = protectAdminFromUserList(
      ['z', 'admin', 'a', 'm', 'admin', 'q'],
      'admin',
    );
    // Both `admin` entries filtered, order otherwise preserved.
    expect(out).toEqual(['z', 'a', 'm', 'q']);
  });
});

describe('parseFlags', () => {
  test('defaults to dry-run when no flags are passed', () => {
    expect(parseFlags([])).toEqual({
      execute: false,
      keepShops: false,
      keepOrders: false,
      noConfirm: false,
      adminUid: null,
    });
  });

  test('parses --execute', () => {
    expect(parseFlags(['--execute']).execute).toBe(true);
  });

  test('parses --keep-shops and routes it to the deletion plan', () => {
    const flags = parseFlags(['--execute', '--keep-shops']);
    expect(flags.keepShops).toBe(true);
    const plan = buildDeletionPlan(
      { orders: 5, shops: 3, menu: 30, users: 4, authUsers: 4 },
      flags,
    );
    expect(plan).toEqual({
      orders: 5,
      shops: 0,
      menu: 0,
      users: 4,
      authUsers: 4,
      isNoOp: false,
    });
  });

  test('parses --keep-orders and routes it to the deletion plan', () => {
    const flags = parseFlags(['--execute', '--keep-orders']);
    expect(flags.keepOrders).toBe(true);
    const plan = buildDeletionPlan(
      { orders: 5, shops: 3, menu: 30, users: 4, authUsers: 4 },
      flags,
    );
    expect(plan).toEqual({
      orders: 0,
      shops: 3,
      menu: 30,
      users: 4,
      authUsers: 4,
      isNoOp: false,
    });
  });

  test('parses --admin-uid=<uid>', () => {
    expect(parseFlags(['--admin-uid=abc123']).adminUid).toBe('abc123');
  });

  test('rejects --admin-uid= with no value', () => {
    expect(() => parseFlags(['--admin-uid='])).toThrow(/requires a value/);
  });

  test('rejects --no-confirm without --execute', () => {
    // Spec: dangerous combo, refuse rather than silently no-op.
    expect(() => parseFlags(['--no-confirm'])).toThrow(
      /--no-confirm requires --execute/,
    );
  });

  test('accepts --no-confirm WITH --execute', () => {
    const flags = parseFlags(['--execute', '--no-confirm']);
    expect(flags.noConfirm).toBe(true);
    expect(flags.execute).toBe(true);
  });

  test('rejects unknown flags (typo guard)', () => {
    // `--keep-shop` (singular) would otherwise silently fall through
    // to "delete everything including shops" — the worst possible
    // default for this script.
    expect(() => parseFlags(['--keep-shop'])).toThrow(/Unknown flag/);
  });
});

describe('buildDeletionPlan', () => {
  test('default plan deletes everything', () => {
    const plan = buildDeletionPlan(
      { orders: 42, shops: 10, menu: 340, users: 7, authUsers: 7 },
      { keepShops: false, keepOrders: false },
    );
    expect(plan).toEqual({
      orders: 42,
      shops: 10,
      menu: 340,
      users: 7,
      authUsers: 7,
      isNoOp: false,
    });
  });

  test('isNoOp = true when all counts are 0 (idempotency signal)', () => {
    const plan = buildDeletionPlan(
      { orders: 0, shops: 0, menu: 0, users: 0, authUsers: 0 },
      { keepShops: false, keepOrders: false },
    );
    expect(plan.isNoOp).toBe(true);
  });

  test('isNoOp = false if at least one phase has work', () => {
    const plan = buildDeletionPlan(
      { orders: 0, shops: 0, menu: 0, users: 1, authUsers: 0 },
      { keepShops: false, keepOrders: false },
    );
    expect(plan.isNoOp).toBe(false);
  });
});
