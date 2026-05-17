import { useEffect, useState } from 'react';
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
 */
const POLL_MS = 15_000;

export function useOnlineDeliveryCount(enabled: boolean): {
  count: number | null;
} {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setCount(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const c = await orderService.getOnlineDeliveryCount();
        if (!cancelled) setCount(c);
      } catch (e) {
        // Don't churn the UI on transient errors — keep last known
        // value if we have one, else stay null.
        console.warn('[useOnlineDeliveryCount] fetch failed:', e);
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
