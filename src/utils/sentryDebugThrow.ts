/**
 * PR 26 — Dev-only helper to verify Sentry source-map upload by
 * triggering a real, de-minifiable error from a known file/line.
 *
 * Usage: temporarily wire `<Button onPress={triggerSentryTestError}>`
 * to ANY screen during smoke testing of a fresh production build.
 * Tap → app crashes / Sentry receives the event → check the Sentry
 * dashboard. The stack trace should resolve to
 * `src/utils/sentryDebugThrow.ts:<line>` rather than `<anonymous>:1`.
 *
 * REMOVE the wiring before merging. The export itself is harmless to
 * leave in place — it isn't imported anywhere by default.
 */
export function triggerSentryTestError(): void {
  // Distinct, easily-grep-able message so the corresponding Sentry
  // event is identifiable in the dashboard.
  throw new Error(
    'PR 26 — Sentry source-map upload verification crash',
  );
}
