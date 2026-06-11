/**
 * PR-NEXT-BUNDLE-D §E — pure sort helpers for the delivery
 * dashboard's chip-filter row + coming-up priority ordering.
 *
 * Client-only (no server mirror) — the partner re-sorts the local
 * array on chip tap with no server round-trip. All functions are
 * pure: no input mutation, no side effects. Pinned by
 * `tests/utils/deliverySortHelpers.test.ts`.
 */

import type { Order } from '../types';

export type PickupSortMode = 'distance' | 'pay' | 'age';

/**
 * Sort a pickup list by the chosen chip mode.
 *   - distance: nearest first (ascending distanceKm; missing → bottom)
 *   - pay: highest delivery fee first (descending; missing → 0)
 *   - age: newest first (descending createdAt; missing → 0)
 *
 * Stable for ties via original-index tiebreaker. Does NOT mutate.
 */
export function sortPickups<
  T extends Pick<Order, 'deliveryFee' | 'createdAt'> & { distanceKm?: number },
>(orders: T[], sort: PickupSortMode): T[] {
  const indexed = orders.map((o, i) => ({ o, i }));
  switch (sort) {
    case 'distance':
      return indexed
        .sort(
          (a, b) =>
            (a.o.distanceKm ?? Number.POSITIVE_INFINITY) -
              (b.o.distanceKm ?? Number.POSITIVE_INFINITY) || a.i - b.i,
        )
        .map(x => x.o);
    case 'pay':
      return indexed
        .sort(
          (a, b) => (b.o.deliveryFee ?? 0) - (a.o.deliveryFee ?? 0) || a.i - b.i,
        )
        .map(x => x.o);
    case 'age':
      return indexed
        .sort(
          (a, b) => (b.o.createdAt ?? 0) - (a.o.createdAt ?? 0) || a.i - b.i,
        )
        .map(x => x.o);
    default:
      return orders.slice();
  }
}

const STATUS_PRIORITY: Record<string, number> = {
  preparing: 0,
  accepted: 1,
};

/**
 * Sort the "coming up" pool so preparing orders (closest to ready)
 * float above accepted ones. Within each status, earlier
 * readyByEstimate first. Stable via original-index tiebreaker.
 * Does NOT mutate.
 */
export function sortComingUpByPriority<
  T extends Pick<Order, 'status'> & { readyByEstimate?: number | null },
>(orders: T[]): T[] {
  return orders
    .map((o, i) => ({ o, i }))
    .sort((a, b) => {
      const aP = STATUS_PRIORITY[a.o.status as string] ?? 99;
      const bP = STATUS_PRIORITY[b.o.status as string] ?? 99;
      if (aP !== bP) return aP - bP;
      const aR = a.o.readyByEstimate ?? Number.POSITIVE_INFINITY;
      const bR = b.o.readyByEstimate ?? Number.POSITIVE_INFINITY;
      if (aR !== bR) return aR - bR;
      return a.i - b.i;
    })
    .map(x => x.o);
}
