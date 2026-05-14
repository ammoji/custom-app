import * as Sentry from '@sentry/react-native';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export function initSentry() {
  if (!dsn) {
    // eslint-disable-next-line no-console
    console.warn('[sentry] EXPO_PUBLIC_SENTRY_DSN not set — error tracking disabled');
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
