/**
 * HOTFIX-AMEND-RECOMPUTE §H — +6 tests pinning recomputeRollingAverageOnAmend.
 * Deliberate-break demo: revert §H.1's recompute block back outside the
 * transaction → amend-atomicity integration drift. This unit suite pins
 * the math itself.
 */
import { recomputeRollingAverageOnAmend } from '../../functions/src/recomputeRollingAverageHelpers';

describe('recomputeRollingAverageOnAmend', () => {
  it('amend 2→4 on a 1-rating shop: avg 2 → 4', () => {
    const res = recomputeRollingAverageOnAmend({
      oldAvg: 2,
      oldCount: 1,
      oldStars: 2,
      newStars: 4,
    });
    expect(res).not.toBeNull();
    expect(res!.newAvg).toBeCloseTo(4, 5);
  });

  it('amend 2→4 on a 5-rating shop with avg 3.0: avg → 3.4', () => {
    const res = recomputeRollingAverageOnAmend({
      oldAvg: 3,
      oldCount: 5,
      oldStars: 2,
      newStars: 4,
    });
    expect(res!.newAvg).toBeCloseTo(3.4, 5);
  });

  it('amend 4→2 on a 5-rating shop with avg 3.0: avg → 2.6 (decrease path)', () => {
    const res = recomputeRollingAverageOnAmend({
      oldAvg: 3,
      oldCount: 5,
      oldStars: 4,
      newStars: 2,
    });
    expect(res!.newAvg).toBeCloseTo(2.6, 5);
  });

  it('returns null when no change requested (oldStars === newStars)', () => {
    expect(
      recomputeRollingAverageOnAmend({ oldAvg: 3, oldCount: 5, oldStars: 3, newStars: 3 }),
    ).toBeNull();
  });

  it('returns null defensively when oldCount === 0', () => {
    expect(
      recomputeRollingAverageOnAmend({ oldAvg: 0, oldCount: 0, oldStars: 2, newStars: 4 }),
    ).toBeNull();
  });

  it('chained amends round-trip to within 0.01', () => {
    // 5 ratings, avg 3.0. Amend 2→4, then 4→3, then 3→5 on the same review.
    let avg = 3;
    const count = 5;
    let current = 2;
    for (const next of [4, 3, 5]) {
      const res = recomputeRollingAverageOnAmend({
        oldAvg: avg,
        oldCount: count,
        oldStars: current,
        newStars: next,
      });
      avg = res!.newAvg;
      current = next;
    }
    // Net effect: original 2 became 5 → sum increased by 3 over 5 → +0.6.
    expect(avg).toBeCloseTo(3.6, 2);
  });
});
