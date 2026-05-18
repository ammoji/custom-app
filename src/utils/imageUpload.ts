/**
 * PR 6 — Image picker + resize pipeline.
 *
 * Wraps expo-image-picker (camera / gallery) + expo-image-manipulator
 * (resize + recompress) behind a single async call. Returns a tagged
 * union so the caller can branch cleanly on success vs. each failure
 * mode without inspecting exception types — same posture as the
 * deliveryRequestHelpers and shopSettingsHelpers callables.
 *
 * The resize step is the bandwidth-saving point: phone photos out of
 * the camera roll are typically 3000+ px wide and 3–5 MB. After
 * resize-to-1024 + quality-0.85 JPEG, the same photo is ~300–500 KB.
 * Customer browse paths render these images on every shop card and
 * search result, so the size delta directly translates to faster
 * loads on slower networks (target users on 2G/3G).
 *
 * The square 1:1 crop is intentional — consistent visual rhythm on
 * shop detail / search result lists, and matches the existing GLOBAL
 * catalog image aspect. If a real shop pushes back, V2 can offer 4:3
 * / freeform; revisit only when asked.
 *
 * 'cancelled' is a normal user action (they tapped the picker and
 * decided not to pick), not an error. Caller should silently no-op
 * rather than showing an alert — same convention as
 * `useAddressBook`'s cancel paths.
 */

// NOTE: These imports may be stripped by the auto-formatter (see PRs
// 1, 2, 4, 5, 6 history). If tsc complains "Cannot find name
// 'ImagePicker'" or "Cannot find name 'ImageManipulator'", re-add.
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

export type PickedImage =
  | { ok: true; uri: string; mimeType: 'image/jpeg' }
  | {
      ok: false;
      reason: 'cancelled' | 'permission-denied' | 'too-large' | 'unknown';
      message?: string;
    };

// 1024px on the longest edge — large enough to look sharp on a
// 3x-density phone display in a typical card, small enough that the
// resulting JPEG is well under 1 MB even before compression.
const MAX_DIMENSION = 1024;

export async function pickAndResizeImage(
  source: 'camera' | 'gallery',
): Promise<PickedImage> {
  // Permission gate. Both methods return { granted, status, canAskAgain }.
  // `granted: true` is the only path we accept; if false (denied or
  // never-granted), surface 'permission-denied' so the caller can
  // show a one-shot explanatory alert.
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    return {
      ok: false,
      reason: 'permission-denied',
      message:
        source === 'camera'
          ? 'Camera permission is required to take a photo.'
          : 'Photo library permission is required to pick a photo.',
    };
  }

  const launcher =
    source === 'camera'
      ? ImagePicker.launchCameraAsync
      : ImagePicker.launchImageLibraryAsync;

  let picked: ImagePicker.ImagePickerResult;
  try {
    picked = await launcher({
      // `mediaTypes` API changed between SDKs; using the constant
      // exported on the namespace keeps compatibility across the
      // SDK 54/55 window without a runtime branch.
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      // Pre-resize quality; the real quality knob is in the
      // ImageManipulator step below. Setting this to ~0.9 keeps the
      // intermediate file small without losing detail before resize.
      quality: 0.9,
    });
  } catch (e: any) {
    return {
      ok: false,
      reason: 'unknown',
      message: e?.message ?? 'Image picker failed',
    };
  }

  if (picked.canceled) return { ok: false, reason: 'cancelled' };
  const asset = picked.assets?.[0];
  if (!asset) return { ok: false, reason: 'unknown', message: 'No image returned' };

  // Resize + re-compress as JPEG. The `resize: { width }` action
  // preserves aspect ratio; combined with the square crop above, the
  // result is a 1024×1024 JPEG. Quality 0.85 is the sweet spot for
  // photo content — visually indistinguishable from 0.95 at this
  // size, ~30% smaller file.
  try {
    const resized = await ImageManipulator.manipulateAsync(
      asset.uri,
      [{ resize: { width: MAX_DIMENSION } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
    );
    return { ok: true, uri: resized.uri, mimeType: 'image/jpeg' };
  } catch (e: any) {
    return {
      ok: false,
      reason: 'unknown',
      message: e?.message ?? 'Image resize failed',
    };
  }
}
