/**
 * PR 20 — pure helpers for order rating submission.
 *
 * Two responsibilities:
 *   1. Validate the submitOrderRating input (auth, shape, order
 *      state, prior rating).
 *   2. Compute the new rolling average for a shop given its current
 *      avg + count + the new stars value.
 *
 * Pure — no Firestore, no React, no clock. Pinned by
 * `tests/functions/ratingHelpers.test.ts`.
 *
 * Architectural posture mirrors `cancelPaidOrderHelpers`,
 * `auditLogHelpers`, `favoritesHelpers`. No firebase-admin /
 * firebase-functions imports — keeps the helper plain-Node
 * runnable so the test file doesn't have to mock the whole
 * admin SDK.
 */

const MIN_STARS = 1;
const MAX_STARS = 5;
const MAX_COMMENT_LEN = 500;

export type SubmitRatingInput = {
  auth: { uid: string } | null | undefined;
  order:
    | {
        customerUid?: unknown;
        status?: unknown;
        rating?: unknown;
        shopId?: unknown;
      }
    | null
    | undefined;
  stars: unknown;
  comment: unknown;
};

export type SubmitRatingResult =
  | {
      ok: true;
      uid: string;
      shopId: string;
      stars: 1 | 2 | 3 | 4 | 5;
      comment?: string;
    }
  | {
      ok: false;
      code:
        | 'unauthenticated'
        | 'not-found'
        | 'permission-denied'
        | 'failed-precondition'
        | 'invalid-argument';
      message: string;
    };

/**
 * Validate the inputs to the `submitOrderRating` callable.
 *
 * Layered checks (cheapest first, most specific later):
 *   1. auth + order existence.
 *   2. customerUid match — only the order's owner may rate.
 *   3. status === 'delivered' — can't rate cancelled / in-flight.
 *   4. no prior rating — submit-once policy in MVP (editing would
 *      require the rolling average to recompute from scratch).
 *   5. shopId presence — defensive; rating must attribute somewhere.
 *   6. stars range + integer.
 *   7. comment trim + length cap.
 *
 * Returns a discriminated union so the callable can throw
 * `HttpsError(code, message)` directly.
 */
export function validateRatingSubmission(
  input: SubmitRatingInput,
): SubmitRatingResult {
  const { auth, order, stars, comment } = input;
  if (!auth?.uid) {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    };
  }
  if (!order) {
    return { ok: false, code: 'not-found', message: 'Order not found' };
  }
  if (
    typeof order.customerUid !== 'string' ||
    order.customerUid !== auth.uid
  ) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Only the order customer can rate it',
    };
  }
  if (order.status !== 'delivered') {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Only delivered orders can be rated',
    };
  }
  if (order.rating !== undefined && order.rating !== null) {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'This order has already been rated',
    };
  }
  if (typeof order.shopId !== 'string' || order.shopId.length === 0) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'Order is missing shopId — cannot attribute rating',
    };
  }
  if (
    typeof stars !== 'number' ||
    !Number.isInteger(stars) ||
    stars < MIN_STARS ||
    stars > MAX_STARS
  ) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'stars must be an integer 1-5',
    };
  }

  // Comment is optional but we still validate the SHAPE if provided.
  // Whitespace-only comments collapse to "no comment" so the doc
  // doesn't carry a phantom empty string field.
  let cleanComment: string | undefined;
  if (comment !== undefined && comment !== null && comment !== '') {
    if (typeof comment !== 'string') {
      return {
        ok: false,
        code: 'invalid-argument',
        message: 'comment must be a string',
      };
    }
    const trimmed = comment.trim();
    if (trimmed.length > MAX_COMMENT_LEN) {
      return {
        ok: false,
        code: 'invalid-argument',
        message: `comment too long (max ${MAX_COMMENT_LEN} chars)`,
      };
    }
    if (trimmed.length > 0) cleanComment = trimmed;
  }
  return {
    ok: true,
    uid: auth.uid,
    shopId: order.shopId,
    stars: stars as 1 | 2 | 3 | 4 | 5,
    comment: cleanComment,
  };
}

/**
 * Compute the new rolling average given the existing average +
 * count and the new stars value.
 *
 * Rounds avg to 1 decimal so customer-facing display stays clean
 * ("4.7" not "4.683333"). Float drift across many ratings is
 * bounded because we always store the rounded value back, so each
 * new computation uses the rounded prior — small error per step,
 * and ratingCount being tracked alongside means we can recompute
 * exactly from scratch if needed in a future migration.
 *
 * Defensively coerces negative / undefined / non-numeric current
 * stats to zero so a corrupted shop doc doesn't poison new
 * submissions.
 */
export function computeNewRollingAverage(
  currentAvg: number | undefined,
  currentCount: number | undefined,
  newStars: number,
): { newAvg: number; newCount: number } {
  const oldAvg =
    typeof currentAvg === 'number' && currentAvg >= 0 ? currentAvg : 0;
  const oldCount =
    typeof currentCount === 'number' && currentCount >= 0
      ? currentCount
      : 0;
  const newCount = oldCount + 1;
  const newAvgRaw = (oldAvg * oldCount + newStars) / newCount;
  const newAvg = Math.round(newAvgRaw * 10) / 10;
  return { newAvg, newCount };
}
