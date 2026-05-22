/**
 * PR 16 — Shop owner new-order alert.
 *
 * Pure helper that returns the IDs of orders that are NEW relative
 * to a previously-seen set. Used by ShopOwnerDashboardScreen to
 * detect which orders arrived in the latest watcher tick.
 *
 * "New" = id is in the current order list AND wasn't in the
 * previously-seen set. We deliberately do NOT use timestamps —
 * server clock drift + late writes mean a freshly-written order can
 * have a `createdAt` that falls before the previous poll's max. ID
 * set comparison is the reliable signal.
 *
 * First-tick semantics: when `previouslySeenIds` is `null`
 * (uninitialised), return an empty set — the first tick establishes
 * the baseline. Showing 20 "new" orders the moment a shopkeeper
 * opens the dashboard would be alarming and meaningless.
 *
 * Pure — no Firestore, no React, no clock. Pinned by
 * tests/utils/detectNewOrderIds.test.ts.
 */
export function detectNewOrderIds(
  currentOrderIds: string[],
  previouslySeenIds: Set<string> | null,
): Set<string> {
  if (previouslySeenIds === null) return new Set();
  const newIds = new Set<string>();
  for (const id of currentOrderIds) {
    if (!previouslySeenIds.has(id)) newIds.add(id);
  }
  return newIds;
}
