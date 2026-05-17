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
 *   - `isAvailableForClaim`    — unassigned + out_for_delivery (pickup)
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
  isPickedUp: boolean;
  isDelivered: boolean;
  /**
   * The order is no longer actionable by the current viewer. Either
   * a different delivery person claimed it, or it's already
   * delivered. Drives the "claimed by another partner" /
   * "already delivered" terminal EmptyState branch on the screen.
   */
  isTerminalForOthers: boolean;
};

export const FLAGS_NULL_ORDER: DeliveryFlags = {
  isAssigned: false,
  isAvailableForClaim: false,
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
    order.status === 'out_for_delivery';
  const isPickedUp = !!order.pickedUpAt;
  // "Terminal for others" = the viewer can't claim AND isn't the
  // owner. Either someone else has it, or it's done. The screen
  // uses this to render an EmptyState instead of dead buttons.
  const isTerminalForOthers =
    !isAssignedToMe && !isAvailableForClaim;
  return {
    isAssigned: isAssignedToMe,
    isAvailableForClaim,
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

export type UseDeliveryOrderDetailDeps = {
  watchOrder?: typeof orderService.watchOrder;
  claimDelivery?: ClaimDeliveryFn;
  markPickedUp?: StatusActionFn;
  markDelivered?: StatusActionFn;
  now?: () => number;
};

export type UseDeliveryOrderDetailResult = DeliveryOrderDetailState &
  DeliveryFlags & {
    pendingAction: 'claim' | 'pickedUp' | 'delivered' | null;
    handleClaim: () => Promise<{ ok: true } | { ok: false; error: string }>;
    handlePickedUp: () => Promise<
      { ok: true } | { ok: false; error: string }
    >;
    handleDelivered: () => Promise<
      { ok: true } | { ok: false; error: string }
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
  const now = deps.now ?? (() => Date.now());

  const [state, setState] = useState<DeliveryOrderDetailState>(INITIAL_STATE);
  const [pendingAction, setPendingAction] =
    useState<'claim' | 'pickedUp' | 'delivered' | null>(null);
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
    retry,
  };
}
