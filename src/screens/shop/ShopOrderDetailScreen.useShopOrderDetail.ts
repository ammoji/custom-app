import { useCallback, useEffect, useState } from 'react';
import { orderService } from '../../services/orderService';
import type { Order } from '../../types';
// PR 3 — concurrency cleanup (item 3a). Race-guard rollbacks so a
// watcher tick mid-flight isn't clobbered by stale captured state.
// NOTE: auto-formatter has stripped this import; if tsc complains
// about Cannot find name 'shouldRollbackOptimistic' after a save,
// re-add it.
import { shouldRollbackOptimistic } from '../../utils/optimisticRollback';
import type { OrderStatus } from '../../utils/orderStateMachine';

/**
 * State machine for ShopOrderDetailScreen. Extracted from the screen
 * so the watcher contract + optimistic-action revert can be unit
 * tested without React Native rendering. Same pattern as
 * `ShopListScreen.useShopListData`.
 *
 * Contract:
 *   - First watcher callback (success or error) ALWAYS clears
 *     loading. The whole point of the v2-iii watcher-contract
 *     refactor (post-loader-spin hotfix) — pinned by tests.
 *   - On a watcher error AFTER an initial successful render, we
 *     keep the prior `order` on screen and surface the error in a
 *     banner. Tossing the order would make the screen flash empty.
 *   - On a watcher error BEFORE any successful render, `order`
 *     stays null and the screen renders the error state. The
 *     screen-level Retry path remounts the hook by bumping a key.
 *   - `handleAction` does optimistic status update; on failure it
 *     reverts to the prior status and returns an error result so
 *     the screen can show an Alert. The next watcher tick (≤5s on
 *     native poll, instant on web onSnapshot) will resync anyway,
 *     but reverting eagerly avoids a stale-button-flash race.
 */

export type WatcherUpdate = {
  order: Order | null;
  error?: Error;
};

export type ShopOrderDetailState = {
  order: Order | null;
  loading: boolean;
  error: string | null;
};

export const INITIAL_STATE: ShopOrderDetailState = {
  order: null,
  loading: true,
  error: null,
};

/**
 * Pure reducer for one watcher callback. Pinned because the
 * `loading: false` line on the error branch is the regression we
 * keep solving in different shapes.
 */
export function reduceWatcherUpdate(
  prev: ShopOrderDetailState,
  update: WatcherUpdate,
): ShopOrderDetailState {
  if (update.error) {
    return {
      // Preserve `prev.order` so a transient error doesn't blank
      // out the screen. The banner above tells the user something
      // went wrong; meanwhile they can still see the items they
      // need to fulfil.
      order: prev.order,
      // ALWAYS — see watcher contract refactor.
      loading: false,
      error: update.error.message || 'Could not load order. Try again later.',
    };
  }
  return {
    order: update.order,
    loading: false,
    error: null,
  };
}

export type UpdateOrderStatusFn = (input: {
  orderId: string;
  newStatus: OrderStatus;
  // PR 12 — ETA passed through on accept / preparing transitions.
  readyByEstimate?: number;
}) => Promise<void>;

/**
 * Pure helper that performs the actual updateOrderStatus call and
 * normalises the result into a discriminated union. Lets the hook
 * (and tests) drive the success/failure branches without depending
 * on the ambient orderService.
 */
export async function runOrderActionOnce(
  updateOrderStatus: UpdateOrderStatusFn,
  orderId: string,
  newStatus: OrderStatus,
  readyByEstimate?: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await updateOrderStatus({
      orderId,
      newStatus,
      ...(readyByEstimate !== undefined ? { readyByEstimate } : {}),
    });
    return { ok: true };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || 'Failed to update order status.',
    };
  }
}

/**
 * Pure helper that produces an optimistically-updated order. Kept
 * separate so the test for the revert scenario can call it
 * directly without spinning up the hook.
 */
export function applyOptimisticStatus(
  order: Order | null,
  newStatus: OrderStatus,
): Order | null {
  if (!order) return order;
  return { ...order, status: newStatus };
}

export type UseShopOrderDetailDeps = {
  watchOrder?: typeof orderService.watchOrder;
  updateOrderStatus?: UpdateOrderStatusFn;
};

export type UseShopOrderDetailResult = ShopOrderDetailState & {
  pendingStatus: OrderStatus | null;
  handleAction: (
    newStatus: OrderStatus,
    readyByEstimate?: number,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  retry: () => void;
};

/**
 * The hook itself is a thin React wiring layer around the pure
 * helpers above. We don't unit-test it directly — RNTL is still
 * out of scope. The pure helpers carry the semantic load.
 */
export function useShopOrderDetail(
  orderId: string,
  deps: UseShopOrderDetailDeps = {},
): UseShopOrderDetailResult {
  const watch = deps.watchOrder ?? orderService.watchOrder;
  const update = deps.updateOrderStatus ?? orderService.updateOrderStatus;

  const [state, setState] = useState<ShopOrderDetailState>(INITIAL_STATE);
  const [pendingStatus, setPendingStatus] = useState<OrderStatus | null>(null);
  // Manual remount lever for the watcher; bumping this re-runs the
  // effect after a Retry tap. Same pattern as ShopOwnerDashboard.
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    setState(INITIAL_STATE);
    let cancelled = false;
    const unsub = watch(orderId, (order, error) => {
      if (cancelled) return;
      setState(prev => reduceWatcherUpdate(prev, { order, error }));
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [orderId, watch, retryNonce]);

  const handleAction = useCallback(
    async (newStatus: OrderStatus, readyByEstimate?: number) => {
      const previousStatus = state.order?.status;
      // Optimistic update so the chip + button row refresh
      // instantly. Reverted below on failure.
      setState(prev => ({
        ...prev,
        order: applyOptimisticStatus(prev.order, newStatus),
      }));
      setPendingStatus(newStatus);
      const result = await runOrderActionOnce(
        update,
        orderId,
        newStatus,
        readyByEstimate,
      );
      if (!result.ok && previousStatus) {
        // PR 3 — concurrency cleanup. Only roll back to
        // previousStatus if the current order's status is STILL the
        // optimistic value we wrote. If a watcher tick arrived in
        // the gap and installed something different, that's the
        // server's view and clobbering it would undo a successful
        // concurrent transition (worst case: another role just
        // delivered the order, our rollback flips it back to
        // 'preparing'). Trust the watcher.
        setState(prev => {
          if (
            !shouldRollbackOptimistic(prev.order?.status, newStatus)
          ) {
            console.warn(
              '[useShopOrderDetail] rollback suppressed — watcher already updated to',
              prev.order?.status,
            );
            return prev;
          }
          return {
            ...prev,
            order: applyOptimisticStatus(prev.order, previousStatus),
          };
        });
      }
      setPendingStatus(null);
      return result;
    },
    [orderId, state.order?.status, update],
  );

  const retry = useCallback(() => {
    setRetryNonce(n => n + 1);
  }, []);

  return {
    ...state,
    pendingStatus,
    handleAction,
    retry,
  };
}
