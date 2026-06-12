/**
 * PR-NEXT-BUNDLE-G §C — DO NOT REMOVE. Pure helpers for computing
 * publicRatingCount / publicDeliveryRatingCount increments on
 * review state transitions. Pinned by tests.
 */

export type ReviewCorrectionState =
  | 'flagged_low'
  | 'responded'
  | 'amended'
  | 'published'
  | 'acknowledged';

/**
 * Returns 1 when a transition INTO 'published' is happening for the
 * first time (prev !== 'published'), 0 otherwise. Idempotent — repeated
 * calls from the same state return 0 so counts never double-increment.
 *
 * `prev` is widened to `string` so callers can pass any review state
 * type (e.g. ReviewState from reviewWorkflowHelpers) without a cast.
 */
export function computePublicCountDelta(
  prev: string | null | undefined,
  next: string,
): 0 | 1 {
  if (next !== 'published') return 0;
  if (prev === 'published') return 0;
  return 1;
}

/**
 * Given an array of review documents, counts how many are published
 * for a given shopId. Used by backfill-public-rating-count.ts.
 */
export function countPublishedShopReviews(
  reviews: Array<{ shopId?: string | null; correctionState?: string | null }>,
  shopId: string,
): number {
  return reviews.filter(
    r => r.shopId === shopId && r.correctionState === 'published',
  ).length;
}

/**
 * Given an array of review documents, counts how many are published
 * for a given deliveryPersonId.
 */
export function countPublishedPartnerReviews(
  reviews: Array<{
    deliveryPersonId?: string | null;
    correctionState?: string | null;
  }>,
  partnerUid: string,
): number {
  return reviews.filter(
    r =>
      r.deliveryPersonId === partnerUid && r.correctionState === 'published',
  ).length;
}
