/**
 * Unit tests for `validateBulkMenuRequest`.
 *
 * Pins the PR 8 Part B authorization + input-shape policy.
 *
 * Deliberate-break demo target: weaken the shopOwner check from
 * `!== true` to `!`. The "rejects truthy-but-not-true shopOwner
 * claim (string 'true')" test goes red — that's the canonical
 * strict-equality guard for this codebase.
 */
import {
  BULK_MENU_MAX_IDS,
  validateBulkMenuRequest,
} from '../../functions/src/bulkMenuHelpers';

const validAuth = {
  uid: 'u1',
  token: { shopOwner: true, shopId: 'shop_42' },
};

describe('validateBulkMenuRequest — auth gate', () => {
  test('rejects unauthenticated callers (null auth)', () => {
    const r = validateBulkMenuRequest({
      auth: null,
      menuItemIds: ['m1'],
      available: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  test('rejects authenticated non-shop-owner (no claims)', () => {
    const r = validateBulkMenuRequest({
      auth: { uid: 'u1', token: {} },
      menuItemIds: ['m1'],
      available: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('rejects truthy-but-not-true shopOwner claim (string "true")', () => {
    // Canonical strict-equality guard. Don't weaken to `!`.
    const r = validateBulkMenuRequest({
      auth: {
        uid: 'u1',
        token: { shopOwner: 'true', shopId: 'shop_42' },
      },
      menuItemIds: ['m1'],
      available: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('rejects shopOwner=true with missing shopId', () => {
    const r = validateBulkMenuRequest({
      auth: { uid: 'u1', token: { shopOwner: true } },
      menuItemIds: ['m1'],
      available: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });
});

describe('validateBulkMenuRequest — input validation', () => {
  test('rejects missing menuItemIds (undefined)', () => {
    const r = validateBulkMenuRequest({
      auth: validAuth,
      menuItemIds: undefined,
      available: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('rejects empty menuItemIds array', () => {
    const r = validateBulkMenuRequest({
      auth: validAuth,
      menuItemIds: [],
      available: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('rejects non-array menuItemIds', () => {
    const r = validateBulkMenuRequest({
      auth: validAuth,
      menuItemIds: 'm1',
      available: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('rejects non-string entry inside menuItemIds', () => {
    const r = validateBulkMenuRequest({
      auth: validAuth,
      menuItemIds: ['m1', 42, 'm3'],
      available: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('rejects empty-string entry inside menuItemIds', () => {
    const r = validateBulkMenuRequest({
      auth: validAuth,
      menuItemIds: ['m1', '', 'm3'],
      available: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test(`rejects > ${BULK_MENU_MAX_IDS} ids (max cap)`, () => {
    const tooMany = Array.from(
      { length: BULK_MENU_MAX_IDS + 1 },
      (_, i) => `m_${i}`,
    );
    const r = validateBulkMenuRequest({
      auth: validAuth,
      menuItemIds: tooMany,
      available: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid-argument');
      expect(r.message).toMatch(/max/i);
    }
  });

  test('accepts exactly the cap (boundary)', () => {
    const ids = Array.from(
      { length: BULK_MENU_MAX_IDS },
      (_, i) => `m_${i}`,
    );
    const r = validateBulkMenuRequest({
      auth: validAuth,
      menuItemIds: ids,
      available: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.validIds.length).toBe(BULK_MENU_MAX_IDS);
  });

  test('rejects non-boolean available (string "false")', () => {
    const r = validateBulkMenuRequest({
      auth: validAuth,
      menuItemIds: ['m1'],
      available: 'false',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });
});

describe('validateBulkMenuRequest — happy path', () => {
  test('accepts 5 ids + available=false', () => {
    const r = validateBulkMenuRequest({
      auth: validAuth,
      menuItemIds: ['m1', 'm2', 'm3', 'm4', 'm5'],
      available: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.shopId).toBe('shop_42');
      expect(r.validIds).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
      expect(r.available).toBe(false);
    }
  });

  test('accepts 1 id + available=true', () => {
    const r = validateBulkMenuRequest({
      auth: validAuth,
      menuItemIds: ['m1'],
      available: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.available).toBe(true);
  });
});
