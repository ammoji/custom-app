# PR 6.1 — Signed upload URL hotfix for menu images (Windsurf prompt)

## Why this PR exists

PR 6 shipped the image picker UI but uploads fail in TestFlight with
`Firebase Storage: User does not have permission to access
'menu/{shopId}/{filename}.jpg'. (storage/unauthorized)`.

The root cause is a cross-SDK auth-state mismatch baked into the
PR 6 design:

- On native, the app signs in via `@react-native-firebase/auth` (phone
  OTP). That session is held by the RNFB native module.
- PR 6's `uploadMenuImage` (see `src/services/storage.ts`) uses the
  Firebase **Web SDK**'s `storage` handle — deliberately, to avoid
  pulling in `@react-native-firebase/storage` (another native module
  → another EAS rebuild).
- The Web SDK and RNFB Auth have **separate auth sessions**. The Web
  SDK auth on native was never signed in, so it sends the upload
  request with `request.auth == null`.
- The `/menu/{shopId}/{filename}` Storage rule gates on
  `request.auth.token.shopOwner == true && request.auth.token.shopId
  == shopId` — by construction that can never pass when called from
  the Web SDK on native.

This is even foreshadowed in the `src/services/firebase.ts` header
comment:

> "native: still uses this web SDK for storage AND for Firestore
> reads of world-readable collections. **Those work cross-SDK because
> their security rules don't gate on `request.auth`.**"

PR 6 introduced the first auth-gated path that uses the cross-SDK
storage handle. It can't work. We need to either (a) move storage to
RNFB on native, (b) mirror auth state from RNFB into the Web SDK via
a custom token, or (c) sidestep Storage rules entirely with a
server-minted signed upload URL.

This PR takes option (c) because:

- **No new native module.** Pure JS client + new callable. Ships via
  OTA to the existing TestFlight build — no rebuild cycle, no
  fingerprint change. (The PR 6 native rebuild was painful enough.)
- **Server is the single source of truth on authorization.** The
  callable verifies `shopOwner` claim + `shopId` and only then mints a
  signed PUT URL. Storage rules collapse to "writes forbidden, reads
  public" — admin SDK signed URLs bypass rules, which is the
  documented Google Cloud Storage pattern.
- **Path is server-controlled.** Filename is generated server-side
  rather than client-side, eliminating a class of client-side bugs
  (path-traversal-style filename mischief, collisions across owners
  who share a millisecond, etc.).
- **No auth-state mirror to maintain.** Option (b) would require
  signing into the Web SDK auth after every RNFB sign-in, and clearing
  both on sign-out — easy to get wrong.

Scope is deliberately narrow: just the menu-image upload path. If a
future PR adds another auth-gated Storage path (delivery partner
profile photo, customer complaint screenshots), it reuses the same
pattern.

## Read first

- `.windsurf/test-discipline.md` and `.windsurf/deploy-discipline.md`.
- `src/services/storage.ts` — current `uploadMenuImage` that this PR
  replaces. Note the file header explaining why Web SDK was chosen;
  update it to reflect the new approach.
- `storage.rules` — `/menu/{shopId}/{filename}` rule that this PR
  collapses to write-deny.
- `functions/src/index.ts` — `addCustomMenuItem` and `updateMenuItem`
  callables for the role-check + claim-read pattern. The new callable
  uses the same posture.
- `functions/src/cancelPaidOrderHelpers.ts` — reference pattern for
  pure helper + discriminated `{ ok }` union return + tests-without-
  firebase-admin posture. Mirror this exactly.
- `src/services/orderService.ts` — the `retryPayment` method (~line
  171) is the closest pattern for a callable that returns data. Note
  the `if (isNative)` dispatch — match that.
- `src/screens/shop/AddCustomMenuItemScreen.tsx` and
  `src/screens/shop/ShopMenuItemEditScreen.tsx` — current call sites
  for `uploadMenuImage`. Should require **zero changes** if the
  function signature is preserved.
- `package.json` (`functions/package.json`) — confirm
  `firebase-admin` is on a version that supports `getSignedUrl({
  version: 'v4', action: 'write' })`. (Admin SDK v11+ does; we're on
  a recent version already.)

## Scope (in)

### Part 1 — Pure helper for the new callable

New file `functions/src/menuImageUploadHelpers.ts`:

```ts
/**
 * PR 6.1 — pure helpers for getMenuImageUploadUrl callable.
 *
 * Authorization model: caller MUST be a shop owner with a matching
 * shopId claim. Admins are NOT given a back-door upload path here —
 * if admin needs to manage menu images for a shop, they should do it
 * via the existing admin-managed product catalog (which uses service
 * account uploads), not by impersonating shop owners.
 *
 * Filename is generated here (not client-side) so the server controls
 * the storage path. The format mirrors the PR 6 client-side scheme:
 * `{timestamp}_{rand6}.jpg` for collision-resistance within a shop's
 * folder. The actual storage path is `menu/{shopId}/{filename}`.
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
  now: number, // injected for deterministic tests
  rand: () => string, // injected for deterministic tests
): GetUploadUrlResult {
  const { auth } = input;
  if (!auth?.uid) {
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
  // Mirror the PR 6 client-side filename scheme: {ms}_{rand6}.jpg.
  // 6-char base36 suffix + ms-precision timestamp = ~2^25 distinct
  // filenames per shop per millisecond — collisions are not a
  // practical concern.
  const filename = `${now}_${rand()}.jpg`;
  const storagePath = `menu/${shopId}/${filename}`;
  return { ok: true, shopId, filename, storagePath };
}
```

### Part 2 — Callable function `getMenuImageUploadUrl`

Add to `functions/src/index.ts`:

```ts
// PR 6.1 — Mint a signed PUT URL for a menu image upload. The
// signed URL bypasses Storage rules (admin SDK does the signing),
// so the Storage rule for /menu/ can stay closed to client writes.
// 15-minute URL validity is enough wall-clock for the client to
// resize + upload even on slow networks; short enough that a
// leaked URL goes stale before it can be abused at scale.
//
// Returns: { uploadUrl, downloadUrl, storagePath, expiresAt }.
// Client PUTs the resized JPEG bytes to uploadUrl with
// Content-Type: image/jpeg, then saves downloadUrl on the menu item.
//
// Why 'image/jpeg' is hard-coded into the signed URL's contentType:
// signed URLs in v4 bind the contentType into the signature, so the
// client MUST send the exact same header. We resize-to-JPEG client-
// side, so this is always correct.
export const getMenuImageUploadUrl = onCall(
  { region: 'asia-south1', enforceAppCheck: true },
  async request => {
    const auth = request.auth;
    const check = validateGetUploadUrlInput(
      {
        auth: auth
          ? {
              uid: auth.uid,
              token: auth.token as {
                shopOwner?: unknown;
                shopId?: unknown;
              },
            }
          : null,
      },
      Date.now(),
      () => Math.random().toString(36).slice(2, 8),
    );
    if (!check.ok) {
      throw new HttpsError(check.code as any, check.message);
    }
    const { storagePath } = check;

    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 min

    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: expiresAt,
      contentType: 'image/jpeg',
    });

    // Public download URL — the bucket is configured public-read on
    // the /menu/ prefix via Storage rules (read: if true), so this URL
    // works without a token. Format matches Firebase Storage's standard
    // public URL pattern.
    const downloadUrl =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}` +
      `/o/${encodeURIComponent(storagePath)}?alt=media`;

    return {
      uploadUrl,
      downloadUrl,
      storagePath,
      expiresAt,
    };
  },
);
```

Don't forget to `import { validateGetUploadUrlInput } from
'./menuImageUploadHelpers';` at the top of `index.ts`.

### Part 3 — Storage rule update

In `storage.rules`, change the `/menu/` rule to:

```
// PR 6.1 — Writes are now done via server-minted signed URLs
// (getMenuImageUploadUrl callable). Admin SDK bypasses these
// rules when signing, so we close client writes entirely. Reads
// stay public (anonymous customer browse paths render these).
match /menu/{shopId}/{filename} {
  allow read: if true;
  allow write: if false;
}
```

The `if false` is intentional and correct — the upload flow no longer
hits Storage rules at all.

### Part 4 — Client refactor `src/services/storage.ts`

Replace `uploadMenuImage` body. Function signature stays the same so
callers (`AddCustomMenuItemScreen`, `ShopMenuItemEditScreen`) need
zero changes.

```ts
/**
 * PR 6.1 — Signed upload URL flow.
 *
 * Previous implementation used the Firebase Web SDK's uploadBytes,
 * which failed on native with storage/unauthorized because the Web
 * SDK's auth state is separate from @react-native-firebase/auth (the
 * SDK that actually has the user signed in). See
 * docs/pr-6.1-signed-upload-url-hotfix-windsurf-prompt.md for the
 * full root-cause writeup.
 *
 * The new flow:
 *  1. Client calls getMenuImageUploadUrl callable (RNFB on native /
 *     Web SDK on web — dispatch in orderService).
 *  2. Server verifies shopOwner + shopId claim, mints a v4 signed
 *     PUT URL bound to a server-chosen path under menu/{shopId}/.
 *  3. Client PUTs the resized JPEG bytes to that URL.
 *  4. Returns the public download URL for saving on the menu item.
 *
 * Storage rule for /menu/ is now write-deny — the signed URL
 * bypasses rules entirely.
 */
import { orderService } from './orderService';

export async function uploadMenuImage(input: {
  shopId: string; // kept in signature for backwards-compat; server
                  // re-derives shopId from auth claims, this is
                  // ignored. Logged client-side for debugging only.
  localUri: string;
}): Promise<string> {
  const { localUri } = input;

  // Step 1: Get a signed upload URL from the server.
  const session = await orderService.getMenuImageUploadUrl();

  // Step 2: Fetch the local file as a Blob. Same fetch() pattern as
  // before — works on both web (blob:/data: URIs) and native (file://
  // URIs via RN's embedded fetch).
  const blob = await (await fetch(localUri)).blob();

  // Step 3: PUT to the signed URL. Content-Type MUST match what the
  // signed URL was minted with ('image/jpeg') — v4 signatures bind it.
  const putResp = await fetch(session.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
  });
  if (!putResp.ok) {
    // Surface the server's error text — typically a Google Cloud
    // Storage XML error that's customer-readable enough for an alert.
    const errBody = await putResp.text().catch(() => '');
    throw new Error(
      `Upload failed (HTTP ${putResp.status}): ${errBody.slice(0, 200)}`,
    );
  }

  // Step 4: Return the public download URL the server gave us.
  return session.downloadUrl;
}
```

**Important:** remove the `getDownloadURL`, `ref`, `uploadBytes`
imports and the `storage` import from this file — they're no longer
used. Lint will catch this if you miss any. **Do not** remove the
`uploadMenuImage` export or rename it — the call sites depend on it.

### Part 5 — Add `getMenuImageUploadUrl` to `orderService`

In `src/services/orderService.ts`, add a new method following the
`retryPayment` dispatch pattern exactly:

```ts
// PR 6.1 — Mint a signed PUT URL for a menu image upload. Server
// derives shopId from auth claims and the storage path it returns;
// client just blindly PUTs bytes to uploadUrl with content-type
// image/jpeg, then saves downloadUrl on the menu item.
async getMenuImageUploadUrl(): Promise<{
  uploadUrl: string;
  downloadUrl: string;
  storagePath: string;
  expiresAt: number;
}> {
  if (isNative) {
    const fn = getNativeFunctions().httpsCallable('getMenuImageUploadUrl');
    const result = await fn({});
    return result.data as any;
  }
  const fn = httpsCallable(functions, 'getMenuImageUploadUrl');
  const result = await fn({});
  return result.data as any;
},
```

Note: storage.ts imports `orderService` — confirm there's no circular
import. If `orderService.ts` already imports anything from
`storage.ts`, refactor to break the cycle (extract the callable
wrapper into a small `src/services/menuImageUpload.ts` and have
storage.ts import from there). Last time we checked, storage.ts only
imports from `./firebase`, so a fresh `import { orderService } from
'./orderService'` should be safe.

### Part 6 — Tests

New file `tests/functions/menuImageUploadHelpers.test.ts`:

```ts
import { describe, it, expect } from '@jest/globals';
import { validateGetUploadUrlInput } from '../../functions/src/menuImageUploadHelpers';

const FROZEN_NOW = 1_700_000_000_000;
const FROZEN_RAND = () => 'abc123';

describe('validateGetUploadUrlInput', () => {
  it('rejects unauthenticated callers', () => {
    const r = validateGetUploadUrlInput({ auth: null }, FROZEN_NOW, FROZEN_RAND);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  it('rejects authenticated callers without shopOwner claim', () => {
    const r = validateGetUploadUrlInput(
      { auth: { uid: 'u1', token: {} } },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  it('rejects shopOwner claim that is not literally === true', () => {
    const r = validateGetUploadUrlInput(
      { auth: { uid: 'u1', token: { shopOwner: 'true', shopId: 'shop_1' } } },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  it('rejects shopOwner with missing shopId', () => {
    const r = validateGetUploadUrlInput(
      { auth: { uid: 'u1', token: { shopOwner: true } } },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  it('rejects shopOwner with non-string shopId', () => {
    const r = validateGetUploadUrlInput(
      { auth: { uid: 'u1', token: { shopOwner: true, shopId: 42 } } },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  it('rejects shopOwner with empty-string shopId', () => {
    const r = validateGetUploadUrlInput(
      { auth: { uid: 'u1', token: { shopOwner: true, shopId: '' } } },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  it('returns a deterministic storage path for a valid shop owner', () => {
    const r = validateGetUploadUrlInput(
      {
        auth: { uid: 'u1', token: { shopOwner: true, shopId: 'shop_42' } },
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
});
```

Run once at the end (per test-discipline.md), no in-loop test running.

### Part 7 — Update `firebase.ts` comment

The file header comment in `src/services/firebase.ts` should no
longer claim the Web SDK is used for storage. Update the lines that
say "native: still uses this web SDK for storage..." to reflect that
menu image uploads now go through `getMenuImageUploadUrl` (signed
URL) and Web SDK storage is only used as the holder of the
`storage` export for any code path that may still use it on web.

## Scope (out)

- **Image deletion / orphan cleanup.** Same as PR 6: orphaned old
  images in Storage on edit are left for a deferred cleanup chore.
- **Bandwidth metering / rate limiting** of the callable. App Check
  is enforced (`enforceAppCheck: true`); if abuse becomes a real
  problem, add Cloud Functions rate-limit middleware in a future PR.
- **Resumable uploads.** Single PUT is fine for ≤500 KB JPEGs at the
  current resize spec; resumable uploads add complexity that
  isn't justified.
- **Admin-impersonates-shop upload path.** If admin needs to upload
  on behalf of a shop, that's a separate flow with separate auth
  posture; not in this PR.

## Acceptance checklist

- [ ] `functions/src/menuImageUploadHelpers.ts` created with
  `validateGetUploadUrlInput` matching the spec.
- [ ] `tests/functions/menuImageUploadHelpers.test.ts` created with
  ≥7 cases, all passing.
- [ ] `getMenuImageUploadUrl` callable added to
  `functions/src/index.ts`. Uses helper for validation. Returns
  `{ uploadUrl, downloadUrl, storagePath, expiresAt }`.
- [ ] `storage.rules` updated: `/menu/{shopId}/{filename}` write
  rule is `if false`. Read stays `if true`.
- [ ] `src/services/storage.ts` rewritten to call the new callable
  and PUT to the signed URL. Old Web SDK imports removed. Function
  signature unchanged.
- [ ] `src/services/orderService.ts` has new
  `getMenuImageUploadUrl` method with native/web dispatch matching
  the `retryPayment` pattern.
- [ ] `src/services/firebase.ts` header comment updated to remove
  the "storage uses Web SDK on native" claim or to qualify it.
- [ ] `npx tsc --noEmit` baseline unchanged (still 10 known errors
  — see PRELAUNCH_CHECKLIST). No new tsc errors.
- [ ] `npm test` all pass.
- [ ] Deliberate-break demo: change `validateGetUploadUrlInput` to
  always return `{ ok: true, ... }`, confirm a test fails, then
  revert.

## Smoke tests (manual, after deploy)

Run **after** Part 1 deploys (storage rules + function) but
**before** the OTA goes out. Then again after OTA.

1. **As shop owner, add a custom menu item with a gallery photo:**
   open AddCustomMenuItem → Gallery → pick a photo → save. Expect:
   item appears in the menu list with the photo rendered correctly.
   No "permission denied" alert.
2. **As shop owner, take a photo:** AddCustomMenuItem → Take photo
   → snap → save. Same expectation.
3. **As shop owner, edit an existing menu item's photo:** open
   ShopMenuItemEdit → Gallery → pick a different photo → save.
   Expect: item's image updates in the list.
4. **As customer, browse a shop that has a freshly uploaded
   image:** open ShopDetailScreen → confirm the new image renders.
   (Validates that public-read URL works.)
5. **Negative test — admin trying to upload:** sign in as admin (no
   `shopOwner` claim) → try to call the callable directly via the
   Firebase console → expect `permission-denied`. (Can also assert
   this in a unit test if convenient.)

## Deploy steps

Follow `.windsurf/deploy-discipline.md`: one `--only` target per
command, no pipes, no `&&` chains.

1. `cd functions && npm run build` — confirm clean build.
2. `firebase deploy --only storage` — push the updated `/menu/` rule
   (write deny).
3. `firebase deploy --only functions:getMenuImageUploadUrl` — push
   the new callable.
4. `cd ..` and run `npm test` once more — final confirmation.
5. `eas update --branch preview` — push the client (storage.ts +
   orderService.ts) for testing.
6. Smoke-test on phone (TestFlight pointing at preview channel).
7. `eas update --branch production` — promote to production once
   smoke tests pass.

**Order matters.** Step 2 (storage rule) must land before step 3
(callable) only matters if the rule was previously allowing writes —
since we're tightening it, either order is safe. Step 3 (callable)
must land before step 5 (client OTA), because the OTA'd client calls
the new function. If the callable isn't deployed, the client errors
with "not found".

## Estimated time

~1 hour Windsurf work (helper + callable + storage rule + client
refactor + tests). Compare to PR 6's ~4 hours — this is much
narrower scope, and most of the patterns (helper, callable wiring,
dispatch) already exist in the codebase.

No native module changes → no EAS rebuild → ships as OTA to existing
TestFlight build. Should be in customers' hands within 2 hours of
starting.
