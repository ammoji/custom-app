/**
 * PR 25 — Open the hosted Privacy Policy / Terms of Service URLs.
 *
 * Native (iOS / Android): uses `expo-web-browser`'s
 * `openBrowserAsync` which renders the system in-app browser tab
 * (SFSafariViewController / Chrome Custom Tabs). The user returns
 * to Kirana Mart on close — no app re-launch, no auth state loss.
 *
 * Web: `expo-web-browser` on web pops up a useless about:blank tab.
 * We use `Linking.openURL` instead, which becomes `window.open()`
 * with `_blank` — the same UX as any external link on a web app.
 *
 * Errors (network, user cancellation) are swallowed deliberately —
 * the legal-link tap is a non-critical UX affordance, not a flow
 * the user is mid-task in. We do NOT report cancellation to Sentry.
 */
import * as WebBrowser from 'expo-web-browser';
import { Linking, Platform } from 'react-native';
import { getLegalUrls } from '../constants/legal';

export async function openPrivacy(): Promise<void> {
  const { privacyUrl } = getLegalUrls();
  return openInBrowser(privacyUrl);
}

export async function openTerms(): Promise<void> {
  const { termsUrl } = getLegalUrls();
  return openInBrowser(termsUrl);
}

async function openInBrowser(url: string): Promise<void> {
  if (Platform.OS === 'web') {
    await Linking.openURL(url);
    return;
  }
  await WebBrowser.openBrowserAsync(url);
}
