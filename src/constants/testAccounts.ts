/**
 * PR 18 — Pre-configured test phone numbers for the Quick Switch
 * shortcut on HomeScreen.
 *
 * These MUST match entries in:
 *   Firebase Console → grocery-mvp-dev → Authentication →
 *   Settings → Phone numbers for testing
 *
 * Each entry's `otp` field must be EXACTLY what's configured in the
 * console for that phone. If you add a new test phone there, add a
 * matching entry here. If a phone is removed from the console, the
 * Quick Switch entry will fail with "Invalid OTP" at runtime.
 *
 * Labels are display-only — pick whatever helps identify the
 * account during testing. Convention: role + region + numeric
 * suffix when there are multiple of the same role-region pair.
 * Tester should be able to pick the right account at a glance.
 *
 * 2026-06-02 reset: list rebuilt for the 2-region (India + US)
 * test-team setup. `phone` field changed from "10-digit Indian"
 * to full E.164 strings so multi-country phones work without
 * hardcoded `+91` prefixes in QuickSwitchModal / HomeScreen.
 *
 * Visibility / production safety: the HomeScreen button is gated on
 * whether the currently signed-in user's `phoneNumber` (E.164)
 * exactly matches `entry.phone` for any entry in this list.
 *   - Real customers' phones aren't in this list → button hidden.
 *   - Anonymous bootstrap users (no phone yet) → button hidden.
 *   - Any test account is in the list → button visible from EVERY
 *     test account, so you can move freely between roles without
 *     getting stranded after a switch (admin → customer would
 *     otherwise hide the button if it were `isAdmin`-gated).
 *
 * NOTE on the admin entry: the admin user is created normally via
 * Firebase Console (set-admin script). Quick Switch doesn't grant
 * claims; it just authenticates. The admin claim survives because
 * it's attached to the uid server-side — confirmOtp force-refreshes
 * the ID token which re-reads claims.
 */
export type TestAccount = {
  /** Display label in QuickSwitchModal — role + region + suffix. */
  label: string;
  /**
   * Full E.164 phone number, e.g. `+918888888881` or `+19999999991`.
   * QuickSwitchModal passes this directly to startPhoneAuth — NO
   * country-code prefix added by the caller. Format-on-display only.
   */
  phone: string;
  /** Matches the OTP configured in Firebase Console for this phone. */
  otp: string;
};

export const TEST_ACCOUNTS: TestAccount[] = [
  // EDIT THIS LIST as you add/remove test phones in Firebase Console.
  // Keep entries grouped by region + role for fast scanning during a
  // multi-role smoke test pass.

  // ── India team ──────────────────────────────────────────────────
  { label: 'Customer 1 (India)',         phone: '+918888888881', otp: '123456' },
  { label: 'Customer 2 (India)',         phone: '+918888888882', otp: '123456' },
  { label: 'Shop 1 (India)',             phone: '+918888888883', otp: '123456' },
  { label: 'Shop 2 (India)',             phone: '+918888888884', otp: '123456' },
  { label: 'Delivery Partner 1 (India)', phone: '+918888888885', otp: '123456' },
  { label: 'Delivery Partner 2 (India)', phone: '+918888888886', otp: '123456' },

  // ── US team ─────────────────────────────────────────────────────
  { label: 'Customer (US)',              phone: '+19999999991',  otp: '123456' },
  { label: 'Shop (US)',                  phone: '+19999999992',  otp: '123456' },
  { label: 'Delivery Partner (US)',      phone: '+19999999993',  otp: '123456' },

  // ── Admin (preserved across the 2026-06-02 reset) ───────────────
  { label: 'Admin (you)',                phone: '+913145415346', otp: '123456' },
];

/**
 * Format an E.164 phone for human-readable display. Splits the
 * country code from the subscriber digits with a space.
 * Examples:
 *   "+918888888881" → "+91 8888888881"
 *   "+19999999991"  → "+1 9999999991"
 * Unknown country codes pass through unchanged.
 */
export function formatTestAccountPhone(e164: string): string {
  if (e164.startsWith('+91')) return `+91 ${e164.slice(3)}`;
  if (e164.startsWith('+1')) return `+1 ${e164.slice(2)}`;
  return e164;
}
