/**
 * PR 36.2 — pure-helper tests for `scripts/reset-pilot-data.ts`.
 *
 * The destructive script is split into wiring (`reset-pilot-data.ts`)
 * and pure logic (`reset-pilot-data.helpers.ts`). This file pins the
 * blast-radius decisions in the helpers so a future "let me clean
 * up users too" patch can't slip through review.
 *
 * Mirrors the structure of `tests/scripts/reset-test-data.test.ts`.
 */
import {
  ALLOWED_PROJECTS,
  COLLECTIONS_TO_WIPE,
  PROTECTED_COLLECTIONS,
  STORAGE_PATHS_TO_WIPE,
  assertProjectAllowed,
  buildClaimsAfterRoleRevoke,
  parseFlags,
  planUserRoleCleanup,
} from '../../scripts/reset-pilot-data.helpers';

describe('reset-pilot-data — parseFlags', () => {
  test('default is dry-run with no other flags', () => {
    expect(parseFlags([])).toEqual({
      execute: false,
      yes: false,
      skipStorage: false,
      adminUid: null,
    });
  });

  test('--execute sets execute=true', () => {
    expect(parseFlags(['--execute']).execute).toBe(true);
  });

  test('--skip-storage sets skipStorage=true', () => {
    expect(parseFlags(['--skip-storage']).skipStorage).toBe(true);
  });

  test('--execute --yes --skip-storage sets all three', () => {
    const f = parseFlags(['--execute', '--yes', '--skip-storage']);
    expect(f.execute).toBe(true);
    expect(f.yes).toBe(true);
    expect(f.skipStorage).toBe(true);
  });

  test('--admin-uid=<uid> populates adminUid', () => {
    expect(parseFlags(['--admin-uid=abc123']).adminUid).toBe('abc123');
  });

  test('--admin-uid= without value throws', () => {
    expect(() => parseFlags(['--admin-uid='])).toThrow(/requires a value/);
  });

  test('unknown flag throws', () => {
    expect(() => parseFlags(['--exec'])).toThrow(/Unknown flag/);
  });

  test('--yes without --execute throws', () => {
    expect(() => parseFlags(['--yes'])).toThrow(
      /--yes requires --execute/,
    );
  });
});

describe('reset-pilot-data — COLLECTIONS_TO_WIPE', () => {
  test('does NOT include users (load-bearing exclusion)', () => {
    expect(COLLECTIONS_TO_WIPE).not.toContain('users');
  });

  test('does NOT include aiFeatures (kill-switch docs preserved)', () => {
    expect(COLLECTIONS_TO_WIPE).not.toContain('aiFeatures');
  });

  test('PROTECTED_COLLECTIONS is exactly the non-wipe set', () => {
    expect([...PROTECTED_COLLECTIONS].sort()).toEqual([
      'aiFeatures',
      'users',
    ]);
  });

  test('contains the expected high-volume collections', () => {
    for (const c of [
      'orders',
      'shops',
      'products',
      'refunds',
      'pendingShopRequests',
      'deliveryRequests',
      'razorpayWebhookEvents',
      'auditLog',
      'aiAuditLog',
      'aiQuotas',
      'featureUsageLog',
    ]) {
      expect(COLLECTIONS_TO_WIPE).toContain(c);
    }
  });

  test('STORAGE_PATHS_TO_WIPE covers KYC + menu uploads', () => {
    expect([...STORAGE_PATHS_TO_WIPE].sort()).toEqual([
      'menu/',
      'shop-kyc/',
    ]);
  });
});

describe('reset-pilot-data — planUserRoleCleanup', () => {
  test('throws if adminUid is empty', () => {
    expect(() => planUserRoleCleanup([], '')).toThrow(
      /adminUid required/,
    );
  });

  test('excludes the admin uid even if they have role flags', () => {
    const r = planUserRoleCleanup(
      [
        { uid: 'admin', isShopOwner: true, shopId: 'shop_xxx' },
        { uid: 'user1', isShopOwner: true, shopId: 'shop_yyy' },
      ],
      'admin',
    );
    expect(r.uidsToClean).toEqual(['user1']);
  });

  test('includes users with isShopOwner=true', () => {
    const r = planUserRoleCleanup(
      [{ uid: 'u1', isShopOwner: true }],
      'admin',
    );
    expect(r.uidsToClean).toEqual(['u1']);
  });

  test('includes users with isDelivery=true', () => {
    const r = planUserRoleCleanup(
      [{ uid: 'u2', isDelivery: true }],
      'admin',
    );
    expect(r.uidsToClean).toEqual(['u2']);
  });

  test('includes users with non-empty shopId even without role flag', () => {
    const r = planUserRoleCleanup(
      [{ uid: 'u3', shopId: 'shop_zzz' }],
      'admin',
    );
    expect(r.uidsToClean).toEqual(['u3']);
  });

  test('excludes users with no role fields set', () => {
    const r = planUserRoleCleanup([{ uid: 'u4' }], 'admin');
    expect(r.uidsToClean).toEqual([]);
  });

  test('excludes users with shopId=null', () => {
    const r = planUserRoleCleanup(
      [{ uid: 'u5', shopId: null }],
      'admin',
    );
    expect(r.uidsToClean).toEqual([]);
  });

  test('fieldsToRemove returns the canonical 4-tuple', () => {
    const r = planUserRoleCleanup([], 'admin');
    expect(r.fieldsToRemove).toEqual([
      'isShopOwner',
      'isDelivery',
      'shopId',
      'favorites',
    ]);
  });
});

describe('reset-pilot-data — buildClaimsAfterRoleRevoke', () => {
  test('preserves admin=true', () => {
    expect(
      buildClaimsAfterRoleRevoke({ admin: true, shopOwner: true }),
    ).toEqual({ admin: true });
  });

  test('drops shopOwner / shopId / delivery', () => {
    expect(
      buildClaimsAfterRoleRevoke({
        shopOwner: true,
        shopId: 'shop_xyz',
        delivery: true,
      }),
    ).toEqual({});
  });

  test('handles null / undefined input', () => {
    expect(buildClaimsAfterRoleRevoke(null)).toEqual({});
    expect(buildClaimsAfterRoleRevoke(undefined)).toEqual({});
  });

  test('does NOT promote admin if the original claim was missing', () => {
    expect(buildClaimsAfterRoleRevoke({ shopOwner: true })).toEqual({});
  });
});

describe('reset-pilot-data — allowlist reuse', () => {
  test('ALLOWED_PROJECTS re-export matches reset-test-data', () => {
    expect([...ALLOWED_PROJECTS]).toEqual(['grocery-mvp-dev']);
  });

  test('assertProjectAllowed accepts grocery-mvp-dev', () => {
    expect(() => assertProjectAllowed('grocery-mvp-dev')).not.toThrow();
  });

  test('assertProjectAllowed throws for non-allowed project', () => {
    expect(() => assertProjectAllowed('grocery-mvp-prod')).toThrow(
      /REFUSING TO RUN/,
    );
  });
});
