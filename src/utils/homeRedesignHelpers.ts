/**
 * PR-NEXT-BUNDLE-F — pure helpers for the home / shop-list redesign.
 *
 * `statusToLabel` maps an order status to a customer-friendly banner
 * label. `sortShopsForBrowse` reorders the nearby-shops list per the
 * sort dropdown. Both pure (no React) and unit-pinned by
 * `tests/utils/homeRedesignHelpers.test.ts`.
 */

import type { Order, Shop } from '../types';

export type OrderStatus = Order['status'];

const STATUS_LABELS: Record<string, string> = {
  pending: 'Order placed',
  accepted: 'Order accepted',
  preparing: 'Being prepared',
  ready_for_pickup: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/**
 * Customer-friendly label for an order status. Unknown statuses fall
 * back to a neutral "Order in progress" so the banner never renders a
 * raw enum value.
 */
export function statusToLabel(status: OrderStatus | string): string {
  return STATUS_LABELS[status] ?? 'Order in progress';
}

export type ShopSortMode = 'distance' | 'rating' | 'reviews';

/**
 * Sort the browse list per the chosen mode. Stable (original-index
 * tiebreaker), non-mutating.
 *   - distance: nearest first (missing distanceKm → bottom)
 *   - rating: highest ratingAvg first (missing → 0)
 *   - reviews: most ratingCount first (missing → 0)
 */
export function sortShopsForBrowse<
  T extends Pick<Shop, 'distanceKm' | 'ratingAvg' | 'ratingCount'>,
>(shops: T[], mode: ShopSortMode): T[] {
  const indexed = shops.map((s, i) => ({ s, i }));
  switch (mode) {
    case 'distance':
      return indexed
        .sort(
          (a, b) =>
            (a.s.distanceKm ?? Number.POSITIVE_INFINITY) -
              (b.s.distanceKm ?? Number.POSITIVE_INFINITY) || a.i - b.i,
        )
        .map(x => x.s);
    case 'rating':
      return indexed
        .sort(
          (a, b) => (b.s.ratingAvg ?? 0) - (a.s.ratingAvg ?? 0) || a.i - b.i,
        )
        .map(x => x.s);
    case 'reviews':
      return indexed
        .sort(
          (a, b) => (b.s.ratingCount ?? 0) - (a.s.ratingCount ?? 0) || a.i - b.i,
        )
        .map(x => x.s);
    default:
      return shops.slice();
  }
}

export const SHOP_SORT_LABELS: Record<ShopSortMode, string> = {
  distance: 'Nearest',
  rating: 'Best rated',
  reviews: 'Most reviewed',
};
