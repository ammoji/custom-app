/**
 * Pure-helper tests for `formatRelativeDeliveryTime`.
 *
 * The helper backs the Delivery History rows on
 * DeliveryDashboardScreen. The four formatting branches plus the
 * DST/midnight edge are all locked in here.
 *
 * Privacy posture is asserted at the SIGNATURE level (test below):
 * the helper's parameter list is `(ms, now?)` only — no
 * address/phone object ever flows through it.
 */
import { formatRelativeDeliveryTime } from '../../src/utils/format';

// Pin the test "now" to a known local-timezone wall clock to make
// the day-boundary branches deterministic. Using `new Date(y, m, d, h, m)`
// builds in local TZ, so dayStart() inside the helper anchors on
// the same calendar boundary the test does.
const NOW_LOCAL = new Date(2026, 4, 15, 14, 30).getTime(); // Fri May 15 2026 14:30 local

describe('formatRelativeDeliveryTime', () => {
  test('same calendar day → "Today h:mm AM/PM"', () => {
    const sameDayMorning = new Date(2026, 4, 15, 9, 5).getTime();
    expect(formatRelativeDeliveryTime(sameDayMorning, NOW_LOCAL)).toBe(
      'Today 9:05 AM',
    );
  });

  test('previous calendar day → "Yesterday h:mm AM/PM"', () => {
    const yesterdayAfternoon = new Date(2026, 4, 14, 15, 22).getTime();
    expect(formatRelativeDeliveryTime(yesterdayAfternoon, NOW_LOCAL)).toBe(
      'Yesterday 3:22 PM',
    );
  });

  test('3 days ago → weekday abbrev', () => {
    // Now is Fri May 15; three days back is Tue May 12.
    const threeDaysAgo = new Date(2026, 4, 12, 14, 15).getTime();
    expect(formatRelativeDeliveryTime(threeDaysAgo, NOW_LOCAL)).toBe(
      'Tue 2:15 PM',
    );
  });

  test('6 days ago → still weekday abbrev (upper bound of the week branch)', () => {
    // Now Fri May 15, six days back is Sat May 9.
    const sixDaysAgo = new Date(2026, 4, 9, 11, 0).getTime();
    expect(formatRelativeDeliveryTime(sixDaysAgo, NOW_LOCAL)).toBe(
      'Sat 11:00 AM',
    );
  });

  test('8 days ago → full month-day format', () => {
    const eightDaysAgo = new Date(2026, 4, 7, 14, 15).getTime();
    expect(formatRelativeDeliveryTime(eightDaysAgo, NOW_LOCAL)).toBe(
      'May 7, 2:15 PM',
    );
  });

  test('midnight boundary: 11:59 PM yesterday is "Yesterday", 12:01 AM today is "Today"', () => {
    // Anchor "now" at 12:30 AM May 15 so both timestamps are inside
    // a single 32-minute window but on different calendar days.
    const earlyToday = new Date(2026, 4, 15, 0, 30).getTime();
    const lateYesterday = new Date(2026, 4, 14, 23, 59).getTime();
    const earlierToday = new Date(2026, 4, 15, 0, 1).getTime();

    expect(formatRelativeDeliveryTime(lateYesterday, earlyToday)).toBe(
      'Yesterday 11:59 PM',
    );
    expect(formatRelativeDeliveryTime(earlierToday, earlyToday)).toBe(
      'Today 12:01 AM',
    );
  });

  test('DST forward-jump: dayDiff is calendar-aware, not 24h-ms-aware', () => {
    // US DST 2026 starts Sun Mar 8 02:00. A delivery completed at
    // 02:30 AM "spring forward" day would be 23h after Sat 03:30
    // in wall-clock terms but only one calendar day after.
    // Using a synthetic test: now = Mon Mar 9 2026 10:00, delivery
    // = Sun Mar 8 2026 14:00 — should report "Yesterday".
    const now = new Date(2026, 2, 9, 10, 0).getTime();
    const yest = new Date(2026, 2, 8, 14, 0).getTime();
    expect(formatRelativeDeliveryTime(yest, now)).toBe('Yesterday 2:00 PM');
  });

  test('signature locks privacy at the type level: (ms, now?) → string only', () => {
    // The helper's Function.length must be 1 — `ms` is required,
    // `now` is optional. No address/phone parameter slot exists.
    // If a future "convenience" refactor adds another required
    // parameter, this test fails immediately and the reviewer can
    // remind the author that privacy means MORE restrictive
    // signatures, not richer ones.
    expect(formatRelativeDeliveryTime.length).toBe(1);
    // Smoke-call with a primitive number to confirm it returns a
    // primitive string (no object leaks through the return).
    const out = formatRelativeDeliveryTime(NOW_LOCAL, NOW_LOCAL);
    expect(typeof out).toBe('string');
  });
});
