# PR 24 — Push token cleanup on sign-out (Windsurf prompt)

## Why this PR exists

When a user signs out, this device's Expo push token stays in their
`users/{prev-uid}.fcmTokens` array on the server. Result: every push
notification the server sends to the *previous* account continues to
arrive on this physical device, even after a new user signs in. On
shared phones (delivery partner hands phone to a family member who
opens the app as a customer; quick-switch between test accounts on
the same device) the new user sees notifications meant for someone
else — at best confusing, at worst a privacy leak (order pickup
addresses, delivery partner names, etc.).

The bug is explicitly documented in `signOutAndClearLocalState.ts`
lines 29–34 as a known follow-up. PRELAUNCH_CHECKLIST tracks it
under "Auth UX + Profile + Saved Addresses (Phase 12a-v2-iv)".

**PR 24 adds a server-side `unregisterPushToken` callable and wires
it into the sign-out flow** so the previous account's `fcmTokens`
array has *this device's* token removed *before* Firebase Auth
signs out. After PR 24, signing out cleanly disowns the device from
the previous account; the next sign-in re-registers fresh.

**Two call sites** to fix, both with the same gap:

1. `ProfileScreen.tsx` — the user-facing Sign Out button. Already
   uses `signOutAndClearLocalState`, just needs the new dep wired.
2. `src/components/dev/QuickSwitchModal.tsx` — the dev/test
   account switcher. Currently calls `authService.signOut()`
   directly, bypassing `signOutAndClearLocalState` entirely. Both
   bugs (push token + cart leak across switches) live here. Fix by
   routing it through the orchestrator.

Server-first deploy discipline applies (new callable). ~1–1.5 hours.

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md`.
- `src/services/pushService.ts` — the existing
  `registerForPushNotifications` flow. PR 24 adds a sibling
  `unregisterPushToken` method that fetches the current token and
  calls the server.
- `src/services/signOutAndClearLocalState.ts` — the orchestrator
  that runs on Sign Out. Read the comment at lines 29–34 — that's
  this PR. Extend `SignOutDeps` with an optional
  `unregisterPushToken` field; call it at the top of the function.
- `src/services/authService.ts` — `signOut` (~line 98). Read-only;
  PR 24 does not change it.
- `src/screens/ProfileScreen.tsx` (~line 202) — current
  `signOutAndClearLocalState` call site. Wire the new dep.
- `src/components/dev/QuickSwitchModal.tsx` (~line 60–80) — direct
  `authService.signOut()` call that bypasses the orchestrator. Route
  it through `signOutAndClearLocalState` so QuickSwitch picks up the
  new token cleanup AND the existing cart clear.
- `functions/src/index.ts` — `registerPushToken` callable
  (~line 2176). PR 24 adds a sibling `unregisterPushToken` right
  next to it. Same auth gate, same loose token validation, same
  Firestore-merge pattern but with `arrayRemove` instead of
  `arrayUnion`.
- `tests/services/authService.signOut.test.ts` — existing tests for
  the orchestrator. Extend with new cases for the
  `unregisterPushToken` dep.

## Critical lessons from PRs 12–23 (do not repeat)

1. **Server-first deploy.** New callable added — Functions go out
   first, verify with `firebase functions:list`, then ship the
   client that calls it. If you OTA the client before the function
   is live, sign-out will throw `functions/not-found` and the user
   sees a broken sign-out flow.
2. **Sign-out must not be blocked by network failures.** The user's
   intent ("get me out of this account") is more important than a
   clean server-side state. The unregister call goes in a `try`
   block; failures are logged but do not abort the rest of the
   orchestrator. The next launch's `registerForPushNotifications`
   call is idempotent — a stale token will be revisited.
3. **Order of operations matters.** The unregister callable
   requires auth. It MUST run BEFORE `firebase.auth().signOut()`
   or the request goes unauthenticated and the server rejects.
4. **Never strip imports between edits in the same PR.** Files
   touched: `pushService.ts` (already imports `Notifications`,
   `Constants`, `Device`, `Platform`; PR 24 reuses them all),
   `signOutAndClearLocalState.ts` (no new imports), `ProfileScreen.tsx`
   (adds `pushService` import), `QuickSwitchModal.tsx` (adds
   `signOutAndClearLocalState` + `pushService` + cart store imports).
5. **All `useState` calls in screens sit ABOVE conditional early
   returns.** No new state added by PR 24 — only the call sites
   change. **Verify** no hooks order regressions after edits.
6. **Zero new `DO NOT REMOVE` markers expected.** 13-PR streak.

## Scope (in)

### Part 1 — New server callable `unregisterPushToken`

In `functions/src/index.ts`, immediately after the existing
`registerPushToken` callable (~line 2200), add:

```ts
// PR 24 — Inverse of registerPushToken. Removes THIS device's Expo
// push token from the caller's users/{uid}.fcmTokens array so the
// account no longer receives notifications on this device.
//
// Called by the client's signOutAndClearLocalState flow BEFORE
// firebase.auth().signOut() — once Firebase signs out, request.auth
// is null and the call would be rejected as unauthenticated.
//
// arrayRemove is idempotent: if the token isn't in the array (never
// registered, already removed, or different device), the operation
// is a no-op. The callable never throws for "token not found".
//
// Multi-device safety: arrayRemove only touches the exact token
// string passed in. Other devices the user has registered (phone +
// tablet, etc.) keep their tokens — they continue to receive push.
// Only the device that signed out is detached.
export const unregisterPushToken = onCall<{ token: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError('unauthenticated', 'Sign in required');
    }
    const { token } = request.data ?? ({} as { token?: string });
    if (!token || typeof token !== 'string') {
      throw new HttpsError('invalid-argument', 'token required');
    }
    await db.doc(`users/${auth.uid}`).set(
      {
        fcmTokens: FieldValue.arrayRemove(token),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true };
  },
);
```

No new helper file needed — the logic is one `arrayRemove` call. If
the discipline-doc strongly prefers a helpers file, create
`functions/src/pushTokenHelpers.ts` with a single
`isValidExpoToken(t: unknown): boolean` predicate that both
`registerPushToken` and `unregisterPushToken` import. Otherwise
inline is fine.

### Part 2 — Client `pushService.unregisterPushToken`

In `src/services/pushService.ts`, add a new method to the
`pushService` object, immediately after `registerForPushNotifications`:

```ts
/**
 * PR 24 — Remove this device's Expo push token from the currently
 * authed user's fcmTokens server-side. Call BEFORE
 * firebase.auth().signOut() — the callable needs auth, and once
 * sign-out completes request.auth is null.
 *
 * Idempotent: server uses arrayRemove, so duplicate calls are
 * cheap. Returns silently in any of these cases (no throw):
 *   - running on web (no native push registered to begin with)
 *   - simulator/emulator (no token was ever obtained)
 *   - no permission granted (no token to remove)
 *   - cannot fetch the Expo token (transient network / Expo issue)
 *
 * Only throws if the callable itself rejects with something other
 * than "user is unauthenticated" — in which case the orchestrator
 * logs but does not abort sign-out.
 */
async unregisterPushToken(): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!Device.isDevice) return;

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  const projectId = getEasProjectId();
  if (!projectId) return;

  let token: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    token = result.data;
  } catch (e) {
    console.warn('[push] unregister: getExpoPushTokenAsync failed:', e);
    return;
  }

  try {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('unregisterPushToken');
      await fn({ token });
    } else {
      const fn = httpsCallable(functions, 'unregisterPushToken');
      await fn({ token });
    }
    console.log('[push] token unregistered from backend');
  } catch (e) {
    console.warn('[push] unregisterPushToken call failed:', e);
  }
},
```

### Part 3 — Extend `SignOutDeps` and the orchestrator

In `src/services/signOutAndClearLocalState.ts`:

```ts
export type SignOutDeps = {
  /** The actual Firebase auth signOut. */
  signOut: () => Promise<void>;
  /**
   * PR 24 — Remove this device's push token from the currently
   * authed user's fcmTokens BEFORE firebase signOut so the new
   * user doesn't inherit notifications meant for the previous
   * account. Production caller wires
   * `pushService.unregisterPushToken`; tests pass jest.fn().
   *
   * Optional so older call sites (no push at all, e.g. web /
   * simulator) and the existing test suite continue to work
   * without modification.
   */
  unregisterPushToken?: () => Promise<void>;
  /** Wipes useCartStore. */
  clearCart: () => void;
  resetNavigation?: () => void;
};

export async function signOutAndClearLocalState(
  deps: SignOutDeps,
): Promise<void> {
  // PR 24 — Push token cleanup MUST happen before signOut because
  // the callable requires auth. Failures are logged but don't
  // abort sign-out (user's intent to log out takes priority over
  // server-side state cleanup; the next launch's
  // registerForPushNotifications is idempotent and will re-sync).
  if (deps.unregisterPushToken) {
    try {
      await deps.unregisterPushToken();
    } catch (e) {
      console.warn('[signOut] unregisterPushToken failed (non-fatal):', e);
    }
  }
  await deps.signOut();
  deps.clearCart();
  deps.resetNavigation?.();
}
```

Update the file-header comment that currently says "Known follow-up
(NOT addressed here)" — strike through or remove that paragraph
since PR 24 addresses it. Replace with:

```
 * Push token cleanup (PR 24):
 *   - unregisterPushToken (optional dep) runs BEFORE firebase
 *     signOut so the callable still has auth. Failures are
 *     logged but never abort sign-out.
```

### Part 4 — Wire in `ProfileScreen`

In `src/screens/ProfileScreen.tsx`, find the existing
`signOutAndClearLocalState` call (~line 202) and add the new dep:

```tsx
import { pushService } from '../services/pushService';

// inside the Sign Out handler:
await signOutAndClearLocalState({
  signOut: () => authService.signOut(),
  unregisterPushToken: () => pushService.unregisterPushToken(), // PR 24
  clearCart: useCartStore.getState().clearCart,
  resetNavigation: () => nav.reset({ index: 0, routes: [{ name: 'Home' }] }),
});
```

(Adjust the exact lambdas to match what's already there; only the
new `unregisterPushToken` line is added.)

### Part 5 — Fix `QuickSwitchModal` to use the orchestrator

In `src/components/dev/QuickSwitchModal.tsx`, the current sign-out
path (~line 60–80) calls `authService.signOut()` directly. This
bypasses both cart cleanup AND the new push token cleanup. Route it
through `signOutAndClearLocalState` so QuickSwitch picks up the
full discipline:

```tsx
import { signOutAndClearLocalState } from '../../services/signOutAndClearLocalState';
import { pushService } from '../../services/pushService';
import { useCartStore } from '../../store/useCartStore';

// Replace the existing direct signOut call:
//   await authService.signOut();
// with:
await signOutAndClearLocalState({
  signOut: () => authService.signOut(),
  unregisterPushToken: () => pushService.unregisterPushToken(),
  clearCart: useCartStore.getState().clearCart,
  // No resetNavigation — QuickSwitch immediately signs into the
  // next account, the AuthBootstrap re-render takes care of routing.
});
```

Note: leave the existing comment block ("// 1. Sign out current
user...") in place; just swap the implementation. The comment's
intent now genuinely matches what happens.

### Part 6 — Tests

#### 6a — Extend `tests/services/authService.signOut.test.ts`

Append new tests for the `unregisterPushToken` dep:

```ts
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
```

After these additions the file should have ≥ (original count + 3)
tests, all green.

#### 6b — Optional: server-side unit test for the callable

If you want symmetry with PR 19/20/21/22's per-helper test files,
add `tests/functions/unregisterPushToken.test.ts` exercising the
callable through the existing `mockOnCall` / firestore-emulator
pattern used by `tests/functions/favoritesHelpers.test.ts`. If the
callable stays as inline logic in index.ts (no helper file), this
is optional — the integration is well-pinned by 6a.

### Part 7 — PRELAUNCH_CHECKLIST update

In `PRELAUNCH_CHECKLIST.md`, find the unchecked item under
"Auth UX + Profile + Saved Addresses (Phase 12a-v2-iv)":

```
- [ ] **Push token cleanup on sign-out** — ...
```

Flip to checked and add a `[Shipped — PR 24]` annotation, matching
the style used by prior PRs in the same file. Add a new PR 24
section at the bottom of the file documenting what shipped + any
follow-ups (e.g. "QuickSwitchModal now uses the orchestrator —
existing cart-clear gap also closed as side effect").

## Scope (out)

- **Server-side cron to GC orphaned tokens.** If a device uninstalls
  the app without signing out, its token stays in fcmTokens
  permanently. Expo Push returns `DeviceNotRegistered` on send;
  ideally we'd consume that error and `arrayRemove` server-side.
  Worth a separate PR (PR 25 candidate); out of scope here.
- **Migrating from Expo Push to `@react-native-firebase/messaging`.**
  The existing pushService comment explains why we use Expo Push
  for now. PR 24 keeps that choice.
- **Removing notification permission on sign-out.** Permissions are
  per-device, not per-account. The next user might want
  notifications for their own orders. Leave the OS-level permission
  granted.
- **Push token cleanup on account deletion.** Out of scope — we
  don't have a "delete my account" flow yet. When that PR lands, it
  will need a similar cleanup (plus removal of ALL the user's
  tokens, not just this device's — for that case, an unauthed
  admin-side `arrayRemove(*)` works, but the deletion PR will own
  the design).

## Acceptance checklist

- [ ] Server: `unregisterPushToken` callable added to
  `functions/src/index.ts`. Auth required. Loose string validation.
  `arrayRemove(token)` with merge. Returns `{ ok: true }`.
- [ ] Client: `pushService.unregisterPushToken()` method added.
  Mirrors the registration flow's bail-outs (web, simulator, no
  permission, no project id, getExpoPushTokenAsync failure).
- [ ] `SignOutDeps` extended with optional `unregisterPushToken`.
  Orchestrator calls it BEFORE `signOut`; failures logged not
  re-thrown.
- [ ] `signOutAndClearLocalState.ts` file-header comment updated
  to reflect PR 24 (the "Known follow-up" paragraph is gone or
  marked resolved).
- [ ] `ProfileScreen.tsx` wires `pushService.unregisterPushToken`
  into the `signOutAndClearLocalState` call.
- [ ] `QuickSwitchModal.tsx` no longer calls `authService.signOut()`
  directly — routes through `signOutAndClearLocalState` with the
  same deps as ProfileScreen (sans `resetNavigation`).
- [ ] `tests/services/authService.signOut.test.ts`: 3 new tests
  pass (order, failure-isolation, optional dep).
- [ ] Existing tests in the same file still pass.
- [ ] `npx tsc --noEmit` (root + functions): 0 errors.
- [ ] `npm test` overall: green.
- [ ] PRELAUNCH_CHECKLIST: relevant item flipped to checked + PR 24
  section appended at bottom.
- [ ] **Zero new `DO NOT REMOVE` markers added** (14-PR streak).

## Deliberate-break check (per `.windsurf/test-discipline.md`)

Before declaring done, temporarily change the orchestrator so
`unregisterPushToken` runs AFTER `signOut` instead of before. Run
the new "calls unregisterPushToken BEFORE signOut" test. It must
fail with a clear message pointing at the order assertion. Revert
the change. This confirms the order-of-operations test actually
exercises the contract.

## Smoke tests (manual, after staged deploy)

1. **Sign out actually removes this device's token from prev user**
   — sign in as User A (delivery partner). Confirm notifications
   permission granted. Note User A's `fcmTokens` count in Firestore
   (Admin Console → users/{A.uid}). Sign out. Firestore should show
   that array length decreased by 1 (or token disappeared if A only
   had this device).
2. **Other devices unaffected** — register User A on Device 1 and
   Device 2. Sign out on Device 1. User A's `fcmTokens` should
   still contain Device 2's token. (Hard to verify in solo testing;
   inspect Firestore manually.)
3. **Push to new user on the same device works** — after Test 1,
   sign in as User B (customer) on the same physical device. Trigger
   a push that targets User B (e.g. an order status change). User B
   receives it. **User A does NOT receive a copy** to the same
   device.
4. **Push to previous user no longer reaches this device** — from
   another admin account, place an order assigned to User A's role
   (e.g. a new pickup for a delivery partner). User A's other
   devices receive the push; this device (now signed in as B) does
   NOT.
5. **Sign-out works offline** — turn airplane mode on. Open the
   Profile screen, tap Sign Out. The orchestrator should warn-log
   the unregister failure but still complete the sign-out (cart
   cleared, navigation reset, auth state flipped to anon). When
   the user comes back online and re-signs in, the stale token
   eventually self-corrects on next push attempt (Expo returns
   DeviceNotRegistered for a token that's been re-issued to a
   different install — a future PR could consume that).
6. **QuickSwitch carries the same discipline** — open QuickSwitch
   from User A. Switch to User B. Inspect Firestore: User A's
   fcmTokens should have this device's token removed. Inherited
   cart should also be empty (this was a pre-PR 24 bug; PR 24's
   QuickSwitch-uses-orchestrator change closes it as a side effect).
7. **No screen crashes** — visit Profile, tap Sign Out, sign back
   in. Repeat on QuickSwitch. No ErrorBoundary, no console errors.
8. **TypeScript clean** — `npx tsc --noEmit` shows zero errors.

## Deploy plan

Server-first per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Local audit.
npm test

# 2. Server FIRST — new callable must be live before any client
#    that calls it ships.
cd functions
npm run build
cd ..
firebase deploy --only functions:unregisterPushToken
firebase functions:list | Select-String -Pattern "unregisterPushToken"
# Should print one line confirming the function is live.

# 3. Commit + push.
git add functions/src/index.ts
git add src/services/pushService.ts
git add src/services/signOutAndClearLocalState.ts
git add src/screens/ProfileScreen.tsx
git add src/components/dev/QuickSwitchModal.tsx
git add tests/services/authService.signOut.test.ts
git add PRELAUNCH_CHECKLIST.md
git add docs/pr-24-push-token-cleanup-on-signout-windsurf-prompt.md
git commit -m "PR 24: push token cleanup on sign-out + route QuickSwitch through orchestrator"
git push origin main

# 4. Client OTA to production.
eas update --branch production --message "PR 24 - push token cleanup on sign-out"
```

Tell testers (when they're online) to force-close + reopen the app
after publish; the new bundle picks up the cleanup. Behaviour
change is transparent — they should NOT notice anything different
during normal use.

## Estimated time

~1–1.5 hours Windsurf work:

- Part 1 (server callable): 10 min
- Part 2 (client unregister method): 15 min
- Part 3 (orchestrator + dep): 10 min
- Part 4 (ProfileScreen wiring): 5 min
- Part 5 (QuickSwitch routed through orchestrator): 10 min
- Part 6 (tests, 3 new cases): 20 min
- Part 7 (PRELAUNCH_CHECKLIST update): 5 min
- Smoke + deliberate-break: 15 min

## Why this PR matters

Push notifications carry sensitive context — pickup addresses,
customer phone snippets in the body, payment status. Surfacing
those to the wrong account is the kind of small privacy leak that
becomes a real problem when the app starts onboarding shared-device
households (a parent's phone used by their kid for school-supply
orders, a tester's phone with multiple test roles, a kirana shop
owner who hands the partner phone to a temporary helper).

PR 24 closes the leak with a small, well-scoped change: one new
callable, one new client method, two call sites cleaned up. The
QuickSwitch fix is a bonus — same orchestrator, same discipline,
one less "but does that flow do the right thing?" question for
future PRs.

Also stress-tests the cross-check pattern in a slightly different
shape: Claude writes the prompt with a clear server-first sequence
+ failure-isolation requirement, Windsurf executes inside the IDE
with the TypeScript signatures keeping the dep injection sound.
