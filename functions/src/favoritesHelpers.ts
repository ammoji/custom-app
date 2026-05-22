/**
 * PR 19 — pure helpers for per-shop favorites management.
 *
 * Why pure: the toggle logic (add if missing, remove if present, clean
 * up shop keys when their array drops to empty) is gnarly enough to
 * deserve dedicated unit tests. Same architectural posture as
 * `cancelPaidOrderHelpers`, `auditLogHelpers`, `profileHelpers` —
 * helpers tested in plain Node without firebase-admin, then wired to
 * `HttpsError` + `FieldValue` inside the callable in `index.ts`.
 *
 * Pinned by `tests/functions/favoritesHelpers.test.ts`.
 *
 * Nothing in this file may import firebase-admin / firebase-functions
 * / react-native — that's the testability contract.
 */

export type ToggleFavoriteInput = {
  shopId: unknown;
  menuItemId: unknown;
};

export type ToggleFavoriteResult =
  | { ok: true; shopId: string; menuItemId: string }
  | {
      ok: false;
      code: 'unauthenticated' | 'invalid-argument';
      message: string;
    };

/**
 * Validate the inputs to the `toggleFavorite` callable.
 *
 * `auth` may be null/undefined (anonymous request hitting the
 * callable directly with no token). We reject with `unauthenticated`
 * — the client gates anonymous taps too (FavoriteHeart shows a
 * "Sign in to save favorites" alert), this is belt-and-braces.
 *
 * shopId and menuItemId must both be non-empty strings. Looser
 * validation (e.g. checking shopId actually exists in /shops or that
 * the menuItem belongs to that shop) is INTENTIONALLY skipped — see
 * the comment block on the callable for the "favorites can outlive
 * a shop's menu" rationale.
 */
export function validateToggleFavoriteInput(
  auth: { uid: string } | null | undefined,
  input: ToggleFavoriteInput,
): ToggleFavoriteResult {
  if (!auth?.uid) {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    };
  }
  if (typeof input.shopId !== 'string' || input.shopId.length === 0) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'shopId required (non-empty string)',
    };
  }
  if (
    typeof input.menuItemId !== 'string' ||
    input.menuItemId.length === 0
  ) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'menuItemId required (non-empty string)',
    };
  }
  return { ok: true, shopId: input.shopId, menuItemId: input.menuItemId };
}

/**
 * Apply a toggle to a favorites map. Returns the NEW map (immutable
 * — caller's input is never mutated); the caller writes it back to
 * the profile doc with merge:true.
 *
 * Rules:
 *   - If `menuItemId` is NOT in `favorites[shopId]` → ADD it
 *     (creates the array if `shopId` key doesn't exist).
 *   - If `menuItemId` IS in `favorites[shopId]` → REMOVE it.
 *   - If removing makes `favorites[shopId]` empty → DELETE the
 *     `shopId` key entirely. Keeps the map compact and means the
 *     "favoritesCount" derived selector on the client doesn't have
 *     to walk dead empty arrays.
 *
 * Returns `{ favorites, isFavorite }` — the new map AND whether the
 * toggled item is now favorited (so the client can confirm/render
 * the heart state without re-checking).
 */
export function applyFavoriteToggle(
  currentFavorites: Record<string, string[]> | undefined,
  shopId: string,
  menuItemId: string,
): { favorites: Record<string, string[]>; isFavorite: boolean } {
  const current = { ...(currentFavorites ?? {}) };
  const shopFavorites = current[shopId] ?? [];
  const existingIndex = shopFavorites.indexOf(menuItemId);

  if (existingIndex >= 0) {
    // REMOVE branch.
    const next = shopFavorites.filter(id => id !== menuItemId);
    if (next.length === 0) {
      delete current[shopId];
    } else {
      current[shopId] = next;
    }
    return { favorites: current, isFavorite: false };
  }

  // ADD branch.
  current[shopId] = [...shopFavorites, menuItemId];
  return { favorites: current, isFavorite: true };
}
