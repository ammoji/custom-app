/**
 * PR-NEXT-PARTNER-PHOTO — pure helper for rendering a delivery
 * partner's identity avatar.
 *
 * Returns a discriminated union so callers can render either a photo
 * (`<Image source={{ uri }}>`) or an initials fallback without
 * any conditional logic in JSX beyond a single branch.
 *
 * Intentionally pure — no React, no storage, no fetch. Pinned by
 * `tests/utils/formatPartnerAvatar.test.ts`.
 */

export type PartnerAvatarResult =
  | { kind: 'photo'; uri: string }
  | { kind: 'initials'; text: string };

/**
 * Derive the display form for a partner avatar.
 *
 * @param name   - Partner display name (may be null/undefined for anonymous).
 * @param photoUrl - URL from `order.deliveryPersonPhotoUrl` or partner doc.
 *                   Non-empty string → photo. Null/undefined/empty → initials.
 */
export function formatPartnerAvatar(
  name: string | null | undefined,
  photoUrl: string | null | undefined,
): PartnerAvatarResult {
  if (typeof photoUrl === 'string' && photoUrl.trim().length > 0) {
    return { kind: 'photo', uri: photoUrl.trim() };
  }
  // Initials fallback: first letter of first + last word in name, uppercase.
  const clean =
    typeof name === 'string' ? name.trim() : '';
  if (clean.length === 0) {
    return { kind: 'initials', text: '?' };
  }
  const words = clean.split(/\s+/).filter(Boolean);
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return { kind: 'initials', text: (first + last).toUpperCase() };
}
