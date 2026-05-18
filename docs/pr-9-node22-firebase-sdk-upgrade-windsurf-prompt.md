# PR 9 — Node 22 + firebase-functions/admin SDK upgrade (Windsurf prompt)

## Why this PR exists

Three coordinated upgrades on Cloud Functions, driven by a real
calendar deadline:

1. **Node 20 → Node 22.** Per Google Cloud's runtime support policy
   (and tracked in `PRELAUNCH_CHECKLIST.md` around line 363), Node 20
   for Cloud Functions was **deprecated 2026-04-30** and will be
   **decommissioned 2026-10-30**. After decommissioning, existing
   functions continue to run but **no new deploys** will be
   accepted on Node 20. We need to be on Node 22 well before late
   October so that an emergency fix-deploy isn't blocked by the
   runtime bump.
2. **`firebase-functions` ^6.0.1 → latest.** The deploy log has been
   warning the pinned version is outdated. Major version bumps in
   firebase-functions tend to include breaking changes in secret
   handling, scheduler API, or the v1/v2 surface boundary — worth
   addressing in the same PR as the Node bump because they share
   the staged deploy + smoke test work.
3. **`firebase-admin` ^12.6.0 → latest.** Less risky than
   firebase-functions (smaller surface area in our code: `getAuth`,
   `getFirestore`, `getStorage`, `FieldValue`) but the same logic
   applies — bundle it into the same risk-aware deploy.

Why bundle all three: they share the same blast radius (any one
breaking means all callables fail to deploy or behave weirdly),
they share the same deploy + smoke test workflow, and the
firebase-functions bump may have specific compatibility requirements
with Node 22 + firebase-admin major versions. Doing them piecemeal
multiplies the testing cycles.

This PR is **server-only** — zero client/Expo/EAS changes. No OTA
needed. Risk surface is entirely on `firebase deploy --only functions`.

## Read first

- `.windsurf/test-discipline.md`, `.windsurf/deploy-discipline.md`,
  and `.windsurf/code-discipline.md`.
- `functions/package.json` — current pins: `firebase-admin ^12.6.0`,
  `firebase-functions ^6.0.1`, engines `node: "20"`. We're bumping
  all three.
- `functions/src/index.ts` — every callable + scheduler + onDocument
  trigger. ~247 references to the v2 SDK surface (onCall, onSchedule,
  onDocumentCreated, onDocumentUpdated, HttpsError, setGlobalOptions,
  defineSecret). If anything breaks at compile time, the call sites
  here are what need updating.
- `PRELAUNCH_CHECKLIST.md` line 363 area — the Node-20 deprecation
  tracking entry. Move it to "completed" at the end of this PR.
- `PRELAUNCH_CHECKLIST.md` line 366 area — the firebase-functions
  SDK upgrade tracking entry. Same.
- `tests/functions/*.test.ts` — all pure-helper tests. They don't
  exercise firebase-admin so they're insulated from the upgrade,
  but they're the baseline that has to stay green.

## Pre-flight check (do before touching anything)

Before installing anything, capture the current state so we can
confirm the upgrade actually moved versions:

```powershell
cd functions
npm list firebase-admin firebase-functions razorpay
node --version
npx tsc --noEmit
cd ..
npm test
```

Paste the output into your scratchpad. The current baseline is:

- `firebase-admin@12.x`
- `firebase-functions@6.x`
- `razorpay@2.x`
- Local Node: whatever the user has (this doesn't matter — only the
  Cloud Functions runtime matters).
- `tsc --noEmit` clean (per PR 8.1).
- `npm test`: 476/476 passing.

Any deviation from this baseline → stop and report. Don't proceed
with an upgrade on a non-baseline tree.

## Scope (in)

### Part 1 — Bump engines + upgrade SDK pins

In `functions/`:

```powershell
cd functions
npm install --save firebase-admin@latest firebase-functions@latest
```

Then edit `functions/package.json`:

```json
"engines": {
  "node": "22"
}
```

Run `npm install` once more to refresh the lock file with the new
engine constraint:

```powershell
npm install
```

Capture the new resolved versions:

```powershell
npm list firebase-admin firebase-functions razorpay
```

Paste into scratchpad. Note the **major versions** that resolved —
that drives what release notes need to be reviewed.

### Part 2 — Review breaking changes

For each major version bump (firebase-admin v12 → v13/v14,
firebase-functions v6 → v7+), open the release notes / migration
guide. The high-risk areas in this codebase, in priority order:

1. **`defineSecret` + secret access pattern.** We use
   `defineSecret('RAZORPAY_KEY_ID')` etc. and read them via
   `.value()` inside callable bodies. If the API changed, this
   breaks every Razorpay call site.
2. **`onCall` / `HttpsError` signatures.** ~15 callables depend on
   the exact `request.auth.token` shape and the `HttpsError(code,
   message)` constructor.
3. **`onSchedule` configuration.** `cleanupAbandonedOrders` uses
   the v2 scheduler with a cron string. If the config object shape
   changed, the schedule won't trigger.
4. **`onDocumentCreated` / `onDocumentUpdated`.** We have a couple
   of Firestore triggers; the `event.data` accessor pattern is the
   one that historically gets refactored.
5. **`setGlobalOptions` shape.** We set `region: 'asia-south1'`
   globally. If the options interface tightened, this is a one-line
   fix.
6. **`firebase-admin` `initializeApp` / `getAuth` / `getFirestore` /
   `getStorage` / `FieldValue.serverTimestamp()` / `FieldValue.arrayUnion()`.**
   These are extremely stable but worth a sanity check on the v13/v14
   release notes.
7. **`Razorpay` SDK.** Pinned at `^2.9.4` and not being bumped in
   this PR. Should continue to work on Node 22; if it doesn't, that's
   a separate PR.

**Don't fix anything yet.** Just enumerate every breaking change
that touches code we have. Make a "fix list" in your scratchpad.

### Part 3 — Apply the fix list

Work through the list one item at a time. For each:

- Edit the affected file(s) in `functions/src/`.
- Run `npx tsc --noEmit` after each fix. The error count should
  monotonically decrease.
- If a fix is non-obvious (e.g. an API surface that no longer
  exists), pause and document the decision before continuing.

**Do NOT use `// @ts-ignore` or `// @ts-expect-error` to make
compile errors go away.** The whole point of this upgrade is to
land on a cleanly-typing baseline so future regressions are loud.
If a real upstream issue requires `@ts-ignore`, document the
upstream issue URL inline (same posture as the
`getReactNativePersistence` `@ts-ignore` in `src/services/firebase.ts`
that PR 8.1 cleaned up).

### Part 4 — Test pass

```powershell
cd functions
npx tsc --noEmit              # must be 0 errors
cd ..
npx tsc --noEmit              # must stay 0 errors (PR 8.1 baseline)
npm test                      # must stay 476/476 passing
```

If any pre-existing test starts failing, that's a real regression
introduced by the upgrade — investigate before proceeding.

### Part 5 — Local emulator smoke (highest-value before-deploy check)

The emulator runs against the firebase-admin you just upgraded and
exercises the v2 SDK surface. Catches API mismatches that compile
clean but blow up at runtime.

```powershell
cd functions
npm run serve
```

In another shell, hit at least one callable using `firebase
functions:shell` or `curl`. The minimum coverage I'd want:

1. `placeOrder` with a fake COD payload (no Razorpay dependency).
2. `cancelMyPendingOrder` on the order from step 1.
3. `listMyOrders` for the same uid.

Don't try to test Razorpay-dependent functions in the emulator
unless you have a separate sandbox; just confirm the SDK surface
loads without errors.

### Part 6 — Staged deploy

Per `.windsurf/deploy-discipline.md`: one `--only` target per
command, no pipes. Have the user run these in their own PowerShell
window:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
cd functions
npm run build
cd ..
firebase deploy --only functions --project grocery-mvp-dev
```

After the deploy:

```powershell
firebase functions:list --project grocery-mvp-dev
```

Confirm the expected function count (~30) matches what was there
before. If any function is missing or unexpected, that's a
server-state mismatch and needs another targeted deploy — do not
proceed.

Check the Cloud Functions console:
`https://console.firebase.google.com/project/grocery-mvp-dev/functions`

Each function should show **runtime: nodejs22** (not nodejs20). If
any still show nodejs20, the deploy didn't pick up the engine bump
— investigate before going further.

### Part 7 — Production smoke (manual, on the dev project first)

Before flipping the production project, run these against the dev
project's deployed functions via TestFlight pointed at dev:

1. **Place an online order, complete payment via Razorpay, get
   confirmation.** Covers `placeOrder` + Razorpay SDK + webhook.
2. **Cancel that order within the 2-min window** (PR 7 flow).
   Covers `cancelMyRecentPaidOrder` + the new Node 22 runtime.
3. **As admin, suspend a shop, then unsuspend.** Covers
   `suspendShop` + `unsuspendShop` + audit log writes (which use
   firebase-admin's FieldValue).
4. **Wait for the next `cleanupAbandonedOrders` cron tick** (or
   force-trigger via the console). Confirm it ran without errors
   in the Cloud Functions log.
5. **Pull the function logs** and grep for any `unhandled`,
   `deprecation`, or `error` lines:

   ```powershell
   firebase functions:log --project grocery-mvp-dev --only cleanupAbandonedOrders --limit 50
   ```

### Part 8 — Production deploy

Only after Part 7 is fully green:

```powershell
firebase deploy --only functions --project grocery-mvp-prod
```

(Or whatever the production project alias is — confirm with the
user before running.)

Then immediately:

```powershell
firebase functions:list --project grocery-mvp-prod
```

And spot-check the production Cloud Functions console shows
`runtime: nodejs22` on at least one function.

### Part 9 — Update PRELAUNCH_CHECKLIST

Move the two tracked items to completed:

- "Node 20 deprecation" entry around line 363 — mark complete with
  PR 9 reference + the deploy date.
- "firebase-functions SDK upgrade" entry around line 366 — same.

Add a short post-mortem entry under the PR 9 section noting:

- What versions resolved (firebase-admin@X, firebase-functions@Y).
- Which breaking changes needed fixes (if any).
- Any non-obvious behaviour differences observed in the dev
  smoke tests.

## Scope (out)

- **Razorpay SDK upgrade.** Pinned at `^2.9.4`. Could be bumped but
  it's not on a deadline and bundling it adds risk to this PR
  without proportional value. Separate PR if/when needed.
- **TypeScript upgrade.** Currently `^5.6.0`. Compatible with Node
  22 and firebase-functions v7+. No reason to bump in this PR.
- **Refactoring the v1/v2 SDK boundary.** All our triggers are
  already on v2 (no `firebase-functions/v1` imports). Nothing to do.
- **Enabling App Check.** Tracked separately per PR 8.1's
  PRELAUNCH section. Not in scope.
- **Reorganising functions into separate files.** `index.ts` is
  large (~4000 lines) but works. Splitting is a separate
  refactoring PR.

## Acceptance checklist

- [ ] `functions/package.json` engines: `"node": "22"`.
- [ ] `functions/package.json` dependencies: `firebase-admin@^13`
  (or whatever latest major is) and `firebase-functions@^7` (or
  later) — paste the exact versions in the PR notes.
- [ ] `functions/package-lock.json` updated to reflect new resolutions.
- [ ] `cd functions && npx tsc --noEmit` reports 0 errors.
- [ ] `cd .. && npx tsc --noEmit` still reports 0 errors (PR 8.1
  baseline preserved).
- [ ] `npm test` still passes (476+ tests).
- [ ] Local emulator smoke (Part 5) passes for at least 3 callables.
- [ ] `firebase deploy --only functions --project grocery-mvp-dev`
  completes cleanly. All ~30 functions in
  `firebase functions:list` output.
- [ ] Cloud Functions console shows `runtime: nodejs22` on at
  least one deployed function in the dev project.
- [ ] Production smoke tests (Part 7) all pass against the dev
  project.
- [ ] `firebase deploy --only functions --project grocery-mvp-prod`
  completes cleanly.
- [ ] Production Cloud Functions console shows `runtime: nodejs22`.
- [ ] PRELAUNCH_CHECKLIST updated (Part 9).
- [ ] **Zero new `DO NOT REMOVE` markers added** (the auto-formatter
  fix from PR 8.1's prep work should still hold).

## Rollback plan

If anything breaks in production AFTER the prod deploy:

1. **Immediate fix attempt:** if it's a known issue (e.g. a
   specific callable throws a clear error), redeploy a fix targeting
   just that function: `firebase deploy --only
   functions:problemFunction --project grocery-mvp-prod`.
2. **Full rollback:** revert the PR commit, `npm install` to restore
   old `node_modules`, then redeploy:
   ```powershell
   cd functions
   npm run build
   cd ..
   firebase deploy --only functions --project grocery-mvp-prod
   ```
   This will redeploy on Node 20 (still supported until October),
   buying time to diagnose.
3. **Hard rollback:** if even the revert deploy fails, use the
   Firebase console's "revert to previous version" feature on each
   affected function. Slower (~30s per function) but guaranteed.

Don't roll back over chat-noise concerns — only roll back on
concrete reproducible breakage. A single transient timeout isn't
a rollback signal; an entire callable category failing is.

## Estimated time

**Optimistic:** 2 hours. If firebase-functions v7 has no breaking
changes that touch our code and firebase-admin v13/v14 is a clean
bump, Parts 1–5 are largely mechanical and Parts 6–8 are just
waiting for deploys.

**Realistic:** 3–4 hours. Most likely one or two SDK surfaces will
have shifted (commonly: scheduler config shape, secret access, or
event data accessors). Each fix is small but they accumulate.

**Pessimistic:** 6+ hours. If firebase-functions jumped two majors
(v6 → v8), or if firebase-admin has tightened types in a way that
ripples through helpers, real refactoring may be needed.

Build in the staged deploy time too: dev deploy + smoke test
typically takes ~30 min before you're confident to push to prod.

## What to send back to the user

When done, the report should include:

- Resolved versions: `firebase-admin@X.Y.Z`, `firebase-functions@A.B.C`,
  Node target `22`.
- The "fix list" from Part 2 with what each item required (or "no
  change needed").
- Test results: tsc + tests + emulator smoke + dev deploy.
- Production deploy status (or a list of blockers if you stopped
  before prod).
- Any non-obvious behaviour differences observed.
- Updated PRELAUNCH_CHECKLIST diff.
