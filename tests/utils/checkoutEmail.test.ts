/**
 * Unit tests for `deriveCheckoutEmail`.
 *
 * Pins the PR 5 Razorpay-prefill rules — see the helper's doc
 * comment for the policy rationale. Four canonical cases per the
 * spec, plus a couple of edge cases that have bitten us in the past
 * (whitespace-only email, phone with `+91` prefix).
 */
import { deriveCheckoutEmail } from '../../src/utils/checkoutEmail';

describe('deriveCheckoutEmail', () => {
  test('uses profile.email when present and well-formed', () => {
    expect(
      deriveCheckoutEmail({ email: 'rohan@example.com' }, '9876543210'),
    ).toBe('rohan@example.com');
  });

  test('falls back to phone-derived placeholder when profile is null', () => {
    expect(deriveCheckoutEmail(null, '9876543210')).toBe(
      '9876543210@noemail.kiranamart.app',
    );
  });

  test('falls back when profile.email is empty string', () => {
    expect(deriveCheckoutEmail({ email: '' }, '9876543210')).toBe(
      '9876543210@noemail.kiranamart.app',
    );
  });

  test('falls back when profile.email is whitespace-only', () => {
    expect(deriveCheckoutEmail({ email: '   ' }, '9876543210')).toBe(
      '9876543210@noemail.kiranamart.app',
    );
  });

  test('falls back when profile.email is null', () => {
    expect(deriveCheckoutEmail({ email: null }, '9876543210')).toBe(
      '9876543210@noemail.kiranamart.app',
    );
  });

  test('falls back when profile.email has no @ (defensive)', () => {
    // A malformed save (e.g. user typed "rohan" without @-tld) should
    // not be passed straight to Razorpay; better to fall through.
    expect(
      deriveCheckoutEmail({ email: 'just-a-name' }, '9876543210'),
    ).toBe('9876543210@noemail.kiranamart.app');
  });

  test('strips non-digits from phone for placeholder local-part', () => {
    expect(deriveCheckoutEmail(null, '+91 98765-43210')).toBe(
      '919876543210@noemail.kiranamart.app',
    );
  });

  test('uses "guest" sentinel when phone has zero digits', () => {
    // Defensive — should not happen since address.phone is required,
    // but if upstream changes ever pass an empty string we shouldn't
    // emit "@noemail.kiranamart.app" with an empty local-part
    // (Razorpay rejects that and the customer sees a cryptic error).
    expect(deriveCheckoutEmail(null, '')).toBe(
      'guest@noemail.kiranamart.app',
    );
  });
});
