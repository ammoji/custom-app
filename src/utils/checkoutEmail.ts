/**
 * PR 5 — Razorpay Checkout email prefill helper.
 *
 * Razorpay Checkout requires an email field by default (RBI compliance
 * for receipt delivery). When we don't prefill it, the customer sees
 * an extra mandatory input at the highest-conversion-stakes moment of
 * the order flow — friction we can avoid almost entirely.
 *
 * Strategy:
 *   - If the user has a saved profile email and it looks like an
 *     email (contains '@'), use it. This is the path real receipts
 *     should follow.
 *   - Otherwise, derive a phone-based placeholder against the
 *     `noemail.kiranamart.app` domain. That domain doesn't accept
 *     mail — it's a sentinel, not a delivery target. Razorpay's
 *     input validation accepts it, the customer doesn't have to type
 *     anything, and we don't pretend they consented to receive email
 *     at an address that isn't theirs.
 *
 * Extracted into `src/utils/` rather than inlined in CheckoutScreen
 * so the rules can be unit-tested without React.
 */
export function deriveCheckoutEmail(
  profile: { email?: string | null } | null,
  phone: string,
): string {
  const cleaned = profile?.email?.trim();
  if (cleaned && cleaned.includes('@')) return cleaned;
  // Strip everything that isn't a digit — handles `+91`, spaces,
  // hyphens, parens — Razorpay only cares that the local-part is
  // syntactically valid, and digits-only always is.
  const phoneDigits = phone.replace(/\D/g, '');
  return `${phoneDigits || 'guest'}@noemail.kiranamart.app`;
}
