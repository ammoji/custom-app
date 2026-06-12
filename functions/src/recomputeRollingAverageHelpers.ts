/**
 * HOTFIX-AMEND-RECOMPUTE — pure rolling-average recompute for the
 * amend path. When a customer changes their stars (e.g. 2★ → 4★), the
 * shop's (or partner's) rolling average must be adjusted by removing
 * the old contribution and adding the new one, keeping count fixed.
 *
 * Lives in its own file so the math is unit-testable and so the
 * recompute can run INSIDE _publishReview's transaction (atomic with
 * the publish state cascade) rather than in a racy outside-tx write.
 *
 * Rule 14 — returns nullable. Returns null when oldCount <= 0
 * (defensive — should never happen, but avoids NaN/divide-by-zero).
 * Pinned by tests/functions/recomputeRollingAverageHelpers.test.ts.
 */

export function recomputeRollingAverageOnAmend(args: {
  oldAvg: number;
  oldCount: number;
  oldStars: number;
  newStars: number;
}): { newAvg: number } | null {
  if (!Number.isFinite(args.oldCount) || args.oldCount <= 0) return null;
  if (args.oldStars === args.newStars) return null;
  const oldSum = args.oldAvg * args.oldCount;
  const newAvg = (oldSum - args.oldStars + args.newStars) / args.oldCount;
  return { newAvg };
}
