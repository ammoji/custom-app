/**
 * PR 11 — Pure helpers for the admin order timeline view.
 *
 * Kept separate from the React component so the actor parsing and
 * status-label mapping can be unit-tested without a React renderer.
 * The component (src/components/order/OrderTimeline.tsx) imports these
 * and is itself a thin View+Text wrapper.
 *
 * statusHistory entries are written by Cloud Functions; their `by`
 * field follows two shapes:
 *
 *   - `${role}:${uid}` for human actors (e.g. `customer:7Xkj...`,
 *     `shopOwner:JK2L...`, `admin:abc1...`, `delivery:9Mxs...`,
 *     `client-confirm:abc1...`).
 *   - bare token for system actors (e.g. `system`,
 *     `system:cleanup`, `razorpay-webhook`).
 *
 * Both shapes flow into `formatTimelineActor` below. We render the
 * role + a 4-char uid prefix to keep the cell compact and avoid
 * leaking full uids in screenshots.
 *
 * The status union for `statusHistory` is wider than `Order['status']`
 * — it includes `paid`, `authorized`, `refund_pending`,
 * `refund_failed`, `amount_mismatch`. We can't reuse OrderStatusChip's
 * label map directly; instead we ship a permissive mapping with a
 * fallback to the raw token (rendered as-is) so an unexpected status
 * surfaces in the UI rather than silently disappearing.
 */

export type TimelineEntry = {
  status: string;
  at: number;
  by: string;
  reason?: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  preparing: 'Preparing',
  // PR 12 — admin/internal label. The admin order-timeline view
  // uses these labels; customer-facing copy ("Out for delivery")
  // lives in OrderStatusChip's CUSTOMER_LABEL_OVERRIDES.
  ready_for_pickup: 'Ready for Pickup',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  // Payment + refund states that show up in statusHistory but not
  // on Order['status'].
  paid: 'Paid',
  authorized: 'Payment authorized',
  amount_mismatch: 'Amount mismatch',
  refund_pending: 'Refund pending',
  refund_failed: 'Refund failed',
  refunded: 'Refunded',
};

export function labelForTimelineStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * Parse a `statusHistory[].by` value into a display-safe string.
 *
 * Examples:
 *   `customer:7XkjabcdEFG`         → `customer:7Xkj...`
 *   `shopOwner:JK2LmnopQ`          → `shopOwner:JK2L...`
 *   `system`                       → `system`
 *   `system:cleanup`               → `system:cleanup`
 *   `razorpay-webhook`             → `razorpay-webhook`
 *   `client-confirm:abc1234`       → `client-confirm:abc1...`
 *   ``                             → `unknown`
 *
 * Rules:
 *   - If the value contains `:` AND the suffix looks like a
 *     uid (>4 chars), truncate the suffix to 4 chars + `...`.
 *   - If the suffix is short (≤4 chars, e.g. `system:cleanup`,
 *     `system:abc`), return the full value untouched. This lets
 *     server-defined namespaced tokens like `system:cleanup`
 *     render verbatim instead of becoming `system:clea...`.
 *   - If there's no `:`, return the value as-is. Empty input
 *     becomes the literal `unknown` so the UI never renders an
 *     empty actor cell.
 */
export function formatTimelineActor(by: string | undefined | null): string {
  if (!by) return 'unknown';
  const idx = by.indexOf(':');
  if (idx === -1) return by;
  const role = by.slice(0, idx);
  const suffix = by.slice(idx + 1);
  // Heuristic: Firestore uids are ≥20 chars in practice but we
  // only need to distinguish "short namespaced token" from "uid".
  // 8 chars is the threshold — `cleanup`, `webhook` etc. fall
  // below it; uids land well above.
  if (suffix.length <= 8) {
    return by;
  }
  return `${role}:${suffix.slice(0, 4)}...`;
}
