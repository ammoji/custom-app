/**
 * Should we rollback an optimistic state mutation?
 *
 * Returns true iff the current state still matches the optimistic
 * value we wrote — i.e. no concurrent watcher tick has installed a
 * different (and presumably authoritative) value in the meantime.
 * If something else has happened, trust the watcher: it saw the
 * server state and we should not overwrite it with stale captured
 * data.
 *
 * Used by all client-side optimistic-update sites in the dashboards
 * (AdminOrders, useShopOrderDetail, DeliveryDashboard handlePickedUp
 * / handleDelivered). Extracted so the race-condition reasoning lives
 * in one place and can be unit-tested without touching React.
 *
 * Strict equality is intentional: callers compare primitive status /
 * timestamp values, NOT entire orders. If you find yourself wanting
 * deep comparison here, you almost certainly want to capture a
 * narrower scalar at the call site instead.
 */
export function shouldRollbackOptimistic<T>(
  currentValue: T,
  optimisticValue: T,
): boolean {
  return currentValue === optimisticValue;
}
