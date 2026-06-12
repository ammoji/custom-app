/**
 * HOTFIX-RESPOND-OWNER-AND-CARD-NAV §D — view model for the new
 * AttentionQueueScreen. Transforms the AttentionReviewRow[] from the
 * server into a render-ready list with the role's rated dimension,
 * a comment excerpt, and an auto-publish countdown (days left).
 */

export type AttentionQueueRow = {
  orderId: string;
  shopName: string | null;
  ratingStars: number; // 1-5 for the role's rated dimension (0 if absent)
  commentExcerpt: string | null; // First 80 chars (+ ellipsis when longer)
  submittedAtMs: number | null;
  daysLeft: number | null; // 7 - days since submitted (auto-publish countdown)
};

const DAY_MS = 86_400_000;
const AUTO_PUBLISH_DAYS = 7;
const EXCERPT_MAX = 80;

export function buildAttentionQueueRows(
  role: 'delivery' | 'shop',
  rawRows: Array<{
    orderId: string;
    shopName?: string | null;
    deliveryRating?: number | null;
    deliveryComment?: string | null;
    shopRating?: number | null;
    shopComment?: string | null;
    submittedAt?: number | null;
  }>,
  nowMs: number,
): AttentionQueueRow[] {
  return rawRows.map(r => {
    const stars =
      role === 'delivery' ? (r.deliveryRating ?? 0) : (r.shopRating ?? 0);
    const comment =
      role === 'delivery' ? (r.deliveryComment ?? null) : (r.shopComment ?? null);
    const submittedAtMs = r.submittedAt ?? null;
    const daysLeft =
      submittedAtMs != null
        ? Math.max(
            0,
            AUTO_PUBLISH_DAYS - Math.floor((nowMs - submittedAtMs) / DAY_MS),
          )
        : null;
    return {
      orderId: r.orderId,
      shopName: r.shopName ?? null,
      ratingStars: stars,
      commentExcerpt: comment
        ? comment.slice(0, EXCERPT_MAX) + (comment.length > EXCERPT_MAX ? '…' : '')
        : null,
      submittedAtMs,
      daysLeft,
    };
  });
}
