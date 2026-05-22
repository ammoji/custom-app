/**
 * PR 31 — tests for `validateGetKycUploadUrlInput`.
 *
 * Pin every authorization branch so a regression in the upload
 * gate fails loudly rather than silently widening write access.
 * Same precedent as `menuImageUploadHelpers.test.ts`.
 */
import {
  validateGetKycUploadUrlInput,
  VALID_DOC_KINDS,
} from '../../functions/src/kycUploadHelpers';

const NOW = 1_700_000_000_000;
const rand = () => 'abc123';

describe('PR 31 — validateGetKycUploadUrlInput', () => {
  const baseShop = { ownerUid: 'user-1', status: 'pending' };

  test('rejects unauthenticated caller', () => {
    const r = validateGetKycUploadUrlInput(
      { auth: null, shopId: 's1', docKind: 'storefront', shop: baseShop },
      NOW,
      rand,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  test('rejects missing shopId', () => {
    const r = validateGetKycUploadUrlInput(
      {
        auth: { uid: 'user-1' },
        shopId: undefined,
        docKind: 'storefront',
        shop: baseShop,
      },
      NOW,
      rand,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('rejects unknown docKind', () => {
    const r = validateGetKycUploadUrlInput(
      {
        auth: { uid: 'user-1' },
        shopId: 's1',
        docKind: 'passport',
        shop: baseShop,
      },
      NOW,
      rand,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('rejects when the shop document is missing', () => {
    const r = validateGetKycUploadUrlInput(
      {
        auth: { uid: 'user-1' },
        shopId: 's-missing',
        docKind: 'storefront',
        shop: null,
      },
      NOW,
      rand,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not-found');
  });

  test('rejects caller who does not own the shop', () => {
    const r = validateGetKycUploadUrlInput(
      {
        auth: { uid: 'user-2' },
        shopId: 's1',
        docKind: 'storefront',
        shop: { ownerUid: 'user-1', status: 'pending' },
      },
      NOW,
      rand,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('rejects upload on non-pending shop (frozen post-approval)', () => {
    const r = validateGetKycUploadUrlInput(
      {
        auth: { uid: 'user-1' },
        shopId: 's1',
        docKind: 'storefront',
        shop: { ownerUid: 'user-1', status: 'active' },
      },
      NOW,
      rand,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('failed-precondition');
  });

  test('happy path returns ok + server-controlled filename', () => {
    const r = validateGetKycUploadUrlInput(
      {
        auth: { uid: 'user-1' },
        shopId: 's1',
        docKind: 'gstDoc',
        shop: baseShop,
      },
      NOW,
      rand,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.shopId).toBe('s1');
      expect(r.docKind).toBe('gstDoc');
      expect(r.filename).toBe(`gstDoc_${NOW}_abc123.jpg`);
      expect(r.storagePath).toBe(`shop-kyc/s1/gstDoc_${NOW}_abc123.jpg`);
    }
  });

  test('VALID_DOC_KINDS exposes the 4 expected kinds', () => {
    expect([...VALID_DOC_KINDS].sort()).toEqual(
      ['fssaiDoc', 'gstDoc', 'ownerIdDoc', 'storefront'].sort(),
    );
  });
});
