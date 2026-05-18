/**
 * PR 6 — Pure helper for validating menu item image URLs server-side.
 *
 * Used by `addCustomMenuItem` and `updateMenuItem` to ensure shop
 * owners cannot persist arbitrary external URLs in their menu items.
 * The in-app picker uploads to Firebase Storage and passes the
 * resulting download URL — those URLs always resolve to one of the
 * `STORAGE_HOST_SUFFIXES` below. Anything else (random external
 * site, picsum.photos, hot-link to copyrighted imagery) is rejected.
 *
 * Why server-side validation when storage.rules already constrains
 * writes to /menu/{shopId}/{filename}? Because the `imageUrl` field
 * on the menu item doc is a free string — a malicious or buggy
 * client could upload to Storage AND then call updateMenuItem with
 * `imageUrl: "https://picsum.photos/200"` to persist a different
 * URL than the one they actually uploaded. Closing that path here
 * is cheap (one URL parse + hostname check).
 *
 * Three accepted shapes:
 *   - undefined / null / empty string → ok with `url: null`. Caller
 *     interprets null as "no image; use placeholder downstream".
 *   - https URL on the project's Storage CDN (one of the
 *     STORAGE_HOST_SUFFIXES) → ok with `url: trimmed`.
 *   - Anything else → reject with a customer-friendly reason string.
 *
 * Note about legacy data: the 8 demo shops seeded for early testing
 * carry picsum.photos URLs in their menu docs. This helper does NOT
 * touch existing values — it only validates NEW writes. Existing
 * docs continue to render correctly because the customer browse
 * paths just <Image source={uri} /> without re-validating. A
 * migration script can rewrite seeded URLs to Storage post-launch
 * if the cosmetic mix bothers anyone; deferred for MVP.
 */
const STORAGE_HOST_SUFFIXES = [
  // Older Firebase projects: storage CDN under googleapis.com.
  'firebasestorage.googleapis.com',
  // Newer Firebase projects (this one — `grocery-mvp-dev.firebasestorage.app`):
  // download URLs resolve via the per-project subdomain on .firebasestorage.app.
  // BOTH must be accepted; checking only the legacy host would break
  // the entire upload path for this project.
  'firebasestorage.app',
];

export type ImageUrlValidationResult =
  | { ok: true; url: string | null }
  | { ok: false; reason: string };

export function validateMenuImageUrl(
  raw: unknown,
): ImageUrlValidationResult {
  // Absent / cleared.
  if (raw === undefined || raw === null) return { ok: true, url: null };
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'imageUrl must be a string' };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, url: null };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'imageUrl is not a valid URL' };
  }

  // https-only — http would expose the customer to mixed-content
  // warnings on web and cleartext-traffic flags on Android.
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'imageUrl must be https' };
  }

  // Hostname must end in one of our Storage host suffixes. Using
  // `endsWith` instead of `===` because the new Firebase domain is
  // a per-project subdomain (e.g. `grocery-mvp-dev.firebasestorage.app`).
  const hostOk = STORAGE_HOST_SUFFIXES.some(s =>
    parsed.hostname.endsWith(s),
  );
  if (!hostOk) {
    return {
      ok: false,
      reason:
        'imageUrl must point to our Storage bucket. Upload via the in-app picker.',
    };
  }
  return { ok: true, url: trimmed };
}
