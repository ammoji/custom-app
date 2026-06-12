# HOTFIX-POST-DEPLOY-SMOKE-SCRIPT — Scripted smoke check after every server deploy

**Source:** Devin's 2026-06-10 root-cause framing of the dashboard count = 0 bug:

> *"Most of these bugs are deploy-state: index Building, IAM ACAB, callable not deployed. A 5-line scripted check (indexes Enabled, IAM bound, callable responds) per release would catch them before Sudhir does."*

Across this testing wave, three deploy-state failure modes have shipped to retest:
1. **Callable not actually deployed** (Bundle I §D/§E callables claimed but never created)
2. **Composite index still Building** (queries return empty until Enabled)
3. **IAM ACAB on Cloud Run** (allUsers invoker stripped during deploy)

Each could be detected in ~30 seconds via a scripted check. The cost of running it is trivial; the cost of NOT running it is multi-hour retest cycles where the bug is "everything works but nothing happens."

**Deploy class:** **dev-only tooling.** Pure script + verification. No runtime code change. No backfill. No deploy.

## Root cause (verified by Claude before this prompt)

Three structurally different post-deploy failures share the same symptom (empty result / silent failure) but require different remediations:

| Failure | Detection | Remediation |
| --- | --- | --- |
| Callable not deployed | `gcloud functions describe` returns 404 | Re-run `firebase deploy --only "functions:NAME"` |
| Index still Building | `firebase firestore:indexes` shows `state: CREATING` | Wait — usually minutes |
| IAM ACAB | `gcloud run services get-iam-policy` returns `etag: ACAB` | Re-bind `allUsers` invoker |

None of these are visible in the deploy command's exit code. `firebase deploy --only` exits 0 when the function deploy succeeds — the IAM strip happens separately at the Cloud Run layer. The index build is async; deploy exits before the index is queryable.

Today the symptoms surface only when Sudhir tests the live app and notices something's off. The script makes them surface at the end of the deploy command.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls` (read-only)
- `npx tsc --noEmit`
- File edits to:
  - `scripts/post-deploy-smoke.ts` (new)
  - `package.json` (add a `scripts.smoke` entry if helpful)
  - Possibly `scripts/.smoke-config.json` (new — declares which callables and indexes to check)

You MUST stop and ask before:
- Running the script against production (`grocery-mvp-prod` doesn't exist yet anyway — only `grocery-mvp-dev`)
- Deleting any existing scripts
- Adding NEW dependencies — the script should use `child_process.execSync` for gcloud / firebase CLIs, plus the firebase-admin SDK already in `package.json`
- Touching application code

## Required completion-report verification block

Paste the literal output of:

```
wc -l scripts/post-deploy-smoke.ts
npx tsx scripts/post-deploy-smoke.ts --help 2>&1 | head -20
# Dry run against grocery-mvp-dev (READ-ONLY — script must never write):
npx tsx scripts/post-deploy-smoke.ts --check listMyOrders 2>&1 | head -10
# (Pick any deployed callable known to exist. If the script reports success here, it works.)
```

## Plan

### §A — Script skeleton

`scripts/post-deploy-smoke.ts`:

```ts
/**
 * HOTFIX-POST-DEPLOY-SMOKE-SCRIPT — fast deploy-state validator.
 *
 * Catches three structurally-different failures that all surface as
 * "empty result" in the live app:
 *   1. Callable not deployed (gcloud functions describe → 404)
 *   2. Composite index still Building (firebase firestore:indexes)
 *   3. IAM ACAB on Cloud Run (gcloud run services get-iam-policy)
 *
 * Usage:
 *   npx tsx scripts/post-deploy-smoke.ts                  # check all per config
 *   npx tsx scripts/post-deploy-smoke.ts --check <names>  # check specific callable
 *   npx tsx scripts/post-deploy-smoke.ts --indexes-only   # skip callables
 *   npx tsx scripts/post-deploy-smoke.ts --iam-only       # skip callables + indexes
 *
 * Exit code: 0 if all checks pass; 1 if any check fails.
 *
 * READ-ONLY. Never writes. Safe to run repeatedly.
 *
 * Mirrors the safety scaffolding from reset-keep-catalog.ts:
 *   - Project allowlist (grocery-mvp-dev only — until prod exists)
 *   - No --execute / write modes (script is intrinsically read-only)
 */

import { execSync } from 'node:child_process';

const ALLOWED_PROJECT = 'grocery-mvp-dev';
const REGION = 'asia-south1';

type CheckResult = { ok: true } | { ok: false; reason: string };

// ─── Callable existence + invocability ─────────────────────────────────
function checkCallableDeployed(callableName: string): CheckResult {
  try {
    execSync(
      `gcloud functions describe ${callableName} --region=${REGION} --project=${ALLOWED_PROJECT} --format="value(name)"`,
      { stdio: 'pipe' },
    );
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: `Callable ${callableName} not found via gcloud describe` };
  }
}

// ─── Cloud Run IAM allUsers invoker ────────────────────────────────────
function checkCallableIamAllUsers(callableName: string): CheckResult {
  try {
    const out = execSync(
      `gcloud run services get-iam-policy ${callableName.toLowerCase()} --region=${REGION} --project=${ALLOWED_PROJECT}`,
      { stdio: 'pipe', encoding: 'utf8' },
    );
    // ACAB is the empty-policy etag. If we see it, IAM was stripped.
    if (out.includes('etag: ACAB') || !out.includes('allUsers')) {
      return { ok: false, reason: `IAM allUsers invoker missing on ${callableName}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: `IAM check failed for ${callableName}: ${e?.message ?? 'unknown'}` };
  }
}

// ─── Composite index Enabled (not Building / CREATING) ─────────────────
function checkIndexesEnabled(): CheckResult {
  try {
    const out = execSync(
      `firebase firestore:indexes --project=${ALLOWED_PROJECT}`,
      { stdio: 'pipe', encoding: 'utf8' },
    );
    // The output lists indexes with their state. Look for any in CREATING / Building state.
    // Parse format depends on Firebase CLI version — handle both JSON and table output.
    const buildingMatches = out.match(/CREATING|BUILDING|Building/g);
    if (buildingMatches && buildingMatches.length > 0) {
      return { ok: false, reason: `${buildingMatches.length} index(es) still building` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: `Indexes check failed: ${e?.message ?? 'unknown'}` };
  }
}

// ─── Main ──────────────────────────────────────────────────────────────
function loadSmokeConfig(): { callables: string[] } {
  // Read scripts/.smoke-config.json if present; otherwise default to a hardcoded list.
  // The config file lets developers add new callables to the smoke check without modifying the script.
  // ...
}

async function main() {
  const args = process.argv.slice(2);
  const explicitCallables = args.includes('--check')
    ? args[args.indexOf('--check') + 1].split(',')
    : null;
  const indexesOnly = args.includes('--indexes-only');
  const iamOnly = args.includes('--iam-only');

  const config = loadSmokeConfig();
  const callables = explicitCallables ?? config.callables;

  let failed = false;

  // 1. Index check
  if (!iamOnly) {
    console.log('[smoke] Checking Firestore indexes…');
    const r = checkIndexesEnabled();
    if (!r.ok) { console.error(`  ❌ ${r.reason}`); failed = true; }
    else { console.log('  ✅ All indexes Enabled'); }
  }

  // 2. Callable existence + IAM
  if (!indexesOnly) {
    for (const name of callables) {
      console.log(`[smoke] Checking ${name}…`);
      const r1 = checkCallableDeployed(name);
      if (!r1.ok) { console.error(`  ❌ ${r1.reason}`); failed = true; continue; }
      const r2 = checkCallableIamAllUsers(name);
      if (!r2.ok) { console.error(`  ❌ ${r2.reason}`); failed = true; continue; }
      console.log(`  ✅ ${name}: deployed + IAM bound`);
    }
  }

  if (failed) {
    console.error('\n[smoke] One or more checks FAILED. Investigate above before declaring deploy done.');
    process.exit(1);
  } else {
    console.log('\n[smoke] All checks passed.');
  }
}

main().catch(e => {
  console.error('[smoke] Fatal:', e);
  process.exit(1);
});
```

### §B — Smoke config file

`scripts/.smoke-config.json`:

```json
{
  "callables": [
    "submitOrderRating",
    "respondToReview",
    "amendRating",
    "acknowledgeReview",
    "listMyAttentionReviews",
    "listShopAttentionReviews",
    "listMyOrders",
    "listShopOrders",
    "getPartnerPhotoUploadUrl"
  ]
}
```

Pre-populated with the callables touched in the recent waves. Developers append as they ship new ones.

### §C — `npm run smoke` script entry

`package.json`:

```json
"scripts": {
  "smoke": "tsx scripts/post-deploy-smoke.ts",
  "smoke:indexes": "tsx scripts/post-deploy-smoke.ts --indexes-only",
  "smoke:iam": "tsx scripts/post-deploy-smoke.ts --iam-only"
}
```

### §D — Update the project's deploy documentation

There's no canonical `DEPLOY.md` today. Decide:
- (a) Add one — `docs/DEPLOY.md` with the standard order: indexes → functions → IAM verify → `npm run smoke` → backfill → OTA.
- (b) Update `CLAUDE.md` In-flight protocol section to reference `npm run smoke` after every server deploy.

Pick (b) — minimal documentation churn, lands the discipline in the file every fresh session reads first.

### §E — Tests (optional but recommended)

Pin **+3 tests** on small extracted helpers:

```ts
// scripts/parsesmokeOutput.ts — pure helpers extracted from the script for testability
export function parseIamPolicyOutput(text: string): { hasAllUsers: boolean; etag: string | null }
export function parseIndexesOutput(text: string): { building: number; enabled: number }
```

Tests verify the parsers against known sample outputs from gcloud / firebase CLI. Makes the script's logic unit-testable without needing live gcloud calls.

If the script stays small enough to be obviously correct, skip the test extraction. Use judgment.

## Discipline checklist

1. **Rule 1** — script header carries "HOTFIX-POST-DEPLOY-SMOKE-SCRIPT — DO NOT REMOVE" comment.
2. **Rule 2** — N/A.
3. **Rule 5** — schema audit-grep N/A. Required completion-report verification block enforces real execution evidence.
4. **Rule 7** — N/A.
5. **Rule 8** — FEATURES.md update in Doc trail: new row in cross-cutting §5.9 Operational scripts for the smoke check.
6. **Rule 11** — N/A.
7. **Rule 13** — N/A.
8. **Rule 14** — N/A.
9. **Schema-additive** — N/A.
10. **Test discipline:** §E +3 if extracted helpers; **0 minimum** if script stays obviously correct.

## Acceptance checklist

1. `npx tsx scripts/post-deploy-smoke.ts` runs against `grocery-mvp-dev`. Reports per-callable + per-check pass/fail. Exit 0 on all-pass; 1 on any fail.
2. `npx tsx scripts/post-deploy-smoke.ts --check listMyOrders` checks just one callable. Useful for spot-checks during deploy.
3. `npx tsx scripts/post-deploy-smoke.ts --indexes-only` skips callable checks. Useful for waiting on index builds.
4. Refusal: `npx tsx scripts/post-deploy-smoke.ts --project=anything-else` refuses (project allowlist).
5. **Deliberate-break demo:** strip IAM allUsers from one callable via `gcloud run services remove-iam-policy-binding`. Re-run smoke → reports failure with file:line message. Re-bind. Smoke passes.
6. CLAUDE.md updated to reference `npm run smoke` as standard post-deploy step.
7. **Required completion-report verification block at the top is filled in.**

## Out of scope

- **Integration testing the callables.** This script does existence + IAM checks only — not behavior validation. That belongs in emulator-class tests or a separate e2e suite.
- **Running automatically as part of deploy.** Discipline first, automation second. Manual `npm run smoke` after every deploy is the goal; CI integration later.
- **Production project (`grocery-mvp-prod`)** doesn't exist yet. The script is dev-only until the prod project lands.
- **Backfill verification** (separate concern; backfills have their own dry-run + audit-log pattern).

## Deploy

**None — dev-only tooling.** Commit the script + config + `package.json` script entries + CLAUDE.md note. Verify locally:

```
npm run smoke
```

Expected: clean pass against current grocery-mvp-dev state.

## Doc trail (Cowork)

After ship:

- **TESTING-FINDINGS** — note: the next deploy-state failure (missing callable, building index, IAM stripped) surfaces in `npm run smoke` before retest.
- **CLAUDE.md** — Resume protocol step 7 (post-deploy verification) references `npm run smoke`.
- **SESSION_LOG** paragraph capturing: deploy-state failures repeatedly masqueraded as code failures during this wave; smoke check is the institutional fix.
- **PROMPT_AUTHORING_NOTES** — add Rule 5 worked example #16 (deploy state ≠ code state — verify with gcloud/firebase queries, not just by running `eas update`).
- **FEATURES.md** §5.9 Operational scripts — add row: `post-deploy-smoke | Read-only validator: callable existence + IAM allUsers binding + index Enabled status | HOTFIX-POST-DEPLOY-SMOKE-SCRIPT | shipped`. Lineage HTML comment.
- **Last updated** stamp on Cross-cutting §5.9 → 2026-06-10.
