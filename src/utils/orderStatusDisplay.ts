/**
 * PR-NEXT-1 — Single source of truth for "what status label does
 * this order show right now."
 *
 * Pre-this-PR every customer / shopkeeper / delivery / admin
 * surface read `order.status` directly and applied its own ad-hoc
 * mapping (see `OrderStatusChip` + the bespoke "ready_by" branch
 * in `orderEtaDisplay`). The May 30 Android pilot validation
 * surfaced **finding #10**: a customer order with
 * `status === 'ready_for_pickup'` AND `pickedUpAt != null`
 * rendered the chip "Out for delivery" at the top AND the ETA
 * line "Pickup ready 5 min ago" at the bottom — two different
 * screens of the SAME UI disagreeing about whether the order
 * was in transit.
 *
 * Root cause: the `OrderStatusChip` customer-override mapped
 * `ready_for_pickup → 'Out for delivery'` unconditionally,
 * ignoring `pickedUpAt`. The fix lives here: a derived
 * `DisplayedStatus.state` that includes a synthetic
 * `'picked_up'` value (NOT in the `OrderStatus` enum — promoting
 * it would be a server-side state-machine refactor deferred to
 * a later PR; the synthetic state lets the UI lie consistently
 * without churning the wire format).
 *
 * The "decision matrix" (top-down, first-match-wins) is:
 *
 *   1. status === 'cancelled'                            → 'cancelled'
 *      (cancelled wins even if `deliveredAt` is somehow set —
 *      data inconsistency case; cancelled is the more important
 *      negative signal to surface).
 *   2. status === 'delivered'                            → 'delivered'
 *   3. status === 'ready_for_pickup' && pickedUpAt != null → 'picked_up'
 *   4. status === 'ready_for_pickup'                     → 'ready_for_pickup'
 *   5. else                                              → status
 *
 * Pure — no React, no firebase. Mirrors the helper-extraction
 * convention from `orderEtaDisplay`, `deliveryRoutingHelpers`,
 * `geoVisibilityHelpers`. Test matrix in
 * `tests/utils/orderStatusDisplay.test.ts` pins per-audience
 * label strings so a careless edit can't silently change
 * customer-visible text.
 */

import type { Order } from '../types';
import type { OrderStatus } from './orderStateMachine';

export type DisplayedState =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'ready_for_pickup'
  | 'picked_up' // synthetic — not in OrderStatus enum
  | 'delivered'
  | 'cancelled';

export type DisplayAudience = 'customer' | 'shopkeeper' | 'delivery' | 'admin';

export type DisplayedStatus = {
  state: DisplayedState;
  label: string;
  sublabel?: string;
};

/**
 * Per-audience labels. Exported so `OrderStatusChip` and any
 * other display surface can look up the same strings without
 * recomputing the state. Pinned in tests so a careless edit
 * can't silently change customer-visible text.
 */
export const ORDER_STATUS_LABELS: Record<
  DisplayAudience,
  Record<DisplayedState, string>
> = {
  customer: {
    pending: 'Awaiting shop confirmation',
    accepted: 'Shop accepted',
    preparing: 'Being prepared',
    ready_for_pickup: 'Ready — partner picking up',
    picked_up: 'Out for delivery',
    delivered: 'Delivered',
    cancelled: 'Order cancelled',
  },
  shopkeeper: {
    pending: 'New order — review',
    accepted: 'Order accepted',
    preparing: 'Preparing',
    ready_for_pickup: 'Ready for partner',
    picked_up: 'Picked up — out for delivery',
    delivered: 'Delivered',
    cancelled: 'Order cancelled',
  },
  delivery: {
    pending: 'New order at shop',
    accepted: 'Coming soon',
    preparing: 'Coming soon',
    ready_for_pickup: 'Ready to pick up',
    picked_up: 'Out for delivery',
    delivered: 'Delivered',
    cancelled: 'Order cancelled',
  },
  admin: {
    pending: 'Order placed',
    accepted: 'Accepted',
    preparing: 'Preparing',
    ready_for_pickup: 'Ready for pickup',
    picked_up: 'Out for delivery',
    delivered: 'Delivered',
    cancelled: 'Order cancelled',
  },
};

/**
 * Compute the displayed state from the order document. Reads
 * (status, pickedUpAt, deliveredAt) together so the UI can never
 * show contradictory labels for the same order. `cancelledAt`
 * is accepted for forward-compat but the current schema only
 * carries `status === 'cancelled'`; the helper degrades cleanly
 * when the field is absent.
 */
export function resolveDisplayedState(
  order: Pick<Order, 'status'> & {
    pickedUpAt?: number | null;
    deliveredAt?: number | null;
    cancelledAt?: number | null;
  },
): DisplayedState {
  const status = order.status as OrderStatus;
  // Cancelled wins — it's the most important negative signal,
  // and beats a stale `deliveredAt` if both somehow ended up on
  // the same doc (data inconsistency).
  if (status === 'cancelled') return 'cancelled';
  if (status === 'delivered') return 'delivered';
  if (status === 'ready_for_pickup') {
    return order.pickedUpAt != null ? 'picked_up' : 'ready_for_pickup';
  }
  // pending / accepted / preparing / and any defensively-unknown
  // future status all flow through unchanged.
  return status as DisplayedState;
}

/**
 * Top-level: state + label for the given audience. Use this on
 * any screen that renders an order's status as text. Direct
 * reads of `order.status` for branching logic (e.g. "show
 * Cancel button only if status === 'pending'") are still fine —
 * only the *displayed text* must flow through here.
 */
export function displayOrderStatus(
  order: Pick<Order, 'status'> & {
    pickedUpAt?: number | null;
    deliveredAt?: number | null;
    cancelledAt?: number | null;
  },
  audience: DisplayAudience,
): DisplayedStatus {
  const state = resolveDisplayedState(order);
  const label = ORDER_STATUS_LABELS[audience][state];
  return { state, label };
}
