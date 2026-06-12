/**
 * PR-NEXT-BUNDLE-H §E — thin Sentry-compatible observability shim
 * for Cloud Functions. Sentry's React Native SDK is not available
 * in the Node 22 functions runtime; GCP Cloud Logging captures
 * structured console.error output and makes it queryable.
 *
 * Exports a `Sentry` object whose API surface matches the subset
 * used across `functions/src/` so callers compile against the same
 * interface and tests can mock this module with jest.mock.
 *
 * Pinned by tests/functions/sentryFunctions.test.ts.
 */

export const Sentry = {
  captureException(
    err: unknown,
    context?: {
      tags?: Record<string, string>;
      extra?: Record<string, unknown>;
    },
  ): void {
    console.error('[Sentry]', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      tags: context?.tags ?? {},
      extra: context?.extra ?? {},
    });
  },
};
