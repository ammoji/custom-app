import type { Order } from '../types';

export type OrderStatus = Order['status'];

// Must stay in sync with functions/src/index.ts VALID_ORDER_TRANSITIONS.
// We can't share that file directly (different rootDir / build pipeline),
// but the CLI script and the admin UI both consume this map.
export const VALID_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: [],
};

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  preparing: 'Preparing',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const ACTION_LABELS: Record<OrderStatus, string> = {
  pending: 'Mark Pending',
  accepted: 'Accept',
  preparing: 'Start Preparing',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Mark Delivered',
  cancelled: 'Cancel',
};

export function nextActionsFor(status: OrderStatus): OrderStatus[] {
  return VALID_ORDER_TRANSITIONS[status] ?? [];
}
