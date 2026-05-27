# PR 45 — Push notification reliability, observability + test coverage (Windsurf prompt)

## Why this PR exists

Push notifications worked on build 15, silently broke by build 17.
Symptom: `users/{uid}.fcmTokens` is empty even after a fresh
sign-in — the token never lands. **Three compounding failures
let this happen and stay hidden for days:**

1. **No observability.** `pushService.registerForPushNotifications`
   and `AuthBootstrap` both swallow every failure in a silent
   `console.warn`. Nothing reaches Sentry, nothing alerts anyone.
   A broken push pipeline is invisible until someone manually
   checks Firestore for a token.
2. **A closure-gate retry bug.** `AuthBootstrap.tsx:95` sets
   `pushRegistered = true` BEFORE the async registration resolves.
   If the first attempt fails (any reason), the flag is already
   set, so no retry happens — not on sign-out/sign-in, not on
   anything short of a full app force-quit. One transient failure
   poisons the whole app session.
3. **Zero test coverage.** The entire push pipeline —
   client registration, the `registerPushToken` callable, the
   `sendOrderStatusPush` + sibling triggers — has no unit tests.
   Confirmed: `grep` finds only `authService.signOut.test.ts`
   mocking pushService as a dependency. Nothing tests the push
   logic itself.

Sudhir's directive (May 27 2026): *"I really want PR for test
coverage debt. My preference is to cover such issues using our
automated tests wherever possible. The more test coverage we
have, the faster manual testing it would be."*

PR 45 addresses all three. It does NOT pre-suppose the root
cause of the current breakage — instead, **Part A's
instrumentation makes the root cause visible** the moment the
build is reproduced on a device, so we stop guessing. Parts B +
C fix the known reliability bug and build the safety net so this
class of regression is caught automatically next time.

**Note on the root cause still being unknown:** the current
breakage might be platform-level (iOS APN credential lost during
the build 17 native rebuild — being checked separately via
`eas credentials`). If so, no client code fixes it; the eas
credential setup does. But PR 45 is still correct and valuable
regardless: it makes the failure observable, fixes the retry
bug, and builds the test net. Once Part A ships and the device
is reproduced, the Sentry breadcrumbs tell us definitively
whether it's client-code or platform-credential.

## Read first

- `.windsurf/code-discipline.md` — all rules, especially Rule 5
  (audit safety net) and the testing posture.
- `.windsurf/test-discipline.md` — how tests are structured in
  this repo (pure helpers, emulator tiers, mock posture).
- `src/services/pushService.ts` — the full client registration
  flow. Every early-return and every `console.warn` is a place
  that currently hides a failure. ~190 lines, read it all.
- `src/components/AuthBootstrap.tsx` lines 91-101 — the
  closure-gate. `pushRegistered` is the buggy flag.
- `functions/src/index.ts` — `registerPushToken` (~line 2440),
  `unregisterPushToken` (~line 2481), `sendOrderStatusPush`
  (~line 2512), and the sibling push triggers
  (`sendNewOrderPushToShop`, `sendNewPickupPushToDelivery`,
  `pushToAdmins`). These are the server surfaces to test.
- `src/services/sentry.ts` (or wherever Sentry is initialized) —
  confirm the capture API available to import
  (`captureException`, `captureMessage`, `addBreadcrumb`).

## Part A — Observability (the diagnostic that ends the guessing)

### A1. Structured breadcrumbs through the registration flow

In `pushService.registerForPushNotifications`, add a Sentry
breadcrumb at every decision point so the flow is traceable in
Sentry even when it fails silently. Replace the bare
`console.warn`/`console.log` calls with breadcrumb + (on real
failures) `captureException` / `captureMessage`.

```ts
import * as Sentry from '@sentry/react-native'; // confirm actual import path

async registerForPushNotifications(): Promise<string | null> {
  Sentry.addBreadcrumb({ category: 'push', message: 'register: start' });

  if (Platform.OS === 'web') {
    Sentry.addBreadcrumb({ category: 'push', message: 'register: skip (web)' });
    return null;
  }
  if (!Device.isDevice) {
    Sentry.addBreadcrumb({ category: 'push', message: 'register: skip (simulator)' });
    return null;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    Sentry.addBreadcrumb({ category: 'push', message: 'register: permission denied' });
    Sentry.captureMessage('push registration: permission not granted', 'info');
    return null;
  }

  const projectId = getEasProjectId();
  if (!projectId) {
    Sentry.captureMessage('push registration: no EAS projectId', 'warning');
    return null;
  }

  let token: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    token = result.data;
    Sentry.addBreadcrumb({
      category: 'push',
      message: 'register: token obtained',
      data: { tokenPrefix: token.slice(0, 24) },
    });
  } catch (e) {
    // THIS is the most likely current failure point (APN entitlement /
    // provisioning). Capturing it surfaces the exact platform error.
    Sentry.captureException(e, {
      tags: { push_stage: 'getExpoPushTokenAsync' },
    });
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { /* unchanged */ });
    await Notifications.setNotificationChannelAsync('admin-alerts', { /* unchanged from PR 41 */ });
  }

  try {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('registerPushToken');
      await fn({ token });
    } else {
      const fn = httpsCallable(functions, 'registerPushToken');
      await fn({ token });
    }
    Sentry.addBreadcrumb({ category: 'push', message: 'register: backend write ok' });
  } catch (e) {
    // Callable rejected — IAM, auth-context, validation. Capture so
    // we know which.
    Sentry.captureException(e, {
      tags: { push_stage: 'registerPushToken_callable' },
    });
    // Re-throw so the caller's gate (Part B) knows it failed and can
    // retry on the next auth event.
    throw e;
  }

  return token;
}
```

Key change: the `registerPushToken` callable failure now
**re-throws** instead of swallowing, so AuthBootstrap's gate
(Part B) can tell success from failure. The token-fetch failure
returns null (a legitimate "can't proceed" — no point retrying
in-session if the device can't mint a token).

### A2. Self-verification breadcrumb in AuthBootstrap

After registration resolves, AuthBootstrap logs the outcome to
Sentry so we can see in the dashboard whether each session's
push registration succeeded.

## Part B — Closure-gate reliability fix

`src/components/AuthBootstrap.tsx` lines 91-101. The fix: only
mark the gate satisfied AFTER a successful resolve, and allow
retry on subsequent auth events if the prior attempt failed.

```ts
// Before (buggy — flag set before resolve, never retries):
if (user && !pushRegistered) {
  pushRegistered = true;
  pushService.registerForPushNotifications().catch(err => {
    console.warn('[bootstrap] push registration failed:', err);
  });
}

// After (only mark done on success; retry-eligible on failure):
if (user && !pushRegisteredOk) {
  pushService
    .registerForPushNotifications()
    .then(token => {
      if (token) {
        pushRegisteredOk = true; // success — stop retrying this session
        Sentry.addBreadcrumb({
          category: 'push',
          message: 'bootstrap: push registered ok',
        });
      }
      // token === null (permission denied / simulator / no projectId):
      // leave gate open. Harmless — server is idempotent (arrayUnion
      // dedupes), and a later auth event (e.g. user grants permission
      // in Settings then re-foregrounds) can retry.
    })
    .catch(err => {
      // Backend write failed (re-thrown from pushService). Leave gate
      // open so the NEXT auth event retries. Capture for visibility.
      Sentry.captureException(err, { tags: { push_stage: 'bootstrap_register' } });
    });
}
```

Rename `pushRegistered` → `pushRegisteredOk` to make the
"only-true-on-success" semantics obvious at the call site.

**Watch the closure scope.** `pushRegisteredOk` must be declared
at the same scope as the original `pushRegistered` (inside the
useEffect, above the `onAuthStateChanged` subscription) so it
persists across auth events within one app session but resets on
component remount (app cold start). Don't accidentally hoist it
to module scope (would persist across remounts and re-break the
retry-on-cold-start behavior).

## Part C — Test coverage (the core ask)

The push pipeline currently has ZERO tests. PR 45 builds the net.
All tests use the existing repo posture: mock the SDK boundaries
(Notifications, firebase functions, firebase-admin), assert the
logic.

### C1. `tests/services/pushService.test.ts` (new)

Mock `expo-notifications`, `expo-device`, `expo-constants`, and
the functions callable. Cover every branch:

- Web platform → returns null, no token fetch attempted
- Simulator (`Device.isDevice === false`) → returns null
- Permission denied → returns null, no token fetch
- Permission granted + no projectId → returns null, captureMessage called
- `getExpoPushTokenAsync` throws → returns null, captureException
  called with `push_stage: 'getExpoPushTokenAsync'` tag
- Happy path → token obtained, callable called with `{ token }`,
  returns the token
- Callable rejects → captureException with
  `push_stage: 'registerPushToken_callable'` tag, AND the error
  re-throws (assert the promise rejects)
- Android branch → `setNotificationChannelAsync` called for both
  `default` and `admin-alerts` channels

(~10 cases)

### C2. `tests/components/AuthBootstrap.test.tsx` (new)

Mount AuthBootstrap with mocked `pushService` + a controllable
auth-state emitter. The CRITICAL test — the one that would have
caught this bug:

- **Retry-on-failure:** first auth event → `registerForPush`
  rejects → assert gate stays open → second auth event →
  assert `registerForPush` called AGAIN (twice total). This is
  the closure-gate regression test.
- **Stop-on-success:** first auth event → `registerForPush`
  resolves with a token → second auth event → assert
  `registerForPush` NOT called again (once total).
- **Null-token (permission denied) leaves gate open:** resolves
  with `null` → second auth event retries.
- Sign-out → sign-in within session behaves per the above.

(~5 cases)

### C3. `tests/functions/registerPushToken.test.ts` (new)

Mock firebase-admin Firestore. Cover:

- Authed caller → token appended to `users/{uid}.fcmTokens` via
  `arrayUnion`
- Unauthenticated caller → throws `unauthenticated`
- Missing token arg → throws `invalid-argument`
- Duplicate token → arrayUnion dedupes (assert called with
  arrayUnion, which is idempotent server-side)

(~4 cases)

### C4. `tests/functions/unregisterPushToken.test.ts` (new)

- Authed caller → token removed via `arrayRemove`
- Unauthenticated → throws

(~2 cases)

### C5. `tests/functions/sendOrderStatusPush.test.ts` (new)

Mock the Firestore event + `fetch` (Expo Push API). Cover:

- Order status change → reads customer's `fcmTokens` → POSTs to
  `https://exp.host/--/api/v2/push/send` with correct message
  shape (to, title, body, sound, channelId)
- No fcmTokens on customer → skips the fetch (no crash)
- Missing customerUid → logs + returns, no fetch
- Multiple tokens → all included in the push batch

(~5 cases)

### C6. Pure helper extraction (if it reduces mocking burden)

If `sendOrderStatusPush` and the sibling triggers share message-
construction logic, extract a pure
`buildOrderStatusPushMessages(order, tokens)` helper into
`functions/src/pushHelpers.ts` (mirror the
`pendingCountsHelpers` / `notifyAdminsHelpers` pattern). Test the
pure builder directly without mocking firebase-admin. The triggers
then just do IO + call the helper. This is the cleanest testable
shape and matches how PR 41 + PR 42 structured their helpers.

Use judgment — if the triggers are simple enough that mocking
fetch is sufficient, skip the extraction. But the pure-helper
route is generally preferred in this repo.

### Test count target

~26 new test cases across C1-C5 (+ helper tests if C6 extraction
done). Full suite should reach ~808+ from the current 782.

## Discipline checklist

- [ ] All hooks in AuthBootstrap stay above conditional returns.
      No new hooks added (the gate is a closure var, not a hook).
- [ ] `pushRegisteredOk` scoped INSIDE the useEffect (resets on
      remount/cold-start), NOT module-level.
- [ ] Sentry import path verified against the actual sentry
      service module — don't assume `@sentry/react-native`
      directly if the repo wraps it.
- [ ] `registerPushToken` callable failure now re-throws from
      pushService — verify no OTHER caller of
      `registerForPushNotifications` relied on it swallowing
      (grep for callers; AuthBootstrap is the only one, and
      Part B handles the throw).
- [ ] No schema changes. No new permissions. No native rebuild.
- [ ] No Firestore rules changes.

## Deploy plan

Mixed: client OTA + functions (only if C6 extraction changes the
trigger code; the trigger LOGIC is unchanged so likely just a
refactor that still needs a deploy to ship the extracted helper).

Sequence:

1. `npm run test:unit` — green, ~808+ passing.
2. **Functions** (if triggers touched by C6): `firebase deploy
   --only functions:registerPushToken,functions:sendOrderStatusPush`
   (+ siblings if refactored).
3. **Cloud Run IAM verification** for any redeployed callable —
   `registerPushToken` already confirmed has `allUsers` binding
   (May 27), but re-verify after deploy per discipline rule.
4. **Client OTA** — `eas update --branch production --message
   "PR 45 push reliability + observability + tests"`.
5. **Reproduce on device** — force-quit, reopen, sign in. Then
   check Sentry dashboard for the push breadcrumbs from your
   session. The breadcrumb trail reveals exactly where
   registration stops:
   - Stops at `getExpoPushTokenAsync` with a captured exception →
     **platform/APN credential issue** → fix via `eas credentials`
     iOS push key setup (outside this PR).
   - Stops at `registerPushToken_callable` → backend issue
     (IAM/auth/validation) → investigate the captured error.
   - Reaches `backend write ok` but token still not in Firestore
     → a deeper callable bug.
   - Reaches `backend write ok` AND token IS in Firestore → the
     closure-gate was the only bug; Part B fixed it.

## Smoke acceptance

1. **Fresh-install token registration.** Force-quit, reopen,
   sign in. Within ~10s, `users/{uid}.fcmTokens` has an
   `ExponentPushToken[...]` entry. (If it doesn't, Sentry now
   shows WHY — that's the whole point of Part A.)
2. **End-to-end push.** With a token registered, place an order
   as customer → shop owner accepts → customer device receives
   a push notification within ~5s. Notification persists on lock
   screen until tapped/cleared (iOS "Persistent" banner style).
3. **Retry-on-failure (hard to trigger manually, covered by
   tests).** If registration fails once, a later sign-in retries
   rather than staying broken for the session.
4. **Sentry visibility.** After any failed registration, the
   Sentry dashboard shows the breadcrumb trail + captured
   exception with the `push_stage` tag. No more silent failures.

## Out of scope (defer)

- **Daily IAM audit job** (the "Option 3" automated Cloud
  Scheduler audit of all callables' allUsers bindings) — useful
  infra, but Phase B post-pilot.
- **Notification preferences UI** (let users toggle which push
  types they get) — future feature.
- **Rich notifications** (images, action buttons) — future.
- **The actual platform-credential fix** (if Part A reveals it's
  an APN issue) — that's `eas credentials` work, done outside
  this PR once the diagnostic points there.

## Definition of done

- pushService instruments every step with Sentry breadcrumbs +
  captures real failures (no more silent console.warn).
- `registerPushToken` callable failure re-throws so the caller
  can detect it.
- AuthBootstrap closure-gate only marks done on success; retries
  on failure across auth events within a session.
- 26+ new test cases covering pushService, AuthBootstrap gate,
  registerPushToken, unregisterPushToken, sendOrderStatusPush.
- Full suite green (~808+).
- After deploy + device reproduce, Sentry shows the breadcrumb
  trail that reveals the current root cause.
- Doc trail: CLAUDE.md + SESSION_LOG.md + ROADMAP.md updated.
  PILOT_SMOKE_TEST_PLAN.md Phase 2 gets a "verify fcmTokens
  registered after sign-in" step.
- New permanent test-discipline note: push-pipeline regressions
  are caught by C1-C5; platform-credential regressions are
  caught by Part A's Sentry visibility (not by unit tests —
  document this boundary so future devs know which net catches
  what).
