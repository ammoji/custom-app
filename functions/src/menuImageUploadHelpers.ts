/**
 * PR 6.1 — pure helpers for getMenuImageUploadUrl callable.
 *
 * Background: PR 6 uploaded menu images via the Firebase Web SDK's
 * `uploadBytes`. On native, that fails with `storage/unauthorized`
 * because the Web SDK and `@react-native-firebase/auth` keep
 * separate auth sessions — the Web SDK sees `request.auth == null`
 * even though the user is signed in via RNFB phone OTP. See
 * `docs/pr-6.1-signed-upload-url-hotfix-windsurf-prompt.md`.
 *
 * Fix: server mints a v4 signed PUT URL. The admin SDK bypasses
 * Storage rules at signing time, so the rule for `/menu/` can
 * collapse to write-deny and the cross-SDK auth mismatch becomes
 * irrelevant.
 *
 * Authorization model: caller MUST be a shop owner with a matching
 * `shopId` claim. Admins do NOT get a back-door here — if admin
 * needs to manage menu images on behalf of a shop, that should be
 * a separate flow with separate auth posture.
 *
 * Filename is generated here (not client-side) so the server
 * controls the storage path. Format mirrors the PR 6 client-side
 * scheme: `{timestamp}_{rand6}.jpg`, collision-resistant within a
 * shop's folder.
 *
 * `now` and `rand` are injected so the helper is deterministic
 * under test — same posture as the formatRelativeDeliveryTime and
 * adminStats helpers.
 *
 * Strict equality on `shopOwner === true` is deliberate: a string
 * 'true' or number 1 in the claim (which would never come from
 * `setCustomUserClaims`, but might arrive via a forged token in a
 * defense-in-depth scenario) gets rejected. Same posture as the
 * other claim-gated helpers in this codebase.
 *
 * Pinned by tests/functions/menuImageUploadHelpers.test.ts.
 */

export type GetUploadUrlInput = {
  auth:
    | {
        uid: string;
        token?: {
          shopOwner?: unknown;
          shopId?: unknown;
        };
      }
    | null
    | undefined;
};

export type GetUploadUrlResult =
  | {
      ok: true;
      shopId: string;
      filename: string;
      storagePath: string;
    }
  | {
      ok: false;
      code: 'unauthenticated' | 'permission-denied';
      message: string;
    };

export function validateGetUploadUrlInput(
  input: GetUploadUrlInput,
  now: number,
  rand: () => string,
): GetUploadUrlResult {
  const { auth } = input;
  if (!auth || typeof auth.uid !== 'string' || auth.uid.length === 0) {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    };
  }
  if (auth.token?.shopOwner !== true) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Only shop owners can upload menu images',
    };
  }
  const shopId = auth.token?.shopId;
  if (typeof shopId !== 'string' || shopId.length === 0) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Shop owner claim is missing shopId',
    };
  }
  // Mirror PR 6's client-side filename scheme: `{ms}_{rand6}.jpg`.
  // 6-char base36 suffix at ms granularity = ~2^25 distinct names
  // per shop per ms — collisions are not a practical concern.
  const filename = `${now}_${rand()}.jpg`;
  const storagePath = `menu/${shopId}/${filename}`;
  return { ok: true, shopId, filename, storagePath };
}
