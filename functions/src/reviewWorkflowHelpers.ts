/**
 * PR-NEXT-REVIEW-SYSTEM — pure state-machine helpers for the
 * low-rating correction workflow.
 *
 * Design: reviews that are ≤ the configured threshold start as
 * 'flagged_low' (private); above-threshold reviews publish
 * immediately. Once flagged, the shop/partner can respond, and
 * the customer can then amend or acknowledge. A 7-day timeout
 * publishes unresolved reviews automatically.
 *
 * These functions have zero I/O — all Firestore reads/writes
 * stay in index.ts so every decision can be unit-tested without
 * firebase-admin.
 *
 * Pinned by tests/functions/reviewWorkflowHelpers.test.ts.
 */

export type ReviewState =
  | 'submitted'
  | 'flagged_low'
  | 'responded'
  | 'amended'
  | 'published';

/**
 * Determine the initial correction state after a customer submits a
 * rating. If either dimension is at-or-below the configured threshold
 * the review is held private ('flagged_low'). Otherwise it publishes
 * immediately.
 *
 * `deliveryStars` may be null/undefined (partner not rated or not
 * assigned); in that case only shopStars is evaluated.
 */
export function decideInitialState(args: {
  shopStars: number;
  deliveryStars: number | null | undefined;
  shopThreshold: number;
  partnerThreshold: number;
}): { state: ReviewState; reason: 'above_threshold' | 'low_stars' } {
  const lowShop = args.shopStars <= args.shopThreshold;
  const lowPartner =
    args.deliveryStars != null && args.deliveryStars <= args.partnerThreshold;
  if (lowShop || lowPartner) {
    return { state: 'flagged_low', reason: 'low_stars' };
  }
  return { state: 'published', reason: 'above_threshold' };
}

/**
 * Can the shop/partner respond to this review?
 * Only in 'flagged_low' state (before customer can amend/ack).
 */
export function canRespond(state: ReviewState): boolean {
  return state === 'flagged_low';
}

/**
 * Can the customer amend their stars?
 * Only after the shop/partner has responded ('responded' state).
 */
export function canAmend(state: ReviewState): boolean {
  return state === 'responded';
}

/**
 * Can the customer acknowledge the response (keep original stars)?
 * Only in 'responded' state — mirrors canAmend gate.
 */
export function canAcknowledge(state: ReviewState): boolean {
  return state === 'responded';
}

/**
 * Should a stale review be auto-published by the timeout cron?
 * Returns true when the review is still 'flagged_low' AND the
 * elapsed time since submission exceeds `timeoutDays` (default 7).
 */
export function decideTimeoutPublish(args: {
  state: ReviewState;
  submittedAtMs: number;
  nowMs: number;
  timeoutDays?: number;
}): boolean {
  const days = args.timeoutDays ?? 7;
  const elapsed = args.nowMs - args.submittedAtMs;
  return (
    args.state === 'flagged_low' &&
    elapsed > days * 24 * 60 * 60 * 1000
  );
}
