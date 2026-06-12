/**
 * HOTFIX-PROFILE-PHOTO-4 (2026-06-10) — pure helpers for the partner
 * profile-photo upload flow.
 *
 * Why this exists: partner photos previously downloaded via a GCS
 * direct URL (`storage.googleapis.com/{bucket}/{path}`) which bypasses
 * Firebase Storage Rules and requires bucket-level `allUsers` public
 * read — which would also expose the KYC PII under `/shop-kyc/`.
 *
 * The fix mirrors what shop storefront photos already do: serve the
 * photo via the Firebase Storage REST URL
 * (`firebasestorage.googleapis.com/v0/b/{bucket}/o/{encoded}?alt=media&token={uuid}`)
 * with a per-object download token embedded in object metadata. The
 * token is written at upload time by requiring the client PUT to echo
 * an `x-goog-meta-firebasestoragedownloadtokens` extension header that
 * the server baked into the v4 signed URL.
 *
 * Pure — no SDK, no I/O. Pinned by
 * tests/functions/partnerPhotoUploadHelpers.test.ts.
 */
import { buildFirebaseStorageDownloadUrl } from './approveShopHelpers';

// HOTFIX-PROFILE-PHOTO-4 — DO NOT REMOVE. The extension-header key the
// server bakes into the v4 signed URL and the client MUST echo on PUT.
// GCS lowercases metadata header keys; the canonical metadata field is
// `firebaseStorageDownloadTokens` but the wire header is all-lowercase.
export const PARTNER_PHOTO_TOKEN_HEADER =
  'x-goog-meta-firebasestoragedownloadtokens';

/**
 * Server-controlled storage path for a partner's profile photo.
 * One file per partner — re-upload overwrites both the bytes and the
 * embedded token. JPEG/PNG only.
 */
export function partnerPhotoStoragePath(
  uid: string,
  contentType: string,
): string {
  const ext = contentType === 'image/jpeg' ? 'jpg' : 'png';
  return `delivery-profile/${uid}.${ext}`;
}

export type PartnerPhotoUploadPlan = {
  storagePath: string;
  downloadUrl: string;
  downloadToken: string;
  extensionHeaders: Record<string, string>;
};

/**
 * Given the per-upload token + bucket name, build everything the
 * callable needs: the storage path, the Firebase Storage REST download
 * URL (with the token embedded), and the extension-header map that must
 * be both (a) signed into the v4 upload URL and (b) echoed by the
 * client PUT.
 */
export function buildPartnerPhotoUploadPlan(args: {
  uid: string;
  contentType: string;
  bucketName: string;
  token: string;
}): PartnerPhotoUploadPlan {
  const storagePath = partnerPhotoStoragePath(args.uid, args.contentType);
  const downloadUrl = buildFirebaseStorageDownloadUrl(
    args.bucketName,
    storagePath,
    args.token,
  );
  return {
    storagePath,
    downloadUrl,
    downloadToken: args.token,
    extensionHeaders: { [PARTNER_PHOTO_TOKEN_HEADER]: args.token },
  };
}
