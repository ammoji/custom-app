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
