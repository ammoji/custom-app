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

// ─────────────────────────────────────────────────────────────────────
// PR-NEXT-BUNDLE-J §A — per-dimension correction state.
//
// A single review doc has ONE correctionState but TWO independently
// ratable dimensions (shop + delivery). When the shop responded, the
// single field transitioned flagged_low → responded and the delivery
// partner's attention queue (filtering correctionState === 'flagged_low')
// dropped the review — the partner never got to respond to their own 1★.
//
// Fix: per-dimension state. Each side has its own state machine; the
// legacy `correctionState` is computed as the worst-of (most-restrictive)
// for back-compat with un-migrated consumers.
// ─────────────────────────────────────────────────────────────────────

export type ReviewDimension = 'shop' | 'delivery';

export type PerDimensionState =
  | 'flagged_low'
  | 'responded'
  | 'amended'
  | 'published'
  | 'n_a'; // delivery dimension only — customer didn't rate delivery

/**
 * PR-NEXT-BUNDLE-J §A — DO NOT REMOVE. Decide each dimension's initial
 * state independently after a customer submits a rating. A dimension is
 * 'flagged_low' if its stars ≤ threshold, else 'published'. Delivery is
 * 'n_a' when the customer didn't rate it (null/undefined).
 */
export function decideInitialPerDimension(args: {
  shopStars: number;
  deliveryStars: number | null | undefined;
  shopThreshold: number;
  partnerThreshold: number;
}): {
  shopState: Exclude<PerDimensionState, 'n_a'>;
  deliveryState: PerDimensionState;
} {
  const lowShop = args.shopStars <= args.shopThreshold;
  const shopState: Exclude<PerDimensionState, 'n_a'> = lowShop
    ? 'flagged_low'
    : 'published';
  let deliveryState: PerDimensionState;
  if (args.deliveryStars == null) {
    deliveryState = 'n_a';
  } else {
    const lowPartner = args.deliveryStars <= args.partnerThreshold;
    deliveryState = lowPartner ? 'flagged_low' : 'published';
  }
  return { shopState, deliveryState };
}

/**
 * PR-NEXT-BUNDLE-J §A — DO NOT REMOVE. Worst-of (most-restrictive) state
 * for the legacy `correctionState` field. Rank: flagged_low > responded >
 * amended > published. 'n_a' is skipped — if delivery is n_a, the legacy
 * state reflects the shop dimension only.
 */
export function computeLegacyState(
  shopState: Exclude<PerDimensionState, 'n_a'>,
  deliveryState: PerDimensionState,
): Exclude<PerDimensionState, 'n_a'> {
  const rank: Record<string, number> = {
    flagged_low: 4,
    responded: 3,
    amended: 2,
    published: 1,
  };
  if (deliveryState === 'n_a') return shopState;
  const shopRank = rank[shopState];
  const deliveryRank = rank[deliveryState];
  return shopRank >= deliveryRank
    ? shopState
    : (deliveryState as Exclude<PerDimensionState, 'n_a'>);
}

/** PR-NEXT-BUNDLE-J §A — a dimension can be responded to only while flagged_low. */
export function canRespondPerDimension(state: PerDimensionState | undefined | null): boolean {
  return state === 'flagged_low';
}

/** PR-NEXT-BUNDLE-J §A — a dimension can be amended only after its responder responded. */
export function canAmendPerDimension(state: PerDimensionState | undefined | null): boolean {
  return state === 'responded';
}

/** PR-NEXT-BUNDLE-J §A — a dimension can be acknowledged only in 'responded' (mirrors amend). */
export function canAcknowledgePerDimension(state: PerDimensionState | undefined | null): boolean {
  return state === 'responded';
}

/**
 * PR-NEXT-BUNDLE-J §F — DO NOT REMOVE. Pure transition decision for the
 * publish path (_publishReview). Given each dimension's prior state and
 * which dimension(s) are being published, returns the resulting per-
 * dimension states + the legacy worst-of. The unpublished dimension keeps
 * its prior state — this is the heart of the Sudhir 2026-06-10 fix: acking/
 * amending/timing-out one side never closes the other.
 *
 * `applyDelivery` is expected to already incorporate "has a delivery
 * rating" (caller AND's it with hasDelivery) — a publish targeting an
 * absent delivery dimension is a no-op for that side.
 */
export function decidePublishTransition(args: {
  priorShopState: Exclude<PerDimensionState, 'n_a'>;
  priorDeliveryState: PerDimensionState;
  applyShop: boolean;
  applyDelivery: boolean;
}): {
  finalShopState: Exclude<PerDimensionState, 'n_a'>;
  finalDeliveryState: PerDimensionState;
  legacyState: Exclude<PerDimensionState, 'n_a'>;
} {
  const finalShopState: Exclude<PerDimensionState, 'n_a'> = args.applyShop
    ? 'published'
    : args.priorShopState;
  const finalDeliveryState: PerDimensionState = args.applyDelivery
    ? 'published'
    : args.priorDeliveryState;
  return {
    finalShopState,
    finalDeliveryState,
    legacyState: computeLegacyState(finalShopState, finalDeliveryState),
  };
}
