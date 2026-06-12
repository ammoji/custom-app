/**
 * HOTFIX-PROFILE-PHOTO — DO NOT REMOVE. Construct a GCS public download
 * URL for a delivery partner profile photo. Replaces the broken inline
 * construction in DeliveryProfileScreen + BecomeDeliveryPartnerScreen
 * which used encodeURIComponent on the full path (encoding '/' as '%2F').
 *
 * GCS requires literal '/' path separators in the URL. We URL-encode
 * each path segment INDIVIDUALLY so a uid with unusual characters
 * (shouldn't happen — Firebase uids are URL-safe base64 — but
 * defense-in-depth) still produces a valid URL.
 *
 * Pure — pinned by tests/utils/buildPartnerPhotoDownloadUrl.test.ts.
 *
 * HOTFIX-PROFILE-PHOTO-3 (2026-06-10) — bucket name was previously
 * `grocery-mvp-dev.appspot.com` (the pre-April-2024 default Firebase
 * Storage bucket naming convention). This project was created under
 * the NEW naming convention `{project-id}.firebasestorage.app` — see
 * google-services.json and GoogleService-Info.plist `storage_bucket`
 * / `STORAGE_BUCKET` keys for the source of truth. Browser test of
 * the old URL returned `NoSuchBucket — The specified bucket does not
 * exist`; server uploads succeeded because the admin SDK's
 * `getStorage().bucket()` returns the REAL bucket name regardless of
 * what the client constructs. Same value is used in
 * src/mocks/products.ts and every other in-repo reference; this
 * helper was the lone outlier.
 */
const STORAGE_BUCKET = 'grocery-mvp-dev.firebasestorage.app';

/**
 * @deprecated HOTFIX-PROFILE-PHOTO-4 (2026-06-10). Constructs a GCS
 * direct URL (`storage.googleapis.com/...`) which bypasses Firebase
 * Storage Rules and requires bucket-level public IAM that would expose
 * /shop-kyc/ PII. Partner photo downloads now use the Firebase Storage
 * REST URL with an embedded download token, returned directly by
 * `getPartnerPhotoUploadUrl` (see functions/src/partnerPhotoUploadHelpers.ts).
 * Do NOT call this from production code. Tests stay to document the GCS
 * pattern in isolation; remove after one release cycle if no caller
 * surfaces.
 */
export function buildPartnerPhotoDownloadUrl(storagePath: string): string {
  const encoded = storagePath
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');
  return `https://storage.googleapis.com/${STORAGE_BUCKET}/${encoded}`;
}
