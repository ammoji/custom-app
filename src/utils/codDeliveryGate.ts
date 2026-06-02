/**
 * PR-NEXT-COD-UX (Case 8) — client-side mirror of
 * `validateMarkDeliveredCodGate` from
 * `functions/src/codPaymentHelpers.ts`. The server is the gate of
 * record (it rejects `markDelivered` on COD-unpaid orders); this
 * helper is purely cosmetic — hides the Delivered CTA when the
 * server would reject it, so the partner never gets the dead-tap-
 * then-error UX Sudhir reported.
 *
 * Audience-uniform contract used by both the dashboard's
 * `ActiveDeliveryCard` and `DeliveryOrderDetailScreen`, so the two
 * surfaces stay in lockstep — partner doesn't bounce between them
 * to find an action.
 *
 *   true  → Delivered button safe to show (online+paid, or
 *           cod+paid via Cash/UPI pill OR via `payCodOrder`
 *           conversion).
 *   false → COD unpaid (or online unpaid) — show the Cash/UPI
 *           confirmation pills instead.
 *
 * Pinned by tests/utils/codDeliveryGate.test.ts.
 */
import type { Order } from '../types';

export function canShowDeliveredButton(
  order: Pick<Order, 'paymentMethod' | 'paymentStatus'>,
): boolean {
  if (order.paymentMethod === 'online' && order.paymentStatus === 'paid') {
    return true;
  }
  if (order.paymentMethod === 'cod' && order.paymentStatus === 'paid') {
    return true;
  }
  return false;
}
