import { useEffect, useRef, useState } from 'react';
import { orderService } from '../services/orderService';

/**
 * PR-NEXT-7 (finding #9) — count of delivery partners who would
 * actually receive a push for a new order at the shop owner's
 * shop. Powers the "N partners online nearby" trust badge on
 * ShopOwnerDashboard.
 *
 * Mirrors `useOnlineDeliveryCount` (Phase 12c, PR 3 — concurrency
 * cleanup item 5) — same polling cadence philosophy, same stale-
 * threshold semantics, same null-on-permanent-failure posture.
 * The single difference is the additional `filtered` boolean
 * returned alongside the count so the UI can render an optional
 * "set shop location for an accurate count" hint for the fail-
 * open unfiltered case.
 *
 * IMPORTANT — hooks rules (code-discipline Rule 2): callers in
 * `ShopOwnerDashboardScreen` MUST invoke this hook ABOVE any
 * conditional early-return. The hook gates the fetch internally
 * via `enabled`; callers should pass `isShopOwner && !!shopId`
 * rather than gating the hook call itself.
 *
 * IMPORTANT — claims discipline: do NOT widen this hook (or
 * `orderService.getOnlinePartnersNearMyShop`) to accept a `shopId`
 * parameter. The callable derives the shop from the caller's
 * server-validated claims; passing it through the client would
 * invite cross-shop snooping attempts. Server-side `claims.shopId`
 * is the single source of truth.
 */
const POLL_MS = 30_000;
export const NEARBY_PARTNERS_STALE_THRESHOLD = 3;

export type NearbyPartnersState = {
  count: number | null;
  filtered: boolean;
};

const INITIAL_STATE: NearbyPartnersState = {
  count: null,
  filtered: false,
};

/**
 * Pure state-machine slice for the polling hook. Extracted so the
 * consecutive-failure semantics can be unit-tested without a React
 * renderer (react-test-renderer isn't a project dependency and
 * RNTL is out of scope per `.windsurf/test-discipline.md`).
 *
 *   - Success           → counter resets to 0; new value installed
 *                         (count + filtered).
 *   - Failure under N   → counter += 1; previous value preserved.
 *   - Failure at >= N   → counter += 1; value cleared to
 *                         `{ count: null, filtered: false }` so
 *                         the placeholder copy renders honestly.
 */
export function nextNearbyPartnersState(
  prev: { state: NearbyPartnersState; failures: number },
  outcome:
    | { kind: 'success'; value: NearbyPartnersState }
    | { kind: 'failure' },
  threshold: number = NEARBY_PARTNERS_STALE_THRESHOLD,
): { state: NearbyPartnersState; failures: number } {
  if (outcome.kind === 'success') {
    return { state: outcome.value, failures: 0 };
  }
  const failures = prev.failures + 1;
  if (failures >= threshold) {
    return { state: INITIAL_STATE, failures };
  }
  return { state: prev.state, failures };
}

export function useOnlinePartnersNearMyShop(
  enabled: boolean,
): NearbyPartnersState {
  const [state, setState] = useState<NearbyPartnersState>(INITIAL_STATE);
  // Refs (not state) so incrementing the counter on a transient
  // failure doesn't re-render the consumer on every failed poll.
  // We only re-render on the Nth strike when we flip to null, or
  // on any successful poll where the displayed value actually
  // changed.
  const failuresRef = useRef(0);
  const stateRef = useRef<NearbyPartnersState>(INITIAL_STATE);

  useEffect(() => {
    if (!enabled) {
      setState(INITIAL_STATE);
      failuresRef.current = 0;
      stateRef.current = INITIAL_STATE;
      return;
    }
    let cancelled = false;
    const apply = (
      outcome:
        | { kind: 'success'; value: NearbyPartnersState }
        | { kind: 'failure' },
    ) => {
      const next = nextNearbyPartnersState(
        { state: stateRef.current, failures: failuresRef.current },
        outcome,
      );
      failuresRef.current = next.failures;
      stateRef.current = next.state;
      // Only re-render when the displayed value actually changes —
      // a transient failure that preserves the previous value
      // shouldn't churn React.
      setState(prev =>
        prev.count === next.state.count && prev.filtered === next.state.filtered
          ? prev
          : next.state,
      );
    };
    const tick = async () => {
      try {
        const v = await orderService.getOnlinePartnersNearMyShop();
        if (cancelled) return;
        apply({ kind: 'success', value: v });
      } catch (e) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn(
          '[useOnlinePartnersNearMyShop] fetch failed (strike',
          failuresRef.current + 1,
          'of',
          NEARBY_PARTNERS_STALE_THRESHOLD,
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

  return state;
}
