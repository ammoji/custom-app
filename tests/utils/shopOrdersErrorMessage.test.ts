/**
 * Pure unit tests for mapShopOrdersError in
 * src/utils/shopOrdersErrorMessage.ts.
 *
 * Replaces the raw `err.message` that ShopOwnerDashboardScreen used
 * to show — which on RNFB native was often just "INTERNAL". The
 * mapper turns common Firebase Functions error codes into actionable
 * messages a shop owner can read without context. Pin them so a
 * future refactor doesn't accidentally regress to showing
 * "INTERNAL" again.
 */
import { mapShopOrdersError } from '../../src/utils/shopOrdersErrorMessage';

describe('mapShopOrdersError', () => {
  test('maps `internal` to a contact-support hint', () => {
    expect(mapShopOrdersError({ code: 'internal', message: 'INTERNAL' })).toBe(
      "Couldn't load orders. Please try again or contact support.",
    );
  });

  test('maps `unauthenticated` to a sign-in-again hint', () => {
    expect(
      mapShopOrdersError({ code: 'unauthenticated', message: 'Sign in required' }),
    ).toBe('Session expired. Please sign in again.');
  });

  test('maps `permission-denied` to an access hint', () => {
    expect(
      mapShopOrdersError({
        code: 'permission-denied',
        message: "Not authorized for this shop",
      }),
    ).toBe("You don't have access to this shop's orders.");
  });

  test('maps RNFB-style `functions/internal` (prefixed) the same as `internal`', () => {
    // RNFB on native prefixes the code with `functions/`. The mapper
    // strips the prefix so both SDKs produce the same UX.
    expect(mapShopOrdersError({ code: 'functions/internal' })).toBe(
      "Couldn't load orders. Please try again or contact support.",
    );
  });

  test('maps missing-index FAILED_PRECONDITION to a "being built" hint', () => {
    // The classic missing-index error wraps a long Firestore URL.
    // Mapper trims it to something the owner can act on.
    expect(
      mapShopOrdersError({
        code: 'failed-precondition',
        message:
          'The query requires an index. You can create it here: https://console.firebase.google.com/...',
      }),
    ).toBe('Orders index is being built. Try again in a few minutes.');
  });

  test('falls through to server message when the code is unknown', () => {
    expect(
      mapShopOrdersError({ code: 'rate-limited', message: 'Slow down' }),
    ).toBe('Slow down');
  });

  test('returns a default hint when error is null/undefined/empty', () => {
    expect(mapShopOrdersError(null)).toBe("Couldn't load orders. Pull to refresh.");
    expect(mapShopOrdersError(undefined)).toBe(
      "Couldn't load orders. Pull to refresh.",
    );
    expect(mapShopOrdersError('')).toBe("Couldn't load orders. Pull to refresh.");
  });

  test('returns the string itself when err is a non-empty string', () => {
    expect(mapShopOrdersError('Network unavailable')).toBe('Network unavailable');
  });
});
