/**
 * PR 2 — payment hardening. Pure helper for the retryPayment guard
 * (item 6 of the May 17 review).
 *
 * Without this check, retryPayment would happily mint a fresh
 * Razorpay order even when the OLD razorpayOrderId already had a
 * captured payment on Razorpay's side (webhook delayed, or
 * paymentStatus stuck pending due to a transient write failure).
 * The customer would then pay a SECOND time on the new order and
 * we'd have to refund manually.
 *
 * Verdict shape is the same `{ ok: true } | { ok: false; code; message }`
 * union the rest of the codebase uses (see deliveryRequestHelpers.ts).
 * The callable converts non-ok verdicts to HttpsError.
 */

import type { RazorpayPaymentLike } from './cleanupReconciliationHelpers';

export type RetryPaymentGuardResult =
  | { ok: true }
  | {
      ok: false;
      code: 'failed-precondition' | 'unverifiable';
      message: string;
    };

/**
 * Decide whether retryPayment is safe to proceed.
 *
 * `payments == null` means fetchPayments threw. The current behaviour
 * is conservative: surface as 'unverifiable' so the callable can
 * choose policy (currently it converts to HttpsError 'internal' —
 * better to ask the customer to refresh than to risk a double charge).
 *
 * Captured → block, surface "captured" message: customer should refresh
 * and check the order, not retry.
 * Authorized → block, surface "processing" message: webhook will
 * eventually capture or fail; rotating now risks double-auth.
 * Otherwise (failed / created / no payments) → ok to rotate.
 */
export function checkRetryPaymentGuard(input: {
  payments: RazorpayPaymentLike[] | null;
}): RetryPaymentGuardResult {
  if (input.payments == null) {
    return {
      ok: false,
      code: 'unverifiable',
      message:
        'Could not verify previous payment status. Please refresh and try again.',
    };
  }
  const captured = input.payments.find(p => p?.status === 'captured');
  if (captured) {
    return {
      ok: false,
      code: 'failed-precondition',
      message:
        'A previous payment for this order was captured. Refresh and check your order status.',
    };
  }
  const authorized = input.payments.find(p => p?.status === 'authorized');
  if (authorized) {
    return {
      ok: false,
      code: 'failed-precondition',
      message:
        'A previous payment for this order is being processed. Please wait a minute and refresh.',
    };
  }
  return { ok: true };
}
