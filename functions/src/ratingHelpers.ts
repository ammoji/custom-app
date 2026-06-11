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

// PR 42.1 — Dual-rating shape ──────────────────────────────────────
//
// The customer rates two dimensions per delivered order: the shop
// (product quality, packaging, freshness) and the delivery partner
// (timeliness, courtesy, condition on arrival). Industry standard
// (Swiggy / Zomato / Blinkit) — splits the surface so a slow
// delivery doesn't tank the shop's rolling average unfairly, and
// the delivery partner builds an independent reputation.
//
// Backwards-compat is LOAD-BEARING during the OTA propagation
// window: a not-yet-OTA'd client will still send
// `{ stars, comment }`. The helper detects the input shape (new
// uses `shopRating`, legacy uses `stars`) and coerces legacy to
// shop-only. Both shapes produce the SAME canonical result; the
// callable writes to the new flat schema (`shopRating`,
// `shopComment`, `deliveryRating?`, `deliveryComment?`) on the
// order doc regardless of input shape.
//
// Submit-once policy spans BOTH schemas: an order with either the
// legacy `order.rating` object OR the new `order.shopRating`
// number is "already rated".

export type SubmitDualRatingInput = {
  auth: { uid: string } | null | undefined;
  order:
    | {
        customerUid?: unknown;
        status?: unknown;
        // Legacy: nested `{ stars, comment?, ratedAt }` object
        // (PR 20). Presence-truthy means already rated.
        rating?: unknown;
        // New: flat 1-5 integer (PR 42.1). Presence (any value
        // other than undefined / null) means already rated.
        shopRating?: unknown;
        shopId?: unknown;
        deliveryPersonId?: unknown;
      }
    | null
    | undefined;
  // Legacy single-rating fields (still accepted for OTA-transition
  // safety). If `shopRating` is also present, the new shape wins
  // and these are ignored.
  stars?: unknown;
  comment?: unknown;
  // New dual-rating fields. `shopRating` is required for the new
  // shape; `deliveryRating` is optional even when `shopRating` is
  // present (customer skipped the delivery dimension).
  shopRating?: unknown;
  shopComment?: unknown;
  deliveryRating?: unknown;
  deliveryComment?: unknown;
};

export type SubmitDualRatingResult =
  | {
      ok: true;
      uid: string;
      shopId: string;
      shopRating: 1 | 2 | 3 | 4 | 5;
      shopComment?: string;
      // Present only if delivery rating was submitted AND the order
      // has a `deliveryPersonId`. The callable uses the presence of
      // `deliveryPersonId` to decide whether to run the second
      // user-doc write; if delivery rating was submitted but the
      // order has no partner, the helper drops the dimension and
      // logs `deliveryDropped: 'no-partner'` for ops visibility.
      deliveryRating?: 1 | 2 | 3 | 4 | 5;
      deliveryComment?: string;
      deliveryPersonId?: string;
      // Diagnostic — only set when the delivery rating was sent but
      // had to be dropped. Lets the callable emit a warn log + the
      // audit metadata record the drop without failing the
      // submission. Empty string = no drop.
      deliveryDropped?: 'no-partner';
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

function validateStarsInteger(
  value: unknown,
  fieldName: string,
): { ok: true; value: 1 | 2 | 3 | 4 | 5 } | { ok: false; message: string } {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_STARS ||
    value > MAX_STARS
  ) {
    return { ok: false, message: `${fieldName} must be an integer 1-5` };
  }
  return { ok: true, value: value as 1 | 2 | 3 | 4 | 5 };
}

function validateCommentField(
  value: unknown,
  fieldName: string,
):
  | { ok: true; value: string | undefined }
  | { ok: false; message: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'string') {
    return { ok: false, message: `${fieldName} must be a string` };
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_COMMENT_LEN) {
    return {
      ok: false,
      message: `${fieldName} too long (max ${MAX_COMMENT_LEN} chars)`,
    };
  }
  // Whitespace-only collapses to undefined so the doc doesn't carry
  // a phantom empty-string field. Matches PR 20's single-comment
  // posture.
  return { ok: true, value: trimmed.length > 0 ? trimmed : undefined };
}

/**
 * PR 42.1 — dual-rating validator. Accepts both the new
 * shop+delivery shape and the PR 20 legacy single-rating shape;
 * normalises both to a canonical result the callable writes to
 * the new flat schema.
 *
 * Layered checks (cheapest first):
 *   1. auth + order existence.
 *   2. customerUid match.
 *   3. status === 'delivered'.
 *   4. Submit-once across BOTH schemas (`order.rating` legacy OR
 *      `order.shopRating` new).
 *   5. order.shopId presence.
 *   6. Shape detection — `input.shopRating !== undefined` → new
 *      path; else `input.stars !== undefined` → legacy → coerce
 *      to shopRating. Both detections enforce 1-5 integer range.
 *   7. Comments (shopComment + deliveryComment) shape + length
 *      cap of 500 chars each. Whitespace-only collapses to
 *      undefined.
 *   8. Delivery rating (new path only) — if present, validate
 *      range. If `order.deliveryPersonId` is missing, accept the
 *      shop rating but drop the delivery dimension with a
 *      `deliveryDropped: 'no-partner'` marker; callable logs +
 *      audit captures.
 */
export function validateDualRatingSubmission(
  input: SubmitDualRatingInput,
): SubmitDualRatingResult {
  const { auth, order } = input;
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
  // Already-rated span — legacy nested object OR new flat number.
  if (
    (order.rating !== undefined && order.rating !== null) ||
    (order.shopRating !== undefined && order.shopRating !== null)
  ) {
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

  // Shape detection. New shape uses `shopRating`; legacy uses
  // `stars`. If both are present (shouldn't happen — clients send
  // one or the other), new wins because that's the path the OTA
  // is migrating to. If neither is present, reject — a
  // delivery-only submission is not a valid rating.
  const hasNewShape = input.shopRating !== undefined;
  const hasLegacyShape = input.stars !== undefined;
  if (!hasNewShape && !hasLegacyShape) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'shopRating is required (delivery rating alone is not valid)',
    };
  }

  // Validate shop rating from whichever shape was sent.
  const rawShopStars = hasNewShape ? input.shopRating : input.stars;
  const shopStarsCheck = validateStarsInteger(
    rawShopStars,
    hasNewShape ? 'shopRating' : 'stars',
  );
  if (!shopStarsCheck.ok) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: shopStarsCheck.message,
    };
  }

  // Validate shop comment — new path uses `shopComment`, legacy
  // uses `comment`. We prefer the new field if both are sent.
  const rawShopComment = hasNewShape ? input.shopComment : input.comment;
  const shopCommentCheck = validateCommentField(
    rawShopComment,
    hasNewShape ? 'shopComment' : 'comment',
  );
  if (!shopCommentCheck.ok) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: shopCommentCheck.message,
    };
  }

  // Legacy callers don't send a delivery rating — short-circuit
  // here so the new path's optional-delivery logic doesn't
  // accidentally pick up a stray field on a legacy payload.
  if (!hasNewShape) {
    return {
      ok: true,
      uid: auth.uid,
      shopId: order.shopId,
      shopRating: shopStarsCheck.value,
      shopComment: shopCommentCheck.value,
    };
  }

  // New path — optional delivery dimension.
  let deliveryStarsValid: 1 | 2 | 3 | 4 | 5 | undefined;
  let deliveryCommentValid: string | undefined;
  let deliveryDropped: 'no-partner' | undefined;

  if (input.deliveryRating !== undefined) {
    const deliveryStarsCheck = validateStarsInteger(
      input.deliveryRating,
      'deliveryRating',
    );
    if (!deliveryStarsCheck.ok) {
      return {
        ok: false,
        code: 'invalid-argument',
        message: deliveryStarsCheck.message,
      };
    }

    const deliveryCommentCheck = validateCommentField(
      input.deliveryComment,
      'deliveryComment',
    );
    if (!deliveryCommentCheck.ok) {
      return {
        ok: false,
        code: 'invalid-argument',
        message: deliveryCommentCheck.message,
      };
    }

    // The delivery rating only persists if the order actually has
    // a partner attached. Missing partner → drop the dimension,
    // accept shop rating, log via the diagnostic marker.
    if (
      typeof order.deliveryPersonId === 'string' &&
      order.deliveryPersonId.length > 0
    ) {
      deliveryStarsValid = deliveryStarsCheck.value;
      deliveryCommentValid = deliveryCommentCheck.value;
    } else {
      deliveryDropped = 'no-partner';
    }
  }

  return {
    ok: true,
    uid: auth.uid,
    shopId: order.shopId,
    shopRating: shopStarsCheck.value,
    shopComment: shopCommentCheck.value,
    deliveryRating: deliveryStarsValid,
    deliveryComment: deliveryCommentValid,
    deliveryPersonId: deliveryStarsValid
      ? (order.deliveryPersonId as string)
      : undefined,
    deliveryDropped,
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

/**
 * PR-NEXT-5.1 §F — resolve a customer's display name for review
 * denormalization at submitOrderRating write time.
 *
 * Preference order:
 *   1. users/{uid}.displayName (Firestore profile)
 *   2. auth.token.name (Firebase Auth display name)
 *   3. 'Anonymous' (no name available)
 *
 * Trims whitespace and treats empty / non-string values as absent
 * so a profile with `displayName: ''` falls through to the token,
 * then the 'Anonymous' fallback.
 *
 * Pure — no Firestore. The caller fetches the profile doc + passes
 * its data alongside the decoded auth token.
 */
export function resolveCustomerName(
  profileDisplayName: unknown,
  authTokenName: unknown,
): string {
  const fromProfile =
    typeof profileDisplayName === 'string' ? profileDisplayName.trim() : '';
  if (fromProfile.length > 0) return fromProfile;
  const fromToken =
    typeof authTokenName === 'string' ? authTokenName.trim() : '';
  if (fromToken.length > 0) return fromToken;
  return 'Anonymous';
}
