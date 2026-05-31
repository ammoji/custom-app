/**
 * PR-NEXT-5 — temporal dampening for polling-watcher error banners.
 *
 * The Delivery Dashboard polls two callables every 10–15s
 * (`watchAvailableDeliveries` + `watchMyDeliveries`) and shows a
 * "Network connection lost" banner when both happen to be in error
 * state. A single transient blip — Cloud Run cold start, iOS idle-
 * connection reap, brief Wi-Fi to cellular hand-off — makes the
 * banner flicker for 10–15s before the next successful poll dismisses
 * it. The partner reads that flicker as "the system is broken" and
 * loses confidence well before they have any actual problem to act
 * on (finding #7 in `docs/TESTING-FINDINGS-2026-05-30.md`).
 *
 * This helper tracks consecutive failures per watcher and only flips
 * a watcher's `tripped` flag once N failures stack up uninterrupted.
 * The screen owns the counter state (in closure variables inside the
 * existing watcher `useEffect`); this helper just decides what the
 * new state + signals are after each new outcome.
 *
 * Pure / no React / no Firebase. Mirrors the convention established
 * by `deliveryRoutingHelpers`, `displayOrderStatus`,
 * `notificationRadiusHelpers`, `codPaymentHelpers`,
 * `menuListingHelpers`.
 *
 * Test suite: `tests/utils/pollFailureGate.test.ts`.
 */

/**
 * Default consecutive-failure count before flipping `tripped`.
 *
 * At the existing dashboard poll cadences (10s for the `mine`
 * watcher, 15s for `available`), a value of 3 means the banner
 * shows only after the SLOWER watcher has had ~45 seconds of
 * uninterrupted failure — well past any reasonable transient.
 * Anything shorter is "network jitter" and the partner doesn't
 * need to know about it.
 */
export const POLL_FAILURE_THRESHOLD = 3;

export type PollOutcomeKind = 'success' | 'failure';

export type PollGateUpdate = {
  /** New consecutive-failure count. Always 0 after a 'success'. */
  nextCount: number;
  /** True once `nextCount >= threshold`. */
  tripped: boolean;
  /**
   * Distinguishes the moment we cross from below-threshold to at-or-
   * above-threshold. Used by the screen for "captureMessage once per
   * outage event, not per failed poll" Sentry hygiene — fire on
   * `justTripped`, suppress on subsequent `tripped && !justTripped`
   * polls while the outage continues. Always false on `success`
   * outcomes.
   */
  justTripped: boolean;
};

/**
 * Apply a new poll outcome to the current consecutive-failure count
 * and decide what the new state + signals are.
 *
 *   success → nextCount=0, tripped=false, justTripped=false
 *   failure → nextCount=clampedCurrent+1,
 *             tripped=(nextCount >= threshold),
 *             justTripped=(was below threshold before this call)
 *
 * `currentCount` is clamped to a non-negative integer before the
 * increment so a future caller bug (negative seed, NaN) can't
 * leave us stuck below threshold forever.
 */
export function applyPollOutcome(opts: {
  currentCount: number;
  outcome: PollOutcomeKind;
  threshold?: number;
}): PollGateUpdate {
  const threshold = opts.threshold ?? POLL_FAILURE_THRESHOLD;
  if (opts.outcome === 'success') {
    return { nextCount: 0, tripped: false, justTripped: false };
  }
  // Defensive clamp: negative / NaN currentCount → start from 0.
  const sanitized =
    typeof opts.currentCount === 'number' &&
    Number.isFinite(opts.currentCount) &&
    opts.currentCount > 0
      ? Math.floor(opts.currentCount)
      : 0;
  const nextCount = sanitized + 1;
  const wasTripped = sanitized >= threshold;
  const tripped = nextCount >= threshold;
  return {
    nextCount,
    tripped,
    justTripped: tripped && !wasTripped,
  };
}
