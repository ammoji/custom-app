import { useCallback, useEffect, useState } from 'react';
import { orderService } from '../../services/orderService';
import type { Order } from '../../types';

/**
 * State machine for DeliveryOrderDetailScreen. Same architectural
 * pattern as `ShopOrderDetailScreen.useShopOrderDetail.ts` and
 * `ShopListScreen.useShopListData.ts` — the screen is a thin
 * presenter, the pure helpers below carry every assertion that
 * matters for tests.
 *
 * Three derived flags drive the UI:
 *   - `isAssigned`             — the current uid owns this order
 *   - `isAvailableForClaim`    — unassigned + ready_for_pickup (pickup)
 *   - `isTerminalForOthers`    — claimed by someone else, or delivered
 *
 * `handleClaim` is the one that needs revert-on-failure — the race
 * loser must see the dashboard refresh to current reality. The
 * other two actions revert the same way (matches the dashboard
 * card behaviour) so the screen stays consistent if used as the
 * sole action surface.
 */

export type WatcherUpdate = { order: Order | null; error?: Error };

export type DeliveryOrderDetailState = {
  order: Order | null;
  loading: boolean;
  error: string | null;
};

export const INITIAL_STATE: DeliveryOrderDetailState = {
  order: null,
  loading: true,
  error: null,
};

/**
 * Pure reducer for one watcher callback. The `loading: false` line
 * on the error branch is the regression-prone bit — pinned by tests
 * (deliberate-break demo target).
 */
export function reduceWatcherUpdate(
  prev: DeliveryOrderDetailState,
  update: WatcherUpdate,
): DeliveryOrderDetailState {
  if (update.error) {
    return {
      // Keep prior order so a transient error doesn't blank the
      // screen mid-pickup. The banner above tells the user.
      order: prev.order,
      loading: false,
      error: update.error.message || 'Could not load order. Try again.',
    };
  }
  return {
    order: update.order,
    loading: false,
    error: null,
  };
}

export type DeliveryFlags = {
  isAssigned: boolean;
  isAvailableForClaim: boolean;
  /**
   * PR 23 — the viewer is a delivery partner previewing an order
   * that the shop has accepted or is preparing but has not yet
   * flagged ready_for_pickup. The dashboard's "Heads up — coming
   * soon" rail (PR 12) routes here on tap; the screen renders the
   * order info with an info banner and no action button.
   *
   * Before PR 23 these orders fell into `isTerminalForOthers` and
   * the screen wrongly rendered "Already taken". See the screen-
   * branch ordering comment in DeliveryOrderDetailScreen.tsx.
   */
  isComingSoon: boolean;
  isPickedUp: boolean;
  isDelivered: boolean;
  /**
   * The order is no longer actionable by the current viewer because
   * a different delivery person claimed it, OR it was already
   * delivered by someone else. Drives the "claimed by another
   * partner" / "already delivered" terminal EmptyState branches on
   * the screen.
   *
   * PR 23 narrowed this: it no longer catches orders that simply
   * aren't ready_for_pickup yet (accepted/preparing) — those are
   * `isComingSoon` instead.
   */
  isTerminalForOthers: boolean;
};

export const FLAGS_NULL_ORDER: DeliveryFlags = {
  isAssigned: false,
  isAvailableForClaim: false,
  isComingSoon: false,
  isPickedUp: false,
  isDelivered: false,
  isTerminalForOthers: false,
};

export function deriveDeliveryFlags(
  order: Order | null,
  uid: string | null | undefined,
  isDelivery: boolean,
): DeliveryFlags {
  if (!order) return FLAGS_NULL_ORDER;
  const isDelivered = order.status === 'delivered';
  const isAssignedToMe = !!uid && order.deliveryPersonId === uid;
  const isUnassigned =
    order.deliveryPersonId == null || order.deliveryPersonId === '';
  const isAvailableForClaim =
    !!isDelivery &&
    !isAssignedToMe &&
    isUnassigned &&
    order.status === 'ready_for_pickup';
  // PR 23 — "coming soon" matches the server's AVAILABLE_POOL minus
  // ready_for_pickup. The dashboard surfaces these to delivery
  // partners so they can plan routes; tapping should preview, not
  // dead-end into "Already taken".
  const isComingSoon =
    !!isDelivery &&
    !isAssignedToMe &&
    isUnassigned &&
    (order.status === 'accepted' || order.status === 'preparing');
  const isPickedUp = !!order.pickedUpAt;
  // PR 23 — narrowed semantics: claimed by another partner OR
  // already delivered (and not by me). The previous formulation
  // (`!isAssignedToMe && !isAvailableForClaim`) was a catch-all
  // that swept accepted/preparing into "terminal", which produced
  // the spurious "Already taken" message when a partner tapped a
  // heads-up card.
  const isClaimedByOther = !isUnassigned && !isAssignedToMe;
  const isTerminalForOthers =
    isClaimedByOther || (isDelivered && !isAssignedToMe);
  return {
    isAssigned: isAssignedToMe,
    isAvailableForClaim,
    isComingSoon,
    isPickedUp,
    isDelivered,
    isTerminalForOthers,
  };
}

export type ClaimDeliveryFn = (input: {
  orderId: string;
}) => Promise<{ orderId: string } | void>;
export type StatusActionFn = (input: { orderId: string }) => Promise<void>;

/**
 * Pure helper for the claim race. Resolves to a discriminated
 * union so the hook can render an Alert without an unhandled
 * rejection. Same shape as `runOrderActionOnce` in the shop hook.
 */
export async function runClaimOnce(
  claimDelivery: ClaimDeliveryFn,
  orderId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await claimDelivery({ orderId });
    return { ok: true };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || 'Could not claim this pickup. It may be taken.',
    };
  }
}

export async function runStatusActionOnce(
  fn: StatusActionFn,
  orderId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await fn({ orderId });
    return { ok: true };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || 'Update failed. Please try again.',
    };
  }
}

/** Pure: optimistically stamp `pickedUpAt: now` on the order. */
export function applyOptimisticPickedUp(
  order: Order | null,
  nowMs: number,
): Order | null {
  if (!order) return order;
  return { ...order, pickedUpAt: nowMs };
}

/** Pure: optimistically flip status → delivered. */
export function applyOptimisticDelivered(
  order: Order | null,
  nowMs: number,
): Order | null {
  if (!order) return order;
  return { ...order, status: 'delivered', deliveredAt: nowMs };
}

// PR-NEXT-COD-UX (Case 8) — `confirmCodPayment` callable injected
// the same way as the other delivery actions so unit tests can stub
// it without hitting Firebase. Returns `alreadyPaid` so the screen
// can surface the friendly "customer paid online" alert that the
// dashboard already shows.
export type ConfirmCodPaymentFn = (input: {
  orderId: string;
  paidMethod: 'cash' | 'online';
}) => Promise<{ ok: true; alreadyPaid: boolean }>;

export type UseDeliveryOrderDetailDeps = {
  watchOrder?: typeof orderService.watchOrder;
  claimDelivery?: ClaimDeliveryFn;
  markPickedUp?: StatusActionFn;
  markDelivered?: StatusActionFn;
  // PR-NEXT-COD-UX — injected for the new on-detail-screen Cash/UPI
  // pills (Case 8). Default is the production callable.
  confirmCodPayment?: ConfirmCodPaymentFn;
  now?: () => number;
};

export type UseDeliveryOrderDetailResult = DeliveryOrderDetailState &
  DeliveryFlags & {
    pendingAction:
      | 'claim'
      | 'pickedUp'
      | 'delivered'
      | 'confirmCod'
      | null;
    handleClaim: () => Promise<{ ok: true } | { ok: false; error: string }>;
    handlePickedUp: () => Promise<
      { ok: true } | { ok: false; error: string }
    >;
    handleDelivered: () => Promise<
      { ok: true } | { ok: false; error: string }
    >;
    // PR-NEXT-COD-UX (Case 8) — Cash/UPI pill handler. Optimistically
    // flips the local order to `paymentStatus: 'paid' + paidMethod`
    // so the screen falls through to the Delivered button on the
    // next render. Returns `alreadyPaid` so the screen can fire the
    // dashboard-equivalent friendly alert.
    handleConfirmCodPayment: (
      paidMethod: 'cash' | 'online',
    ) => Promise<
      | { ok: true; alreadyPaid: boolean }
      | { ok: false; error: string }
    >;
    retry: () => void;
  };

export function useDeliveryOrderDetail(
  orderId: string,
  uid: string | null | undefined,
  isDelivery: boolean,
  deps: UseDeliveryOrderDetailDeps = {},
): UseDeliveryOrderDetailResult {
  const watch = deps.watchOrder ?? orderService.watchOrder;
  const claim = deps.claimDelivery ?? orderService.claimDelivery;
  const pickedUp = deps.markPickedUp ?? orderService.markPickedUp;
  const delivered = deps.markDelivered ?? orderService.markDelivered;
  // PR-NEXT-COD-UX (Case 8) — defaults to the production callable so
  // the screen can fire the COD pill without threading orchestration
  // through props.
  const confirmCod =
    deps.confirmCodPayment ?? orderService.confirmCodPayment;
  const now = deps.now ?? (() => Date.now());

  const [state, setState] = useState<DeliveryOrderDetailState>(INITIAL_STATE);
  const [pendingAction, setPendingAction] =
    useState<'claim' | 'pickedUp' | 'delivered' | 'confirmCod' | null>(
      null,
    );
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!isDelivery) {
      setState(prev => ({ ...prev, loading: false }));
      return;
    }
    setState(INITIAL_STATE);
    let cancelled = false;
    const off = watch(orderId, (order, error) => {
      if (cancelled) return;
      setState(prev => reduceWatcherUpdate(prev, { order, error }));
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [orderId, isDelivery, watch, retryNonce]);

  const handleClaim = useCallback(async () => {
    if (!state.order) return { ok: false as const, error: 'Order not loaded' };
    setPendingAction('claim');
    // No optimistic UI flip on claim — the screen swaps from
    // available-for-claim to assigned only after the watcher tick
    // confirms it server-side. We DO surface the spinner via
    // pendingAction so the user knows the tap registered. On race
    // loss, the watcher (or the navigation back to dashboard) will
    // re-render reality.
    const result = await runClaimOnce(claim, state.order.id);
    setPendingAction(null);
    return result;
  }, [claim, state.order]);

  const handlePickedUp = useCallback(async () => {
    if (!state.order) return { ok: false as const, error: 'Order not loaded' };
    const orderId = state.order.id;
    setPendingAction('pickedUp');
    const ts = now();
    setState(prev => ({
      ...prev,
      order: applyOptimisticPickedUp(prev.order, ts),
    }));
    const result = await runStatusActionOnce(pickedUp, orderId);
    if (!result.ok) {
      // Revert.
      setState(prev =>
        prev.order
          ? { ...prev, order: { ...prev.order, pickedUpAt: null } }
          : prev,
      );
    }
    setPendingAction(null);
    return result;
  }, [pickedUp, state.order, now]);

  const handleDelivered = useCallback(async () => {
    if (!state.order) return { ok: false as const, error: 'Order not loaded' };
    const orderId = state.order.id;
    const previousStatus = state.order.status;
    const previousDeliveredAt = state.order.deliveredAt;
    setPendingAction('delivered');
    const ts = now();
    setState(prev => ({
      ...prev,
      order: applyOptimisticDelivered(prev.order, ts),
    }));
    const result = await runStatusActionOnce(delivered, orderId);
    if (!result.ok) {
      setState(prev =>
        prev.order
          ? {
              ...prev,
              order: {
                ...prev.order,
                status: previousStatus,
                deliveredAt: previousDeliveredAt ?? null,
              },
            }
          : prev,
      );
    }
    setPendingAction(null);
    return result;
  }, [delivered, state.order, now]);

  // PR-NEXT-COD-UX (Case 8) — Cash/UPI pill handler. Mirrors the
  // dashboard's `handleConfirmCodPayment` (in
  // `DeliveryDashboardScreen.tsx`) — same optimistic flip,
  // `alreadyPaid` surfacing, and revert-on-failure-unless-watcher-
  // already-paid posture. Local revert checks `paymentStatus !==
  // 'paid'` to avoid stomping a watcher tick that confirmed the
  // customer's parallel `payCodOrder` conversion mid-flight.
  const handleConfirmCodPayment = useCallback(
    async (paidMethod: 'cash' | 'online') => {
      if (!state.order)
        return { ok: false as const, error: 'Order not loaded' };
      const orderId = state.order.id;
      const previousStatus = state.order.paymentStatus;
      const previousPaidMethod = state.order.paidMethod;
      setPendingAction('confirmCod');
      setState(prev => ({
        ...prev,
        order: prev.order
          ? { ...prev.order, paymentStatus: 'paid', paidMethod }
          : prev.order,
      }));
      try {
        const result = await confirmCod({ orderId, paidMethod });
        setPendingAction(null);
        return { ok: true as const, alreadyPaid: result.alreadyPaid };
      } catch (e: any) {
        setState(prev => {
          if (!prev.order) return prev;
          if (prev.order.paymentStatus === 'paid') {
            // Watcher tick (or another fast handler) already paid
            // it — leave the optimistic flip in place.
            return prev;
          }
          return {
            ...prev,
            order: {
              ...prev.order,
              paymentStatus: previousStatus,
              paidMethod: previousPaidMethod,
            },
          };
        });
        setPendingAction(null);
        return {
          ok: false as const,
          error: e?.message || 'Could not confirm payment. Please try again.',
        };
      }
    },
    [confirmCod, state.order],
  );

  const retry = useCallback(() => {
    setRetryNonce(n => n + 1);
  }, []);

  const flags = deriveDeliveryFlags(state.order, uid, isDelivery);

  return {
    ...state,
    ...flags,
    pendingAction,
    handleClaim,
    handlePickedUp,
    handleDelivered,
    handleConfirmCodPayment,
    retry,
  };
}
