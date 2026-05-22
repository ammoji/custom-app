import { Linking } from 'react-native';

/**
 * PR 31.1 — open a coordinates pair in the device's preferred
 * maps app via the universal Google Maps deep link.
 *
 * Web: opens in a new tab via `Linking.openURL` (which maps to
 *   `window.open`) — no need for `expo-web-browser`; Maps is
 *   universally available.
 * Native: opens the Google Maps app if installed (iOS + Android
 *   both register the `https://www.google.com/maps?...` URL
 *   scheme), else falls back to the system browser. iOS users
 *   with Apple Maps as default still get the link rendered by
 *   Apple Maps on tap if they prefer — universal URL.
 *
 * The `(0, 0)` sentinel — used by `registerShop` when GPS was
 * unavailable at registration — is treated as "no location" by
 * the caller (admin screens render a non-tappable "No GPS"
 * fallback), NOT here. This utility just opens whatever it is
 * given.
 *
 * Sentry-quiet: `Linking.openURL` rejection is swallowed and
 * console-warned, never thrown to the caller. A failed open is
 * not actionable from the UI — the caller has no recovery path.
 */
export async function openMapsForCoords(
  lat: number,
  lng: number,
  label?: string,
): Promise<void> {
  // Google's universal maps URL: works on iOS, Android, and web.
  // `q=<lat>,<lng>(<label>)` shows a labelled pin if a label is
  // provided; otherwise just the coords.
  const query = label
    ? `${lat},${lng}(${encodeURIComponent(label)})`
    : `${lat},${lng}`;
  const url = `https://www.google.com/maps?q=${query}`;

  try {
    await Linking.openURL(url);
  } catch (e) {
    // Should be unreachable on platforms we ship — every browser
    // and the Maps app on both mobile OSes registers the
    // https://www.google.com/maps URL pattern. Log defensively
    // so a phantom failure shows up in dev console without
    // surfacing to the user.
    // eslint-disable-next-line no-console
    console.warn('[openMapsForCoords] Linking.openURL failed:', e);
  }
}
