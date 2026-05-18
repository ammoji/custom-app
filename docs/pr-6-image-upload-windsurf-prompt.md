# PR 6 — Image upload for menu items (Windsurf prompt)

## Why this PR exists

Real shops can't onboard without this. Currently `AddCustomMenuItem`
and `ShopMenuItemEdit` accept image URLs as text input — the shop
owner has to host the image somewhere, paste a URL, and hope it
loads. That's a non-starter for actual users who have photos on
their phone, not URLs.

This PR adds an in-app image picker (camera or gallery) that
uploads to Firebase Storage and returns a CDN URL, wired into both
the create and edit menu-item flows. Client-side resize to a sane
max so we don't pay bandwidth for 4K phone photos on every
customer browse.

Scope is deliberately narrow: shop-owner uploads only, no admin
or customer image uploads, no thumbnails-via-extension (revisit
post-launch if storage costs warrant it).

## Read first

- `.windsurf/test-discipline.md` and `.windsurf/deploy-discipline.md`.
- `src/screens/shop/AddCustomMenuItemScreen.tsx` — current
  "Image URL (optional)" field is what this PR replaces.
- `src/screens/shop/ShopMenuItemEditScreen.tsx` — same.
- `firestore.rules` for the rules-file format and the existing
  shopOwner-shopId scoping pattern. Storage rules use a parallel
  syntax; reference if needed.
- `storage.rules` (if it exists; if not, this PR creates it).
- `functions/src/index.ts` — `addCustomMenuItem` and `updateMenuItem`
  callables already accept `imageUrl` as a string. Server side
  validates it's a string but doesn't currently check the URL is
  on our Storage bucket. PR 6 tightens this slightly (see Part 4).
- `package.json` to confirm whether `expo-image-picker` and
  `expo-image-manipulator` are already deps. If not, install via
  `npx expo install expo-image-picker expo-image-manipulator` (Expo's
  installer pins compatible versions for the SDK).

## Scope (in)

### Part 1 — Storage rules

If `storage.rules` doesn't exist yet, create it. If it does, add to
it.

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Menu item images — public read, shopOwner-scoped write.
    // Path: menu/{shopId}/{filename}
    //
    // Rationale: customer browse paths (ShopDetailScreen,
    // SearchScreen results) load these images directly via the
    // download URL. Auth-gating reads would break anonymous customer
    // browsing. Public read is the standard pattern for menu
    // imagery — same as Swiggy / Zomato / Dunzo public images.
    //
    // Write is gated on the shopOwner claim AND shopId match, so a
    // shop owner can only write to their own shop's folder. 5MB max
    // size is generous (post-resize a typical phone photo is ~500KB)
    // and the contentType regex blocks non-image uploads.
    match /menu/{shopId}/{filename} {
      allow read: if true;
      allow write: if request.auth != null
        && request.auth.token.shopOwner == true
        && request.auth.token.shopId == shopId
        && request.resource.size < 5 * 1024 * 1024
        && request.resource.contentType.matches('image/.*');
    }

    // Everything else: deny by default. Add new prefixes here as
    // features ship (e.g. delivery partner profile photos).
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

Also: `firebase.json` should include the storage rules path. Add if
missing:
```json
{
  "storage": {
    "rules": "storage.rules"
  }
}
```

### Part 2 — Image picker + resize helper

New pure-ish helper file `src/utils/imageUpload.ts`:

```ts
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Result shape from the picker + resize pipeline. `uri` is a local
 * file:// URI the caller can then upload via Firebase Storage.
 *
 * Cancelled = user dismissed the picker without selecting. Caller
 * should silently no-op (don't show an error).
 */
export type PickedImage =
  | { ok: true; uri: string; mimeType: string }
  | { ok: false; reason: 'cancelled' | 'permission-denied' | 'too-large' | 'unknown'; message?: string };

const MAX_DIMENSION = 1024; // px — large enough for retina, small enough to keep bandwidth sane
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB; matches Storage rule

export async function pickAndResizeImage(source: 'camera' | 'gallery'): Promise<PickedImage> {
  // Ask for the matching permission. Both methods return { granted, status }.
  const perm = source === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    return { ok: false, reason: 'permission-denied', message: 'Permission required to access photos.' };
  }

  const launcher = source === 'camera'
    ? ImagePicker.launchCameraAsync
    : ImagePicker.launchImageLibraryAsync;

  const picked = await launcher({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    quality: 0.9, // pre-resize quality; ImageManipulator handles final
    aspect: [1, 1], // square crop for consistent menu display
  });
  if (picked.canceled) return { ok: false, reason: 'cancelled' };

  const asset = picked.assets[0];
  if (!asset) return { ok: false, reason: 'unknown', message: 'No image returned' };

  // Resize to MAX_DIMENSION on the longest edge, re-compress as JPEG.
  // This is the bandwidth-saving step: phone photos are typically
  // 3000+px wide and 3-5MB. Post-resize they're ~500KB.
  const resized = await ImageManipulator.manipulateAsync(
    asset.uri,
    [{ resize: { width: MAX_DIMENSION } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
  );

  // Re-check size after compression. With a 1024px JPEG at quality
  // 0.85 the result is virtually always under 5MB but we double-check
  // defensively.
  // (Note: we'd need an extra fetch/blob to measure size on web;
  // expo's API doesn't return size directly. Acceptable since the
  // server-side rule also enforces 5MB.)

  return { ok: true, uri: resized.uri, mimeType: 'image/jpeg' };
}
```

### Part 3 — Upload helper

New helper `src/services/storage.ts`:

```ts
import { firebase as nativeFirebase } from '@react-native-firebase/app';
import '@react-native-firebase/storage';
import { Platform } from 'react-native';
import { getStorage, ref as webRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage as webStorage } from './firebase'; // existing web SDK init

const isNative = Platform.OS !== 'web';

/**
 * Upload an image file URI to Firebase Storage and return the
 * publicly-resolvable download URL.
 *
 * Path convention: `menu/{shopId}/{timestamp}_{random}.jpg`. Random
 * suffix prevents collisions when a shop owner uploads multiple
 * images in the same millisecond (rare but cheap to defend).
 *
 * Native uses RNFB Storage (more reliable on iOS+Android for
 * upload progress + retry); web uses the firebase web SDK. Same
 * Plan-B dispatch posture as orderService.
 *
 * Returns the download URL on success, throws on failure.
 */
export async function uploadMenuImage(input: {
  shopId: string;
  localUri: string;
}): Promise<string> {
  const { shopId, localUri } = input;
  const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const storagePath = `menu/${shopId}/${filename}`;

  if (isNative) {
    const ref = nativeFirebase.app().storage().ref(storagePath);
    await ref.putFile(localUri);
    return await ref.getDownloadURL();
  }
  // Web: fetch the local URI as a blob (file picker returns blob URLs
  // on web), then upload via the modular SDK.
  const blob = await (await fetch(localUri)).blob();
  const ref = webRef(getStorage(), storagePath);
  await uploadBytes(ref, blob);
  return await getDownloadURL(ref);
}
```

Note: `src/services/firebase.ts` may need to initialize Storage on
the web side. If `getStorage()` isn't exported or initialized, add:
```ts
// In src/services/firebase.ts, near the other initializers:
import { getStorage } from 'firebase/storage';
export const storage = getStorage(app);
```

### Part 4 — Server-side: tighten imageUrl validation

In `functions/src/index.ts`, the existing `addCustomMenuItem` and
`updateMenuItem` callables accept any string as `imageUrl`. Tighten
to require either (a) a URL on the project's Storage CDN, OR (b)
absent / empty (server fills in a placeholder for unset). Add a
small pure helper:

`functions/src/imageUrlHelpers.ts`:
```ts
const STORAGE_HOST_SUFFIXES = [
  'firebasestorage.googleapis.com',
  'firebasestorage.app',
];

export type ImageUrlValidationResult =
  | { ok: true; url: string | null }
  | { ok: false; reason: string };

/**
 * Validates a menu item's imageUrl. Three accepted shapes:
 *   - undefined / null / empty string → ok, url = null (server uses
 *     placeholder downstream).
 *   - Firebase Storage URL on the project's bucket → ok, url = trimmed.
 *   - Anything else (random external URL, picsum, malformed) →
 *     reject. We can't enforce content moderation on third-party URLs
 *     and don't want shop owners hot-linking copyrighted images.
 *
 * The legacy 8 demo shops have picsum URLs in their menus from the
 * initial seed; this helper does NOT touch existing values — only
 * validates NEW writes. Migration of seeded URLs to Storage is a
 * separate (deferred) script.
 */
export function validateMenuImageUrl(raw: unknown): ImageUrlValidationResult {
  if (raw === undefined || raw === null) return { ok: true, url: null };
  if (typeof raw !== 'string') return { ok: false, reason: 'imageUrl must be a string' };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, url: null };
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:') return { ok: false, reason: 'imageUrl must be https' };
    const hostOk = STORAGE_HOST_SUFFIXES.some(s => u.hostname.endsWith(s));
    if (!hostOk) {
      return {
        ok: false,
        reason: 'imageUrl must point to our Storage bucket. Upload via the in-app picker.',
      };
    }
    return { ok: true, url: trimmed };
  } catch {
    return { ok: false, reason: 'imageUrl is not a valid URL' };
  }
}
```

Pin via `tests/functions/imageUrlHelpers.test.ts` with ≥6 tests:
- accepts undefined / null / empty string → null
- accepts valid Storage URL on firebasestorage.googleapis.com
- accepts valid Storage URL on firebasestorage.app subdomain
- rejects http (not https)
- rejects external host (picsum, random.com)
- rejects non-string types
- rejects malformed URL

Wire into `addCustomMenuItem` and `updateMenuItem` — validate
imageUrl, throw `invalid-argument` on failure, write the validated
value (or fall through to placeholder if null).

### Part 5 — Client UI in AddCustomMenuItem + ShopMenuItemEdit

Replace the existing "Image URL" text input in both screens with an
image-picker affordance:

```tsx
{/* Image card — replaces the Image URL text input */}
<View style={styles.card}>
  <Text style={styles.fieldLabel}>Image (optional)</Text>
  {imageUrl ? (
    <Image source={{ uri: imageUrl }} style={styles.imagePreview} />
  ) : (
    <View style={[styles.imagePreview, styles.imagePlaceholder]}>
      <Text style={styles.placeholderText}>No image</Text>
    </View>
  )}
  <View style={styles.imageButtons}>
    <Button title="📷 Take photo" variant="secondary" onPress={() => handlePick('camera')} disabled={uploading} />
    <View style={{ width: spacing.sm }} />
    <Button title="🖼️ From gallery" variant="secondary" onPress={() => handlePick('gallery')} disabled={uploading} />
  </View>
  {uploading && <Text style={styles.uploadingText}>Uploading…</Text>}
  {imageUrl && !uploading && (
    <Button title="Remove image" variant="ghost" onPress={() => setImageUrl('')} />
  )}
</View>
```

Handler:
```tsx
const handlePick = async (source: 'camera' | 'gallery') => {
  const picked = await pickAndResizeImage(source);
  if (!picked.ok) {
    if (picked.reason === 'cancelled') return; // silent
    Alert.alert('Could not pick image', picked.message ?? picked.reason);
    return;
  }
  setUploading(true);
  try {
    const url = await uploadMenuImage({ shopId, localUri: picked.uri });
    setImageUrl(url);
  } catch (e: any) {
    Alert.alert('Upload failed', e?.message ?? 'Please try again.');
  } finally {
    setUploading(false);
  }
};
```

The component already tracks `imageUrl` as state; this changes WHERE
the value comes from (picker → Storage upload → returned URL), not
HOW it's persisted (still flows through addCustomMenuItem /
updateMenuItem with `imageUrl` field).

For `ShopMenuItemEdit`: image-picker is only shown when `item.isCustom`
(GLOBAL items inherit image from the catalog and aren't editable
per the existing UI gate).

### Part 6 — app.json: permissions

Expo SDK requires explicit permission strings in app.json for iOS
camera + photo library access. Add to `app.json`'s `expo.ios.infoPlist`:

```json
"NSCameraUsageDescription": "Take photos of menu items to add to your shop.",
"NSPhotoLibraryUsageDescription": "Pick photos of menu items from your library to add to your shop.",
"NSPhotoLibraryAddUsageDescription": "Save edited photos back to your library."
```

(The first two may already exist from earlier Razorpay setup. If
present, leave them. The third is new for editing.)

Android: expo-image-picker handles permissions at runtime; no
manifest changes needed for typical use.

## Scope (out — explicitly defer)

- **Firebase Image Resize extension** for auto-generated thumbnails.
  MVP uploads are client-resized to 1024px which is small enough
  that thumbnail variants aren't worth the extension complexity.
  Revisit at 100+ shops or if bandwidth costs spike.
- **Orphaned image cleanup.** When a shop owner replaces a menu
  item's image, the old image stays in Storage. Cheap (~₹0.025/GB/month)
  and rare. Cleanup script can be a post-launch chore.
- **Migration of the 8 seeded demo shops' picsum URLs** to Storage.
  Those work as-is; rewriting them would need a backfill script.
  Real shops register fresh post-launch and get the upload flow
  immediately.
- **Customer / delivery partner profile photos.** Out of scope —
  not a launch requirement.
- **Multiple images per menu item.** MVP is one image. Real shops
  may want a gallery later; revisit if asked for.
- **Server-side image moderation** (NSFW detection, etc). Trust
  the shop owner for MVP; if abuse becomes a problem, integrate
  Google Cloud Vision later.

## Acceptance checklist

- [ ] `storage.rules` exists and includes the `menu/{shopId}/{filename}`
      rule with size + MIME guards.
- [ ] `firebase.json` declares `storage.rules` path.
- [ ] `expo-image-picker` and `expo-image-manipulator` are deps in
      package.json (installed via `npx expo install` so versions
      match the SDK).
- [ ] `app.json` has the three iOS permission strings.
- [ ] `src/utils/imageUpload.ts` exports `pickAndResizeImage`.
- [ ] `src/services/storage.ts` exports `uploadMenuImage` with
      native + web dispatch.
- [ ] `functions/src/imageUrlHelpers.ts` exports
      `validateMenuImageUrl` with ≥6 unit tests.
- [ ] `addCustomMenuItem` and `updateMenuItem` validate imageUrl
      via the helper before write; reject with `invalid-argument`
      on non-Storage URLs.
- [ ] `AddCustomMenuItemScreen` and `ShopMenuItemEditScreen` (for
      custom items only) render the image-picker affordance instead
      of the URL text input.
- [ ] `npm test` passes — total ≥ baseline + ≥6 imageUrl tests.
- [ ] Deliberate-break demo: weaken `validateMenuImageUrl` to
      always return ok. Confirm a specific test fails by name
      (suggest "rejects external host" — biggest blast radius).
      Revert.
- [ ] `npx tsc --noEmit` — 0 new errors (baseline unchanged).
- [ ] `npm run audit:indexes` passes (no new queries; expect no
      change).

## Deploy plan (hand to user — NOT executed)

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Storage rules first (new resource type — separate deploy target)
firebase deploy --only storage --project grocery-mvp-dev

# 2. Functions (updated addCustomMenuItem + updateMenuItem)
firebase deploy --only functions:addCustomMenuItem --project grocery-mvp-dev
firebase deploy --only functions:updateMenuItem --project grocery-mvp-dev
firebase functions:list --project grocery-mvp-dev

# 3. OTA — straight to production per the pattern from PR 4
eas update --branch production --message "PR 6: image upload for menu items"
```

**Note:** This PR adds two new Expo native modules (`expo-image-picker`,
`expo-image-manipulator`). Both are config-plugin-managed by Expo SDK
54 and SHOULD work via OTA on existing TestFlight / production builds
without a fresh `eas build`. Verify after OTA: if camera/gallery
fails to launch on a real device, a rebuild is needed. Worth testing
both paths immediately after the OTA lands.

Smoke tests on production phone:
1. **Add custom item with image (camera)**: ShopMenu → "+ Add custom
   item" → tap "📷 Take photo" → confirm permission prompt fires on
   first use → take photo → upload spinner → preview appears → fill
   rest of form → Save → item appears in list with photo.
2. **Add custom item with image (gallery)**: same flow with "🖼️ From
   gallery". Pick a phone photo.
3. **Edit custom item — replace image**: ShopMenu → tap a custom item
   → tap "📷 Take photo" → new photo replaces old → Save → list
   shows new photo.
4. **Edit GLOBAL item**: confirm image picker is NOT shown (only
   price / availability / stock fields editable).
5. **Customer browse**: as customer, browse the test shop → newly
   uploaded image renders.
6. **Reject external URL (negative test)**: manually call
   `updateMenuItem` from Firestore Console or a dev script with
   `imageUrl: "https://picsum.photos/200"` → expect rejection.

## Reporting back

- Output of `npm test` (one final run).
- Output of `npx tsc --noEmit` (error count, baseline vs new).
- Deliberate-break demo: test name that failed, line you weakened.
- New files + line counts.
- Whether the OTA worked or a fresh `eas build` was needed (this is
  the biggest unknown — if Expo's native module loading requires a
  rebuild, family testing has to wait for the build).
- The deploy commands handed back — NOT executed.

## Design notes for Windsurf

- The `firebasestorage.app` subdomain matters — recent Firebase
  projects use the new `<project>.firebasestorage.app` domain, older
  projects use `firebasestorage.googleapis.com`. Both must be
  accepted in `STORAGE_HOST_SUFFIXES`.
- The pre-validated URL on the server is paranoia: even though the
  client uploads via Storage SDK (which only writes to allowed
  paths), a malicious or buggy client could pass any string in the
  `imageUrl` field of the callable. Server rejecting external URLs
  closes that path.
- The auto-formatter import-stripping issue (PRs 1, 2, 4, 5):
  `pickAndResizeImage` and `uploadMenuImage` are likely targets.
  Verify imports survived after save.
- The image-picker's `aspect: [1, 1]` square crop is intentional —
  consistent display in shop browse / search results. If a real shop
  pushes back on this, V2 can offer 4:3 / freeform.
- DO NOT add a Cloud Function to mediate the upload (i.e. don't
  send base64 through a callable and have the function write to
  Storage). That doubles bandwidth and adds Cloud Function cost for
  zero security benefit — direct client-to-Storage upload is the
  recommended Firebase pattern when the rules are correct.
