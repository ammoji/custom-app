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
 * account during testing. Convention: include the role in the
 * label so you don't accidentally sign into the wrong account.
 *
 * Visibility / production safety: the HomeScreen button is gated on
 * whether the currently signed-in user's `phoneNumber` (E.164)
 * matches `+91${entry.phone}` for any entry in this list.
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
  label: string;
  // 10-digit Indian phone, no +91 prefix. The QuickSwitchModal
  // prepends `+91` when calling startPhoneAuth.
  phone: string;
  // Matches the OTP configured in Firebase Console for this phone.
  otp: string;
};

export const TEST_ACCOUNTS: TestAccount[] = [
  // EDIT THIS LIST as you add/remove test phones in Firebase Console.
  // Keep entries grouped by role for fast scanning during a multi-
  // role smoke test pass.
  { label: 'Customer',           phone: '9999999991', otp: '123456' },
  { label: 'Shopkeeper 1',       phone: '9999999992', otp: '123456' },
  { label: 'Delivery Partner',   phone: '9999999993', otp: '123456' },
  { label: 'Shopkeeper 2',       phone: '9999999994', otp: '123456' },
  { label: 'Admin (you)',        phone: '3145415346', otp: '123456' },
];
