/**
 * PR 25 — Legal URLs (Privacy Policy + Terms of Service) hosted on
 * Firebase Hosting. Reads from `app.json` `extra.legal` via
 * `expo-constants`, with a hard-coded fallback that points at the
 * current dev project's `.web.app` domain so a missing config never
 * leaves the user staring at a broken link.
 *
 * Why the indirection instead of inlining: when we move to a custom
 * domain (e.g. `https://kiranamart.in/privacy`) post-PR 28, only this
 * file + `app.json` need to change. Every screen and util uses
 * `getLegalUrls()` so the swap is a two-line change.
 *
 * Same pattern as `src/services/sentry.ts` — `expo-constants` is
 * Metro-bundler-agnostic and survives release builds where
 * `process.env.EXPO_PUBLIC_*` has dropped values in the past.
 */
import Constants from 'expo-constants';

export type LegalConfig = { privacyUrl: string; termsUrl: string };

const fallback: LegalConfig = {
  privacyUrl: 'https://grocery-mvp-dev.web.app/privacy',
  termsUrl: 'https://grocery-mvp-dev.web.app/terms',
};

export function getLegalUrls(): LegalConfig {
  const extra =
    (Constants.expoConfig?.extra as { legal?: LegalConfig } | undefined)
      ?.legal;
  return {
    privacyUrl: extra?.privacyUrl ?? fallback.privacyUrl,
    termsUrl: extra?.termsUrl ?? fallback.termsUrl,
  };
}
