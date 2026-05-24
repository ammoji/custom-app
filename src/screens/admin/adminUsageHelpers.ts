/**
 * PR 38 — pure aggregation helpers for the AdminUsageScreen.
 *
 * Mirrors the PR 32 / PR 34 helpers pattern: zero React, zero
 * Firestore — just data → data so the dashboard's aggregation
 * logic is fully unit-testable without rendering or mocking the
 * SDK. The screen fetches `featureUsageLog/` once with a single
 * date-range query, drops the docs into these helpers, and
 * renders the result.
 *
 * Client-side aggregation is correct at pilot scale (≤ 10k
 * events/period — the screen caps the query at limit:10000). If
 * pilot scale exceeds this, the path is a scheduled Cloud
 * Function that pre-computes daily counter docs; the helpers
 * here remain useful for the rolled-up data too.
 */

/**
 * Shape of one document in `featureUsageLog/`. Mirrors the
 * write site in `src/services/analytics.ts` exactly. Fields are
 * deliberately conservative — every consumer-visible field is
 * defensive against schema drift (events written by an older
 * client missing a field must not crash the aggregator).
 */
export type FeatureUsageEvent = {
  uid: string;
  role: 'customer' | 'shop_owner' | 'delivery' | 'admin' | 'anonymous';
  feature: string;
  date: string; // YYYY-MM-DD
  shopId?: string;
  // `timestamp` is a Firestore Timestamp on the wire but the
  // aggregators here don't read it — they trust the query's
  // date filter. Typed loosely so the helpers don't pull in the
  // Firestore types.
  timestamp?: unknown;
};

export type FeatureCount = {
  feature: string;
  count: number;
  /** Percent of total events in the period, 0..100, two decimals. */
  pct: number;
};

export type RoleCount = {
  role: FeatureUsageEvent['role'];
  count: number;
};

/**
 * Group events by `feature` and sort descending by count. Returns
 * up to `limit` entries (default 20 — the dashboard's "Show all"
 * toggle passes Infinity).
 *
 * `pct` is computed against the WHOLE `events` array, not the
 * truncated top-N, so the displayed percentages reflect overall
 * share rather than share-of-top-N. This matters when the long
 * tail is large (each tail event is ~0% individually but
 * collectively can be 30%+).
 */
export function topFeatures(
  events: FeatureUsageEvent[],
  limit: number = 20,
): FeatureCount[] {
  if (events.length === 0) return [];
  const counts = new Map<string, number>();
  for (const e of events) {
    // Defensive: a legacy/forward-compat event missing `feature`
    // is bucketed under '__unknown__' so it shows up in QA but
    // doesn't crash the dashboard.
    const k =
      typeof e?.feature === 'string' && e.feature ? e.feature : '__unknown__';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const total = events.length;
  const arr: FeatureCount[] = Array.from(counts.entries()).map(
    ([feature, count]) => ({
      feature,
      count,
      pct: Math.round((count / total) * 10000) / 100,
    }),
  );
  arr.sort((a, b) => b.count - a.count || a.feature.localeCompare(b.feature));
  return arr.slice(0, Math.max(0, limit));
}

/**
 * Count events per role. Roles with zero count are omitted from
 * the result (the dashboard's role bars only render present
 * roles). Sorted by count descending so the chart reads top-to-
 * bottom.
 */
export function byRole(events: FeatureUsageEvent[]): RoleCount[] {
  const counts = new Map<FeatureUsageEvent['role'], number>();
  for (const e of events) {
    const r = e?.role;
    if (
      r === 'customer' ||
      r === 'shop_owner' ||
      r === 'delivery' ||
      r === 'admin' ||
      r === 'anonymous'
    ) {
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    // Unknown role → silently dropped (defensive against drift).
  }
  return Array.from(counts.entries())
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Count distinct `uid` values across the event list. Anonymous
 * events have no uid in practice (the writer short-circuits when
 * uid is null) but defensively we drop falsy uids here too so a
 * future regression doesn't double-count.
 */
export function uniqueUsers(events: FeatureUsageEvent[]): number {
  const set = new Set<string>();
  for (const e of events) {
    if (typeof e?.uid === 'string' && e.uid) set.add(e.uid);
  }
  return set.size;
}

/**
 * Count distinct `shopId` values across the event list. Events
 * without a `shopId` (customer browsing, admin actions, etc.)
 * are excluded — only events that actually involve a shop count.
 */
export function uniqueShops(events: FeatureUsageEvent[]): number {
  const set = new Set<string>();
  for (const e of events) {
    if (typeof e?.shopId === 'string' && e.shopId) set.add(e.shopId);
  }
  return set.size;
}

/**
 * Defensive filter: drop events whose `date` field is older than
 * `cutoffISO` (YYYY-MM-DD). The dashboard's Firestore query
 * already filters by date — this is a belt-and-braces for cached
 * results, clock-skewed devices, or future code paths that pass
 * in unfiltered arrays.
 */
export function filterAfter(
  events: FeatureUsageEvent[],
  cutoffISO: string,
): FeatureUsageEvent[] {
  return events.filter(
    e => typeof e?.date === 'string' && e.date >= cutoffISO,
  );
}
