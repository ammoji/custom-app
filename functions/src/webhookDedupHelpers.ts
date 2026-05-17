/**
 * PR 2 — payment hardening. Pure helpers for the razorpayWebhook
 * handler:
 *
 *   - extractDedupKey: derive the stable identifier we use as the
 *     razorpayWebhookEvents/{eventId} doc id. Header-first, payload
 *     fallback. Razorpay sends the same event with the same
 *     `x-razorpay-event-id` header on every retry, so anchoring on
 *     it is the canonical idempotency key.
 *
 *   - detectAmountMismatch: is the captured amount within ±1 paisa
 *     of the order's expected total? We compare in paise (integer
 *     space) to avoid float-drift false positives — order.total is
 *     stored as rupees but the webhook payload is in paise.
 *
 *   - shouldIgnoreLatePaymentFailed: belt-and-suspenders guard for
 *     a `payment.failed` event that arrives AFTER `payment.captured`
 *     (rare, but Razorpay's event ordering is best-effort under
 *     network partition). The dedup ledger plus this guard close the
 *     "paid → failed downgrade" path the May 17 review flagged.
 *
 * Pure functions only — no Firestore, no fetch, no side effects. The
 * callable in functions/src/index.ts wraps these with Admin SDK
 * reads/writes and HttpsError throws.
 */

export type WebhookHeadersLike =
  | { [key: string]: string | string[] | undefined }
  | undefined
  | null;

export type WebhookPayloadLike = {
  event?: unknown;
  payload?: {
    payment?: {
      entity?: {
        id?: unknown;
      };
    };
  };
} | null | undefined;

/**
 * Compose a stable dedup key for the event. Prefer the
 * x-razorpay-event-id header (Razorpay's canonical event id, stable
 * across retries). Fall back to `${eventType}:${paymentId}` so we
 * still dedup something even if the header is missing — better than
 * letting a duplicate slip through.
 *
 * Returns null if neither path produces a usable key (event without
 * type AND without payment entity id). Caller logs and acks 200 in
 * that case so Razorpay stops retrying.
 */
export function extractDedupKey(input: {
  headers: WebhookHeadersLike;
  body: WebhookPayloadLike;
}): string | null {
  const headerVal = input.headers?.['x-razorpay-event-id'];
  // Header may be a string (Cloud Functions normalizes) or an array
  // (raw Node http). Normalize both.
  const headerId = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (typeof headerId === 'string' && headerId.length > 0) {
    return headerId;
  }
  const event = input.body?.event;
  const paymentId = input.body?.payload?.payment?.entity?.id;
  if (typeof event === 'string' && typeof paymentId === 'string') {
    return `${event}:${paymentId}`;
  }
  return null;
}

/**
 * Returns true iff the captured amount disagrees with the order's
 * expected total by more than ±1 paisa. We compare in paise (integer
 * space) — `Math.round(order.total * 100)` matches the value placeOrder
 * sent to Razorpay when creating the order, so a clean checkout will
 * always match exactly. Any mismatch is a real anomaly: a user who
 * tampered with the client, a price change between order creation and
 * payment, or a Razorpay bug.
 *
 * `expectedRupees == null` means we don't have enough info to compare
 * (legacy order without `total`, or order doc never loaded). Returns
 * false in that case — better to mark paid than to false-positive an
 * amount mismatch.
 */
export function detectAmountMismatch(input: {
  expectedRupees: number | null | undefined;
  receivedPaise: number | null | undefined;
}): boolean {
  if (input.expectedRupees == null) return false;
  if (typeof input.receivedPaise !== 'number') return false;
  const expectedPaise = Math.round(input.expectedRupees * 100);
  return expectedPaise !== input.receivedPaise;
}

/**
 * Should the payment.failed branch early-return without writing a
 * downgrade? Yes if the order is already in a terminal "good" state.
 * Anything other than 'pending' (current default for online orders
 * pre-capture) means a later event would be regression.
 *
 * The set is conservative: paid, authorized, refund_*, refunded —
 * anything where flipping to 'failed' would mislead the dashboard.
 */
export function shouldIgnoreLatePaymentFailed(input: {
  currentPaymentStatus: string | null | undefined;
}): boolean {
  const s = input.currentPaymentStatus;
  if (!s) return false;
  return (
    s === 'paid' ||
    s === 'authorized' ||
    s === 'refunded' ||
    s === 'refund_pending' ||
    s === 'refund_failed' ||
    s === 'amount_mismatch'
  );
}
