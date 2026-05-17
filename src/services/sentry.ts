import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

// Read DSN from app.json's expo.extra.sentry.dsn via expo-constants. Same
// rationale as services/firebase.ts — Metro's process.env inlining was
// dropping these values in production builds on Expo SDK 54. Constants
// reads from app.json at runtime and is bundler-agnostic.
const dsn =
  (Constants.expoConfig?.extra as { sentry?: { dsn?: string } } | undefined)
    ?.sentry?.dsn ?? process.env.EXPO_PUBLIC_SENTRY_DSN;

export function initSentry() {
  if (!dsn) {
    // eslint-disable-next-line no-console
    console.warn(
      '[sentry] DSN not set in app.json expo.extra.sentry.dsn — error tracking disabled',
    );
    return;
  }
  Sentry.init({
    dsn,
    // PII off — we don't want IPs or emails in error reports.
    sendDefaultPii: false,
    // Capture rate — 100% in dev, 50% for MVP prod. Tune later if noisy.
    tracesSampleRate: __DEV__ ? 1.0 : 0.5,
    // Tag events so dev vs prod are separated in the Sentry UI.
    environment: __DEV__ ? 'development' : 'production',
    // Filter common third-party / network noise so the dashboard isn't drowned.
    ignoreErrors: [/Network request failed/, /AbortError/],
  });
}

export { Sentry };
