/**
 * PR 45.2 — UID-aware push registration orchestrator.
 *
 * The pure orchestrator that AuthBootstrap drives. PR 45 introduced
 * it as a plain "registered yes/no" boolean gate; PR 45.2 promotes
 * it to a uid-aware gate after the May 27 2026 root-cause reproduce.
 *
 * Why uid-aware (the bug PR 45.2 fixes):
 *
 *   `AuthBootstrap` mounts → Firebase signs in an anonymous user
 *   first (`signInAnonymouslyIfNeeded`). The PR 45 gate fired the
 *   push branch for that anonymous user, the registration chain
 *   completed, and the boolean gate flipped closed. Then the user
 *   typed their phone number + OTP → auth upgraded to the real
 *   account → push branch re-evaluated → gate said "already
 *   registered" → never re-registered for the REAL uid. Result:
 *   the throwaway anonymous user's doc owns the only push token
 *   and the real account's `fcmTokens` stays empty forever.
 *
 *   PR 45.1 confirmed this via Sentry: the chain fired with
 *   `isAnonymous: true, uidPrefix: Lb5D6Ske...` (the anonymous
 *   uid), never re-fired post-OTP-confirm for the admin's real
 *   `Nb452wQ...` uid.
 *
 * The fix has two parts encoded in the gate:
 *
 *   1. Skip anonymous users entirely — push is for order updates,
 *      which can't reach a throwaway session anyway.
 *   2. Track WHICH uid was last registered, not just "did we
 *      register". When the user upgrades anonymous→real, or
 *      switches between real accounts, the token follows the
 *      current user.
 *
 * The orchestrator stays pure: it READS the caller's
 * `lastRegisteredUid` and reports the new value via the
 * `registered` outcome. The caller (AuthBootstrap) owns the
 * mutable ref. This keeps the test ergonomics trivial and means
 * the gate is exercised by Jest without rendering React.
 */

export type RunPushRegistrationInput = {
  // The currently-signed-in uid, or null if no user.
  currentUid: string | null;
  // Skip push registration for anonymous users — see file header
  // for the bug history.
  isAnonymous: boolean;
  // The uid we last SUCCESSFULLY registered a token for in this
  // app session, or null if none yet. Caller-owned; the
  // orchestrator just reads.
  lastRegisteredUid: string | null;
  // The actual registration side-effect — `pushService` in
  // production, a jest.fn() in tests.
  registerForPush: () => Promise<string | null>;
  logger?: {
    breadcrumb?: (message: string) => void;
    captureException?: (err: unknown) => void;
  };
};

export type SkipReason =
  // Auth event fired with a real uid we already covered this
  // session — short-circuit to avoid permission-prompt spam.
  | 'already_registered_this_uid'
  // Anonymous launch session — token would land on a throwaway
  // doc the user never receives push for. The PR 45.2 root-cause
  // case.
  | 'anonymous'
  // pushService returned null (permission denied / simulator /
  // no projectId / web). Gate stays open for retry.
  | 'null_token';

export type PushRegistrationOutcome =
  // Token obtained AND backend write succeeded for THIS uid.
  // Caller updates `lastRegisteredUid = outcome.uid`.
  | { kind: 'registered'; token: string; uid: string }
  // Legitimate skip — see SkipReason. Caller does NOT update
  // `lastRegisteredUid`.
  | { kind: 'skipped'; reason: SkipReason }
  // registerForPush threw. Caller does NOT update
  // `lastRegisteredUid`, so the next qualifying auth event
  // retries.
  | { kind: 'failed'; error: unknown }
  // No user at all → not even a "skip"; nothing to report.
  | null;

export async function runPushRegistration(
  input: RunPushRegistrationInput,
): Promise<PushRegistrationOutcome> {
  const {
    currentUid,
    isAnonymous,
    lastRegisteredUid,
    registerForPush,
    logger,
  } = input;

  // 1. No user at all → nothing to do. AuthBootstrap fires the
  //    auth callback with `null` on sign-out; we don't want that
  //    to surface as a "skip" event in Sentry breadcrumbs.
  if (!currentUid) {
    return null;
  }
  // 2. Anonymous user → SKIP. This is the direct fix for the
  //    PR 45.2 root cause: the anonymous launch session must
  //    never claim the push token, otherwise the boolean gate
  //    flips closed before the real user signs in and the
  //    upgrade path never re-registers.
  if (isAnonymous) {
    logger?.breadcrumb?.('push: skip (anonymous user)');
    return { kind: 'skipped', reason: 'anonymous' };
  }
  // 3. Already registered for THIS uid → short-circuit. Avoids
  //    permission-prompt spam on every auth-state nudge for the
  //    same user (e.g. claim-refresh, profile reload). Different
  //    from PR 45's boolean gate: an account switch (real_A →
  //    real_B) now correctly falls through to step 4.
  if (lastRegisteredUid === currentUid) {
    return { kind: 'skipped', reason: 'already_registered_this_uid' };
  }
  // 4. New real uid (anonymous→real upgrade, account switch, or
  //    first-ever sign-in) → register.
  try {
    const token = await registerForPush();
    if (token) {
      logger?.breadcrumb?.('bootstrap: push registered ok');
      return { kind: 'registered', token, uid: currentUid };
    }
    // null = permission denied / simulator / no projectId / web.
    // Caller does not update `lastRegisteredUid`, so the next
    // qualifying state change retries (e.g. user grants in
    // Settings + re-foregrounds).
    logger?.breadcrumb?.('bootstrap: push register skipped (null token)');
    return { kind: 'skipped', reason: 'null_token' };
  } catch (error) {
    // Backend write rejected (IAM, auth-context, validation). The
    // exception is already captured by pushService's Sentry hook;
    // notify the caller's logger for the bootstrap call site so
    // a separate breadcrumb trail shows the orchestrator-level
    // failure too.
    logger?.captureException?.(error);
    return { kind: 'failed', error };
  }
}
