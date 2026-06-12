/**
 * PR-NEXT-BUNDLE-G §E — DO NOT REMOVE. Pure helper that derives the
 * payment status badge shown to delivery partners on dashboard cards
 * and OrderDetail. Replaces ad-hoc paymentMethod checks scattered
 * across the delivery UI. Pinned by tests/utils/derivePartnerPaymentBadge.test.ts.
 */

export type PartnerPaymentBadge =
  | { kind: 'paid_online'; label: string }
  | { kind: 'paid_cash'; label: string }
  | { kind: 'awaiting_cod'; label: string }
  | { kind: 'none' };

export function derivePartnerPaymentBadge(order: {
  paymentMethod?: 'cod' | 'online' | null;
  paymentStatus?: 'paid' | 'unpaid' | 'not_required' | null;
  paidMethod?: 'cash' | 'online' | null;
}): PartnerPaymentBadge {
  const { paymentMethod, paymentStatus, paidMethod } = order;

  if (paymentMethod === 'online' && paymentStatus === 'paid') {
    return { kind: 'paid_online', label: '💳 Paid online · no cash to collect' };
  }

  if (paymentMethod === 'cod' && paymentStatus === 'paid') {
    if (paidMethod === 'cash') {
      return { kind: 'paid_cash', label: '💵 Cash received' };
    }
    if (paidMethod === 'online') {
      return { kind: 'paid_online', label: '💳 Paid online · no cash to collect' };
    }
    return { kind: 'paid_online', label: '💳 Payment received' };
  }

  if (paymentMethod === 'cod' && paymentStatus !== 'paid') {
    return { kind: 'awaiting_cod', label: 'COD — confirm cash or UPI received' };
  }

  return { kind: 'none' };
}
