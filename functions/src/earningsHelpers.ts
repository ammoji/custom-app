/**
 * PR-NEXT-BUNDLE-D §D — pure earnings summation for the delivery
 * partner Earnings tab (`listMyEarnings`).
 *
 * Given a list of delivered-order rows ({ deliveryFee, deliveredAt })
 * and the current epoch-ms, returns today + this-week rupee totals
 * and counts.
 *
 * Window definitions (deterministic for tests):
 *   - today: deliveredAt within the current UTC calendar day
 *     (>= floor(now / 86400000) * 86400000)
 *   - week: deliveredAt within the trailing 7 days (>= now - 7d)
 *
 * Pure — no Firestore, no clock (now is injected). Pinned by
 * `tests/functions/earningsHelpers.test.ts`.
 */

export type EarningRow = {
  deliveryFee: number;
  deliveredAt: number;
};

export type EarningsWindow = {
  totalRupees: number;
  count: number;
};

export type EarningsSummary = {
  today: EarningsWindow;
  week: EarningsWindow;
};

const DAY_MS = 86_400_000;

export function summarizeEarnings(
  rows: EarningRow[],
  nowMs: number,
): EarningsSummary {
  const startOfToday = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const weekAgo = nowMs - 7 * DAY_MS;

  const today: EarningsWindow = { totalRupees: 0, count: 0 };
  const week: EarningsWindow = { totalRupees: 0, count: 0 };

  for (const row of rows ?? []) {
    const fee = Number.isFinite(row?.deliveryFee) ? row.deliveryFee : 0;
    const at = Number.isFinite(row?.deliveredAt) ? row.deliveredAt : 0;
    if (at >= weekAgo && at <= nowMs) {
      week.totalRupees += fee;
      week.count += 1;
    }
    if (at >= startOfToday && at <= nowMs) {
      today.totalRupees += fee;
      today.count += 1;
    }
  }

  return { today, week };
}
