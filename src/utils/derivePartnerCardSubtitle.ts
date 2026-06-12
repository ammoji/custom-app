/**
 * PR-NEXT-BUNDLE-H §C — three-state subtitle for the customer's
 * partner identity card. Was previously two-state (pre-pickup vs
 * post-pickup), staying at "On the way to you" forever even after
 * delivered. Mirrors PartnerDetailsSheet's isFinalized pattern.
 *
 * Pinned by tests/utils/derivePartnerCardSubtitle.test.ts.
 */

export function derivePartnerCardSubtitle(input: {
  orderStatus: string | null | undefined;
  pickedUpAt: number | null | undefined;
}): string {
  if (input.orderStatus === 'delivered') return '✅ Delivered';
  if (input.orderStatus === 'cancelled') return '❌ Order cancelled';
  if (input.pickedUpAt != null) return '🛵 On the way to you';
  return '📦 Heading to the shop';
}
