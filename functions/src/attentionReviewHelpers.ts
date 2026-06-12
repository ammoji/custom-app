/**
 * PR-NEXT-BUNDLE-I §D/§E — pure helper for summarizing attention-review
 * rows from Firestore order docs. Shared between listMyAttentionReviews
 * (delivery partner) and listShopAttentionReviews (shop owner).
 *
 * Pinned by tests/functions/attentionReviewHelpers.test.ts.
 */

export type AttentionReviewRow = {
  orderId: string;
  shopName: string | null;
  deliveryRating: number | null;
  deliveryComment: string | null;
  shopRating: number | null;
  shopComment: string | null;
  deliveredAt: number | null;
  submittedAt: number | null;
};

export function summarizeAttentionReviewRows(
  docs: Array<{ id: string; data: Record<string, any> }>,
  // HOTFIX-ATTENTION-CALLABLES-MISSING §E — DO NOT REMOVE. Per-dimension
  // secondary filter aligned with the callable's per-dimension server query
  // (Bundle J §G). 'delivery' reads deliveryCorrectionState, 'shop' reads
  // shopCorrectionState. Omitted ⇒ legacy worst-of correctionState for any
  // pre-Bundle-J caller. Defends against the order denorm drifting from the
  // index (so the shop never inherits the partner's flagged row, and vice
  // versa — Sudhir 2026-06-10).
  dimension?: 'shop' | 'delivery',
): AttentionReviewRow[] {
  const stateField =
    dimension === 'shop'
      ? 'shopCorrectionState'
      : dimension === 'delivery'
        ? 'deliveryCorrectionState'
        : 'correctionState';
  return docs
    .filter(d => d.data[stateField] === 'flagged_low')
    .slice(0, 50)
    .map(d => ({
      orderId: d.id,
      shopName: d.data.shopName ?? null,
      deliveryRating: d.data.deliveryRating ?? null,
      deliveryComment: d.data.deliveryComment ?? null,
      shopRating: d.data.shopRating ?? null,
      shopComment: d.data.shopComment ?? null,
      deliveredAt: d.data.deliveredAt ?? null,
      submittedAt: d.data.updatedAt ?? d.data.deliveredAt ?? null,
    }))
    .sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0));
}
