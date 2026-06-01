/**
 * PR-NEXT-6 (finding #13) — orchestrate the three-step delivery
 * proof upload. Mirrors the menu-image upload pattern from PR 6.1
 * + the KYC upload pattern from PR 31.
 *
 * Flow:
 *   1. Caller has already picked + resized the image via
 *      `pickAndResizeImage` (the same helper menu + KYC use). We
 *      receive a local file URI.
 *   2. Call `getDeliveryProofUploadUrl` to mint a v4 signed PUT.
 *      Server gates on assigned-partner + picked-up precondition.
 *   3. PUT the resized JPEG bytes to that URL with header
 *      `Content-Type: image/jpeg` (v4 signatures bind contentType,
 *      so the header MUST match exactly).
 *   4. Call `recordDeliveryProofUpload` to stamp the order doc.
 *      Server re-runs the auth gate + path-prefix check.
 *
 * Returns the storagePath so the caller can immediately request a
 * read URL for the just-uploaded photo (UI confirmation thumbnail
 * on the partner dashboard before the watcher tick brings the field
 * back from the order doc).
 *
 * Errors propagate verbatim — caller's catch handles toasts. We
 * deliberately do NOT swallow PUT failures; a half-successful
 * upload (URL minted, PUT failed) leaves the order doc unstamped
 * which is the correct end-state.
 */
import { orderService } from '../services/orderService';

export async function uploadDeliveryProof(input: {
  orderId: string;
  localUri: string;
}): Promise<{ storagePath: string }> {
  const { orderId, localUri } = input;

  const session = await orderService.getDeliveryProofUploadUrl(orderId);

  // RN's fetch() can read local file:// URIs and produce a Blob —
  // same pattern `uploadMenuImage` + the KYC uploader use. The
  // resulting blob's MIME is opaque on RN, but the explicit
  // `Content-Type: image/jpeg` header below binds the v4 signature.
  const blob = await (await fetch(localUri)).blob();
  const putResp = await fetch(session.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
  });
  if (!putResp.ok) {
    const errBody = await putResp.text().catch(() => '');
    throw new Error(
      `Upload failed (HTTP ${putResp.status}): ${errBody.slice(0, 200)}`,
    );
  }

  await orderService.recordDeliveryProofUpload({
    orderId,
    storagePath: session.storagePath,
  });
  return { storagePath: session.storagePath };
}
