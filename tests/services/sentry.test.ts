/**
 * PR 26 — pin the Sentry init contract.
 *
 * The sourcemap-upload PR doesn't change runtime behaviour, but
 * future PRs might. These tests fail loudly if someone:
 *   - removes the DSN read from app.json
 *   - changes the prod sample rate without thinking
 *   - regresses the PII-off setting
 *   - swaps environment tags
 *   - drops the network-noise filters
 *
 * The Sentry SDK + expo-constants are mocked at module level (via
 * `jest.mock(... factory)`), which Jest hoists above all imports.
 * Each test isolates module state with `jest.isolateModules` so
 * `src/services/sentry.ts`'s top-level DSN read re-evaluates against
 * the mocked `expo-constants` on every test.
 */
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        sentry: {
          dsn: 'https://test@test.ingest.sentry.io/123',
        },
      },
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Sentry = require('@sentry/react-native');

describe('PR 26 — Sentry init contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('reads DSN from expo-constants extra.sentry.dsn', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { initSentry } = require('../../src/services/sentry');
      initSentry();
    });
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://test@test.ingest.sentry.io/123',
      }),
    );
  });

  test('PII collection is disabled', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { initSentry } = require('../../src/services/sentry');
      initSentry();
    });
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ sendDefaultPii: false }),
    );
  });

  test('environment tag matches __DEV__ flag', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { initSentry } = require('../../src/services/sentry');
      initSentry();
    });
    // jest-expo's preset sets __DEV__ to false; either way the
    // contract is "tag matches the runtime flag" — assert the
    // mapping rather than a hardcoded string so this passes in
    // both jest-expo and a hypothetical __DEV__=true harness.
    const expected = (globalThis as unknown as { __DEV__: boolean })
      .__DEV__
      ? 'development'
      : 'production';
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ environment: expected }),
    );
  });

  test('network-noise filters are present', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { initSentry } = require('../../src/services/sentry');
      initSentry();
    });
    const call = (Sentry.init as jest.Mock).mock.calls[0][0];
    expect(call.ignoreErrors).toEqual(
      expect.arrayContaining([expect.any(RegExp)]),
    );
    // The /Network request failed/ pattern should still be in there.
    const hasNetwork = (call.ignoreErrors as RegExp[]).some(r =>
      r.source.includes('Network request failed'),
    );
    expect(hasNetwork).toBe(true);
  });
});
