/**
 * Unit tests for `validateGetUploadUrlInput`.
 *
 * Pins the PR 6.1 signed-URL upload authorization policy. Deliberate-
 * break demo target: replace the helper body with `return { ok: true,
 * shopId: '', filename: '', storagePath: '' }` — the
 * "rejects unauthenticated callers" test goes red; that's the
 * canonical auth gate.
 */
import { validateGetUploadUrlInput } from '../../functions/src/menuImageUploadHelpers';

const FROZEN_NOW = 1_700_000_000_000;
const FROZEN_RAND = () => 'abc123';

describe('validateGetUploadUrlInput — auth gate', () => {
  test('rejects unauthenticated callers (null auth)', () => {
    const r = validateGetUploadUrlInput(
      { auth: null },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  test('rejects undefined auth', () => {
    const r = validateGetUploadUrlInput(
      { auth: undefined },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  test('rejects auth with empty uid', () => {
    const r = validateGetUploadUrlInput(
      { auth: { uid: '', token: { shopOwner: true, shopId: 'shop_1' } } },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });
});

describe('validateGetUploadUrlInput — shopOwner claim gate', () => {
  test('rejects authenticated callers with no claims (admin-less customer)', () => {
    const r = validateGetUploadUrlInput(
      { auth: { uid: 'u1', token: {} } },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('permission-denied');
      expect(r.message).toMatch(/shop owners/i);
    }
  });

  test('rejects shopOwner claim that is not literally === true (string "true")', () => {
    // Strict equality matters: a forged token might smuggle truthy
    // strings; we reject anything but boolean true.
    const r = validateGetUploadUrlInput(
      {
        auth: {
          uid: 'u1',
          token: { shopOwner: 'true', shopId: 'shop_1' },
        },
      },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('rejects shopOwner claim that is number 1', () => {
    const r = validateGetUploadUrlInput(
      {
        auth: { uid: 'u1', token: { shopOwner: 1, shopId: 'shop_1' } },
      },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('rejects shopOwner=false explicitly', () => {
    const r = validateGetUploadUrlInput(
      {
        auth: {
          uid: 'u1',
          token: { shopOwner: false, shopId: 'shop_1' },
        },
      },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });
});

describe('validateGetUploadUrlInput — shopId gate', () => {
  test('rejects shopOwner=true with missing shopId', () => {
    const r = validateGetUploadUrlInput(
      { auth: { uid: 'u1', token: { shopOwner: true } } },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('permission-denied');
      expect(r.message).toMatch(/shopId/i);
    }
  });

  test('rejects non-string shopId (number)', () => {
    const r = validateGetUploadUrlInput(
      {
        auth: { uid: 'u1', token: { shopOwner: true, shopId: 42 } },
      },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('rejects empty-string shopId', () => {
    const r = validateGetUploadUrlInput(
      {
        auth: { uid: 'u1', token: { shopOwner: true, shopId: '' } },
      },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });
});

describe('validateGetUploadUrlInput — happy path (canonical guard)', () => {
  test('returns deterministic storage path for a valid shop owner', () => {
    const r = validateGetUploadUrlInput(
      {
        auth: {
          uid: 'u1',
          token: { shopOwner: true, shopId: 'shop_42' },
        },
      },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.shopId).toBe('shop_42');
      expect(r.filename).toBe('1700000000000_abc123.jpg');
      expect(r.storagePath).toBe('menu/shop_42/1700000000000_abc123.jpg');
    }
  });

  test('filename varies with rand fn (collision resistance)', () => {
    const r1 = validateGetUploadUrlInput(
      {
        auth: {
          uid: 'u1',
          token: { shopOwner: true, shopId: 'shop_42' },
        },
      },
      FROZEN_NOW,
      () => 'aaa111',
    );
    const r2 = validateGetUploadUrlInput(
      {
        auth: {
          uid: 'u1',
          token: { shopOwner: true, shopId: 'shop_42' },
        },
      },
      FROZEN_NOW,
      () => 'bbb222',
    );
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.filename).not.toBe(r2.filename);
    }
  });
});
