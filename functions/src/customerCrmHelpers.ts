/**
 * PR 36 — pure aggregator for the shop-owner Customer CRM. Given a
 * flat list of order docs for ONE shop, group by `customerUid` and
 * roll up: orderCount, totalSpent (excludes cancelled/refunded),
 * firstOrderAt, lastOrderAt. `viewShopCustomers` then sorts /
 * filters the aggregate per the requested view (top revenue /
 * recent / stopped).
 *
 * Tested in isolation; the `listShopCustomers` callable wires it
 * together against the live `orders` collection.
 *
 * Schema notes (verified against `functions/src/index.ts` and
 * `src/types/index.ts`):
 *   - customer uid on the order doc is `customerUid` (NOT `userId`
 *     as the PR 36 prompt drafted; the prompt was based on a stale
 *     mental model).
 *   - customer name + phone are nested under `deliveryAddress`
 *     (NOT `address`), matching the placeOrder doc shape since
 *     PR 22.
 *   - `total` is in rupees (matches the on-doc value used by every
 *     other report — no paise conversion needed).
 */

export type ShopOrderRaw = {
  id: string;
  customerUid?: string;
  total?: number;
  status?: string;
  // Epoch ms. The callable converts Firestore Timestamps with
  // `data.createdAt?.toMillis?.() ?? data.createdAt` before
  // handing rows to the aggregator, so we never see a Timestamp
  // object here.
  createdAt?: number;
  deliveryAddress?: {
    name?: string;
    phone?: string;
  };
};

export type ShopCustomer = {
  uid: string;
  phone: string | null;
  displayName: string | null;
  orderCount: number;
  totalSpent: number; // in rupees, matches order.total
  firstOrderAt: number; // epoch ms
  lastOrderAt: number; // epoch ms
};

export type ShopCustomersView =
  | { sortBy: 'top_revenue'; limit?: number }
  | { sortBy: 'recent'; limit?: number }
  | {
      sortBy: 'stopped';
      minDaysSinceLastOrder?: number;
      limit?: number;
    };

/**
 * Group orders by `customerUid` and roll up counts + totals +
 * first/last order times. Phone + displayName are picked from
 * the MOST RECENT order with non-empty values (customers can
 * change their delivery address between orders; the most-recent
 * non-empty contact is the most useful for the shop to call /
 * message).
 *
 * Skips orders with no `customerUid` or no `createdAt` — these
 * are malformed and shouldn't poison the rollup. Cancelled +
 * refunded orders count in `orderCount` (they're still evidence
 * of customer activity) but do NOT contribute to `totalSpent`
 * (the shop didn't actually earn that money).
 */
export function aggregateShopCustomers(
  orders: ShopOrderRaw[],
): ShopCustomer[] {
  const byUid = new Map<string, ShopCustomer>();

  for (const o of orders) {
    if (!o.customerUid || typeof o.customerUid !== 'string') continue;
    const ts = typeof o.createdAt === 'number' ? o.createdAt : 0;
    if (ts === 0) continue;

    const isRevenue =
      o.status !== 'cancelled' && o.status !== 'refunded';
    const total =
      isRevenue && typeof o.total === 'number' && Number.isFinite(o.total)
        ? o.total
        : 0;

    const rawPhone = o.deliveryAddress?.phone;
    const rawName = o.deliveryAddress?.name;
    const phone =
      typeof rawPhone === 'string' && rawPhone.trim()
        ? rawPhone.trim()
        : null;
    const displayName =
      typeof rawName === 'string' && rawName.trim() ? rawName.trim() : null;

    const existing = byUid.get(o.customerUid);
    if (!existing) {
      byUid.set(o.customerUid, {
        uid: o.customerUid,
        phone,
        displayName,
        orderCount: 1,
        totalSpent: total,
        firstOrderAt: ts,
        lastOrderAt: ts,
      });
      continue;
    }

    existing.orderCount += 1;
    existing.totalSpent += total;
    if (ts < existing.firstOrderAt) existing.firstOrderAt = ts;
    // Phone + name update only when this order is the new most-
    // recent AND has a non-empty value. Two-step so an empty
    // newer address doesn't blank out a populated older one.
    if (ts >= existing.lastOrderAt) {
      existing.lastOrderAt = ts;
      if (phone) existing.phone = phone;
      if (displayName) existing.displayName = displayName;
    }
  }

  return Array.from(byUid.values());
}

/**
 * Sort + slice the aggregated customer list per the requested view.
 *
 *   - `top_revenue` — descending by totalSpent.
 *   - `recent`      — descending by lastOrderAt.
 *   - `stopped`     — only customers whose lastOrderAt is older
 *                     than `minDaysSinceLastOrder` (default 30),
 *                     then sorted by lastOrderAt descending so
 *                     the most-recently-lapsed (easiest to win
 *                     back) show first.
 *
 * `nowMs` is injected so tests can pin the cutoff deterministically.
 */
export function viewShopCustomers(
  customers: ShopCustomer[],
  view: ShopCustomersView,
  nowMs: number,
): ShopCustomer[] {
  const limit = 'limit' in view && view.limit ? view.limit : 50;

  if (view.sortBy === 'top_revenue') {
    return [...customers]
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, limit);
  }
  if (view.sortBy === 'recent') {
    return [...customers]
      .sort((a, b) => b.lastOrderAt - a.lastOrderAt)
      .slice(0, limit);
  }
  const minDays = view.minDaysSinceLastOrder ?? 30;
  const cutoff = nowMs - minDays * 86_400_000;
  return customers
    .filter(c => c.lastOrderAt < cutoff)
    .sort((a, b) => b.lastOrderAt - a.lastOrderAt)
    .slice(0, limit);
}
