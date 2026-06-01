/**
 * PR-NEXT-ENH-2 (finding #5 follow-up) — tests for
 * `validateBulkRemoveRequest`. Mirrors `bulkMenuHelpers.test.ts`
 * exactly, minus the `available` field cases (the soft-delete
 * write is unconditional).
 */
import {
  BULK_REMOVE_MAX_IDS,
  validateBulkRemoveRequest,
} from '../../functions/src/bulkRemoveMenuHelpers';

const SHOP_OWNER_AUTH = {
  uid: 'shop_owner_001',
  token: { shopOwner: true, shopId: 'shop_001' },
};

describe('validateBulkRemoveRequest', () => {
  test('rejects unauthenticated callers', () => {
    const r = validateBulkRemoveRequest({
      auth: null,
      menuItemIds: ['m1'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  test('rejects auth with empty uid', () => {
    const r = validateBulkRemoveRequest({
      auth: { uid: '', token: { shopOwner: true, shopId: 'shop_001' } },
      menuItemIds: ['m1'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  test('rejects callers without shopOwner claim', () => {
    const r = validateBulkRemoveRequest({
      auth: { uid: 'cust_001', token: { shopId: 'shop_001' } },
      menuItemIds: ['m1'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('rejects shopOwner === "true" (string, not boolean) — forged-claim defense', () => {
    const r = validateBulkRemoveRequest({
      auth: {
        uid: 'shop_owner_001',
        token: { shopOwner: 'true', shopId: 'shop_001' },
      },
      menuItemIds: ['m1'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('rejects shopOwner without shopId claim', () => {
    const r = validateBulkRemoveRequest({
      auth: { uid: 'shop_owner_001', token: { shopOwner: true } },
      menuItemIds: ['m1'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('rejects shopOwner with empty-string shopId', () => {
    const r = validateBulkRemoveRequest({
      auth: {
        uid: 'shop_owner_001',
        token: { shopOwner: true, shopId: '' },
      },
      menuItemIds: ['m1'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('rejects non-array menuItemIds', () => {
    const r = validateBulkRemoveRequest({
      auth: SHOP_OWNER_AUTH,
      menuItemIds: 'm1',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('rejects empty menuItemIds array', () => {
    const r = validateBulkRemoveRequest({
      auth: SHOP_OWNER_AUTH,
      menuItemIds: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('rejects menuItemIds over the 100-cap', () => {
    const ids = Array.from(
      { length: BULK_REMOVE_MAX_IDS + 1 },
      (_, i) => `m${i}`,
    );
    const r = validateBulkRemoveRequest({
      auth: SHOP_OWNER_AUTH,
      menuItemIds: ids,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid-argument');
      expect(r.message).toMatch(/max/i);
    }
  });

  test('rejects menuItemIds with a non-string entry', () => {
    const r = validateBulkRemoveRequest({
      auth: SHOP_OWNER_AUTH,
      menuItemIds: ['m1', 42, 'm2'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('rejects menuItemIds with an empty-string entry', () => {
    const r = validateBulkRemoveRequest({
      auth: SHOP_OWNER_AUTH,
      menuItemIds: ['m1', '', 'm2'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('happy path → ok with shopId + validIds preserved', () => {
    const r = validateBulkRemoveRequest({
      auth: SHOP_OWNER_AUTH,
      menuItemIds: ['m1', 'm2', 'm3'],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.shopId).toBe('shop_001');
      expect(r.validIds).toEqual(['m1', 'm2', 'm3']);
    }
  });

  test('exactly 100 ids → ok (boundary)', () => {
    const ids = Array.from(
      { length: BULK_REMOVE_MAX_IDS },
      (_, i) => `m${i}`,
    );
    const r = validateBulkRemoveRequest({
      auth: SHOP_OWNER_AUTH,
      menuItemIds: ids,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.validIds.length).toBe(BULK_REMOVE_MAX_IDS);
  });

  test('caller may hold both admin + shopOwner — shopOwner path wins', () => {
    const r = validateBulkRemoveRequest({
      auth: {
        uid: 'admin_owner_001',
        token: {
          shopOwner: true,
          shopId: 'shop_001',
          // extra admin claim shouldn't change the path
          ...({ admin: true } as Record<string, unknown>),
        },
      },
      menuItemIds: ['m1'],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.shopId).toBe('shop_001');
  });
});
