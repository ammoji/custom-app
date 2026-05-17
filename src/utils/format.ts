import { Product } from '../types';

export function formatRupees(amount: number): string {
  return `₹${Math.round(amount)}`;
}

export function formatPackLabel(packSize: Product['packSize']): string {
  const { value, unit } = packSize;
  if (unit === 'litre') return `${value} L`;
  if (unit === 'ml') return `${value} mL`;
  return `${value} ${unit}`;
}

export function formatDistance(km?: number): string {
  if (km == null) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

// True iff the given epoch-ms timestamp falls on the local-device
// "today" (calendar date, not last-24h). Phase 12b uses this for the
// dashboard "deliveries completed today" counter.
export function isToday(timestamp: number | null | undefined): boolean {
  if (!timestamp) return false;
  const d = new Date(timestamp);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatTimeOfDay(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, '0')} ${ampm}`;
}

export function formatOrderTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = formatTimeOfDay(d);
  if (sameDay) return `Today ${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Human-friendly relative formatter for delivered-order timestamps.
 *
 * Rules (all in the device's local timezone):
 *   - Same calendar day      → "Today 3:45 PM"
 *   - Previous calendar day  → "Yesterday 11:20 AM"
 *   - Within last 7 days     → "Mon 2:15 PM"
 *   - Older                  → "May 14, 2:15 PM"
 *
 * The `now` argument is injected to make boundary tests
 * deterministic (DST flips, midnight rollovers, week-old cutoff)
 * without faking Date.now globally.
 *
 * Pure: no React, no React Native, no network, no IO. Signature is
 * locked to `(ms, now?) => string` — the helper does NOT receive or
 * emit address / phone / customer data. Privacy guarantee is at the
 * type level: nothing else can leak through.
 */
export function formatRelativeDeliveryTime(
  ms: number,
  now: number = Date.now(),
): string {
  const d = new Date(ms);
  const n = new Date(now);
  const time = formatTimeOfDay(d);

  // Calendar-day comparison via local midnight floors. Using Date
  // arithmetic on hours/minutes would break across DST boundaries
  // (a "yesterday" timestamp could be 23h or 25h ago in real ms).
  const dayStart = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const nDay = dayStart(n);
  const dDay = dayStart(d);
  const dayDiff = Math.round((nDay - dDay) / (24 * 60 * 60 * 1000));

  if (dayDiff === 0) return `Today ${time}`;
  if (dayDiff === 1) return `Yesterday ${time}`;
  if (dayDiff >= 2 && dayDiff <= 6) {
    return `${WEEKDAYS[d.getDay()]} ${time}`;
  }
  // Older (including dates in the future, which shouldn't happen
  // for a deliveredAt but we fall through gracefully).
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${time}`;
}

/**
 * Calendar-aware "days since" helper used by Phase 12c admin
 * registration review. Same calendar-day → 0, yesterday → 1,
 * last week → 7, regardless of wall-clock hours (DST-safe).
 *
 * Defensive: if `ts` is in the future relative to `now`, or non-
 * finite, return 0. The admin registration screen never wants to
 * show "-3 days ago" because of a clock-skew anomaly.
 *
 * Pure: signature locked at `(ts, now?) => number`. No address /
 * phone / customer data flows through.
 */
export function daysSince(
  ts: number,
  now: number = Date.now(),
): number {
  if (!Number.isFinite(ts) || !Number.isFinite(now)) return 0;
  if (ts > now) return 0;
  const dayStart = (x: number) => {
    const d = new Date(x);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const diff = Math.round(
    (dayStart(now) - dayStart(ts)) / (24 * 60 * 60 * 1000),
  );
  return diff < 0 ? 0 : diff;
}
