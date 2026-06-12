/**
 * HOTFIX-REVIEW-DENORM — pure helper that produces the per-order
 * denormalization payload from a review-doc state transition.
 *
 * Why a helper: the same denorm logic must run from 4 different
 * code paths (respondToReview, and _publishReview which is called
 * by amendRating / acknowledgeReview / publishTimedOutReviews) and
 * the previous "let each callable roll its own object" pattern is
 * exactly how submitOrderRating's correct denorm got mirrored only
 * there.
 *
 * Rule 14 — discriminated-union input so callers name every field;
 * the payload is a plain Firestore-merge-compatible Record.
 *
 * Pinned by tests/functions/reviewDenormHelpers.test.ts.
 */
import { FieldValue } from 'firebase-admin/firestore';

export type ReviewCorrectionState =
  | 'submitted'
  | 'flagged_low'
  | 'responded'
  | 'amended'
  | 'published';

export type PerDimensionCorrectionState =
  | 'flagged_low'
  | 'responded'
  | 'amended'
  | 'published'
  | 'n_a';

export type ReviewDenormInput = {
  nextState: ReviewCorrectionState;
  nowMs: number;
  responseText?: string;
  responseBy?: 'shop' | 'partner';
  responseAt?: number;
  newShopStars?: number;
  newDeliveryStars?: number;
  publishedReason?:
    | 'above_threshold'
    | 'shop_responded'
    | 'customer_amended'
    | 'customer_acknowledged'
    | 'timeout'
    | null;
  // PR-NEXT-BUNDLE-J §C/§F — DO NOT REMOVE. Per-dimension denorm onto the
  // order doc. Consumers (Delivery/Shop OrderDetail, customer panel) read
  // these so the delivery partner never sees the shop's response text and
  // vice-versa. Legacy correctionState/responseText stay as worst-of /
  // last-responder pointers for un-migrated readers.
  shopCorrectionState?: PerDimensionCorrectionState;
  deliveryCorrectionState?: PerDimensionCorrectionState;
  shopResponseText?: string;
  partnerResponseText?: string;
  shopRespondedAt?: number;
  partnerRespondedAt?: number;
};

export type ReviewDenormPayload = Record<string, unknown>;

/**
 * Build the Firestore merge payload to write onto orders/{orderId}
 * mirroring the new review state. Caller invokes:
 *
 *   await db.doc(`orders/${orderId}`).set(
 *     buildOrderReviewDenormPayload(input),
 *     { merge: true },
 *   );
 *
 * Always includes `correctionState` and `updatedAt`. Conditionally
 * includes response fields, star overrides, and published metadata.
 */
export function buildOrderReviewDenormPayload(
  input: ReviewDenormInput,
): ReviewDenormPayload {
  const payload: ReviewDenormPayload = {
    correctionState: input.nextState,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (input.responseText !== undefined) payload.responseText = input.responseText;
  if (input.responseBy !== undefined) payload.responseBy = input.responseBy;
  if (input.responseAt !== undefined) payload.responseAt = input.responseAt;
  if (input.newShopStars !== undefined) payload.shopRating = input.newShopStars;
  if (input.newDeliveryStars !== undefined) payload.deliveryRating = input.newDeliveryStars;
  if (input.nextState === 'published') {
    payload.publishedAt = input.nowMs;
    payload.publishedReason = input.publishedReason ?? null;
  }
  // PR-NEXT-BUNDLE-J §C/§F — per-dimension denorm fields (only when set).
  if (input.shopCorrectionState !== undefined) {
    payload.shopCorrectionState = input.shopCorrectionState;
  }
  if (input.deliveryCorrectionState !== undefined) {
    payload.deliveryCorrectionState = input.deliveryCorrectionState;
  }
  if (input.shopResponseText !== undefined) payload.shopResponseText = input.shopResponseText;
  if (input.partnerResponseText !== undefined) {
    payload.partnerResponseText = input.partnerResponseText;
  }
  if (input.shopRespondedAt !== undefined) payload.shopRespondedAt = input.shopRespondedAt;
  if (input.partnerRespondedAt !== undefined) {
    payload.partnerRespondedAt = input.partnerRespondedAt;
  }
  return payload;
}

// ─── Backfill helper ────────────────────────────────────────────────────────

/**
 * HOTFIX-REVIEW-DENORM §F — derives the order denorm payload from a
 * raw review document snapshot, for use by the backfill script.
 *
 * Mirrors the live callable logic: resolves the per-state fields
 * that each callable writes so the backfill can replay the same
 * semantics idempotently.
 *
 * Pinned by test "deriveDenormFromReview" in reviewDenormHelpers.test.ts.
 */
export function deriveDenormFromReview(
  review: Record<string, unknown>,
): ReviewDenormPayload {
  const state = (review.correctionState as ReviewCorrectionState) ?? 'submitted';
  const input: ReviewDenormInput = {
    nextState: state,
    nowMs: typeof review.publishedAt === 'number' ? review.publishedAt : Date.now(),
  };

  if (state === 'responded' || state === 'amended' || state === 'published') {
    if (typeof review.responseText === 'string') input.responseText = review.responseText;
    if (review.responseBy === 'shop' || review.responseBy === 'partner') {
      input.responseBy = review.responseBy;
    }
    if (typeof review.responseAt === 'number') input.responseAt = review.responseAt;
  }

  if (state === 'published') {
    const reason = review.publishedReason;
    if (
      reason === 'above_threshold' ||
      reason === 'shop_responded' ||
      reason === 'customer_amended' ||
      reason === 'customer_acknowledged' ||
      reason === 'timeout' ||
      reason === null
    ) {
      input.publishedReason = reason;
    } else {
      input.publishedReason = null;
    }
    if (typeof review.shopStars === 'number') input.newShopStars = review.shopStars;
    if (typeof review.deliveryStars === 'number') input.newDeliveryStars = review.deliveryStars;
  }

  return buildOrderReviewDenormPayload(input);
}

// ─── PR-NEXT-BUNDLE-J §J — per-dimension backfill ───────────────────────────

/**
 * PR-NEXT-BUNDLE-J §J — DO NOT REMOVE. Best-effort reconstruction of the
 * per-dimension correction fields from a legacy review doc that only has
 * the single `correctionState` + `responseBy`/`responseText`.
 *
 * Heuristics (legacy data can't perfectly disambiguate which side was low,
 * so we use the stored stars + the responder identity):
 *   - threshold ≤ 3 ⇒ that dimension "was flagged".
 *   - 'published'/'amended' ⇒ both resolved (published).
 *   - 'flagged_low'         ⇒ each low side flagged_low, non-low published.
 *   - 'responded'           ⇒ the responder's side 'responded'; the OTHER
 *                             low side stays 'flagged_low' (this is the bug
 *                             victim we must NOT auto-close). Unknown
 *                             responder defaults to 'shop'.
 * Returns only the fields that should be written (merge-safe).
 *
 * Pinned by tests/functions/backfillPerDimension.test.ts.
 */
export function deriveBackfillPerDimension(
  review: Record<string, unknown>,
  threshold = 3,
): Record<string, unknown> {
  const state = (review.correctionState as string) ?? 'submitted';
  const shopStars = typeof review.shopStars === 'number' ? review.shopStars : null;
  const deliveryStars =
    typeof review.deliveryStars === 'number' ? review.deliveryStars : null;
  const hasDelivery = deliveryStars !== null;
  const shopLow = shopStars !== null && shopStars <= threshold;
  const deliveryLow = hasDelivery && (deliveryStars as number) <= threshold;
  const responseBy =
    review.responseBy === 'shop' || review.responseBy === 'partner'
      ? review.responseBy
      : null;

  let shopCS: 'flagged_low' | 'responded' | 'published';
  let deliveryCS: 'flagged_low' | 'responded' | 'published' | 'n_a';

  if (state === 'published' || state === 'amended') {
    shopCS = 'published';
    deliveryCS = hasDelivery ? 'published' : 'n_a';
  } else if (state === 'responded') {
    // Default the responder to 'shop' when unknown (legacy single-field bug).
    const responder = responseBy ?? 'shop';
    if (responder === 'shop') {
      shopCS = 'responded';
      deliveryCS = !hasDelivery ? 'n_a' : deliveryLow ? 'flagged_low' : 'published';
    } else {
      shopCS = shopLow ? 'flagged_low' : 'published';
      deliveryCS = 'responded';
    }
  } else {
    // 'flagged_low' / 'submitted' / unknown → threshold-derived.
    shopCS = shopLow ? 'flagged_low' : 'published';
    deliveryCS = !hasDelivery ? 'n_a' : deliveryLow ? 'flagged_low' : 'published';
  }

  const out: Record<string, unknown> = {
    shopCorrectionState: shopCS,
    deliveryCorrectionState: deliveryCS,
  };

  // Map the single legacy response onto the responder's dimension fields.
  if (responseBy === 'shop') {
    if (typeof review.responseText === 'string') out.shopResponseText = review.responseText;
    if (typeof review.responseAt === 'number') out.shopRespondedAt = review.responseAt;
  } else if (responseBy === 'partner') {
    if (typeof review.responseText === 'string') {
      out.partnerResponseText = review.responseText;
    }
    if (typeof review.responseAt === 'number') out.partnerRespondedAt = review.responseAt;
  }

  return out;
}
