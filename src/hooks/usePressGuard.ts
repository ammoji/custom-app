/**
 * PR 27 — Re-entrancy guard for async press handlers.
 *
 * Why: the existing `disabled={busyState}` pattern is paint-time
 * defense only. If the user taps a button fast enough that the
 * second tap fires before React re-renders with disabled=true, two
 * copies of the handler run. On payment / order callables that
 * means duplicate Razorpay sessions or duplicate cancellations.
 *
 * How: a ref-backed boolean flipped synchronously on entry, cleared
 * synchronously in finally. Any re-entrant tap is a no-op until the
 * in-flight handler resolves.
 *
 * Usage:
 *
 *   const guardedPlaceOrder = usePressGuard(placeOrder);
 *   <Button onPress={guardedPlaceOrder} loading={placing} />
 *
 * Notes:
 *  - The wrapped function's return value is preserved (Promise<T>).
 *  - The wrapped function's rejection is preserved — callers can
 *    still chain `.catch` or `await` with try/catch. The guard does
 *    NOT swallow errors.
 *  - The hook is intentionally NOT debounced by time. Pure mutex.
 *    A 0-second debounce would block ALL re-presses, not just
 *    in-flight ones. We want users to be able to retry AFTER the
 *    first call settles, just not DURING it.
 *  - This hook does NOT use useState. State updates lag a paint;
 *    that's the whole bug we're fixing.
 *
 * Test discipline: the React-free guard logic is extracted into the
 * pure `createPressGuard` factory below so it can be unit-tested
 * without RNTL / react-test-renderer (which the project deliberately
 * doesn't pull in — see `.windsurf/test-discipline.md` and the
 * `useOnlineDeliveryCount` precedent). The hook is a thin
 * `useRef` + `useCallback` wrapper around the same closure logic.
 */
import { useCallback, useRef } from 'react';

/**
 * Pure factory: given an async handler, returns a guarded wrapper
 * that swallows any re-entrant call while the underlying handler is
 * still in-flight. Lives outside the hook so tests can exercise the
 * guard contract without React.
 */
export function createPressGuard<TArgs extends unknown[], TReturn>(
  handler: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn | undefined> {
  // Closure-scoped boolean — same role as the ref in the hook
  // version, but free of React. Synchronously read+set inside the
  // returned wrapper so a second call fired before the first awaits
  // sees the busy flag.
  const busy = { current: false };

  return async (...args: TArgs) => {
    if (busy.current) {
      // Silently swallow the re-entrant call. Don't log to Sentry —
      // this is expected user behaviour (impatient tap), not a bug.
      return undefined;
    }
    busy.current = true;
    try {
      return await handler(...args);
    } finally {
      busy.current = false;
    }
  };
}

export function usePressGuard<TArgs extends unknown[], TReturn>(
  handler: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn | undefined> {
  const busy = useRef(false);

  return useCallback(
    async (...args: TArgs) => {
      if (busy.current) {
        return undefined;
      }
      busy.current = true;
      try {
        return await handler(...args);
      } finally {
        busy.current = false;
      }
    },
    [handler],
  );
}
