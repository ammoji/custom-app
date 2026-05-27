# Push Notification Diagnostic Handoff — for Windsurf code investigation

> **Purpose:** Push notifications stopped working between build 15
> and build 17. We've ruled out every external/platform cause from
> the outside (credentials, permissions, IAM, the closure-gate
> bug). PR 45 shipped instrumentation to surface the failure — and
> the result is *itself* the key clue: **nothing appears in Sentry
> at all**, which means the failure is happening somewhere we
> can't see from outside the code. This doc hands the full trail
> to Windsurf to trace the actual call paths and find the
> root cause (or add instrumentation that reveals it).

## Symptom

- `users/{uid}.fcmTokens` is **empty for every account**, including
  admin (`3145415346`, uid `Nb452wQTySZd2i07p1...`).
- Push notifications do not deliver for any action (order
  accepted, new order to shop, etc.).
- **Worked on build 15** (pre-rebrand). **Broke by build 17**
  (the PR 39/39.1 rebrand + logo native rebuild).

## What we have VERIFIED and RULED OUT (with evidence)

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | APN push key at Expo | ✅ Set up | `eas credentials` → iOS → "Push Key is already set up for grocery-mvp com.sudhirdavim.grocerymvp" |
| 2 | App ID Push Notifications capability | ✅ Enabled | Apple Developer portal → identifier `com.sudhirdavim.grocerymvp` → Push Notifications checkbox checked (key-based auth, "Certificates (0)" is expected/correct) |
| 3 | iOS notification permission | ✅ Granted | iOS Settings → HamaraSetu → Notifications → Allow Notifications ON |
| 4 | Cloud Run IAM on `registerPushToken` | ✅ allUsers/run.invoker present | `gcloud run services get-iam-policy registerpushtoken` → bindings include allUsers |
| 5 | Closure-gate retry bug | ❌ RULED OUT | Clean force-quit (flick app away) → wait 10s → reopen → fresh sign-in → wait 15s → `fcmTokens` STILL empty. A fresh app session resets the closure var; if the gate were the only bug, the token would appear here. It doesn't. |
| 6 | PR 45 instrumentation deployed | ✅ Live | Expo dashboard shows "PR 45 push reliability + observability + tests" published to `production` branch, runtime 1.0.0, both platforms, ~10 min before testing. Device force-quit + reopened twice to load the OTA. |

## THE KEY CLUE — nothing in Sentry after PR 45 + reproduce

After PR 45 deployed (instrumentation live) and a fresh sign-in
to trigger registration:

- **Sentry → Errors & Outages** (filter: `is:unresolved`,
  `issue.category is error or outage`, react-native, All Envs,
  1H): **No issues match your search.**
- **Sentry → Warnings** (react-native, All Envs, 1H, no category
  filter): **No issues match your search.**

PR 45's `pushService.registerForPushNotifications` has Sentry
calls at every decision point:

- `Sentry.addBreadcrumb({ category: 'push', message: 'register: start' })` — first line
- `captureMessage('push registration: permission not granted', 'info')` — permission branch
- `captureMessage('push registration: no EAS projectId', 'warning')` — projectId branch
- `captureException(e, { tags: { push_stage: 'getExpoPushTokenAsync' } })` — token-mint catch
- `captureException(e, { tags: { push_stage: 'registerPushToken_callable' } })` — callable catch

**None of the `captureMessage` / `captureException` calls produced
a Sentry issue.** (Breadcrumbs alone don't create issues — they
only attach to a captured event — so the absence of "register:
start" in the issue list is expected. But the absence of ANY
captureMessage/captureException is the real signal.)

## What "nothing in Sentry" implies — hypotheses to investigate in code

Ranked by likelihood. Windsurf: please trace each against the
actual code.

### Hypothesis 1 — `registerForPushNotifications` is never being called

If AuthBootstrap isn't invoking it (or the orchestrator's gate
short-circuits before calling `registerForPush`), then no code
in pushService runs, so no Sentry call fires. **This is the most
likely explanation given total Sentry silence.**

Investigate:
- `src/components/AuthBootstrap.tsx` — the auth-state callback +
  the `runPushRegistration` orchestrator call. What is the exact
  condition gating the call? Is `user` the right shape? Is
  `alreadyRegistered` / `pushRegisteredOk` somehow `true` on a
  fresh session?
- `src/services/pushRegistrationOrchestrator.ts` — does
  `runPushRegistration` actually invoke `registerForPush` in the
  not-already-registered path? Could the `alreadyRegistered`
  short-circuit be firing incorrectly?
- Did the PR 45 refactor change the call site such that
  `registerForPushNotifications` is now wired through the
  orchestrator but the orchestrator is never reached on cold
  start?

### Hypothesis 2 — Sentry capture is a no-op in this build

If Sentry isn't actually initialized / enabled in the production
build, every `captureMessage` / `captureException` silently does
nothing. The push flow could be failing loudly in code but
Sentry never records it.

Investigate:
- `src/services/sentry.ts` (or wherever `Sentry.init` lives) — is
  Sentry initialized in production? Is there an `enabled: false`,
  a `beforeSend` that drops events, a `sampleRate: 0`, or a
  `__DEV__` gate that disables it in release builds?
- Confirm the DSN is present and valid in the production env
  (it's in `app.json` extra.sentry.dsn + eas.json
  EXPO_PUBLIC_SENTRY_DSN).
- Is the `./sentry` module that pushService imports the REAL
  Sentry, or could it be resolving to the test mock in some
  build configuration? (The unit tests mock `./sentry` via
  moduleNameMapper — verify that mapping can't leak into the
  production bundle.)
- Has Sentry EVER captured anything from this app in production?
  Check if there are ANY events in the project's history (widen
  to 30d, all issue categories). If literally zero events ever,
  Sentry capture is likely not wired in release builds at all.

### Hypothesis 3 — getExpoPushTokenAsync fails at the native layer without throwing a JS-catchable error

On iOS, `getExpoPushTokenAsync` internally registers with APNs.
If the build 17 binary's provisioning profile lacks the
`aps-environment` entitlement (despite the App ID capability
being enabled — these are separate; the entitlement must be in
the actual provisioning profile used at build time), the native
APN registration can fail in a way that may or may not surface
as a catchable JS exception.

Investigate:
- Whether build 17's provisioning profile included push
  entitlement. `eas build:view <build-17-id>` or the build's
  credential details on expo.dev.
- If the entitlement is missing → the fix is a fresh `eas build`
  (build 18) that regenerates the profile. This would ALSO
  explain why no JS-level captureException fired (the failure is
  below the JS error boundary, or getExpoPushTokenAsync hangs/
  returns without resolving rather than throwing).

### Hypothesis 4 — OTA bundle didn't actually apply on the device

The update is published (visible in Expo dashboard) but the
device might still be running the embedded build-17 bundle if the
runtime fingerprint mismatched or the fetch didn't complete.

Investigate:
- Runtime version match: build 17 and the PR 45 update both show
  `1.0.0`. Confirm they're actually compatible (runtimeVersion
  policy is `appVersion` per app.json).
- Add a trivial visible marker in the PR 45 bundle (e.g., a
  version string somewhere on a screen, or a startup breadcrumb)
  to confirm the new JS is actually running on device.

## What we'd like Windsurf to do

1. **Trace the call path** from AuthBootstrap → orchestrator →
   pushService.registerForPushNotifications. Confirm whether the
   function is actually invoked on a fresh signed-in session.
   This is the #1 suspect given total Sentry silence.
2. **Audit the Sentry wiring** in production. Confirm
   `captureException` / `captureMessage` actually reach Sentry in
   a release build, and aren't no-op'd by init config, a
   `__DEV__` gate, or the test mock leaking.
3. **Add a top-of-function capture that CANNOT be missed** — e.g.,
   a `Sentry.captureMessage('push: registerForPushNotifications
   ENTERED', 'info')` as the very first line, before any
   early-return. If even THAT doesn't appear in Sentry after a
   reproduce, we've proven either the function isn't called
   (Hypothesis 1) or Sentry is dead (Hypothesis 2) — and we can
   tell which by whether OTHER parts of the app produce Sentry
   events.
4. **If Hypotheses 1 + 2 are both disproven** (function IS called,
   Sentry IS live) → the failure is Hypothesis 3 (native APN /
   provisioning), which needs build 18, and we'd want a
   try/catch around getExpoPushTokenAsync that captures even
   non-Error throws (e.g., `captureException(new Error(String(e)))`).

## Reproduction steps (exact)

1. Force-quit HamaraSetu (swipe up, flick the card away — full
   dismiss, not background).
2. Wait 10 seconds.
3. Reopen from home screen.
4. Sign in with admin phone `3145415346`, OTP `123456`.
5. Wait 15 seconds on the home screen.
6. Refresh Firebase Console → `users/{admin-uid}` → check
   `fcmTokens`. → STILL EMPTY.
7. Refresh Sentry (Errors & Outages, then Warnings, 1H,
   react-native). → NOTHING.

## Build / deploy context

- Build 17 (iOS) live on TestFlight — first native rebuild since
  build 15; included PR 39 rebrand strings + PR 39.1 logo assets.
- Bundle ID unchanged: `com.sudhirdavim.grocerymvp`.
- EAS project: `25064a20-cfd6-4a98-ac27-4d435095e50a`, owner
  `ammoji`.
- PR 45 OTA published to `production` branch, runtime 1.0.0.
- Firebase project: `grocery-mvp-dev`.

## Most likely conclusion (our outside-in read)

Given every platform credential checks out AND PR 45's
instrumentation produces zero Sentry signal, our leading theory
is **Hypothesis 1 or 2** — either the registration function isn't
being called on cold start, or Sentry capture isn't wired in
release builds (so it's been failing invisibly all along, and
PR 45's instrumentation can't help because the capture sink
itself is dead). Windsurf reading the actual AuthBootstrap call
path + Sentry init config should resolve which in one pass.

If both are disproven, it's **Hypothesis 3** (build-17
provisioning profile missing push entitlement) → build 18 fixes
it, and we should harden the getExpoPushTokenAsync catch to
capture non-Error throws.

---

## RESOLVED — PR 45.2 (May 27 2026)

**Root cause: Hypothesis 1 with a twist.** The function WAS being
called, but for the wrong user. PR 45.1's probes confirmed the
full chain ran to `push: registerPushToken callable RESOLVED` —
the pipeline worked end-to-end. The smoking gun was the
breadcrumb payload on the first event:

```
{ alreadyRegistered: false, isAnonymous: true, uidPrefix: Lb5D6Ske }
```

Anonymous user. Token registered to the throwaway anon doc, then
PR 45's boolean gate flipped closed before the user finished
their OTP, so the real account never re-registered.

Hypotheses 2 (Sentry dead) and 3 (APN credentials / provisioning)
were both disproven by the breadcrumbs themselves — every probe
fired in order, so Sentry was alive AND APN registration
succeeded. The bug was a pure client-side gate-design flaw.

**Fix shipped: PR 45.2** — orchestrator promoted from boolean
to uid-aware (skip anonymous, track `lastRegisteredUid`,
re-register on uid change). Pure client OTA, no build 18, no
functions deploy. See `PRELAUNCH_CHECKLIST.md` PR 45.2 entry for
the full design + smoke acceptance.

**Lessons captured in tests:**

- `tests/services/pushRegistrationOrchestrator.test.ts` —
  CRITICAL "anonymous skip" + "anonymous→real upgrade
  re-registers" cases. Either failing trips CI before this bug
  can ship again.
- The PR 45.1 `captureMessage` probes stay in place through one
  on-device verification, then get stripped via a small follow-
  up OTA (`[Phase 45.2-cleanup]`). The failure-branch captures
  + breadcrumbs from PR 45 stay permanently — they're the
  legitimate observability.
