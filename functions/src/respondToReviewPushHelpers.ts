/**
 * PR-NEXT-BUNDLE-H §D — pure helper for the push notification
 * title sent to the customer when a shop or delivery partner
 * responds to their low-rating review.
 *
 * Previously the title was hardcoded to "💬 Shop responded to your
 * review" regardless of who actually responded, causing confusing
 * notifications when the delivery partner was the responder.
 *
 * Pinned by tests/functions/respondToReviewPushHelpers.test.ts.
 */

export function derivePushTitle(
  responseBy: 'shop' | 'partner' | string | undefined | null,
): string {
  if (responseBy === 'partner') return '💬 Delivery partner responded to your review';
  return '💬 Shop responded to your review';
}

/**
 * PR-NEXT-BUNDLE-J §K — DO NOT REMOVE. Maps the responder identity to the
 * review DIMENSION the customer should be deep-linked into. Carried in the
 * push data payload so AuthBootstrap can open RatingAmendmentScreen
 * pre-scoped to the responded side (shop vs delivery) — acking/amending one
 * side never closes the other (Sudhir 2026-06-10). 'shop' is the safe
 * default for legacy / unknown responders.
 */
export function deriveResponseDimension(
  responseBy: 'shop' | 'partner' | string | undefined | null,
): 'shop' | 'delivery' {
  return responseBy === 'partner' ? 'delivery' : 'shop';
}
