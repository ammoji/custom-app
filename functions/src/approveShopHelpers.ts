/**
 * PR 42 — Pure helpers for the `approveShop` callable's storefront
 * photo wiring step.
 *
 * `approveShop` reads the storefront upload's storage path off
 * the pending shop doc, mints a v4 signed read URL, and writes
 * that URL to `shops/{shopId}.imageUrl` so the customer-facing
 * shop card can render the actual photo. Pre-PR-42 the URL never
 * landed on the doc and customers saw the 🏪 placeholder for
 * every newly-registered shop.
 *
 * **Path-on-doc correction vs. the prompt:** the PR 42 prompt
 * said `pendingData?.kycDocs?.storefront?.storagePath`. Wrong —
 * KYC docs are stamped onto the SAME `shops/{shopId}` doc by
 * `recordShopKycUpload` at
 * `registrationData.kycDocs.{kind}.storagePath` (verified at
 * `functions/src/index.ts:~1631`). There is no separate
 * `pendingData` collection or sub-doc. The helper below pins
 * the right path.
 *
 * Pure helpers + IO split (same posture as
 * `pendingCountsHelpers`): the helper takes a plain
 * shop-doc-like object and returns the path, leaving the
 * actual signed-URL minting to the callable. That keeps
 * extraction logic unit-testable without firebase-admin.
 */

export type ShopDocLike = {
  registrationData?: {
    kycDocs?: {
      storefront?: { storagePath?: unknown } | null;
      // Other doc kinds are present on real shop docs (gstDoc,
      // fssaiDoc, ownerIdDoc) but we don't read them here. Typed
      // loose to avoid coupling to the full DocKind enum.
      [k: string]: unknown;
    };
  };
};

/**
 * Extract the storefront photo's storage path from the shop doc,
 * or null if it's missing/malformed. Returns null (not undefined,
 * not throw) so the caller can use a single `if (path)` gate.
 *
 * Defends against three real shapes seen in the wild:
 *   - Pre-PR-31 shops with no `registrationData` at all (`{}`).
 *   - Mid-registration shops where `kycDocs` exists but
 *     `storefront` was never uploaded (admin can still approve
 *     a shop based on free-text GST/FSSAI numbers per the
 *     RegisterShop step-2 contract — though PR 42 client side
 *     now blocks finish without storefront, the SERVER must
 *     still tolerate legacy/imperfect uploads).
 *   - Forged or partial KYC payloads where `storefront` exists
 *     but `storagePath` is empty / non-string.
 */
export function pickStorefrontPath(shop: ShopDocLike): string | null {
  const ref = shop?.registrationData?.kycDocs?.storefront;
  if (!ref || typeof ref !== 'object') return null;
  const path = (ref as { storagePath?: unknown }).storagePath;
  if (typeof path !== 'string' || path.length === 0) return null;
  return path;
}

/**
 * PR 42.0.1 — hotfix. The original PR 42 minted a V4 signed URL
 * with a 10-year expiry (`STOREFRONT_SIGNED_URL_TTL_MS`). That
 * exploded at runtime — V4 signed URLs have a HARD CAP of 7
 * days (604800 seconds) baked into the GCS signer:
 *
 *   `Error: Max allowed expiration is seven days (604800 seconds).`
 *
 * The 7-day cap is by spec, not configurable. Three options
 * existed:
 *
 *   (a) Drop expiry to 7 days and re-sign weekly via a cron.
 *       Bad UX (URL churn) + adds infra complexity for a static
 *       shop photo that never changes.
 *   (b) Switch to V2 signing. No 7-day cap historically, but
 *       deprecated by Google + uses a different signing surface.
 *   (c) Use Firebase Storage's download-token URL pattern —
 *       set `firebaseStorageDownloadTokens` metadata to a fresh
 *       UUID, then construct a permanent token URL of the form
 *       `https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{path}?alt=media&token={uuid}`.
 *       This is the canonical "I want a public-ish URL for an
 *       admin-uploaded file" path on Firebase and is exactly how
 *       the Firebase client SDK's `getDownloadURL()` builds URLs.
 *       No expiry, no cron, no V4 cap.
 *
 * (c) wins. Storefront photos are non-sensitive shop branding
 * meant to render on every customer's shop list — signed URLs
 * were the wrong tool entirely. The token URL is a shared
 * secret embedded in the URL, which is appropriate for an asset
 * that's already meant to be publicly displayed.
 *
 * Below: a pure URL-builder helper for unit-testability. The
 * metadata write that actually grants public read still lives
 * in the callable since it needs the GCS bucket handle.
 */
export function buildFirebaseStorageDownloadUrl(
  bucketName: string,
  objectPath: string,
  token: string,
): string {
  // `bucketName` MUST be the raw GCS bucket name (no `gs://` prefix,
  // no `/` suffix). Caller passes `bucket.name` straight from the
  // admin SDK so this is the natural shape.
  //
  // `objectPath` MUST be encoded so slashes and special characters
  // in the storage key survive transport. Firebase's REST API
  // expects `encodeURIComponent` (slashes become `%2F`) — same
  // encoding the client SDK uses.
  const encodedPath = encodeURIComponent(objectPath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${token}`;
}
