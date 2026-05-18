/**
 * PR 6 — Firebase Storage upload helper for menu item images.
 *
 * Uses the Firebase Web SDK on BOTH platforms (web + native). The
 * existing `firebase.ts` already exports a `storage` handle that
 * works cross-platform — see the file-level comment in
 * `src/services/firebase.ts` which notes "native: still uses this
 * web SDK for storage AND for Firestore reads of world-readable
 * collections". This avoids pulling in `@react-native-firebase/storage`
 * (which would require another native module compile + pod install
 * cycle) for a feature that only writes blobs and reads back a URL.
 *
 * Path convention: `menu/{shopId}/{timestamp}_{rand}.jpg`. The
 * random suffix protects against the (rare) case of a shop owner
 * uploading multiple images in the same millisecond — uniqueness
 * matters because the Storage rule keys writes on the path. We
 * intentionally do NOT use the menuItemId in the path because the
 * upload happens BEFORE the item is saved (the shop owner picks an
 * image, then fills out the form). For edits, the new image
 * supersedes the old one in the menuItem doc; the orphaned old image
 * is left in Storage — cleanup is a deferred chore (see PR 6 prompt
 * "Scope out").
 *
 * Errors propagate as thrown Errors so the caller (typically the
 * upload handler in AddCustomMenuItem / ShopMenuItemEdit) can
 * surface them via Alert. The storage SDK throws on permission
 * denied + size cap violations; we don't catch + re-throw because
 * the SDK's error messages are already customer-readable.
 */
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from './firebase';

export async function uploadMenuImage(input: {
  shopId: string;
  localUri: string;
}): Promise<string> {
  const { shopId, localUri } = input;
  // 6-char base36 suffix is enough to make collisions cosmically
  // unlikely in practice; combined with the millisecond timestamp
  // the keyspace is ~2^25-per-ms per shop.
  const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const storagePath = `menu/${shopId}/${filename}`;

  // Fetch the local URI as a Blob. On native, `file://` URIs are
  // supported by RN's fetch (via the embedded Hermes runtime). On
  // web, blob: / data: URIs from the file picker also work.
  // expo-image-manipulator returns a file:// URI on both platforms
  // post-resize, so a single `fetch().then(r => r.blob())` is the
  // correct shape everywhere.
  const blob = await (await fetch(localUri)).blob();
  const storageRef = ref(storage, storagePath);
  // Pass contentType explicitly — the storage rule's contentType
  // check (image/*) reads this value, not the blob's MIME-type
  // sniffing which can be unreliable on RN.
  await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
  return await getDownloadURL(storageRef);
}
