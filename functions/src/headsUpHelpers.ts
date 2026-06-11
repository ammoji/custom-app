/**
 * PR-NEXT-PARTNER-HEADS-UP — pure helpers for the pickup heads-up
 * push notification.
 *
 * `computeMinutesFromNow` centralises the rounding + floor/ceiling
 * behaviour so the push body matches the dashboard "Coming up" row.
 *
 * Pure — no Firestore, no React, no clock. Pinned by
 * `tests/functions/headsUpHelpers.test.ts`.
 */

/**
 * Returns the number of whole minutes between `nowMs` and
 * `readyByEstimateMs`.
 *
 * Returns at least 1 — never "ready in ~0 min" (would imply already
 * ready, contradicting the heads-up framing). Handles negative deltas
 * (past readyByEstimate) by clamping to 1.
 *
 * Non-numeric / null / undefined inputs return 1 as a safe default
 * so a missing ETA yields "ready in ~1 min" rather than crashing.
 */
export function computeMinutesFromNow(
  readyByEstimateMs: number | null | undefined,
  nowMs: number,
): number {
  if (
    typeof readyByEstimateMs !== 'number' ||
    !Number.isFinite(readyByEstimateMs)
  ) {
    return 1; // unknown ETA → safe default
  }
  const deltaMin = (readyByEstimateMs - nowMs) / 60_000;
  return Math.max(1, Math.round(deltaMin));
}
