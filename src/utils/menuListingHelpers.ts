/**
 * PR-NEXT-4 — Pure helpers for menu-listing soft-delete filtering.
 *
 * The `removeMenuItem` callable now stamps `deletedAt:
 * serverTimestamp()` on both custom and global items (see
 * finding #5 in `docs/TESTING-FINDINGS-2026-05-30.md`); every
 * listing surface needs to drop those rows. We do the filter
 * in-memory rather than via Firestore `where('deletedAt', '==',
 * null)` because:
 *
 *   1. Firestore's `where(... '==', null)` does NOT match
 *      docs where the field is absent — only docs where the
 *      field is explicitly stored as `null`. Legacy menu items
 *      predating PR-NEXT-4 have no `deletedAt` field at all,
 *      so a server-side filter would silently exclude every
 *      pre-PR item from the listing — a regression worse than
 *      the bug we're fixing.
 *   2. Menu sizes are tiny (≤ a few hundred items per shop, ~30
 *      in the global catalog). The cost of the in-memory filter
 *      is negligible compared to the index management overhead
 *      a server-side filter would require.
 *
 * This helper centralizes the test so every listing site
 * (`listMyShopMenu`, `listShopMenuPublic`, `searchMenuPublic`,
 * `bulkUpdateMenuAvailability`) treats `deletedAt` consistently.
 *
 * Test suite: `tests/utils/menuListingHelpers.test.ts`.
 */

/**
 * Returns true iff the item should be hidden from listings due
 * to soft-delete. Loose input shape so this works on raw
 * Firestore doc.data() shapes (which lack the optional MenuItem
 * `deletedAt` field type) AND on already-typed MenuItem values.
 *
 * Truthy `deletedAt` → deleted. Absent / null / 0 / undefined → live.
 *
 * The 0-is-live case is deliberate (and pinned by the test): a
 * future tooling slip that writes `deletedAt: 0` should NOT hide
 * the item — only a real epoch-ms timestamp counts as "deleted."
 */
export function isMenuItemDeleted(item: { deletedAt?: unknown }): boolean {
  const v = item?.deletedAt;
  if (v == null) return false; // null OR undefined → live
  if (typeof v === 'number') return v > 0;
  // Defensive: any other truthy shape (Timestamp, Date, string)
  // counts as deleted. The server normalizer should hand us
  // numbers, but a stray Timestamp from a direct Firestore SDK
  // read shouldn't bypass the filter.
  return Boolean(v);
}

/**
 * Drops soft-deleted items from a listing. Preserves order; pure;
 * tolerant of undefined / null / non-array input (returns []).
 */
export function excludeDeleted<T extends { deletedAt?: unknown }>(
  items: T[] | null | undefined,
): T[] {
  if (!Array.isArray(items)) return [];
  return items.filter(i => !isMenuItemDeleted(i));
}
