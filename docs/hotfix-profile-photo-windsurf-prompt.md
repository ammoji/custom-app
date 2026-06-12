# HOTFIX-PROFILE-PHOTO — Delivery partner profile photo never displays

**Source:** Sudhir's 2026-06-10 findings #1. Partner picks a photo, "Tap to change" link is shown but no avatar renders — neither the uploaded photo nor an initials fallback. Save button stays disabled (or re-enables after one cycle then re-disables on hydrate). Screenshot shows pure whitespace where the avatar should be.

**Deploy class:** **pure client OTA.** No server changes; the upload pipeline is correct, only the constructed download URL and the JSX are wrong.

## Root cause (verified by Claude before this prompt)

Three bugs stacked on top of each other in the same screen:

**Bug A — malformed download URL.** In `DeliveryProfileScreen.handleChangePhoto` (line ~120) and `BecomeDeliveryPartnerScreen.handleTakePhoto` (line ~127):

```ts
const downloadUrl = `https://storage.googleapis.com/${STORAGE_BUCKET}/${encodeURIComponent(storagePath)}`;
```

`storagePath` is `delivery-profile/{uid}.jpg`. `encodeURIComponent` encodes `/` as `%2F`, producing a URL like `…/delivery-profile%2FAbCd1234.jpg` instead of `…/delivery-profile/AbCd1234.jpg`. GCS public download URLs require literal `/` path separators. The Image component receives a 404 and renders blank with no error event.

**Bug B — non-tappable label.** `Pressable` wraps only the 96×96 avatar circle. The "Tap to change" `Text` immediately below sits OUTSIDE the Pressable. Users intuit the label is tappable; it isn't. Combined with Bug A, the only tappable area is invisible.

**Bug C — no Image error fallback.** When the broken URL fails to load, `formatPartnerAvatar` already committed to `kind: 'photo'` based on string-non-empty. There's no `onError` handler swapping to the initials branch, so the screen renders an invisible Image instead of "UD" initials.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root)
- `npm test`, `npm run test:unit`, `npx jest`
- File edits to: `src/screens/delivery/DeliveryProfileScreen.tsx`, `src/screens/roles/BecomeDeliveryPartnerScreen.tsx`, `src/utils/formatPartnerAvatar.ts`, `tests/utils/formatPartnerAvatar.test.ts`
- New file creation: only `src/utils/buildPartnerPhotoDownloadUrl.ts` + corresponding test file

You MUST stop and ask before:
- Deploy commands (`eas update`, `firebase deploy`, `gcloud …`)
- Editing files NOT listed above
- Schema additions or new callables
- Touching any server code

Default posture: **execute, report at end.**

## Schema audit-grep (Rule 5)

```
grep -rn "encodeURIComponent.*storagePath\|storage.googleapis.com" src
grep -rn "formatPartnerAvatar\|PartnerAvatarResult" src tests
grep -rn "STORAGE_BUCKET\|grocery-mvp-dev.appspot.com" src
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `STORAGE_BUCKET` | `delivery-profile/{uid}.jpg` per `getPartnerPhotoUploadUrl` (functions/src/index.ts:2118) | Single bucket; no env split today |
| `formatPartnerAvatar(name, photoUrl)` | `src/utils/formatPartnerAvatar.ts` | Returns `{kind: 'photo', uri}` or `{kind: 'initials', text}`. Pure. |
| `buildPartnerPhotoDownloadUrl(storagePath)` | **NEW** pure helper this PR adds | Centralises the URL construction so both screens use one tested path |

## Plan

### §A — Extract URL construction into a tested pure helper

Create `src/utils/buildPartnerPhotoDownloadUrl.ts`:

```ts
/**
 * HOTFIX-PROFILE-PHOTO — construct a GCS public download URL for a
 * partner profile photo. Replaces the broken inline construction in
 * DeliveryProfileScreen + BecomeDeliveryPartnerScreen which used
 * encodeURIComponent on the full path (encoding '/' as '%2F').
 *
 * GCS requires literal '/' path separators in the URL. We URL-encode
 * each segment INDIVIDUALLY so a uid with weird characters (shouldn't
 * happen — Firebase uids are URL-safe base64 — but defense-in-depth)
 * still produces a valid URL.
 *
 * Pure — pinned by tests/utils/buildPartnerPhotoDownloadUrl.test.ts.
 */
const STORAGE_BUCKET = 'grocery-mvp-dev.appspot.com';

export function buildPartnerPhotoDownloadUrl(storagePath: string): string {
  const encoded = storagePath
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');
  return `https://storage.googleapis.com/${STORAGE_BUCKET}/${encoded}`;
}
```

Test cases (`tests/utils/buildPartnerPhotoDownloadUrl.test.ts`):
- `delivery-profile/abc123.jpg` → URL preserves `/` between segments
- `delivery-profile/abc-def_456.jpg` → handles dash + underscore in uid
- Empty string input → returns `https://…/grocery-mvp-dev.appspot.com/` (degenerate but not malformed)
- Path with `.` and uid like `Ab_-Cd123.jpg` → no double-encoding

### §B — Replace inline URL construction at both call sites

**DeliveryProfileScreen.tsx** (around line 120):

```ts
// BEFORE
const downloadUrl = `https://storage.googleapis.com/${STORAGE_BUCKET}/${encodeURIComponent(storagePath)}`;

// AFTER
const downloadUrl = buildPartnerPhotoDownloadUrl(storagePath);
```

Remove the local `STORAGE_BUCKET` const (now lives in the helper). Add `import { buildPartnerPhotoDownloadUrl } from '../../utils/buildPartnerPhotoDownloadUrl';` with the **PR-NEXT-BUNDLE-D §B / HOTFIX-PROFILE-PHOTO — DO NOT REMOVE** comment.

**BecomeDeliveryPartnerScreen.tsx** (around line 126-128):

```ts
// BEFORE
const bucket = 'grocery-mvp-dev.appspot.com';
const encodedPath = encodeURIComponent(storagePath);
const downloadUrl = `https://storage.googleapis.com/${bucket}/${encodedPath}`;

// AFTER
const downloadUrl = buildPartnerPhotoDownloadUrl(storagePath);
```

Remove the local `bucket` variable.

### §C — Make "Tap to change" label part of the Pressable

In `DeliveryProfileScreen.tsx` (around line 186-204), restructure the avatar block so the Pressable wraps BOTH the avatar AND the "Tap to change" text:

```jsx
<View style={styles.avatarBlock}>
  <Pressable
    onPress={handleChangePhoto}
    disabled={photoUploading}
    style={({ pressed }) => [
      styles.avatarPressable,
      pressed && { opacity: 0.7 },
    ]}
    accessibilityRole="button"
    accessibilityLabel="Change profile photo"
    hitSlop={8}
  >
    <View style={styles.avatarWrap}>
      {avatar.kind === 'photo' && !photoLoadError ? (
        <Image
          source={{ uri: avatar.uri }}
          style={styles.avatarImg}
          onError={() => setPhotoLoadError(true)}
        />
      ) : (
        <View style={[styles.avatarImg, styles.avatarInitials]}>
          <Text style={styles.avatarInitialsText}>
            {avatar.kind === 'initials'
              ? avatar.text
              : formatPartnerAvatar(displayName, null).kind === 'initials'
                ? formatPartnerAvatar(displayName, null).text
                : '?'}
          </Text>
        </View>
      )}
    </View>
    <Text style={styles.tapToChange}>
      {photoUploading ? 'Uploading…' : 'Tap to change'}
    </Text>
  </Pressable>
  {(ratingCount ?? 0) > 0 && ratingAvg != null ? (
    <Text style={styles.ratingLine}>
      ⭐ {ratingAvg.toFixed(1)} · {ratingCount} ratings
    </Text>
  ) : (
    <Text style={styles.ratingLineMuted}>New partner</Text>
  )}
</View>
```

Notes:
- `styles.avatarPressable` is a new style — `alignItems: 'center'` so the avatar + label centre under each other.
- `hitSlop={8}` makes the whole pressable a slightly bigger touch target.
- Reset `photoLoadError` to `false` whenever `photoUrl` changes (`useEffect` on `photoUrl`).

Add `const [photoLoadError, setPhotoLoadError] = useState(false);` above the conditional returns (Rule 2).

Add the effect:
```ts
useEffect(() => {
  setPhotoLoadError(false);
}, [photoUrl]);
```

### §D — Same Image `onError` fallback in BecomeDeliveryPartnerScreen

Find where `photoUri` or `photoUploadedUrl` is rendered as Image, add the same `onError` → initials fallback path. If the existing render is just an Image with no fallback at all, add one using `formatPartnerAvatar(name, null)` to compute initials text.

This protects against the same broken-URL class of bug during onboarding — admin approval needs to actually see the photo before granting the claim.

### §E — Defensive: Image `onError` → initials in `formatPartnerAvatar` callers across the app

`formatPartnerAvatar` itself stays pure (single source of truth for "is there a URL string"). The Image fallback pattern goes in each consumer's JSX via a state flag — same pattern as §C.

Audit-grep:
```
grep -rn "formatPartnerAvatar" src --include="*.tsx"
```

For this hotfix's scope, ONLY update the two screens above. Other consumers (PartnerCard, PartnerCardForShop, PartnerDetailsSheet) are out of scope for this hotfix and will be picked up by Bundle G §D's audit if they're missing it.

## Discipline checklist

1. **Rule 1** — every new import / state carries "HOTFIX-PROFILE-PHOTO — DO NOT REMOVE" comments.
2. **Rule 2** — `photoLoadError` useState above all conditional returns.
3. **Rule 5** — schema audit-grep table in header. Reuses existing fields; no new server fields.
4. **Rule 8** — FEATURES.md update list is in the Doc trail section below. Even though this is a hotfix with no row text change, the section dates + lineage HTML comments must be updated.
5. **Rule 13** — N/A (no new modals).
6. **Schema-additive** — no new fields. Pure client.
7. **Test discipline:** **+4 tests minimum** on `buildPartnerPhotoDownloadUrl`. Optional smoke test for Image onError flow if Cascade has the harness.

## Acceptance checklist

1. As a delivery partner, open Profile tab. Avatar circle is visible — either with the (now correctly URL'd) photo or with initials. Both photo and "Tap to change" label are part of a single tappable area.
2. Tap anywhere in the avatar + label region → picker opens.
3. Pick a photo → upload completes → photo IS visible (no blank circle). Save changes button enables.
4. Tap Save → re-hydrate from server → photo still visible after re-hydrate (i.e. the saved URL renders correctly).
5. Force a broken URL (e.g. via dev tool: temporarily set `photoUrl` to a 404 URI) → `onError` fires → initials fallback appears. No invisible-circle state.
6. Onboarding flow (`BecomeDeliveryPartnerScreen`): pick a photo → see the photo preview render before Submit. Submitting goes through and admin sees the photo at approval time.
7. `tsc --noEmit` clean. Test suite +4 minimum. Deliberate-break demo (revert the `encodeURIComponent` per-segment logic) → the test that asserts URL preserves `/` fails.

## Out of scope (deferred to Bundle G or later)

- Reverting other `formatPartnerAvatar` consumers (PartnerCard, PartnerCardForShop, PartnerDetailsSheet) to add `onError` → initials. Bundle G §D audit covers them.
- Storage Rules change (none needed; the URL was always wrong, GCS rejection wasn't a rules issue).
- Backfilling user docs whose `profilePhotoUrl` was stamped with the broken-encoded URL. The fix uses a new, correctly-encoded URL on next save; legacy broken URLs will simply fall back to initials via §C's `onError`.

## Deploy

```
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "HOTFIX-PROFILE-PHOTO — fix delivery profile photo URL + tappable label"
```

No server deploy. No IAM check.

## Doc trail (Cowork)

After ship:

- **TESTING-FINDINGS** — close #1.
- **CLAUDE.md** In-flight strike.
- **SESSION_LOG** paragraph.
- **FEATURES.md** (per PROMPT_AUTHORING_NOTES Rule 8 — mandatory):
  - **Delivery panel §3.5 Profile** — "Edit photo" row: **no row change needed** (feature works correctly now; this is a hotfix not a behaviour change). Verify description "Re-upload partner photo (camera or library)" still accurate.
  - **Shop panel §2.1 Onboarding & approval** — "Storefront photo upload" row stays as-is.
  - **Delivery panel §3.1 Onboarding & approval** — "Mandatory profile photo" row: verify still accurate (BecomeDeliveryPartnerScreen now actually displays the uploaded photo correctly — but the FEATURE description doesn't change).
  - **Cross-cutting §5.7 Deploy & build** — no change.
  - **Last updated** stamp on Delivery panel sections → 2026-06-10.
  - **Maintenance note:** add a `<!-- HOTFIX-PROFILE-PHOTO 2026-06-10 -->` HTML comment next to the Delivery panel §3.5 "Edit photo" row so anyone investigating "why doesn't this work?" can find the lineage.
- **PROMPT_AUTHORING_NOTES** — no rule change; this PR is the first under Rule 8.
