/**
 * Sign-out orchestrator that clears local state the next user must
 * not inherit. Lives in its own file (rather than next to signOut on
 * authService.ts) for one reason only: dependency injection.
 *
 * The function takes its dependencies as a typed bag instead of
 * importing authService / useCartStore at the top, which means:
 *   - Production callers (ProfileScreen) wire the real impls in.
 *   - Unit tests construct a tiny `{ signOut, clearCart, ... }` of
 *     jest.fn()s and drive the orchestration without booting any of
 *     the firebase / zustand / async-storage modules transitively
 *     pulled in by authService.
 *
 * Pinned by tests/services/authService.signOut.test.ts.
 *
 * What gets cleared:
 *   - useCartStore  → the prior user's cart must NOT survive a switch
 *   - navigation    → reset stack to Home so the new (anon) session
 *                     doesn't land on a screen the previous user was
 *                     mid-task on (e.g. Checkout, ShopOwnerDashboard)
 *
 * What does NOT get cleared (intentional):
 *   - useAuthStore  → resets itself when AuthBootstrap's auth
 *                     subscription fires with `null`
 *   - useOrderStore → stateless pass-through; no cache to clear
 *   - useLocationStore → user's GPS / fallback choice survives across
 *                        accounts. Per Sudhir's spec.
 *
 * Known follow-up (NOT addressed here): we do NOT remove this
 * device's FCM token from /users/{prev-uid}.fcmTokens during
 * sign-out. Result is the previous account keeps receiving push
 * notifications meant for them on this physical device, even after
 * a new user signs in. Logged in PRELAUNCH_CHECKLIST as
 * `[Phase 12a-v2-iv-followup]` push-token-on-signout.
 */

export type SignOutDeps = {
  /** The actual Firebase auth signOut. */
  signOut: () => Promise<void>;
  /** Wipes useCartStore. */
  clearCart: () => void;
  /**
   * Optional navigation reset. Passed in by the screen because the
   * helper has no access to the React-Navigation tree itself.
   * Production caller passes a function that does
   * `nav.reset({ index: 0, routes: [{ name: 'Home' }] })`.
   */
  resetNavigation?: () => void;
};

/**
 * Order of operations matters:
 *   1. signOut FIRST so the auth subscription fires and useAuthStore
 *      flips to anon BEFORE any UI re-renders against the cleared
 *      cart (otherwise the cart-empty state can flash with the old
 *      user's name still visible).
 *   2. clearCart so the next authed session starts fresh.
 *   3. resetNavigation last so the Home re-render happens against
 *      a known-good store state.
 *
 * Errors from signOut() are surfaced; the cart and nav are NOT
 * touched if the underlying signOut throws (rare — usually means
 * offline). Caller decides how to communicate the failure.
 */
export async function signOutAndClearLocalState(deps: SignOutDeps): Promise<void> {
  await deps.signOut();
  deps.clearCart();
  deps.resetNavigation?.();
}
