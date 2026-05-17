import { useEffect, useRef, useState } from 'react';
import { orderService } from '../services/orderService';

/**
 * Phase 12c: polls `getOnlineDeliveryCount` every 15s while the
 * caller is mounted and admin claim is true. Independent of the
 * orders watcher cadence (10s) so the two stats refresh on
 * different rhythms — the orders ticker doesn't refetch the
 * partner count, and vice versa.
 *
 * Returns `null` while loading and on error so the screen can
 * show a placeholder ('—') without flashing a stale 0.
 *
 * Pure-helper portion of the auth check + count assembly lives in
 * `functions/src/onlineDeliveryCountHelpers.ts`. The hook itself
 * is intentionally thin.
 *
 * PR 3 — concurrency cleanup (item 5). After a permanent failure
 * (auth revoked, callable removed, network down for minutes), the
 * pre-PR hook held the last successful count forever, showing the
 * admin a number that wasn't real anymore. Now: tolerate up to
 * STALE_THRESHOLD consecutive failures (transient blip), then drop
 * back to null so the placeholder renders honestly. Reset to 0 on
 * any successful poll.
 */
const POLL_MS = 15_000;
export const STALE_THRESHOLD = 3;

/**
 * Pure state-machine slice for the polling hook. Extracted so the
 * consecutive-failure semantics can be unit-tested without a React
 * renderer (react-test-renderer isn't a project dependency and
 * RNTL is out of scope per .windsurf/test-discipline.md).
 *
 *   - Success           → counter resets to 0; new count installed.
 *   - Failure under N   → counter += 1; previous count preserved.
 *   - Failure at >= N   → counter += 1; count cleared to null.
 *
 * Returns the next ({ count, failures }) tuple.
 */
export function nextPollState(
  prev: { count: number | null; failures: number },
  outcome:
    | { kind: 'success'; value: number }
    | { kind: 'failure' },
  threshold: number = STALE_THRESHOLD,
): { count: number | null; failures: number } {
  if (outcome.kind === 'success') {
    return { count: outcome.value, failures: 0 };
  }
  const failures = prev.failures + 1;
  if (failures >= threshold) {
    return { count: null, failures };
  }
  return { count: prev.count, failures };
}

export function useOnlineDeliveryCount(enabled: boolean): {
  count: number | null;
} {
  const [count, setCount] = useState<number | null>(null);
  // Ref (not state) so incrementing the counter doesn't re-render
  // the consumer on every failed poll. We only re-render on the
  // 3rd strike when we flip count to null, or on any successful
  // poll.
  const failuresRef = useRef(0);
  const countRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setCount(null);
      failuresRef.current = 0;
      countRef.current = null;
      return;
    }
    let cancelled = false;
    const apply = (
      outcome:
        | { kind: 'success'; value: number }
        | { kind: 'failure' },
    ) => {
      const next = nextPollState(
        { count: countRef.current, failures: failuresRef.current },
        outcome,
      );
      failuresRef.current = next.failures;
      countRef.current = next.count;
      // Only re-render when the displayed value actually changes —
      // a transient failure that preserves the previous count
      // shouldn't churn React.
      setCount(prev => (prev === next.count ? prev : next.count));
    };
    const tick = async () => {
      try {
        const c = await orderService.getOnlineDeliveryCount();
        if (cancelled) return;
        apply({ kind: 'success', value: c });
      } catch (e) {
        if (cancelled) return;
        console.warn(
          '[useOnlineDeliveryCount] fetch failed (strike',
          failuresRef.current + 1,
          'of',
          STALE_THRESHOLD,
          '):',
          e,
        );
        apply({ kind: 'failure' });
      }
    };
    tick();
    const interval = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

  return { count };
}
