/**
 * PR-NEXT-STATIC-MAP-PREVIEW §B — runtime accessor for the Google
 * Static Maps API key.
 *
 * The key is baked into `app.config.js`'s `extra.googleMapsApiKey`
 * at EAS build time from the `EXPO_PUBLIC_GOOGLE_MAPS_KEY` secret.
 * Returns `null` when the key is absent (local dev, or EAS secret
 * not yet set) — callers must treat null as "no map available."
 *
 * Same pattern as `src/constants/legal.ts` and
 * `src/services/sentry.ts` which both use Constants.expoConfig.extra.
 */
import Constants from 'expo-constants';

export function getGoogleMapsApiKey(): string | null {
  const key = (
    Constants.expoConfig?.extra as { googleMapsApiKey?: string | null } | undefined
  )?.googleMapsApiKey;
  return typeof key === 'string' && key.length > 0 ? key : null;
}
