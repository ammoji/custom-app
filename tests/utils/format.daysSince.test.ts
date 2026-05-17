/**
 * Pure-helper tests for `daysSince` (Phase 12c).
 *
 * Calendar-aware (not 24h-aware), matching the convention of
 * `formatRelativeDeliveryTime`. A timestamp at 11:59 PM yesterday
 * and a "now" at 12:01 AM today are 2 minutes apart on the wall
 * clock but still 1 day apart by calendar math.
 *
 * The negative-input clamp protects the admin UI from showing
 * "-3 days ago" if a clock-skewed device submits a future-dated
 * timestamp.
 */
import { daysSince } from '../../src/utils/format';

const NOW = new Date(2026, 4, 15, 14, 30).getTime(); // Fri May 15 14:30 local

describe('daysSince', () => {
  test('0 days for today (same calendar day, regardless of hour)', () => {
    const earlyToday = new Date(2026, 4, 15, 1, 5).getTime();
    const lateToday = new Date(2026, 4, 15, 23, 50).getTime();
    expect(daysSince(earlyToday, NOW)).toBe(0);
    expect(daysSince(lateToday, NOW)).toBe(0);
  });

  test('1 day for yesterday (calendar-aware, not 24h-aware)', () => {
    // 11:59 PM yesterday → "1 day", even though only 14h31m has
    // elapsed in wall-clock terms relative to NOW (14:30).
    const yesterdayLate = new Date(2026, 4, 14, 23, 59).getTime();
    const yesterdayEarly = new Date(2026, 4, 14, 0, 5).getTime();
    expect(daysSince(yesterdayLate, NOW)).toBe(1);
    expect(daysSince(yesterdayEarly, NOW)).toBe(1);
  });

  test('7 days for last week', () => {
    // Fri May 15 minus 7 calendar days = Fri May 8.
    const lastWeek = new Date(2026, 4, 8, 9, 0).getTime();
    expect(daysSince(lastWeek, NOW)).toBe(7);
  });

  test('future timestamps clamp to 0 (defensive against clock skew)', () => {
    const tomorrow = new Date(2026, 4, 16, 9, 0).getTime();
    const nextWeek = new Date(2026, 4, 22, 9, 0).getTime();
    expect(daysSince(tomorrow, NOW)).toBe(0);
    expect(daysSince(nextWeek, NOW)).toBe(0);
  });

  test('non-finite inputs return 0 (defensive against NaN / Infinity)', () => {
    expect(daysSince(NaN, NOW)).toBe(0);
    expect(daysSince(Infinity, NOW)).toBe(0);
    expect(daysSince(NOW, NaN)).toBe(0);
  });
});
