/**
 * PR-NEXT-ENH-1 (finding #4 follow-up) — count selected items that
 * are currently available vs unavailable. Drives the smart-label
 * decision on `ShopMenuScreen`'s bulk action bar:
 *
 *   availableCount   → how many selected items ARE available now →
 *                      "Mark N unavailable" would flip exactly this many
 *   unavailableCount → how many selected items ARE unavailable now →
 *                      "Mark N available" would flip exactly this many
 *
 * Items not present in the source list are silently ignored
 * (selection state can transiently include ids from a previous
 * fetch). Items whose `available` field is anything other than
 * strict `true` (undefined, null, 0, etc.) are treated as
 * unavailable — defensive against legacy / malformed docs, same
 * posture as the `available === false` checks in `buildReorderPlan`
 * and the menu listing helpers.
 *
 * Pure — exclusively a function of (items, selectedIds). Pinned by
 * `tests/utils/bulkAvailabilityCounts.test.ts`.
 */
import type { MenuItem } from '../types';

export type BulkAvailabilityCounts = {
  availableCount: number;
  unavailableCount: number;
};

export function computeBulkAvailabilityCounts(
  items: readonly MenuItem[],
  selectedIds: ReadonlySet<string>,
): BulkAvailabilityCounts {
  let availableCount = 0;
  let unavailableCount = 0;
  for (const item of items) {
    if (!selectedIds.has(item.id)) continue;
    if (item.available === true) availableCount += 1;
    else unavailableCount += 1;
  }
  return { availableCount, unavailableCount };
}
