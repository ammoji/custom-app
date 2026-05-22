/**
 * PR 31 — pure helpers for the `getShopKycUploadUrl` callable.
 *
 * Mirrors `menuImageUploadHelpers.ts` (PR 6.1): server mints a v4
 * signed PUT URL for a controlled bucket path. The client uploads
 * directly to that URL; the server never receives the bytes.
 *
 * Authorization gate (stricter than menu-image upload):
 *   - Caller must be authenticated.
 *   - Caller must own the target shop (shop.ownerUid === auth.uid).
 *   - The shop must currently be in `status: 'pending'`. Once
 *     approved / rejected / suspended, KYC docs are frozen — a
 *     re-upload would let an owner swap evidence post-KYC. A future
 *     PR can add an admin-requested re-upload window for rejected
 *     shops.
 *
 * Why claim-based gating doesn't fit here (unlike menu uploads):
 * pending shops have NOT yet had the `shopOwner` custom claim
 * minted onto their auth token (that happens in `approveShop`).
 * So the gate is "are you the document-owner of a pending shop"
 * via Firestore lookup, not "does your token carry shopOwner=true".
 *
 * Filename is server-generated. Format:
 *   shop-kyc/{shopId}/{kind}_{timestamp}_{rand6}.jpg
 *
 * Strict equality on the docKind whitelist defends against forged
 * payloads — a typo in client code (e.g. 'storefrontPic') is
 * rejected as `invalid-argument` rather than silently writing under
 * an unindexed path.
 *
 * `now` and `rand` are injected so the helper is deterministic
 * under test — same posture as the menu-image-upload, deliveryFlags,
 * and adminStats helpers.
 *
 * Pinned by `tests/functions/kycUploadHelpers.test.ts`.
 */

export const VALID_DOC_KINDS = [
  'storefront',
  'gstDoc',
  'fssaiDoc',
  'ownerIdDoc',
] as const;

export type DocKind = (typeof VALID_DOC_KINDS)[number];

export type GetKycUploadUrlInput = {
  auth: { uid: string } | null | undefined;
  shopId: string | undefined;
  docKind: string | undefined;
  shop:
    | {
        ownerUid?: string;
        status?: string;
      }
    | null;
};

export type GetKycUploadUrlResult =
  | {
      ok: true;
      shopId: string;
      docKind: DocKind;
      filename: string;
      storagePath: string;
    }
  | {
      ok: false;
      code:
        | 'unauthenticated'
        | 'invalid-argument'
        | 'permission-denied'
        | 'failed-precondition'
        | 'not-found';
      message: string;
    };

export function validateGetKycUploadUrlInput(
  input: GetKycUploadUrlInput,
  now: number,
  rand: () => string,
): GetKycUploadUrlResult {
  const { auth, shopId, docKind, shop } = input;

  if (!auth || typeof auth.uid !== 'string' || auth.uid.length === 0) {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    };
  }
  if (!shopId || typeof shopId !== 'string') {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'shopId required',
    };
  }
  if (!docKind || !VALID_DOC_KINDS.includes(docKind as DocKind)) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: `docKind must be one of: ${VALID_DOC_KINDS.join(', ')}`,
    };
  }
  if (!shop) {
    return { ok: false, code: 'not-found', message: 'Shop not found' };
  }
  if (shop.ownerUid !== auth.uid) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'You are not the owner of this shop',
    };
  }
  if (shop.status !== 'pending') {
    return {
      ok: false,
      code: 'failed-precondition',
      message: `KYC uploads are only allowed on pending shops (status is '${shop.status}')`,
    };
  }

  // Mirrors menu-image upload's `{ms}_{rand6}.jpg` shape, prefixed
  // with the slot kind so admin review can pick out one slot's
  // upload by name even before reading the shop doc.
  const filename = `${docKind}_${now}_${rand()}.jpg`;
  const storagePath = `shop-kyc/${shopId}/${filename}`;
  return {
    ok: true,
    shopId,
    docKind: docKind as DocKind,
    filename,
    storagePath,
  };
}
