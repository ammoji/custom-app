import type { Order } from '../types';

export type OrderStatus = Order['status'];

// Must stay in sync with functions/src/index.ts VALID_ORDER_TRANSITIONS.
// We can't share that file directly (different rootDir / build pipeline),
// but the CLI script and the admin UI both consume this map.
export const VALID_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready_for_pickup', 'cancelled'],
  ready_for_pickup: ['delivered'],
  delivered: [],
  cancelled: [],
};

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  preparing: 'Preparing',
  // PR 12 — internal/admin label. Customer-facing OrderDetailScreen
  // still shows "Out for delivery" via an audience-aware override.
  ready_for_pickup: 'Ready for Pickup',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const ACTION_LABELS: Record<OrderStatus, string> = {
  pending: 'Mark Pending',
  accepted: 'Accept',
  preparing: 'Start Preparing',
  // PR 12 — the action that flips an order from `preparing` to
  // `ready_for_pickup`. Phrased as the shop's outbound signal
  // ("come pick this up") rather than the previous ambiguous
  // "Out for delivery" label.
  ready_for_pickup: 'Ready for Pickup',
  delivered: 'Mark Delivered',
  cancelled: 'Cancel',
};

export function nextActionsFor(status: OrderStatus): OrderStatus[] {
  return VALID_ORDER_TRANSITIONS[status] ?? [];
}
