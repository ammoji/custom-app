/**
 * PR-NEXT-BUNDLE-E §D/§E — pure helpers for cross-role review
 * moderation (admin scope + order review thread timeline).
 *
 * Both functions are pure (no Firestore) so the admin-visibility
 * policy and the timeline-ordering logic are unit-pinned without
 * booting the admin SDK. Pinned by
 * `tests/functions/reviewModerationHelpers.test.ts`.
 */

export type ReviewDocLike = {
  ratingId?: string;
  correctionState?: string | null;
  shopStars?: number | null;
  deliveryStars?: number | null;
  shopComment?: string | null;
  deliveryComment?: string | null;
  customerName?: string | null;
  submittedAt?: number | null;
  responseAt?: number | null;
  responseText?: string | null;
  responseBy?: string | null;
  amendedAt?: number | null;
  amendedStars?: {
    shopStars?: number | null;
    deliveryStars?: number | null;
  } | null;
  publishedAt?: number | null;
  publishedReason?: string | null;
};

/**
 * §E — admin sees ALL reviews; everyone else sees only published.
 * Pure filter over an already-fetched list. Does NOT mutate.
 */
export function filterReviewsForCaller<T extends { correctionState?: string | null }>(
  reviews: T[],
  callerIsAdmin: boolean,
): T[] {
  if (callerIsAdmin) return reviews.slice();
  return reviews.filter(r => r.correctionState === 'published');
}

export type ReviewTimelineEvent =
  | {
      type: 'submitted';
      at: number;
      shopStars: number | null;
      deliveryStars: number | null;
      comment: string | null;
    }
  | {
      type: 'response';
      at: number;
      by: string | null;
      text: string | null;
    }
  | {
      type: 'amended';
      at: number;
      shopStars: number | null;
      deliveryStars: number | null;
    }
  | {
      type: 'published';
      at: number;
      reason: string | null;
      state: string | null;
    };

/**
 * §D — build a chronological event timeline from the timestamps
 * stamped on a single review doc. Only emits events that actually
 * occurred (timestamp present). Sorted ascending by `at`, with a
 * stable phase tiebreaker (submitted → response → amended →
 * published) for equal timestamps.
 *
 * Pure. Does NOT read Firestore.
 */
export function buildReviewTimeline(
  review: ReviewDocLike,
): ReviewTimelineEvent[] {
  const events: Array<ReviewTimelineEvent & { phase: number }> = [];

  if (typeof review.submittedAt === 'number') {
    events.push({
      phase: 0,
      type: 'submitted',
      at: review.submittedAt,
      shopStars: review.shopStars ?? null,
      deliveryStars: review.deliveryStars ?? null,
      comment: review.shopComment ?? review.deliveryComment ?? null,
    });
  }
  if (typeof review.responseAt === 'number') {
    events.push({
      phase: 1,
      type: 'response',
      at: review.responseAt,
      by: review.responseBy ?? null,
      text: review.responseText ?? null,
    });
  }
  if (typeof review.amendedAt === 'number') {
    events.push({
      phase: 2,
      type: 'amended',
      at: review.amendedAt,
      shopStars: review.amendedStars?.shopStars ?? null,
      deliveryStars: review.amendedStars?.deliveryStars ?? null,
    });
  }
  if (typeof review.publishedAt === 'number') {
    events.push({
      phase: 3,
      type: 'published',
      at: review.publishedAt,
      reason: review.publishedReason ?? null,
      state: review.correctionState ?? null,
    });
  }

  return events
    .sort((a, b) => a.at - b.at || a.phase - b.phase)
    .map(({ phase: _phase, ...event }) => event);
}
