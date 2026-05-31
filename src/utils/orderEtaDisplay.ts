/**
 * PR 43 — ETA display state machine for customer-facing surfaces.
 *
 * Tells callers WHAT to render in the "time-to-arrival" slot for a
 * given order, based on its current status and whether the shop
 * has set a `readyByEstimate` yet.
 *
 * Why: pre-PR-43 the customer saw "Arriving in ~29 min" the
 * instant they placed an order, based on
 * `estimatedDeliveryAt = createdAt + shop.etaMinutes * 60s`. That
 * number was just the shop's default ETA wish — not a commitment,
 * not what the shop owner sees, sometimes very different from the
 * ETA the shop will actually set on acceptance. PR 43 hides the
 * minute count until the shop has accepted; until then, customer
 * sees "Awaiting shop confirmation" instead.
 *
 * Used by:
 *   - OrderConfirmationScreen (immediate post-placement view)
 *   - OrderDetailScreen (live tracking)
 *   - ActiveOrdersRail on HomeScreen (in-flight order summary)
 *
 * NOT used by shop-owner or delivery-partner surfaces — they have
 * legitimate reasons to see the minute count even pre-acceptance
 * (shop owner: to plan; delivery partner: to know what's pending).
 * PR 43 Part A is customer-side only.
 *
 * Pure — exclusively a function of (order, nowMs). No React, no
 * clock, no store; every branch is unit-tested.
 */

export type OrderEtaDisplay =
  // status === 'pending'. The shop has not yet accepted; no number
  // commitment exists. Renderer shows "Awaiting shop confirmation"
  // (or per-surface variant).
  | { kind: 'awaiting_confirmation' }
  // status accepted+ AND shop set readyByEstimate. Renderer uses
  // PR 36.1's two-line formatRelativeTime countdown.
  | { kind: 'ready_by'; readyByEstimate: number }
  // status accepted+ AND shop did NOT set readyByEstimate (legacy
  // orders, defensive). Renderer shows "Arriving in ~N min" using
  // the order's creation-time estimate.
  | { kind: 'eta_fallback'; minutesLeft: number }
  // Same as eta_fallback but the estimate has elapsed. Renderer
  // shows "Arriving soon."
  | { kind: 'arriving_soon' }
  // status delivered / cancelled, OR both estimates are missing.
  // Renderer renders nothing.
  | { kind: 'hidden' };

export type EtaInput = {
  status:
    | 'pending'
    | 'accepted'
    | 'preparing'
    | 'ready_for_pickup'
    | 'delivered'
    | 'cancelled';
  // Both estimates accept null because Firestore-shaped Order docs
  // use `number | null` for unset timestamps; coercing to undefined
  // at every call site would be noisy. Helper treats null and
  // undefined identically (both → "missing").
  readyByEstimate?: number | null;
  estimatedDeliveryAt?: number | null;
  // PR-NEXT-1 (finding #10) — once the partner has picked the
  // order up, the customer-facing ETA copy must stop rendering
  // the "Pickup ready 5 min ago" line. Pre-fix that line was
  // still computed off `readyByEstimate` and contradicted the
  // chip's "Out for delivery" label. The chip uses
  // `displayOrderStatus` to read the synthetic `picked_up`
  // state; this helper mirrors the same pickedUpAt-aware
  // collapse to `hidden`.
  pickedUpAt?: number | null;
};

export function orderEtaDisplay(
  order: EtaInput,
  nowMs: number,
): OrderEtaDisplay {
  // Terminal + in-transit states first — no ETA copy regardless
  // of what estimates are still hanging on the order doc.
  if (order.status === 'delivered' || order.status === 'cancelled') {
    return { kind: 'hidden' };
  }
  if (order.pickedUpAt != null) {
    // PR-NEXT-1 — order is in transit. The chip handles the
    // "Out for delivery" label; the ETA slot stays empty rather
    // than continuing to count down to a moment in the past.
    return { kind: 'hidden' };
  }

  // PR 43 — gate the minute count behind shop acceptance. The
  // customer sees no number until the shop owner taps Accept.
  // Pre-PR-43 this state showed "Arriving in ~29 min" based on
  // shop.etaMinutes which violated Trust Principle 2 (anchor
  // expectation only on real commitments).
  if (order.status === 'pending') {
    return { kind: 'awaiting_confirmation' };
  }

  // Status is accepted / preparing / ready_for_pickup.
  // Prefer the shop's accepted ETA; fall back to the order's
  // creation-time estimate ONLY if the shop's accepted ETA is
  // somehow missing (legacy orders, defensive).
  if (
    typeof order.readyByEstimate === 'number' &&
    Number.isFinite(order.readyByEstimate) &&
    order.readyByEstimate > 0
  ) {
    return {
      kind: 'ready_by',
      readyByEstimate: order.readyByEstimate,
    };
  }

  if (
    typeof order.estimatedDeliveryAt === 'number' &&
    Number.isFinite(order.estimatedDeliveryAt) &&
    order.estimatedDeliveryAt > 0
  ) {
    const minutesLeft = Math.round(
      (order.estimatedDeliveryAt - nowMs) / 60_000,
    );
    if (minutesLeft <= 0) {
      return { kind: 'arriving_soon' };
    }
    return { kind: 'eta_fallback', minutesLeft };
  }

  // Neither estimate is usable — render nothing rather than a
  // misleading "~NaN min".
  return { kind: 'hidden' };
}
