# Firebase Deploy Discipline

**Status:** mandatory for all Windsurf sessions on this project.
**Reason:** in May 2026 a Windsurf-issued
`firebase deploy --only functions,firestore:rules,firestore:indexes 2>&1 | Select-Object -Last 80`
hung silently for 5+ hours. The pipe through `Select-Object` buffered all
stdout, hiding both the live progress bars **and** the interactive
`"Would you like to proceed with deletion of claimShop?"` prompt that
the CLI was waiting on. The user killed the Windsurf shell and re-ran
the same command in a real PowerShell window, where the prompt
appeared, was answered `Y`, and the deploy completed in ~6 minutes.

These rules exist to make that incident impossible to repeat.

## Rules

### 1. One `--only` target per command. Always.

Never bundle:

```powershell
# DON'T
firebase deploy --only functions,firestore:rules,firestore:indexes
```

Instead:

```powershell
# DO
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only storage:rules     # only if storage.rules changed
firebase deploy --only functions
```

Each command waits for the previous to finish. If one fails you know
exactly which one. Bundling makes the failure mode "everything is
half-deployed and you have to read 200 lines of output to find the
broken one."

### 2. Never pipe deploy output through anything.

Forbidden:

```powershell
firebase deploy --only functions | Select-Object -Last 80
firebase deploy --only functions | Out-File deploy.log
firebase deploy --only functions 2>&1 | Tee-Object deploy.log
firebase deploy --only functions > deploy.log 2>&1
```

`Select-Object` and `Out-File` both buffer stdout. The Firebase CLI
uses **interactive prompts** (delete-orphaned-functions, IAM grants,
quota confirmations) that read from stdin only when stdout is a TTY.
Buffering breaks that handshake; the CLI hangs forever waiting for
input that the user can't see they need to provide.

If you need the output saved, run it raw and let the user copy/paste:

```powershell
firebase deploy --only functions
# then user pastes the output back into Windsurf
```

### 3. Never run `firebase deploy` from Windsurf at all.

Even with all the rules above followed, Windsurf's shell wrappers can
buffer or drop stdin. The agent **must not auto-run** any
`firebase deploy ...` command. Instead, write the exact command the
user should paste into their own PowerShell window and ask them to
run it.

```text
Please run this in PowerShell (not Windsurf):

    firebase deploy --only functions

Then paste the last ~30 lines of output back here so I can verify.
```

### 4. Order of operations.

When a phase changes multiple Firebase artifacts, deploy in this
order, one at a time:

1. `firebase deploy --only firestore:rules` — fastest, ~30 sec.
   Failures here are syntax errors and abort cleanly.
2. `firebase deploy --only firestore:indexes` — ~30–60 sec.
   New composite indexes start building in the background; queries
   that need them will fail until the build finishes. Plan releases
   accordingly.
3. `firebase deploy --only storage:rules` — ~10 sec, only when
   `storage.rules` changed.
4. `firebase deploy --only functions` — 5–15 min for a full deploy.
   This is the one that has interactive prompts.

### 5. Functions deletion confirmations.

When source code drops a function that is still deployed (e.g. we
removed `claimShop` in Phase 12a-v2-i), the CLI asks:

```text
The following functions are found in your project but do not exist
in your local source code:
    claimShop(asia-south1)
? Would you like to proceed with deletion?
```

This **must** be confirmed by a human, not silently auto-answered. If
the deletion is intentional and already discussed, the user can pass
`--force` to skip the prompt:

```powershell
firebase deploy --only functions --force
```

Windsurf must **never** add `--force` on its own. Adding `--force`
without explicit user direction can silently delete production
functions that were temporarily missing from local source (e.g.
during a refactor in progress). Rule of thumb: `--force` requires
the user to type "use --force" or equivalent in chat.

### 6. Verify after every deploy.

After the user confirms a deploy completed, ask them to run:

```powershell
firebase functions:list
```

Compare the output against the expected function list for the phase.
If anything is missing or unexpected, that is a server-state mismatch
and needs another targeted deploy — do not proceed to the next task.

For rules:

```powershell
firebase firestore:rules:get
```

For indexes:

```powershell
firebase firestore:indexes
```

### 7. Audit before every deploy.

Run `npm run audit` and `npx tsc --noEmit` before asking the user to
deploy anything. A truncated source file or a TypeScript regression
will deploy successfully and then crash at runtime — much harder to
debug than a pre-deploy compile error.

The audit script tracks file integrity (file ends cleanly, no truncation
mid-statement). It is the line of defense against partial-write bugs
introduced by the multi-edit / write_to_file tools.

### 8. If a deploy "appears stuck."

Default assumption: it is **waiting for an interactive prompt** that
got buffered. Do not wait more than 90 seconds with no output.
Action:

1. Tell the user the deploy may be stuck on a prompt.
2. Have them kill the Windsurf shell (Ctrl+C in the agent's terminal,
   or Stop on the running command in the chat).
3. Have them re-run the exact same command in their own PowerShell
   window where they can answer prompts directly.

### 9. SSL / system CA on Windows.

If the Firebase CLI fails with
`unable to verify the first certificate` /
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, the user is on a corporate or VPN
network and Node isn't picking up the system CA bundle. Fix:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
firebase deploy --only <target>
```

Set this in the user's PowerShell profile if it recurs. Don't
auto-set it from Windsurf — environment mutations should be visible.

## Quick reference

| Target | Command | Approx. time | Interactive prompts? |
|---|---|---|---|
| Rules | `firebase deploy --only firestore:rules` | 30 s | No |
| Indexes | `firebase deploy --only firestore:indexes` | 30–60 s | No |
| Storage rules | `firebase deploy --only storage:rules` | 10 s | No |
| Functions | `firebase deploy --only functions` | 5–15 min | **Yes** (deletions) |
| Verify | `firebase functions:list` | 5 s | No |

## OTA vs `eas build` — what requires a native rebuild

**Hard-learned during PR 34 (2026-05-24).** The PR 34 prompt
incorrectly stated "no native rebuild needed" because
`expo-audio` is autolinked. The actual requirement is set by
the `app.json` plugin block: `expo-audio` adds a
`microphonePermission` string, which becomes
`NSMicrophoneUsageDescription` in iOS `Info.plist` and
permission entries in the Android Manifest. **That's a native
config change.** The runtime fingerprint changes; the OTA
silently doesn't apply to devices running the older fingerprint.

Symptom: you `eas update --branch production`, the dashboard
shows the OTA published with N downloads and at least 1
"known launch," but your test device — even after reinstall
from TestFlight — still runs the old bundle. The downloads
counter was likely a different device (or an Expo internal
probe) whose fingerprint happens to match the new one. Your
device's installed app has the old fingerprint, and Expo
Updates correctly refuses to cross-apply.

The diagnostic is: in the Expo Updates dashboard for the OTA
group, the "Fingerprint" column for each platform is the hash
of the runtime native config that the OTA targets. If your
installed app was built with different native config (e.g.
no expo-audio plugin yet), the fingerprints don't match.

### Decision table

When writing a Windsurf prompt's "Deploy plan" section, classify
the changes against this table FIRST, before claiming
"OTA-only":

| Change | OTA sufficient? |
|---|---|
| JS-only logic, screen edits, callable additions | ✅ OTA |
| Pure-JS npm dep (lodash, date-fns, etc.) | ✅ OTA |
| New `expo-*` / RN library WITHOUT a config plugin in `app.json` (e.g. `expo-image-manipulator`, `expo-web-browser`) | ✅ OTA |
| **`expo-*` library WITH a config plugin** (`expo-audio`, `expo-camera`, `expo-image-picker`, `expo-notifications`, `expo-location`, `expo-tracking-transparency`, etc.) | ❌ **eas build required** |
| New entry in `app.json` `plugins` array | ❌ **eas build required** |
| Permission string added to `app.json` `ios.infoPlist` or `android.permissions` | ❌ **eas build required** |
| Change to `app.json` `ios.bundleIdentifier`, `android.package`, runtime version, scheme | ❌ **eas build required** |
| Changes to existing plugin's config options | ❌ **eas build required** |
| New `expo-build-properties` entries | ❌ **eas build required** |

### Quick check before writing the deploy plan

```powershell
# Compare app.json against main; any diff in plugins / infoPlist /
# android.permissions means native build.
git diff main -- app.json | findstr -i "plugin infoPlist permissions"
```

If that returns lines, the prompt's deploy section must call for
`eas build`, not `eas update`.

### Multi-stage deploy when a PR needs both server + native

Example sequence for a PR that touches Cloud Functions AND adds
a native dep (PR 34 shape):

1. `firebase deploy --only functions:<name>` — server first per
   Rule 1.
2. `git commit + push` the working tree (including the
   `app.json` plugin change).
3. `eas build --profile production --platform ios` AND
   `--platform android` — produces new native builds with the
   matching fingerprint.
4. Wait for builds to complete (~15–20 min each); install via
   TestFlight / EAS Build APK download.
5. `eas update --branch production` is **optional** — the
   embedded JS in the fresh build already includes the new
   code. Run it only if you want a JS-only follow-up patch
   without another native build.

The PR's "Smoke tests" section must specify which install
method is required — "on the next TestFlight build" vs. "on
the next OTA." Don't conflate.

## Signed-URL IAM gotcha (Cloud Functions Gen 2)

**Symptom:** A callable that uses `getSignedUrl({ version: 'v4',
action: 'write' | 'read' })` to mint Storage URLs throws to the
client as `INTERNAL`. The server log shows:

```
Error: Permission 'iam.serviceAccounts.signBlob' denied on resource
   (or it may not exist).
   ...
   at async sign (.../@google-cloud/storage/build/cjs/src/signer.js)
   { name: 'SigningError' }
```

**Cause:** Cloud Functions Gen 2 runs on Cloud Run. Its runtime
service account (`<project-number>-compute@developer.gserviceaccount.com`)
does NOT have permission to call `signBlob` on itself by default.
v4 signed URLs require self-signing. Gen 1 had implicit signing
capability; Gen 2 tightened it for least-privilege.

**Fix (one-time, project-wide — never repeat):**

Grant the runtime SA the `Service Account Token Creator` role
**on itself**. Two paths:

```powershell
# Option A — gcloud CLI
gcloud iam service-accounts add-iam-policy-binding `
  <project-number>-compute@developer.gserviceaccount.com `
  --member="serviceAccount:<project-number>-compute@developer.gserviceaccount.com" `
  --role="roles/iam.serviceAccountTokenCreator" `
  --project=<project-id>
```

```
Option B — Google Cloud Console UI
https://console.cloud.google.com/iam-admin/iam?project=<project-id>
→ find the compute SA row → pencil → Add role
→ "Service Account Token Creator" → Save
```

Propagation: ~30 seconds. No code redeploy needed.

**Affected features in this project:** `getMenuImageUploadUrl`
(PR 6.1), `getShopKycUploadUrl`, `recordShopKycUpload`,
`getShopKycReadUrls` (all PR 31). Any future PR using v4 signed URLs
will inherit the fix.

**Future-proofing:** when the prod Firebase project lands (PR 28),
this IAM grant must be applied to the **prod** compute SA too.
Document in the PR 28 windsurf prompt; the project number will be
different.

## Web SDK Firestore + RNFB auth — the silent-failure trap

**Hard-learned during PR 38.1 (2026-05-24, the second hit of the
PR 6.1 problem).** Any direct Firestore read or write from client
code that requires auth (rule references `request.auth != null` /
role checks / uid match) will silently fail or hard-fail on
**native**, because the Web SDK Firestore client
(`firebase/firestore`) does **not** share auth context with
`@react-native-firebase/auth`. The Cloud Function callable path
DOES work because callables transmit the auth token via the HTTPS
auth header, which both client SDKs populate identically.

**Symptoms:**

- **Writes:** no docs in the target collection, the
  `permission-denied` swallowed by the catch block as a
  `console.warn` only visible in dev menu, no Sentry events.
  Looks like the feature works in dev (web). Looks broken in the
  pilot (native).
- **Reads:** visible "Missing or insufficient permissions" error
  in the UI on tap. At least these fail loudly.

**Fix:** route both reads and writes through Cloud Function
callables. The callable uses the Admin SDK against Firestore
(bypasses rules), and validates auth via `request.auth` (which
works correctly cross-SDK because the auth token rides on the
HTTPS header). Mirror the `orderService.ts` web/native dispatch
pattern. Tighten the corresponding rule to
`allow read, write: if false` — server-mediated only — as
defense-in-depth against forged-event debug clients.

**When writing a Windsurf prompt:** any time the prompt proposes
direct Firestore operations from the client AND those ops require
auth, the deploy plan must specify the callable-routed approach
from the start. Direct client → Firestore writes should be
reserved for unauthenticated or rules-open collections (none
exist in this project today). Re-using the Web SDK client for
Firestore should always raise this question first.

**Affected features so far:**

- **Storage uploads (PR 6 → fixed by PR 6.1)** — direct
  `uploadBytes()` against signed-rules paths failed silently on
  native; fix was server-minted v4 signed PUT URLs.
- **Firestore writes + reads to `featureUsageLog/` (PR 38 →
  fixed by PR 38.1)** — direct `addDoc` / `getDocs` failed
  silently (writes) or hard (reads) on native; fix was
  `logFeatureUsageEvent` + `queryFeatureUsageLog` callables.
- **Likely any future write-from-client to authenticated
  collections.** Prevent at prompt-writing time, not at
  pilot-deploy time.

## Cloud Run `allUsers` invoker IAM — second IAM trap

Sibling gotcha to the Signed-URL section above, surfaced during
PR 41 smoke testing (May 26 2026).

**Symptom:** A previously-working Firebase callable function
suddenly returns HTTP 401 with `"The access token could not be
verified."` from `run.googleapis.com/requests` logs. Client sees
either a silent empty list (try/catch swallows it) or a
React-side crash if the error isn't handled. The function code
hasn't changed; redeploy doesn't fix it.

**Cause:** Firebase Functions Gen 2 callables run as Cloud Run
services. Public callability requires the Cloud Run service to
grant `roles/run.invoker` to the special principal `allUsers`.
The in-function `requireAdminCaller` (or similar) gate enforces
actual authorization — the `allUsers` invoker just lets the
request *reach* the function code.

Some operation (manual gcloud edit, security-policy automation,
even an interrupted `firebase deploy`) can silently strip the
`allUsers` binding from one or more services. The function then
401s for **every** caller, regardless of their Firebase Auth
token.

PR 41 incident: `listpendingdeliveryrequests` lost its binding
while `listpendingshops` (architecturally identical) kept its
binding. Admin could see pending shops but not pending delivery
applicants. Empty IAM policy (`etag: ACAB` with no bindings) was
the smoking gun.

**Diagnostic (run as Sudhir, not Windsurf):**

```powershell
# Inspect one service
gcloud run services get-iam-policy <service-name> --region=asia-south1 --project=grocery-mvp-dev
```

A healthy callable shows:

```
bindings:
- members:
  - allUsers
  role: roles/run.invoker
etag: BwZ...
version: 1
```

A broken service shows just `etag: ACAB` with no `bindings`.

**Bulk audit** — find every callable in `asia-south1` missing
the binding:

```powershell
gcloud run services list --region=asia-south1 --project=grocery-mvp-dev --format="value(metadata.name)" | ForEach-Object {
    $svc = $_
    $policy = gcloud run services get-iam-policy $svc --region=asia-south1 --project=grocery-mvp-dev --format="value(bindings.members)" 2>$null
    if (-not $policy -or $policy -notmatch "allUsers") {
        Write-Host "MISSING allUsers binding: $svc"
    }
}
```

**False positives to ignore in the audit:** background triggers
(`sendOrderStatusPush`, `sendNewOrderPushToShop`, etc.) and
scheduled jobs (`cleanupAbandonedOrders`) MUST NOT have
`allUsers` invoker — they're invoked by Eventarc / Cloud
Scheduler via internal service accounts. Adding `allUsers` to
those would be a real security regression. Audit script
flags them but only `onCall` callables need the binding.

**Fix:**

```powershell
gcloud run services add-iam-policy-binding <service-name> --region=asia-south1 --member=allUsers --role=roles/run.invoker --project=grocery-mvp-dev
```

Takes ~5 seconds. No function code change, no redeploy needed —
the IAM update applies to the existing service immediately.

**Prevention rule for PR prompts that touch callables:**

Add to the deploy plan a verification step like:

```
After firebase deploy --only functions, run:

gcloud run services get-iam-policy <each-new-or-touched-function> --region=asia-south1 --project=grocery-mvp-dev

Confirm `allUsers` + `roles/run.invoker` appears in bindings for
EVERY onCall callable. Background triggers and scheduled jobs
MUST NOT have it.
```

Without that check, a stripped binding survives multiple deploy
cycles unnoticed (Firebase deploy reports "successful update"
even when IAM is in a broken state). Treat IAM verification as
"server-first deploy" hardening, same tier as the signed-URL
gotcha above.

## Cross-references

This doc is referenced from `PRELAUNCH_CHECKLIST.md` under the
"Phase 12a-v2-i" entries. If you change the deploy workflow, update
both files together.
