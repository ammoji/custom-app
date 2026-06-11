/**
 * PR-NEXT-BUNDLE-D §D — tests for summarizeEarnings.
 *
 * 6 cases: today sum, week sum, multi-day window boundaries,
 * zero deliveries, fee coercion (missing/non-number), future-date
 * exclusion.
 */
import { describe, expect, it } from '@jest/globals';
import { summarizeEarnings } from '../../functions/src/earningsHelpers';

const DAY = 86_400_000;
// Fixed "now" at a clean UTC midnight + 10h so "today" window is
// deterministic: startOfToday = floor(now/DAY)*DAY.
const NOW = 20_000 * DAY + 10 * 3_600_000;
const START_OF_TODAY = Math.floor(NOW / DAY) * DAY;

describe('summarizeEarnings', () => {
  it('sums today deliveries', () => {
    const rows = [
      { deliveryFee: 60, deliveredAt: START_OF_TODAY + 3_600_000 },
      { deliveryFee: 45, deliveredAt: START_OF_TODAY + 7_200_000 },
    ];
    const r = summarizeEarnings(rows, NOW);
    expect(r.today).toEqual({ totalRupees: 105, count: 2 });
  });

  it('sums week deliveries (trailing 7 days)', () => {
    const rows = [
      { deliveryFee: 60, deliveredAt: NOW - 1 * DAY },
      { deliveryFee: 50, deliveredAt: NOW - 3 * DAY },
      { deliveryFee: 40, deliveredAt: NOW - 6 * DAY },
    ];
    const r = summarizeEarnings(rows, NOW);
    expect(r.week).toEqual({ totalRupees: 150, count: 3 });
    // None of these are "today".
    expect(r.today).toEqual({ totalRupees: 0, count: 0 });
  });

  it('excludes deliveries older than 7 days from week', () => {
    const rows = [
      { deliveryFee: 100, deliveredAt: NOW - 8 * DAY },
      { deliveryFee: 30, deliveredAt: NOW - 2 * DAY },
    ];
    const r = summarizeEarnings(rows, NOW);
    expect(r.week).toEqual({ totalRupees: 30, count: 1 });
  });

  it('zero deliveries → zero windows', () => {
    const r = summarizeEarnings([], NOW);
    expect(r.today).toEqual({ totalRupees: 0, count: 0 });
    expect(r.week).toEqual({ totalRupees: 0, count: 0 });
  });

  it('coerces missing / non-number fees to 0', () => {
    const rows = [
      { deliveryFee: NaN as any, deliveredAt: START_OF_TODAY + 100 },
      { deliveryFee: undefined as any, deliveredAt: START_OF_TODAY + 200 },
      { deliveryFee: 25, deliveredAt: START_OF_TODAY + 300 },
    ];
    const r = summarizeEarnings(rows, NOW);
    // NaN coerced to 0; total is 25 from the valid row + NaN handling.
    expect(r.today.count).toBe(3);
    expect(r.today.totalRupees).toBe(25);
  });

  it('excludes future-dated deliveries', () => {
    const rows = [{ deliveryFee: 70, deliveredAt: NOW + 1 * DAY }];
    const r = summarizeEarnings(rows, NOW);
    expect(r.today).toEqual({ totalRupees: 0, count: 0 });
    expect(r.week).toEqual({ totalRupees: 0, count: 0 });
  });
});
