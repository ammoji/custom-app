/**
 * PR 14 — HomeScreen "Order again" rail picker.
 *
 * Pure helper that picks the top-N shops a customer has ordered from
 * most frequently, ordered by frequency desc with ties broken by
 * recency. Used by the HomeScreen "Order again" rail.
 *
 * Filters DELIVERED orders only — in-flight orders (pending/accepted/
 * preparing/ready_for_pickup) shouldn't count because the customer
 * hasn't completed the cycle, and cancelled orders shouldn't count
 * either (a cancellation isn't a signal they want to repeat).
 *
 * Each returned entry carries the shop identity + the ID of the most
 * recent delivered order from that shop. The rail component passes
 * that order ID into the reorder flow as the "source" for
 * buildReorderPlan.
 *
 * Pure — no Firestore reads, no React, no clock dependency. Pinned
 * by tests/utils/pickFrequentlyOrderedShops.test.ts.
 */
import type { Order } from '../types';

export type FrequentShopEntry = {
  shopId: string;
  shopName: string;
  // The most recent DELIVERED order from this shop — used as the
  // template for reorder. The reorder flow's buildReorderPlan will
  // join its items against the shop's CURRENT menu.
  lastOrderId: string;
  // For diagnostics + sort: how many delivered orders this customer
  // has placed at this shop.
  orderCount: number;
  // Used for tie-breaking (more-recent-first).
  mostRecentDeliveredAt: number;
  // PR 20 — optional rolling rating stats. Order docs don't snapshot
  // shop ratings (and shouldn't — the rating moves; the order is a
  // historical artifact). The HomeScreen caller can OPTIONALLY hydrate
  // these from a separate shops-fetch and pass them through to
  // OrderAgainRail so the rail card carries the trust badge. When
  // unset, ShopRatingBadge falls back to "New shop", which is the
  // correct graceful-degradation state.
  ratingAvg?: number;
  ratingCount?: number;
};

export function pickFrequentlyOrderedShops(
  orders: Order[],
  limit: number = 3,
): FrequentShopEntry[] {
  // Group by shopId, keeping only delivered orders.
  const byShop = new Map<
    string,
    { shopId: string; shopName: string; orders: Order[] }
  >();
  for (const o of orders) {
    if (o.status !== 'delivered') continue;
    if (!o.shopId) continue;
    const existing = byShop.get(o.shopId);
    if (existing) {
      existing.orders.push(o);
    } else {
      byShop.set(o.shopId, {
        shopId: o.shopId,
        shopName: o.shopName,
        orders: [o],
      });
    }
  }

  // For each shop, find the most recent delivered order (by
  // deliveredAt if present, else createdAt — legacy orders predate
  // the deliveredAt field and toOrder coerces missing values to null).
  const entries: FrequentShopEntry[] = [];
  for (const group of byShop.values()) {
    const sorted = group.orders.slice().sort((a, b) => {
      const aT =
        typeof a.deliveredAt === 'number' ? a.deliveredAt : a.createdAt;
      const bT =
        typeof b.deliveredAt === 'number' ? b.deliveredAt : b.createdAt;
      return bT - aT;
    });
    const mostRecent = sorted[0];
    entries.push({
      shopId: group.shopId,
      shopName: group.shopName,
      lastOrderId: mostRecent.id,
      orderCount: group.orders.length,
      mostRecentDeliveredAt:
        typeof mostRecent.deliveredAt === 'number'
          ? mostRecent.deliveredAt
          : mostRecent.createdAt,
    });
  }

  // Sort by orderCount desc, ties broken by recency desc.
  entries.sort((a, b) => {
    if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount;
    return b.mostRecentDeliveredAt - a.mostRecentDeliveredAt;
  });

  return entries.slice(0, Math.max(0, limit));
}
