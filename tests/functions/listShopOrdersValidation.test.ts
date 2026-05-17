/**
 * Pure unit tests for validateShopOrdersAccess in
 * functions/src/shopOrdersHelpers.ts.
 *
 * Pinned to prevent regression of the v2-iv INTERNAL bug, where the
 * inline check inside listShopOrders concatenated claim values into
 * the error message and the RNFB SDK surfaced the result as
 * `INTERNAL` instead of `invalid-argument` / `permission-denied`.
 * Extracting the validation into a pure helper means we can pin the
 * intended error code per case without booting firebase-functions.
 */
import { validateShopOrdersAccess } from '../../functions/src/shopOrdersHelpers';

describe('validateShopOrdersAccess', () => {
  test('accepts a shopOwner whose claim shopId matches the requested shopId', () => {
    const result = validateShopOrdersAccess({
      claims: { shopOwner: true, shopId: 'shop_001' },
      requestedShopId: 'shop_001',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targetShopId).toBe('shop_001');
  });

  test('accepts a shopOwner with no body param — falls back to their own shopId', () => {
    const result = validateShopOrdersAccess({
      claims: { shopOwner: true, shopId: 'shop_002' },
      requestedShopId: undefined,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targetShopId).toBe('shop_002');
  });

  test('accepts an admin requesting any shop', () => {
    const result = validateShopOrdersAccess({
      claims: { admin: true },
      requestedShopId: 'shop_001',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targetShopId).toBe('shop_001');
  });

  test('rejects with `invalid-argument` (not INTERNAL) when shopId is undefined and caller has no shopId claim', () => {
    // This is the regression-guard case for the v2-iv INTERNAL bug.
    // The earlier inline check used string concatenation in the error
    // message; RNFB serialised the result as INTERNAL on the device.
    // With the helper, the code is explicitly `invalid-argument`.
    const result = validateShopOrdersAccess({
      claims: { admin: true },
      requestedShopId: undefined,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid-argument');
    expect(result.message).toMatch(/shopId/);
  });

  test('rejects with `permission-denied` when shopOwner asks for a different shop', () => {
    const result = validateShopOrdersAccess({
      claims: { shopOwner: true, shopId: 'shop_001' },
      requestedShopId: 'shop_007',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('permission-denied');
  });

  test('rejects when claims.shopId is an empty string (stale-claim edge case)', () => {
    // Sudhir hit a real stale-claim variant during multi-role
    // testing — the shopOwner flag was true but shopId was '' after
    // a revoke-then-regrant. Helper must treat '' the same as
    // undefined to avoid surfacing the empty string as a Firestore
    // query value (which the earlier code did, producing an empty
    // result set + a confusing UI).
    const result = validateShopOrdersAccess({
      claims: { shopOwner: true, shopId: '' },
      requestedShopId: undefined,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid-argument');
  });
});
