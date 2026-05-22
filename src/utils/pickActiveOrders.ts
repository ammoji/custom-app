/**
 * PR 15 — HomeScreen "Active orders" rail picker.
 *
 * Pure helper that filters a customer's order list down to currently
 * IN-FLIGHT orders, sorted most-recent-first.
 *
 * "Active" = non-terminal status:
 *   - `pending`           (just placed, awaiting shop acceptance)
 *   - `accepted`          (shop accepted with ETA)
 *   - `preparing`         (shop is preparing)
 *   - `ready_for_pickup`  (post-PR-12 rename of out_for_delivery)
 *
 * Terminal (excluded):
 *   - `delivered`         (cycle complete — appears in PR 14's
 *                          "Order again" rail instead)
 *   - `cancelled`         (cycle aborted)
 *
 * Sort: createdAt desc — customers care about their newest order
 * first.
 *
 * Pure — no Firestore reads, no React, no clock dependency. Pinned
 * by tests/utils/pickActiveOrders.test.ts.
 */
import type { Order } from '../types';

// Single source of truth for which statuses count as "active".
// Mirror of (the inverse of) the terminal-status set used in PR 13's
// reorder filter. Keep these synced if the state machine evolves.
const ACTIVE_STATUSES = new Set<string>([
  'pending',
  'accepted',
  'preparing',
  'ready_for_pickup',
]);

export function pickActiveOrders(orders: Order[]): Order[] {
  return orders
    .filter(o => ACTIVE_STATUSES.has(o.status))
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);
}
