/**
 * PR 39 — Compose + open a pre-filled support email.
 *
 * Used by `ProfileScreen`'s new "Help & Support" row. We want the
 * single tap a pilot user spends frustrated to be enough to start
 * a bug report: their mail app pops up with `to:` already set to
 * the support address, a subject that identifies us in the
 * support inbox, and a body that prompts them for the bits we
 * actually need (platform + what they were doing).
 *
 * Reads brand + email from `src/constants/branding.ts` so the
 * subject line reflects the current display name automatically
 * when the brand changes.
 *
 * Failure modes:
 *   - No mail app installed (rare on iOS, possible on Android).
 *     `Linking.canOpenURL` returns false; we silent-fail. A
 *     follow-up PR can add a copy-to-clipboard toast fallback;
 *     not pilot-blocking because every modern device has Gmail.
 *   - User cancels the mail compose sheet. Not our problem;
 *     `Linking.openURL` resolves normally.
 *   - `canOpenURL`/`openURL` throw (rare). Caught + swallowed —
 *     the support row is a UX affordance, not a transactional
 *     flow, so a crash would be strictly worse than a silent
 *     no-op.
 */
import { Linking, Platform } from 'react-native';
import { APP_NAME, SUPPORT_EMAIL } from '../constants/branding';

export async function openSupportEmail(): Promise<void> {
  const subject = encodeURIComponent(`${APP_NAME} support`);
  const body = encodeURIComponent(
    `\n\n---\nPlatform: ${Platform.OS}\nApp: ${APP_NAME}\n` +
      `(Please describe what you were doing and what you expected.)`,
  );
  const url = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) return;
    await Linking.openURL(url);
  } catch {
    // Silent fail — see JSDoc.
  }
}
