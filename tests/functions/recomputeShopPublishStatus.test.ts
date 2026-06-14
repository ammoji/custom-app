/**
 * PR-NEXT-BUNDLE-M §C/§H — tests for the `recomputeShopPublishStatus`
 * callable's auth decision.
 *
 * The callable is a thin IO wrapper over the pure `decideRecomputeAuth`
 * helper (Validator-Result posture, same as
 * `validateShopLocationForApproval`); the repo has no emulator harness,
 * so we pin the auth matrix on the helper. The callable's only extra
 * step is mapping the result `code` to an `HttpsError` + running the
 * (IO-bound) recompute, verified at deploy time via `npm run smoke`.
 */
import { decideRecomputeAuth } from '../../functions/src/shopPublishGateHelpers';

describe('decideRecomputeAuth', () => {
  test('shop owner of shop X calling for shop X → success', () => {
    const r = decideRecomputeAuth({
      signedIn: true,
      isAdmin: false,
      isShopOwner: true,
      claimShopId: 'shopX',
      requestedShopId: 'shopX',
    });
    expect(r).toEqual({ ok: true, shopId: 'shopX' });
  });

  test('shop owner of shop X calling for shop Y → permission-denied', () => {
    const r = decideRecomputeAuth({
      signedIn: true,
      isAdmin: false,
      isShopOwner: true,
      claimShopId: 'shopX',
      requestedShopId: 'shopY',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('non-shop-owner / signed-out caller → unauthenticated', () => {
    const r = decideRecomputeAuth({
      signedIn: false,
      isAdmin: false,
      isShopOwner: false,
      claimShopId: null,
      requestedShopId: 'shopX',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  test('admin → success regardless of which shop', () => {
    const r = decideRecomputeAuth({
      signedIn: true,
      isAdmin: true,
      isShopOwner: false,
      claimShopId: null,
      requestedShopId: 'anyShop',
    });
    expect(r).toEqual({ ok: true, shopId: 'anyShop' });
  });

  test('signed-in non-owner with no shopId resolvable → invalid-argument', () => {
    const r = decideRecomputeAuth({
      signedIn: true,
      isAdmin: false,
      isShopOwner: false,
      claimShopId: null,
      requestedShopId: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });
});
