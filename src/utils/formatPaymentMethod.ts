/**
 * PR-NEXT-6 (finding #16d) — surface the actual settlement method
 * on order-detail screens (shop / customer / admin). The original
 * `paymentMethod` field captures the customer's CHOICE at checkout
 * (online vs cod) but PR-NEXT-3 introduced a separate `paidMethod`
 * field to record the ACTUAL settlement (e.g. a COD order paid
 * mid-flow via `payCodOrder` settles as 'online'; partner cash
 * confirmation settles as 'cash'; partner UPI accepted outside the
 * app settles as 'online'). Without this helper the shop owner sees
 * "Cash on Delivery" on an order the customer actually paid online
 * — a confusing mismatch on every COD-converted order.
 *
 * Pure function, no side effects. Returns a single human-readable
 * line for the order-detail card.
 */
export type PaymentMethodInputs = {
  paymentMethod?: string | null;
  paidMethod?: 'cash' | 'online' | null;
  paymentStatus?: string | null;
};

export function formatPaymentMethod(input: PaymentMethodInputs): string {
  const { paymentMethod, paidMethod, paymentStatus } = input;
  // "paid" status is the only one where the settlement is a
  // settled fact. Anything else (pending, failed, expired,
  // refunded, undefined) → "Not yet paid" so the shop reads it as
  // an outstanding balance and the customer reads it as "I still
  // need to pay" rather than a misleading method label.
  if (paymentStatus !== 'paid') return 'Not yet paid';
  if (paymentMethod === 'cod') {
    if (paidMethod === 'online') {
      return 'Cash on delivery — paid online (converted)';
    }
    if (paidMethod === 'cash') return 'Cash on delivery — paid in cash';
    // Legacy COD orders (pre-PR-NEXT-3) marked paid without a
    // `paidMethod` stamp. Don't guess — the safe fallback names
    // the original choice + the paid status.
    return 'Cash on delivery — paid';
  }
  if (paymentMethod === 'online') return 'Online (paid up front)';
  // Defensive: paymentStatus says paid but paymentMethod is
  // missing/unknown. Render generically rather than mislabeling.
  return 'Paid';
}
