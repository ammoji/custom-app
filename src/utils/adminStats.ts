import type { Order } from '../types';

/**
 * Pure stats helper for AdminOrdersScreen's stats card (Phase 12c).
 *
 * Mirrors the today-counter logic from ShopOwnerDashboardScreen but
 * scoped to the admin's all-shops view. Extracted into its own file
 * so the calendar-day math + "exclude cancelled from GMV" rule can
 * be pinned with unit tests without booting React Native.
 *
 * `now` is injected (rather than calling `Date.now()` inside) so day
 * boundaries are deterministic in tests — same posture as
 * `formatRelativeDeliveryTime`.
 *
 * Active = orders that still need someone's attention. Delivered and
 * cancelled are terminal; everything else (pending → accepted →
 * preparing → ready_for_pickup) counts as "needs eyeballs". The
 * online-partner stat is fetched separately via a callable, so this
 * helper deliberately does NOT touch users data — it only reduces
 * the orders array.
 */

const ACTIVE_STATUSES = new Set<Order['status']>([
  'pending',
  'accepted',
  'preparing',
  'ready_for_pickup',
]);

function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export type AdminOrderStats = {
  gmvToday: number;
  activeCount: number;
};

export function computeAdminOrderStats(
  orders: Order[],
  now: number,
): AdminOrderStats {
  let gmvToday = 0;
  let activeCount = 0;
  for (const o of orders) {
    if (
      isSameLocalDay(o.createdAt, now) &&
      o.status !== 'cancelled'
    ) {
      gmvToday += o.total;
    }
    if (ACTIVE_STATUSES.has(o.status)) {
      activeCount += 1;
    }
  }
  return { gmvToday, activeCount };
}
