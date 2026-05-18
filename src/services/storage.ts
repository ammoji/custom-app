/**
 * PR 6.1 — Signed upload URL flow.
 *
 * Previous PR 6 implementation used the Firebase Web SDK's
 * `uploadBytes`, which failed on native with `storage/unauthorized`.
 * Root cause: the Web SDK's auth state is separate from
 * `@react-native-firebase/auth` (which actually has the user signed
 * in via phone OTP). The Web SDK sent the upload with
 * `request.auth == null`, so the `/menu/{shopId}/{filename}` Storage
 * rule's claim check could never pass. See
 * `docs/pr-6.1-signed-upload-url-hotfix-windsurf-prompt.md` for the
 * full root-cause writeup.
 *
 * The new flow:
 *   1. Client calls the `getMenuImageUploadUrl` callable
 *      (RNFB on native, Web SDK on web — dispatch in orderService).
 *   2. Server verifies the shopOwner claim + matching shopId, then
 *      mints a v4 signed PUT URL bound to a server-chosen path
 *      under `menu/{shopId}/`.
 *   3. Client PUTs the resized JPEG bytes to that URL with header
 *      `Content-Type: image/jpeg` (must match exactly — v4
 *      signatures bind contentType).
 *   4. Returns the public download URL for saving on the menu item.
 *
 * Storage rule for `/menu/` is now write-deny — the signed URL
 * bypasses Storage rules entirely (admin SDK does the signing,
 * which GCS honours without rule evaluation).
 *
 * Function signature is unchanged from PR 6 so call sites
 * (`AddCustomMenuItemScreen`, `ShopMenuItemEditScreen`) need zero
 * edits. The `shopId` arg is kept for source-level compatibility
 * but is ignored — the server re-derives it from auth claims.
 */
import { orderService } from './orderService';

export async function uploadMenuImage(input: {
  // Kept in signature for backwards-compat with PR 6 call sites.
  // The server re-derives shopId from auth claims (it's the only
  // safe source); this client-side value is ignored. Documented as
  // such here so a future caller doesn't try to "spoof" by passing
  // a different shopId.
  shopId: string;
  localUri: string;
}): Promise<string> {
  const { localUri } = input;

  // Step 1: Get a signed upload URL from the server. The callable
  // throws unauthenticated / permission-denied if the caller isn't
  // a shop owner with a matching shopId claim.
  const session = await orderService.getMenuImageUploadUrl();

  // Step 2: Fetch the local URI as a Blob. Same fetch() pattern as
  // PR 6 — works on both web (blob:/data: URIs) and native (file://
  // URIs via RN's embedded fetch). expo-image-manipulator returns a
  // file:// URI on both platforms post-resize, so a single
  // `fetch().then(r => r.blob())` is the right shape everywhere.
  const blob = await (await fetch(localUri)).blob();

  // Step 3: PUT to the signed URL. Content-Type MUST be exactly
  // 'image/jpeg' — v4 signatures bind contentType, so any mismatch
  // gives a signature-mismatch error from GCS.
  const putResp = await fetch(session.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
  });
  if (!putResp.ok) {
    // Surface the server's error body — typically a Google Cloud
    // Storage XML payload that's customer-readable enough for an
    // Alert. We truncate to 200 chars so the toast isn't huge.
    const errBody = await putResp.text().catch(() => '');
    throw new Error(
      `Upload failed (HTTP ${putResp.status}): ${errBody.slice(0, 200)}`,
    );
  }

  // Step 4: Return the public download URL the server gave us.
  // Storage rule for `/menu/` is `read: if true`, so this URL works
  // without an auth token.
  return session.downloadUrl;
}
