/**
 * PR 2 — payment hardening. Pure helper for the
 * cleanupAbandonedOrders pre-cancel reconciliation step (item 5 of
 * the May 17 review).
 *
 * Without this guard a paid order whose `payment.captured` webhook
 * was delayed >24h would be cancelled by the scheduled sweep — real
 * money kept by the merchant with no audit trail. The fix is to call
 * Razorpay's fetchPayments(razorpayOrderId) before cancelling and
 * branch on what we find:
 *
 *   - captured payment exists  → mark order paid (webhook was late)
 *   - authorized payment exists → flag for manual review, DON'T cancel
 *   - no payments / fetch threw → defer (skip this sweep, retry next)
 *
 * The third branch is the safety-first default: if Razorpay's API is
 * down we'd rather leave the order pending another hour than risk
 * cancelling something paid.
 *
 * Pure function over a Razorpay-shaped payments list. The callable
 * passes payments.items? from razorpay.orders.fetchPayments(); tests
 * pass synthetic shapes.
 */

export type RazorpayPaymentLike = {
  id?: string;
  status?: string;
  created_at?: number;
};

export type ReconcileVerdict =
  | { kind: 'mark_paid'; paymentId: string; createdAt: number | null }
  | { kind: 'authorized_review'; paymentId: string }
  | { kind: 'cancel_ok' }
  | { kind: 'defer_unverifiable' };

/**
 * Decide what to do with an abandoned order during cleanup, given
 * Razorpay's report of payments against its razorpayOrderId.
 *
 * `payments == null` means fetchPayments threw; we defer rather than
 * risk cancelling a paid order on transient API failure.
 *
 * Empty array means Razorpay has no payments for this order — the
 * customer dismissed the sheet without paying, expected outcome,
 * proceed with cancel.
 *
 * Captured wins over authorized when both exist (rare; would mean a
 * second authorization after capture — proceed treating it as paid).
 */
export function reconcileAbandonedOrder(input: {
  payments: RazorpayPaymentLike[] | null;
}): ReconcileVerdict {
  if (input.payments == null) {
    return { kind: 'defer_unverifiable' };
  }
  const captured = input.payments.find(p => p?.status === 'captured');
  if (captured && typeof captured.id === 'string') {
    return {
      kind: 'mark_paid',
      paymentId: captured.id,
      createdAt:
        typeof captured.created_at === 'number' ? captured.created_at : null,
    };
  }
  const authorized = input.payments.find(p => p?.status === 'authorized');
  if (authorized && typeof authorized.id === 'string') {
    return { kind: 'authorized_review', paymentId: authorized.id };
  }
  return { kind: 'cancel_ok' };
}
