/**
 * PR-NEXT-BUNDLE-M §C/§H — tests for the `forceShopPublishOverride`
 * callable's auth + argument validation.
 *
 * The callable is a thin IO wrapper over the pure
 * `validateForceOverrideInput` helper; the repo has no emulator
 * harness, so the auth/validation matrix is pinned here. The callable's
 * IO steps (write override fields, recompute, audit-log) are verified
 * at deploy time via `npm run smoke`.
 */
import { validateForceOverrideInput } from '../../functions/src/shopPublishGateHelpers';

describe('validateForceOverrideInput', () => {
  test('non-admin caller → permission-denied', () => {
    const r = validateForceOverrideInput({
      signedIn: true,
      isAdmin: false,
      shopId: 'shopX',
      override: true,
      reason: 'test shop',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('admin sets override=true with reason → success (trimmed reason)', () => {
    const r = validateForceOverrideInput({
      signedIn: true,
      isAdmin: true,
      shopId: 'shopX',
      override: true,
      reason: '  family testing  ',
    });
    expect(r).toEqual({
      ok: true,
      shopId: 'shopX',
      override: true,
      reason: 'family testing',
    });
  });

  test('admin sets override=true with empty reason → invalid-argument', () => {
    const r = validateForceOverrideInput({
      signedIn: true,
      isAdmin: true,
      shopId: 'shopX',
      override: true,
      reason: '   ',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('admin removes override (override=false) needs no reason → success', () => {
    const r = validateForceOverrideInput({
      signedIn: true,
      isAdmin: true,
      shopId: 'shopX',
      override: false,
    });
    expect(r).toEqual({ ok: true, shopId: 'shopX', override: false, reason: '' });
  });
});
