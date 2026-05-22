/**
 * Tests for signOutAndClearLocalState — the orchestrator that the
 * Profile screen's Sign Out button drives.
 *
 * Lives in its own file (not bundled into authService) for the sole
 * purpose of testability: we inject all dependencies as plain
 * jest.fn()s, so the test never imports authService /
 * @react-native-firebase/auth / firebase/auth / useCartStore.
 *
 * Pinned behaviour:
 *   1. signOut is awaited
 *   2. clearCart runs after a successful signOut
 *   3. resetNavigation runs (when provided)
 *   4. signOut errors abort cart + nav cleanup (caller decides UI)
 */
import { signOutAndClearLocalState } from '../../src/services/signOutAndClearLocalState';

describe('signOutAndClearLocalState', () => {
  test('calls signOut exactly once', async () => {
    const signOut = jest.fn(async () => {});
    const clearCart = jest.fn();
    await signOutAndClearLocalState({ signOut, clearCart });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test('clears the cart after signOut succeeds', async () => {
    const signOut = jest.fn(async () => {});
    const clearCart = jest.fn();
    await signOutAndClearLocalState({ signOut, clearCart });
    expect(clearCart).toHaveBeenCalledTimes(1);
  });

  test('resets navigation when resetNavigation is provided', async () => {
    const signOut = jest.fn(async () => {});
    const clearCart = jest.fn();
    const resetNavigation = jest.fn();
    await signOutAndClearLocalState({ signOut, clearCart, resetNavigation });
    expect(resetNavigation).toHaveBeenCalledTimes(1);
  });

  test('signOut runs BEFORE clearCart (order matters for UI flicker)', async () => {
    // If clearCart fired first, the UI could re-render with cart
    // empty + name still visible from the prior session. signOut
    // must come first so AuthBootstrap's auth subscription flips
    // useAuthStore to anon before any cart-related re-render.
    const order: string[] = [];
    const signOut = jest.fn(async () => {
      order.push('signOut');
    });
    const clearCart = jest.fn(() => {
      order.push('clearCart');
    });
    const resetNavigation = jest.fn(() => {
      order.push('resetNavigation');
    });
    await signOutAndClearLocalState({ signOut, clearCart, resetNavigation });
    expect(order).toEqual(['signOut', 'clearCart', 'resetNavigation']);
  });

  test('signOut error aborts cart + nav cleanup so caller can surface it', async () => {
    // If signOut fails (offline, transient firebase issue) we MUST
    // NOT clear the cart — the user is still authed locally and
    // their session is intact. Caller surfaces an Alert; user
    // retries.
    const signOut = jest.fn(async () => {
      throw new Error('OFFLINE');
    });
    const clearCart = jest.fn();
    const resetNavigation = jest.fn();
    await expect(
      signOutAndClearLocalState({ signOut, clearCart, resetNavigation }),
    ).rejects.toThrow(/OFFLINE/);
    expect(clearCart).not.toHaveBeenCalled();
    expect(resetNavigation).not.toHaveBeenCalled();
  });

  test('PR 24 — calls unregisterPushToken BEFORE signOut when provided', async () => {
    // Order matters: the callable on the server requires auth, so it
    // must run while the user is still signed in.
    const callOrder: string[] = [];
    const signOut = jest.fn(async () => {
      callOrder.push('signOut');
    });
    const unregisterPushToken = jest.fn(async () => {
      callOrder.push('unregisterPushToken');
    });
    const clearCart = jest.fn();
    await signOutAndClearLocalState({
      signOut,
      unregisterPushToken,
      clearCart,
    });
    expect(callOrder).toEqual(['unregisterPushToken', 'signOut']);
  });

  test('PR 24 — unregisterPushToken failure does NOT abort signOut', async () => {
    // User intent: get me out of this account. A server-side cleanup
    // failure must not block that.
    const signOut = jest.fn(async () => {});
    const unregisterPushToken = jest.fn(async () => {
      throw new Error('network down');
    });
    const clearCart = jest.fn();
    await expect(
      signOutAndClearLocalState({
        signOut,
        unregisterPushToken,
        clearCart,
      }),
    ).resolves.toBeUndefined();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(clearCart).toHaveBeenCalledTimes(1);
  });

  test('PR 24 — unregisterPushToken is optional (legacy callers still work)', async () => {
    // The signOutAndClearLocalState contract pre-PR 24: just signOut +
    // clearCart. Keep it green for any caller that hasn't wired the
    // new dep yet.
    const signOut = jest.fn(async () => {});
    const clearCart = jest.fn();
    await signOutAndClearLocalState({ signOut, clearCart });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(clearCart).toHaveBeenCalledTimes(1);
  });
});
