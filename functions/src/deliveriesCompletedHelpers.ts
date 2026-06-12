/**
 * PR-NEXT-BUNDLE-G §A — DO NOT REMOVE. Pure helper for computing
 * per-partner delivery counts from an array of order documents.
 * Used by backfill-deliveries-completed.ts and pinned by tests.
 */

export interface OrderDoc {
  deliveryPersonId?: string | null;
  status?: string | null;
}

/**
 * Given an array of order documents, returns a map from deliveryPersonId
 * → count of delivered orders. Non-delivered orders and orders with no
 * deliveryPersonId are excluded.
 */
export function computeDeliveriesCompleted(
  orders: OrderDoc[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const order of orders) {
    if (order.status !== 'delivered') continue;
    const uid = order.deliveryPersonId;
    if (!uid || typeof uid !== 'string') continue;
    counts.set(uid, (counts.get(uid) ?? 0) + 1);
  }
  return counts;
}
