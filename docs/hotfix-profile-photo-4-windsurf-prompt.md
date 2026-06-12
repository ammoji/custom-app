# HOTFIX-PROFILE-PHOTO-4 — Switch partner photo download to Firebase Storage REST URL

**Source:** Live testing after HOTFIX-PROFILE-PHOTO + HOTFIX-PROFILE-PHOTO-2 (storage.rules) + HOTFIX-PROFILE-PHOTO-3 (bucket name) all shipped. Photo still doesn't display. Browser test of the current URL returns:

```
<Error>
  <Code>AccessDenied</Code>
  <Message>Access denied.</Message>
  <Details>Anonymous caller does not have storage.objects.get access to the Google Cloud Storage object…</Details>
</Error>
```

**Deploy class:** **server-first.** Modify 1 callable (`getPartnerPhotoUploadUrl`) + IAM verify; small client change to PUT with new metadata header + use server-returned download URL. Client OTA after.

## Root cause (verified by Claude before this prompt)

Two URL strategies exist in this codebase. They look interchangeable but use completely different APIs and access-control systems:

| URL format | API | Access control source |
| --- | --- | --- |
| `storage.googleapis.com/{bucket}/{path}` | GCS direct REST | GCS IAM (per-object ACL + bucket-level IAM) |
| `firebasestorage.googleapis.com/v0/b/{bucket}/o/{encoded}?alt=media&token={uuid}` | Firebase Storage REST | Firebase Storage Rules + per-object download token in metadata |

**Shop storefront photos work** because they use `buildFirebaseStorageDownloadUrl` (Firebase Storage REST). **Partner photos don't work** because `buildPartnerPhotoDownloadUrl` returns the GCS direct URL which bypasses Firebase Storage Rules entirely.

Bucket-level public read (`roles/storage.objectViewer` to `allUsers`) is **NOT a viable fix** because it would also expose every KYC PII document in `/shop-kyc/`. Per-object `makePublic()` is **NOT viable** if the bucket uses Uniform Bucket-Level Access (likely on this Firebase Storage bucket).

The correct fix is to mirror what `buildFirebaseStorageDownloadUrl` already does for storefront photos: serve via Firebase Storage REST URL with an embedded `firebaseStorageDownloadTokens` metadata token.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root AND `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `cd functions && npm run build`
- File edits to:
  - `functions/src/index.ts` (only the `getPartnerPhotoUploadUrl` block at line ~2104)
  - `src/utils/buildPartnerPhotoDownloadUrl.ts` (deprecate or repurpose)
  - `src/screens/delivery/DeliveryProfileScreen.tsx` (handleChangePhoto block)
  - `src/screens/roles/BecomeDeliveryPartnerScreen.tsx` (handleTakePhoto block)
  - `src/services/orderService.ts` (only the `getPartnerPhotoUploadUrl` wrapper)
  - Test files for the above
- New file creation in `functions/src/` if a pure helper is extracted

You MUST stop and ask before:
- Deploy commands (`firebase deploy`, `eas update`, `gcloud …`)
- Editing files NOT listed above
- Schema additions or new callables (this PR modifies existing callable, no new ones)
- Touching storage.rules (`/delivery-profile/` rule is correct as-is for the new URL pattern; verify but don't edit)

Default posture: **execute, report at end.**

## Schema audit-grep (Rule 5)

```
grep -rn "buildPartnerPhotoDownloadUrl\|buildFirebaseStorageDownloadUrl\|firebaseStorageDownloadTokens" src functions/src
grep -rn "getPartnerPhotoUploadUrl" src functions/src
grep -rn "storage.googleapis.com\|firebasestorage.googleapis.com" src functions/src
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `buildFirebaseStorageDownloadUrl(bucketName, objectPath, token)` | `functions/src/approveShopHelpers.ts:99` | **REUSE.** Already pinned by tests. Constructs the correct Firebase Storage REST URL. |
| `getPartnerPhotoUploadUrl` callable | `functions/src/index.ts:2104` | Currently returns `{ uploadUrl, storagePath }`. Extending to also return `downloadUrl` + `downloadToken`. |
| `buildPartnerPhotoDownloadUrl` | `src/utils/buildPartnerPhotoDownloadUrl.ts` | **DEPRECATE.** Was the GCS direct URL helper. Tests stay (proves the GCS pattern works in isolation) but the function is no longer called from production code. Mark with `@deprecated` JSDoc. |
| `storage.rules` `/delivery-profile/` | `storage.rules` (added 2026-06-10) | Stays. Firebase Storage REST URL respects this. The old GCS direct URL bypassed it. |
| `x-goog-meta-firebaseStorageDownloadTokens` extension header | Standard GCS / Firebase Storage convention | New — client PUT must include this so the metadata is set at upload time. |

## Plan

### §A — Server: extend `getPartnerPhotoUploadUrl` to embed the download token

`functions/src/index.ts:2104` — replace the entire callable body:

```ts
export const getPartnerPhotoUploadUrl = onCall<{ contentType: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required');
    }
    const contentType = String(request.data?.contentType ?? '');
    if (!['image/jpeg', 'image/png'].includes(contentType)) {
      throw new HttpsError(
        'invalid-argument',
        'contentType must be image/jpeg or image/png',
      );
    }
    const ext = contentType === 'image/jpeg' ? 'jpg' : 'png';
    const storagePath = `delivery-profile/${request.auth.uid}.${ext}`;

    // HOTFIX-PROFILE-PHOTO-4 — generate a stable download token AND
    // require the client PUT to echo it back as a metadata header.
    // Result: the object lands in storage with metadata
    // `{ firebaseStorageDownloadTokens: <token> }` already set, so
    // the constructed `firebasestorage.googleapis.com/...&token=...`
    // URL works as soon as the PUT completes. Same pattern shop
    // storefront photos use via buildFirebaseStorageDownloadUrl.
    //
    // Why not GCS direct URL: that bypasses Firebase Storage Rules
    // entirely and requires bucket-level allUsers public read,
    // which would expose /shop-kyc/ PII.
    const downloadToken = crypto.randomUUID();

    const bucket = getStorage().bucket();
    const file = bucket.file(storagePath);
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 min, matches KYC
    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: expiresAt,
      contentType,
      extensionHeaders: {
        // Client MUST include this header in the PUT (with the same
        // value) or the signature won't validate. The value gets
        // written into the object's metadata at storage time.
        'x-goog-meta-firebasestoragedownloadtokens': downloadToken,
      },
    });

    const downloadUrl = buildFirebaseStorageDownloadUrl(
      bucket.name,
      storagePath,
      downloadToken,
    );

    return {
      uploadUrl,
      storagePath,
      downloadUrl,
      downloadToken,
    };
  },
);
```

Imports needed at top of `functions/src/index.ts` (verify present, add if missing):
- `import * as crypto from 'crypto';` (Node 22 has it as builtin, may already be imported)
- `import { buildFirebaseStorageDownloadUrl } from './approveShopHelpers';` — likely already imported (see line 302 audit)

### §B — Client service: update wrapper signature

`src/services/orderService.ts` (find by `grep -n "getPartnerPhotoUploadUrl" src/services/orderService.ts`):

```ts
async getPartnerPhotoUploadUrl(
  contentType: 'image/jpeg' | 'image/png',
): Promise<{
  uploadUrl: string;
  storagePath: string;
  downloadUrl: string;
  downloadToken: string;
}> {
  // ... existing native + web SDK branches, just extend the
  // return type — payload shape on the wire now includes
  // downloadUrl + downloadToken
}
```

### §C — Client: DeliveryProfileScreen — use new fields

`src/screens/delivery/DeliveryProfileScreen.tsx` `handleChangePhoto`:

```ts
const handleChangePhoto = async () => {
  const picked = await pickAndResizeImage('gallery');
  if (!picked.ok) {
    if (picked.reason === 'cancelled') return;
    Alert.alert('Photo error', picked.message || 'Could not load photo.');
    return;
  }
  setPhotoUploading(true);
  try {
    const { uploadUrl, downloadUrl, downloadToken } =
      await orderService.getPartnerPhotoUploadUrl('image/jpeg');
    const response = await fetch(picked.uri);
    const blob = await response.blob();
    await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/jpeg',
        // HOTFIX-PROFILE-PHOTO-4 — must match the value the server
        // baked into the signed URL's extension headers, or GCS
        // rejects the PUT signature.
        'x-goog-meta-firebasestoragedownloadtokens': downloadToken,
      },
      body: blob,
    });
    setPhotoUrl(downloadUrl);
  } catch (e: any) {
    Alert.alert('Upload failed', e?.message || 'Please try again.');
  } finally {
    setPhotoUploading(false);
  }
};
```

Remove the import of `buildPartnerPhotoDownloadUrl` (no longer used here).

### §D — Client: BecomeDeliveryPartnerScreen — same change

`src/screens/roles/BecomeDeliveryPartnerScreen.tsx` `handleTakePhoto` — mirror §C exactly.

### §E — Deprecate `buildPartnerPhotoDownloadUrl`

`src/utils/buildPartnerPhotoDownloadUrl.ts` — add JSDoc:

```ts
/**
 * @deprecated HOTFIX-PROFILE-PHOTO-4 (2026-06-10). Constructs a GCS
 * direct URL (`storage.googleapis.com/...`) which bypasses Firebase
 * Storage Rules and requires bucket-level public IAM that would
 * expose /shop-kyc/ PII. Partner photo downloads now use the
 * Firebase Storage REST URL with embedded download token, returned
 * by getPartnerPhotoUploadUrl directly. Do not call this from
 * production code. Tests stay to document the GCS pattern in
 * isolation; remove after one release cycle if no caller surfaces.
 */
```

Tests for this helper stay green (the GCS URL it builds is still well-formed; just isn't usable for our private-bucket case). Mark the test describe block with a comment explaining the deprecation.

### §F — Tests for the new flow

Add `tests/functions/getPartnerPhotoUploadUrl.test.ts` (or extend existing):

- **+1** — Returned `downloadUrl` matches the format `https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encodedPath}?alt=media&token={uuid}`
- **+1** — Same `downloadToken` returned in the payload matches the token embedded in `downloadUrl`
- **+1** — `downloadToken` is a UUID-shaped string (regex `/^[0-9a-f-]{36}$/`)
- **+1** — Stamp on storage path is consistent: `delivery-profile/{uid}.{ext}` (regression guard)

Extend the `signed URL extension headers` test to verify the `x-goog-meta-firebasestoragedownloadtokens` header is in the signed URL config (mock the SDK call).

Pin **+5 tests** total for §F.

## Discipline checklist

1. **Rule 1** — every new import / state carries "HOTFIX-PROFILE-PHOTO-4 — DO NOT REMOVE" comments.
2. **Rule 2** — N/A (no new hooks).
3. **Rule 5** — schema audit-grep table in header. **New worked example #4 for the discipline notes:** *"For URL construction patterns, browser-test a known-good URL of the same scheme before committing the helper. Self-confirming tests (assert against a hardcoded BASE) can't catch wrong URL schemes."* HOTFIX-PROFILE-PHOTO (encoding) + HOTFIX-PROFILE-PHOTO-2 (rules) + HOTFIX-PROFILE-PHOTO-3 (bucket name) + this (URL scheme) = four layers of the same root question "where do photos actually live and how are they served?" — locked in now via this fix.
4. **Rule 7** — auth.token shape unchanged.
5. **Rule 8** — FEATURES.md update in Doc trail. No row text change (feature description stays the same), but lineage HTML comments on the affected rows.
6. **Rule 11** — IAM verify on `getPartnerPhotoUploadUrl` (modified). 1 service.
7. **Rule 13** — N/A.
8. **Schema-additive** — no Firestore field changes. Payload shape of callable extends with `downloadUrl` + `downloadToken`; existing clients reading old shape ignore the new fields gracefully.
9. **Test discipline:** **+5 minimum** for §F.

## Acceptance checklist

1. As a delivery partner, Profile → Tap to change → pick photo → upload completes → **photo IS visible in the avatar circle** (no UD initials fallback). Save changes button enables → Save → re-hydrate → photo still visible.
2. Open the stamped URL from `users/{uid}.profilePhotoUrl` in a browser → image renders directly (no XML error).
3. As a customer, view an order with the partner assigned → partner photo visible on PartnerCard.
4. As a shop owner, view an order with the partner assigned → partner photo visible on PartnerCardForShop.
5. Onboarding flow (`BecomeDeliveryPartnerScreen`): pick a photo → preview displays correctly before Submit → submit goes through → admin sees photo at approval.
6. Browser test the OLD broken URL pattern (`storage.googleapis.com/{bucket}/{path}` against the new bucket name) → still returns AccessDenied (confirming the new URL is structurally different, not just a permissions toggle).
7. **Cloud Run IAM** verify on `getPartnerPhotoUploadUrl`. Re-add `allUsers` invoker if stripped.
8. `tsc` + tests clean. Suite +5 minimum.
9. **Deliberate-break demo:** revert §A's `extensionHeaders` block. Re-deploy mentally (`npm run build` only — don't actually deploy). The §F test that asserts on the signed URL config must fail. Restore. Tests pass.

## Out of scope

- Backfilling existing partner docs whose `profilePhotoUrl` was stamped with the old broken URL formats. Pilot scale: re-upload from partner side replaces it. Pre-pilot launch: one-shot migration script could rewrite stored URLs, but not needed for the current single test account.
- Switching shop storefront photos away from `buildFirebaseStorageDownloadUrl` (they already work; this PR aligns partner photos to the same pattern).
- Adding a `recordPartnerPhotoUpload` callable for token re-mint. Single-token-per-upload is enough; re-upload to the same path overwrites both the file AND the metadata (the signed URL bakes a new token).

## Deploy

```
cd functions; npm run build; cd ..
firebase deploy --only "functions:getPartnerPhotoUploadUrl"

gcloud run services get-iam-policy getpartnerphotouploadurl --region=asia-south1 --project=grocery-mvp-dev
# If etag: ACAB (empty), re-bind:
# gcloud run services add-iam-policy-binding getpartnerphotouploadurl --region=asia-south1 --member=allUsers --role=roles/run.invoker --project=grocery-mvp-dev

eas update --branch production --message "HOTFIX-PROFILE-PHOTO-4 — Firebase Storage REST URL + embedded download token for partner photos"
```

After OTA distributes:
- Re-upload the partner photo from the test account (one tap on Profile → Tap to change → Save changes). The newly-stamped URL works; old URL on the user doc is overwritten.

## Doc trail (Cowork)

After ship:

- **TESTING-FINDINGS** — close the photo issue with a four-step lineage (encoding → rules → bucket → URL scheme).
- **CLAUDE.md** In-flight strike.
- **SESSION_LOG** paragraph noting the four-layer fix.
- **PROMPT_AUTHORING_NOTES** — add Rule 5 worked example #5 (URL scheme verification — browser-test before committing the helper pattern).
- **FEATURES.md** (per Rule 8 — mandatory):
  - **Delivery panel §3.5 Profile** — "Edit photo" row: no description change (feature now actually works end-to-end). Lineage HTML comment chain: `<!-- HOTFIX-PROFILE-PHOTO 2026-06-10 → HOTFIX-PROFILE-PHOTO-2 2026-06-10 → HOTFIX-PROFILE-PHOTO-3 2026-06-10 → HOTFIX-PROFILE-PHOTO-4 2026-06-10 -->`
  - **Delivery panel §3.1 Onboarding & approval** — "Mandatory profile photo" row: same lineage HTML comment.
  - **Customer panel §1.8 Order tracking** — "Partner card" row: append lineage comment.
  - **Cross-cutting §5.3 Maps & geocoding** — no row change.
  - **Last updated** stamp on affected sections → 2026-06-10.
