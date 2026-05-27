import { useEffect, useRef, useState } from 'react';
import { orderService } from '../services/orderService';

/**
 * PR 41 — Live counts of pending approval queues, for HomeScreen
 * badges (admin: shop + delivery; shop owner: pending orders).
 *
 * Polls `getPendingApprovalCounts` every POLL_MS while the caller
 * is mounted and `enabled` is true. The server projects onto the
 * caller's claims and returns all-zero for unauthorised roles, so
 * the hook can poll unconditionally for any signed-in user without
 * burning permission-denied errors in Sentry.
 *
 * State-machine semantics mirror `useOnlineDeliveryCount`: tolerate
 * up to STALE_THRESHOLD consecutive failures (network blip during
 * a screen transition is normal), then fall back to a zero result
 * so the badge UI doesn't render a stale number forever. Reset on
 * any successful poll. The pure `nextPendingCountsState` function
 * is extracted so the failure semantics can be unit-tested without
 * a React renderer (same posture as
 * `useOnlineDeliveryCount.nextPollState`).
 *
 * IMPORTANT — hooks rules: callers in HomeScreen / dashboards must
 * invoke this hook ABOVE any conditional `return` per
 * `.windsurf/code-discipline.md` Rule 5. The hook itself only
 * fetches when `enabled` is true; callers should pass
 * `isAdmin || isShopOwner` rather than gating the hook call
 * itself.
 */

export type PendingCounts = {
  shopCount: number;
  deliveryCount: number;
  pendingOrderCount: number;
};

const ZERO: PendingCounts = {
  shopCount: 0,
  deliveryCount: 0,
  pendingOrderCount: 0,
};

const POLL_MS = 30_000;
export const PENDING_COUNTS_STALE_THRESHOLD = 3;

/**
 * Pure state-machine slice for the polling hook. Identical in
 * spirit to `useOnlineDeliveryCount.nextPollState` but returns
 * a `PendingCounts` triple instead of a single number.
 *
 *   - Success           → counter resets to 0; new counts installed.
 *   - Failure under N   → counter += 1; previous counts preserved.
 *   - Failure at >= N   → counter += 1; counts cleared to all-zero.
 */
export function nextPendingCountsState(
  prev: { counts: PendingCounts; failures: number },
  outcome: { kind: 'success'; value: PendingCounts } | { kind: 'failure' },
  threshold: number = PENDING_COUNTS_STALE_THRESHOLD,
): { counts: PendingCounts; failures: number } {
  if (outcome.kind === 'success') {
    return { counts: outcome.value, failures: 0 };
  }
  const failures = prev.failures + 1;
  if (failures >= threshold) {
    return { counts: ZERO, failures };
  }
  return { counts: prev.counts, failures };
}

export type UsePendingCountsResult = PendingCounts & {
  loading: boolean;
  /** Increment to force an immediate re-poll (e.g. after the admin
   *  approves a shop and wants the badge to drop instantly without
   *  waiting for the next POLL_MS tick). */
  refresh: () => void;
};

export function usePendingCounts(enabled: boolean): UsePendingCountsResult {
  const [counts, setCounts] = useState<PendingCounts>(ZERO);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const failuresRef = useRef(0);
  const countsRef = useRef<PendingCounts>(ZERO);

  useEffect(() => {
    if (!enabled) {
      setCounts(ZERO);
      setLoading(false);
      failuresRef.current = 0;
      countsRef.current = ZERO;
      return;
    }
    let cancelled = false;
    setLoading(true);
    const apply = (
      outcome:
        | { kind: 'success'; value: PendingCounts }
        | { kind: 'failure' },
    ) => {
      const next = nextPendingCountsState(
        { counts: countsRef.current, failures: failuresRef.current },
        outcome,
      );
      failuresRef.current = next.failures;
      countsRef.current = next.counts;
      setCounts(prev =>
        prev.shopCount === next.counts.shopCount &&
        prev.deliveryCount === next.counts.deliveryCount &&
        prev.pendingOrderCount === next.counts.pendingOrderCount
          ? prev
          : next.counts,
      );
    };
    const tick = async () => {
      try {
        const c = await orderService.getPendingApprovalCounts();
        if (cancelled) return;
        apply({
          kind: 'success',
          value: {
            shopCount: Number(c.shopCount) || 0,
            deliveryCount: Number(c.deliveryCount) || 0,
            pendingOrderCount: Number(c.pendingOrderCount) || 0,
          },
        });
      } catch (e) {
        if (cancelled) return;
        console.warn(
          '[usePendingCounts] fetch failed (strike',
          failuresRef.current + 1,
          'of',
          PENDING_COUNTS_STALE_THRESHOLD,
          '):',
          e,
        );
        apply({ kind: 'failure' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    tick();
    const interval = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, refreshNonce]);

  return {
    ...counts,
    loading,
    refresh: () => setRefreshNonce(n => n + 1),
  };
}
