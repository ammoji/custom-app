/**
 * PR 41 — Pure helpers for the `getPendingApprovalCounts` callable.
 *
 * The callable itself does the Firestore queries (admin SDK) and then
 * hands the raw doc snapshots off to these helpers for the actual
 * counting + role-based projection. Keeping IO out of the helpers
 * lets us unit-test the counting logic without firebase-admin.
 *
 * The callable serves two distinct caller roles in a single round
 * trip:
 *   - Admin caller → wants counts of `pendingShopRequests` +
 *     `deliveryRequests` with `status === 'pending'`. These drive
 *     the badges on HomeScreen's two admin rows + the headers on
 *     PendingShopsScreen / PendingDeliveryRequestsScreen.
 *   - Shop-owner caller → wants the count of orders for their shop
 *     currently in `status === 'pending'` (the "needs accept/reject
 *     attention" bucket). Drives the badge on HomeScreen's "Shop
 *     Dashboard" row.
 *   - Anyone else → all zeros.
 *
 * A user can be BOTH admin and shop owner (Sudhir during pilot is
 * exactly this case). The server populates whichever buckets the
 * caller's claims authorise — never throws permission-denied on a
 * caller who at least has one of the roles. Callers without either
 * role get a zero result rather than a 403, because the badge UI
 * polls this on every HomeScreen mount and we don't want
 * permission-denied noise in Sentry for plain customers.
 */

export type PendingCountsRequestRole = {
  isAdmin: boolean;
  isShopOwner: boolean;
  shopId?: string;
};

export type PendingCountsResult = {
  shopCount: number;
  deliveryCount: number;
  pendingOrderCount: number;
};

/**
 * Project the raw counts onto the caller's authorised view. Zero-
 * out any bucket the caller isn't entitled to see. The Firestore
 * queries upstream are role-gated too (we don't fetch `orders` for
 * a non-shop-owner caller, for example) — this is belt-and-braces:
 * if a future refactor accidentally over-fetches, the projection
 * still hides the data from the response payload.
 */
export function projectPendingCounts(
  role: PendingCountsRequestRole,
  raw: PendingCountsResult,
): PendingCountsResult {
  return {
    shopCount: role.isAdmin ? raw.shopCount : 0,
    deliveryCount: role.isAdmin ? raw.deliveryCount : 0,
    pendingOrderCount:
      role.isShopOwner && role.shopId ? raw.pendingOrderCount : 0,
  };
}

/**
 * Defensive counter for a Firestore `where('status', '==', 'pending')`
 * query result. Accepts any iterable of `{ data(): { status?: ... } }`
 * lookalikes so the unit test can pass plain `{ data: () => ({ status:
 * 'pending' }) }` stubs without booting firebase-admin.
 *
 * Filters out anything whose `status` field isn't literally the string
 * `'pending'` even though the upstream query already pins it — same
 * belt-and-braces philosophy as `projectPendingCounts`. Cost of the
 * extra check is one string compare per doc; we'll never have enough
 * pending docs to feel it.
 */
export function countPendingDocs<T extends { data(): unknown }>(
  docs: Iterable<T>,
): number {
  let n = 0;
  for (const d of docs) {
    const data = d.data() as { status?: unknown } | undefined;
    if (data && data.status === 'pending') n += 1;
  }
  return n;
}

/**
 * Cap the surfaced count so the badge UI doesn't render "247" when
 * something has gone wrong with the approval queue (forgotten admin
 * shift, runaway test fixture, etc.). The hard cap is 99 — anything
 * higher reads as "99+" in the badge component. Returning the raw
 * count from the callable + capping in the UI is the cleaner split,
 * but doing the cap server-side too means a misbehaving client can't
 * burn bandwidth on a 1000-entry count integer (trivial, but cheap
 * defence).
 */
export const PENDING_COUNT_HARD_CAP = 999;

export function capPendingCount(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > PENDING_COUNT_HARD_CAP) return PENDING_COUNT_HARD_CAP;
  return Math.floor(n);
}
