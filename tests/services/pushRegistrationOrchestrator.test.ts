/**
 * PR 45.2 — Tests for the uid-aware `runPushRegistration` orchestrator.
 *
 * Rewrite of the PR 45 boolean-gate suite. Same retry-on-failure /
 * stop-on-success contracts (re-expressed via the `lastRegisteredUid`
 * input), PLUS the new anonymous-skip + uid-change cases that are
 * the regression tests for the May 27 2026 production bug.
 *
 * The original bug, restated as a test scenario:
 *   1. App launches → Firebase signs in an anonymous user first.
 *   2. PR 45's boolean gate fired the push branch for that anon
 *      user, registered the token, flipped the gate closed.
 *   3. User signs in via OTP → real uid → push branch re-evaluates
 *      → gate says "already done" → token never moves to the real
 *      uid's `fcmTokens`.
 *
 * Cases 1 (anonymous skip) and 2 (anonymous→real upgrade
 * re-registers) below are the exact regression tests that would
 * have caught the bug on PR submission.
 */
import {
  runPushRegistration,
  type PushRegistrationOutcome,
} from '../../src/services/pushRegistrationOrchestrator';

// Convenience builder — keeps each test concise and forces every
// case to be explicit about the four decision-relevant inputs.
const callOrch = (
  overrides: Partial<{
    currentUid: string | null;
    isAnonymous: boolean;
    lastRegisteredUid: string | null;
    registerForPush: () => Promise<string | null>;
    logger: {
      breadcrumb?: (msg: string) => void;
      captureException?: (err: unknown) => void;
    };
  }>,
) =>
  runPushRegistration({
    // Use `in`-checks rather than `??` because explicit `null`
    // is a meaningful value here (no-user path) — `?? 'default'`
    // would clobber an intentional null.
    currentUid:
      'currentUid' in overrides ? overrides.currentUid! : 'real_user_1',
    isAnonymous:
      'isAnonymous' in overrides ? overrides.isAnonymous! : false,
    lastRegisteredUid:
      'lastRegisteredUid' in overrides ? overrides.lastRegisteredUid! : null,
    registerForPush: overrides.registerForPush ?? (async () => 'tok'),
    logger: overrides.logger,
  });

describe('PR 45.2 — runPushRegistration (uid-aware)', () => {
  // ────────────────────────────────────────────────────────────
  // The two regression tests for the production bug. If either
  // of these fails, we've reintroduced the May 27 2026 issue.
  // ────────────────────────────────────────────────────────────

  test('CRITICAL: anonymous user → skipped, registerForPush NOT called', async () => {
    // The exact PR 45.2 root cause. A throwaway anonymous launch
    // session must NOT claim the push token; it would flip the
    // boolean gate closed in PR 45 and leave the real user's
    // `fcmTokens` empty forever.
    const registerForPush = jest.fn(async () => 'tok');
    const outcome = await callOrch({
      currentUid: 'anon_abc',
      isAnonymous: true,
      lastRegisteredUid: null,
      registerForPush,
    });
    expect(outcome).toEqual<PushRegistrationOutcome>({
      kind: 'skipped',
      reason: 'anonymous',
    });
    expect(registerForPush).not.toHaveBeenCalled();
  });

  test('CRITICAL: anonymous→real upgrade re-registers for the real uid', async () => {
    // Multi-call sequence pinning the upgrade path:
    //   call 1: anonymous → skipped, lastRegisteredUid stays null.
    //   call 2: same session, real uid → registers, outcome.uid
    //           is the REAL uid (NOT the anonymous one).
    const registerForPush = jest.fn(async () => 'tok_real');

    let lastRegisteredUid: string | null = null;
    const out1 = await callOrch({
      currentUid: 'anon_xyz',
      isAnonymous: true,
      lastRegisteredUid,
      registerForPush,
    });
    if (out1?.kind === 'registered') {
      lastRegisteredUid = out1.uid; // mirrors AuthBootstrap's handler
    }
    expect(out1).toEqual({ kind: 'skipped', reason: 'anonymous' });
    expect(registerForPush).not.toHaveBeenCalled();
    expect(lastRegisteredUid).toBeNull();

    // Anon→real upgrade arrives as a fresh auth event with the
    // real uid + isAnonymous=false.
    const out2 = await callOrch({
      currentUid: 'real_admin',
      isAnonymous: false,
      lastRegisteredUid,
      registerForPush,
    });
    if (out2?.kind === 'registered') {
      lastRegisteredUid = out2.uid;
    }
    expect(out2).toEqual({
      kind: 'registered',
      token: 'tok_real',
      uid: 'real_admin',
    });
    // The token now belongs to the REAL uid, not the anonymous one.
    expect(lastRegisteredUid).toBe('real_admin');
    expect(registerForPush).toHaveBeenCalledTimes(1);
  });

  // ────────────────────────────────────────────────────────────
  // Account-switch + same-uid short-circuit.
  // ────────────────────────────────────────────────────────────

  test('account switch (real_A → real_B) re-registers', async () => {
    // Two real accounts in the same app session (common during
    // testing, also a real-world case for shared-device families).
    // The token must follow the current user.
    const registerForPush = jest.fn(async () => 'tok_B');
    const outcome = await callOrch({
      currentUid: 'real_B',
      isAnonymous: false,
      // Already registered for a DIFFERENT real uid.
      lastRegisteredUid: 'real_A',
      registerForPush,
    });
    expect(outcome).toEqual({
      kind: 'registered',
      token: 'tok_B',
      uid: 'real_B',
    });
    expect(registerForPush).toHaveBeenCalledTimes(1);
  });

  test('same real uid signs in again → short-circuits', async () => {
    // Auth-state nudges fire constantly (claim refresh, profile
    // reload, token rotation). For the SAME uid we must not
    // re-invoke registerForPush — it would spam the iOS permission
    // prompt and make a redundant callable round-trip every time.
    const registerForPush = jest.fn(async () => 'tok');
    const outcome = await callOrch({
      currentUid: 'real_admin',
      isAnonymous: false,
      lastRegisteredUid: 'real_admin',
      registerForPush,
    });
    expect(outcome).toEqual({
      kind: 'skipped',
      reason: 'already_registered_this_uid',
    });
    expect(registerForPush).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────
  // No-user path.
  // ────────────────────────────────────────────────────────────

  test('no user (currentUid = null) → returns null, does nothing', async () => {
    // Auth-state callback fires with null on sign-out. We don't
    // want a "skip" event surfacing in Sentry breadcrumbs for
    // every sign-out — null is a "nothing to report" signal.
    const registerForPush = jest.fn(async () => 'tok');
    const outcome = await callOrch({
      currentUid: null,
      isAnonymous: false,
      lastRegisteredUid: null,
      registerForPush,
    });
    expect(outcome).toBeNull();
    expect(registerForPush).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────
  // Retry semantics — preserved from PR 45 but expressed via the
  // uid-aware contract (the caller does NOT update
  // lastRegisteredUid on skipped/failed, so the next call retries).
  // ────────────────────────────────────────────────────────────

  test('null token → skipped(null_token), gate stays open for retry', async () => {
    const registerForPush = jest.fn(async () => null);

    let lastRegisteredUid: string | null = null;
    const out1 = await callOrch({
      currentUid: 'real_admin',
      isAnonymous: false,
      lastRegisteredUid,
      registerForPush,
    });
    if (out1?.kind === 'registered') {
      lastRegisteredUid = (out1 as { uid: string }).uid;
    }
    expect(out1).toEqual({ kind: 'skipped', reason: 'null_token' });
    // Caller did NOT update lastRegisteredUid — gate is open.
    expect(lastRegisteredUid).toBeNull();

    // Next auth event for the same uid → retries (registerForPush
    // called again, not short-circuited).
    await callOrch({
      currentUid: 'real_admin',
      isAnonymous: false,
      lastRegisteredUid,
      registerForPush,
    });
    expect(registerForPush).toHaveBeenCalledTimes(2);
  });

  test('CRITICAL: registerForPush throws → failed, gate stays open', async () => {
    // The closure-gate regression contract (build 17 origin). A
    // transient backend rejection must NOT poison the gate for
    // the rest of the session.
    const err = new Error('functions/internal');
    const registerForPush = jest.fn(async () => {
      throw err;
    });

    let lastRegisteredUid: string | null = null;
    const out1 = await callOrch({
      currentUid: 'real_admin',
      isAnonymous: false,
      lastRegisteredUid,
      registerForPush,
    });
    if (out1?.kind === 'registered') {
      lastRegisteredUid = (out1 as { uid: string }).uid;
    }
    expect(out1).toEqual({ kind: 'failed', error: err });
    expect(lastRegisteredUid).toBeNull();

    const out2 = await callOrch({
      currentUid: 'real_admin',
      isAnonymous: false,
      lastRegisteredUid,
      registerForPush,
    });
    expect(registerForPush).toHaveBeenCalledTimes(2);
    expect(out2?.kind).toBe('failed');
  });

  test('orchestrator never throws — caller can await without try/catch', async () => {
    // Defensive contract — even if registerForPush throws a
    // non-Error value, the orchestrator resolves with a `failed`
    // outcome rather than propagating the rejection.
    await expect(
      callOrch({
        currentUid: 'real_admin',
        isAnonymous: false,
        registerForPush: async () => {
          throw new Error('boom');
        },
      }),
    ).resolves.toMatchObject({ kind: 'failed' });
  });

  // ────────────────────────────────────────────────────────────
  // Logger plumbing — breadcrumbs + captureException.
  // ────────────────────────────────────────────────────────────

  test('logger.breadcrumb fires on anonymous skip', async () => {
    // Important for production observability — the anonymous skip
    // is a "silent" decision (no captureMessage), so the
    // breadcrumb is the only trail saying "we deliberately did
    // nothing for the anon session".
    const breadcrumb = jest.fn();
    await callOrch({
      currentUid: 'anon_1',
      isAnonymous: true,
      logger: { breadcrumb },
    });
    expect(breadcrumb).toHaveBeenCalledWith('push: skip (anonymous user)');
  });

  test('logger.breadcrumb fires on successful registration', async () => {
    const breadcrumb = jest.fn();
    await callOrch({
      currentUid: 'real_admin',
      isAnonymous: false,
      registerForPush: async () => 'tok',
      logger: { breadcrumb },
    });
    expect(breadcrumb).toHaveBeenCalledWith('bootstrap: push registered ok');
  });

  test('logger.breadcrumb fires on null-token skip', async () => {
    const breadcrumb = jest.fn();
    await callOrch({
      currentUid: 'real_admin',
      isAnonymous: false,
      registerForPush: async () => null,
      logger: { breadcrumb },
    });
    expect(breadcrumb).toHaveBeenCalledWith(
      'bootstrap: push register skipped (null token)',
    );
  });

  test('logger.captureException fires on failure', async () => {
    const captureException = jest.fn();
    const err = new Error('boom');
    await callOrch({
      currentUid: 'real_admin',
      isAnonymous: false,
      registerForPush: async () => {
        throw err;
      },
      logger: { captureException },
    });
    expect(captureException).toHaveBeenCalledWith(err);
  });

  test('no breadcrumb fires for null-user (it is not a "skip", it is a no-op)', async () => {
    // null-user must NOT produce a breadcrumb — otherwise every
    // sign-out (and every auth-state-null tick during cold start)
    // would litter Sentry trails.
    const breadcrumb = jest.fn();
    const captureException = jest.fn();
    const outcome = await callOrch({
      currentUid: null,
      isAnonymous: false,
      logger: { breadcrumb, captureException },
    });
    expect(outcome).toBeNull();
    expect(breadcrumb).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────
  // Priority ordering — pin that anonymous-skip wins over the
  // already-registered short-circuit, in case lastRegisteredUid
  // somehow holds a stale value during an anon session.
  // ────────────────────────────────────────────────────────────

  test('anonymous check beats already-registered short-circuit', async () => {
    // Defensive — if for any reason lastRegisteredUid carries
    // forward across a sign-out into a fresh anonymous session,
    // we still skip. The anonymous user must NEVER be treated as
    // "already covered".
    const registerForPush = jest.fn(async () => 'tok');
    const outcome = await callOrch({
      currentUid: 'anon_new',
      isAnonymous: true,
      lastRegisteredUid: 'anon_new',
      registerForPush,
    });
    expect(outcome).toEqual({ kind: 'skipped', reason: 'anonymous' });
    expect(registerForPush).not.toHaveBeenCalled();
  });
});
