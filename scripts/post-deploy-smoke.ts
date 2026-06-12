/**
 * HOTFIX-POST-DEPLOY-SMOKE-SCRIPT — DO NOT REMOVE.
 *
 * Fast deploy-state validator. Catches three structurally-different
 * failures that all surface as "empty result / nothing happens" in the
 * live app — the symptom that masked the dashboard count = 0 bug for an
 * entire retest cycle:
 *
 *   1. Callable not deployed        (gcloud functions describe → 404)
 *   2. Composite index still Building (firebase firestore:indexes)
 *   3. IAM ACAB on Cloud Run         (gcloud run services get-iam-policy)
 *
 * None of these are visible in the deploy command's exit code:
 * `firebase deploy --only` exits 0 when the function deploy succeeds;
 * the IAM strip happens separately at the Cloud Run layer and the index
 * build is async (deploy exits before the index is queryable). This
 * script makes the symptoms surface at the END of the deploy, in ~30s,
 * instead of when Sudhir tests the live app.
 *
 * Usage:
 *   npx tsx scripts/post-deploy-smoke.ts                  # check all per config
 *   npx tsx scripts/post-deploy-smoke.ts --check <names>  # CSV of callables
 *   npx tsx scripts/post-deploy-smoke.ts --indexes-only   # skip callables + IAM
 *   npx tsx scripts/post-deploy-smoke.ts --iam-only        # skip indexes
 *   npx tsx scripts/post-deploy-smoke.ts --help
 *
 * Exit code: 0 if all checks pass; 1 if any check fails.
 *
 * READ-ONLY. Never writes. Safe to run repeatedly. Project allowlist:
 * grocery-mvp-dev only (prod project doesn't exist yet).
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseIamPolicyOutput,
  parseIndexesOutput,
  parseProjectFlag,
} from './parsesmokeOutput';

const ALLOWED_PROJECT = 'grocery-mvp-dev';
const REGION = 'asia-south1';
const CONFIG_PATH = join(__dirname, '.smoke-config.json');

// Default callable list when no .smoke-config.json is present. Kept in
// sync with the config file; the file is the source of truth when it
// exists.
const DEFAULT_CALLABLES = [
  'submitOrderRating',
  'respondToReview',
  'amendRating',
  'acknowledgeReview',
  'listMyAttentionReviews',
  'listShopAttentionReviews',
  'listMyOrders',
  'listShopOrders',
  'getPartnerPhotoUploadUrl',
];

type CheckResult = { ok: true } | { ok: false; reason: string };

// ─── Callable existence ────────────────────────────────────────────────
function checkCallableDeployed(callableName: string): CheckResult {
  try {
    execSync(
      `gcloud functions describe ${callableName} --region=${REGION} --project=${ALLOWED_PROJECT} --format="value(name)"`,
      { stdio: 'pipe' },
    );
    return { ok: true };
  } catch {
    return {
      ok: false,
      reason: `Callable ${callableName} not found (gcloud functions describe → 404). Re-run: firebase deploy --only "functions:${callableName}"`,
    };
  }
}

// ─── Cloud Run IAM allUsers invoker ────────────────────────────────────
function checkCallableIamAllUsers(callableName: string): CheckResult {
  try {
    const out = execSync(
      `gcloud run services get-iam-policy ${callableName.toLowerCase()} --region=${REGION} --project=${ALLOWED_PROJECT}`,
      { stdio: 'pipe', encoding: 'utf8' },
    );
    const { hasAllUsers, etag } = parseIamPolicyOutput(out);
    if (!hasAllUsers) {
      return {
        ok: false,
        reason: `IAM allUsers invoker missing on ${callableName} (etag=${etag ?? 'unknown'}). Re-bind: gcloud run services add-iam-policy-binding ${callableName.toLowerCase()} --member=allUsers --role=roles/run.invoker --region=${REGION} --project=${ALLOWED_PROJECT}`,
      };
    }
    return { ok: true };
  } catch (e: any) {
    return {
      ok: false,
      reason: `IAM check failed for ${callableName}: ${e?.message ?? 'unknown'}`,
    };
  }
}

// ─── Composite index Enabled (not Building / CREATING) ─────────────────
function checkIndexesEnabled(): CheckResult {
  try {
    const out = execSync(
      `firebase firestore:indexes --project=${ALLOWED_PROJECT}`,
      { stdio: 'pipe', encoding: 'utf8' },
    );
    const { building, enabled } = parseIndexesOutput(out);
    if (building > 0) {
      return {
        ok: false,
        reason: `${building} index(es) still Building (${enabled} Enabled). Queries on them return empty until Enabled — wait (usually minutes) and re-run --indexes-only.`,
      };
    }
    return { ok: true };
  } catch (e: any) {
    return {
      ok: false,
      reason: `Indexes check failed: ${e?.message ?? 'unknown'}`,
    };
  }
}

// ─── Config ────────────────────────────────────────────────────────────
function loadSmokeConfig(): { callables: string[] } {
  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      if (Array.isArray(raw?.callables) && raw.callables.length > 0) {
        return { callables: raw.callables };
      }
      console.warn(
        `[smoke] ${CONFIG_PATH} present but has no "callables" array — falling back to defaults.`,
      );
    } catch (e: any) {
      console.warn(
        `[smoke] Failed to parse ${CONFIG_PATH} (${e?.message ?? 'unknown'}) — falling back to defaults.`,
      );
    }
  }
  return { callables: DEFAULT_CALLABLES };
}

function printHelp(): void {
  console.log(
    [
      'post-deploy-smoke — read-only deploy-state validator (grocery-mvp-dev)',
      '',
      'Usage:',
      '  npx tsx scripts/post-deploy-smoke.ts                  check all per config',
      '  npx tsx scripts/post-deploy-smoke.ts --check <names>  CSV of callables',
      '  npx tsx scripts/post-deploy-smoke.ts --indexes-only   only Firestore indexes',
      '  npx tsx scripts/post-deploy-smoke.ts --iam-only       skip index check',
      '  npx tsx scripts/post-deploy-smoke.ts --help           this message',
      '',
      'Checks: callable deployed (gcloud), IAM allUsers invoker (Cloud Run),',
      'composite index Enabled (firebase). Exit 0 = all pass, 1 = any fail.',
      'READ-ONLY — never writes. Project allowlist: grocery-mvp-dev only.',
    ].join('\n'),
  );
}

// ─── Main ──────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  // Project allowlist — refuse any explicit project that isn't dev.
  const requestedProject = parseProjectFlag(args);
  if (requestedProject && requestedProject !== ALLOWED_PROJECT) {
    console.error(
      `[smoke] Refusing: --project=${requestedProject} is not allowed. This script only runs against ${ALLOWED_PROJECT} (prod does not exist yet).`,
    );
    process.exit(1);
  }

  const checkIdx = args.indexOf('--check');
  const explicitCallables =
    checkIdx !== -1 && checkIdx + 1 < args.length
      ? args[checkIdx + 1].split(',').map(s => s.trim()).filter(Boolean)
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
    if (!r.ok) {
      console.error(`  ❌ ${r.reason}`);
      failed = true;
    } else {
      console.log('  ✅ All indexes Enabled');
    }
  }

  // 2. Callable existence + IAM
  if (!indexesOnly) {
    for (const name of callables) {
      console.log(`[smoke] Checking ${name}…`);
      const r1 = checkCallableDeployed(name);
      if (!r1.ok) {
        console.error(`  ❌ ${r1.reason}`);
        failed = true;
        continue;
      }
      const r2 = checkCallableIamAllUsers(name);
      if (!r2.ok) {
        console.error(`  ❌ ${r2.reason}`);
        failed = true;
        continue;
      }
      console.log(`  ✅ ${name}: deployed + IAM bound`);
    }
  }

  if (failed) {
    console.error(
      '\n[smoke] One or more checks FAILED. Investigate above before declaring deploy done.',
    );
    process.exit(1);
  }
  console.log('\n[smoke] All checks passed.');
}

main().catch(e => {
  console.error('[smoke] Fatal:', e);
  process.exit(1);
});
