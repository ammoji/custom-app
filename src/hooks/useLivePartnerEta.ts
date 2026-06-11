/**
 * PR-NEXT-PARTNER-CARD.2 — 30s polling hook for the partner-details
 * sheet. Auto-pauses when `enabled` is false (sheet dismissed) and
 * resumes on reopen. The auto-pause matters because the polling
 * lives off a 30s interval — leaving it running while the sheet is
 * closed would burn callable invocations + battery for zero UX
 * benefit (no one's looking at the values).
 *
 * Fallback policy: the server gate may legitimately reject with
 * `failed-precondition` for a few reasons (partner has no GPS yet,
 * legacy order with no shopLocation). Those are NOT alerted to the
 * customer — the sheet falls back to the at-order static estimate
 * (`order.deliveryDistanceKm` / `deliveryDurationMin`) with a muted
 * "~ estimated" suffix driven by `stale: true` on the formatter
 * input. So the hook returns `null` for distance/eta on any error
 * and the sheet handles the substitution.
 *
 * Concurrency posture:
 *   - `cancelled` ref prevents an in-flight tick from `setState`-ing
 *     after unmount (or after the sheet closes and the hook tears
 *     down). React 18 strict-mode double-invokes effects, so the
 *     cleanup-then-rerun cycle would otherwise leak a stale
 *     `setState` if the network is slow.
 *   - `setInterval` not `setTimeout` recursion — interval drift
 *     under heavy CPU is acceptable for a 30s pilot cadence.
 */
import { useEffect, useRef, useState } from 'react';
import { orderService } from '../services/orderService';

export type LivePartnerEtaState = {
  distanceKm: number | null;
  etaMin: number | null;
  // True when the server reports a stale `currentLocationUpdatedAt`
  // (> 2 minutes old) OR when we're showing the static fallback
  // (i.e. `distanceKm == null`). The sheet drives the muted
  // "~ estimated" suffix off whichever is true.
  stale: boolean;
  // Surfaces during the first fetch on open. Subsequent re-polls
  // don't flip this back to true — the previous value stays visible
  // while we refresh in the background (avoids the "data → spinner
  // → data" flicker every 30 seconds).
  loading: boolean;
};

const REFRESH_MS = 30 * 1000;

// PR-NEXT-BUNDLE-A §C (Finding #12a) — DO NOT REMOVE. Finalized
// statuses that must stop polling even when the sheet is open.
// Polling against a delivered/cancelled order returns stale
// "Arriving now" copy because partner→drop distance is ~0.
const FINALIZED_STATUSES = new Set(['delivered', 'cancelled'] as const);

/**
 * PR-NEXT-BUNDLE-A §C — pure decision: should the hook poll right now?
 * Exported so it can be unit-tested without RNTL.
 * The hook body mirrors this logic exactly.
 */
export function shouldPoll(args: {
  orderId: string | null;
  enabled: boolean;
  orderStatus?: string | null;
}): boolean {
  if (!args.orderId || !args.enabled) return false;
  if (
    typeof args.orderStatus === 'string' &&
    FINALIZED_STATUSES.has(args.orderStatus as 'delivered' | 'cancelled')
  ) {
    return false;
  }
  return true;
}

export function useLivePartnerEta(
  orderId: string | null,
  enabled: boolean,
  // PR-NEXT-BUNDLE-A §C — DO NOT REMOVE. When status flips to
  // 'delivered' or 'cancelled', polling stops immediately and
  // state is cleared to null so the sheet can show static
  // "Delivered" / "Cancelled" copy instead of a stale ETA.
  orderStatus?: string | null,
): LivePartnerEtaState {
  const [state, setState] = useState<LivePartnerEtaState>({
    distanceKm: null,
    etaMin: null,
    stale: false,
    loading: false,
  });
  const cancelledRef = useRef(false);

  useEffect(() => {
    // PR-NEXT-BUNDLE-A §C — stop polling on finalized orders.
    // Cost of continuing: server returns ~0 distance → "Arriving
    // now" on a delivered order. Clearing to null lets the sheet
    // render its own static copy for those states.
    const isFinalized =
      typeof orderStatus === 'string' &&
      FINALIZED_STATUSES.has(orderStatus as 'delivered' | 'cancelled');

    if (!orderId || !enabled || isFinalized) {
      // Sheet closed, no order yet, or order finalized: reset to
      // the initial state so the next open starts clean.
      setState({
        distanceKm: null,
        etaMin: null,
        stale: false,
        loading: false,
      });
      return;
    }
    cancelledRef.current = false;

    const tick = async () => {
      // Only the FIRST fetch sets loading=true; the live row stays
      // populated while the 30s refresh happens in the background.
      setState(prev =>
        prev.distanceKm == null && prev.etaMin == null
          ? { ...prev, loading: true }
          : prev,
      );
      try {
        const data = await orderService.getLivePartnerEta(orderId);
        if (cancelledRef.current) return;
        setState({
          distanceKm: data.distanceKm,
          etaMin: data.etaMin,
          stale: data.stale,
          loading: false,
        });
      } catch {
        // `failed-precondition` (no partner location yet, etc.) —
        // sheet falls back to the static estimate. Don't surface
        // the error; just stop the spinner.
        if (cancelledRef.current) return;
        setState(prev => ({ ...prev, loading: false }));
      }
    };

    tick();
    const intervalId = setInterval(tick, REFRESH_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(intervalId);
    };
  }, [orderId, enabled, orderStatus]);

  return state;
}
