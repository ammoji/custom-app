/**
 * PR 36.2 — Destructive cleanup script that KEEPS users + auth and
 * wipes everything else. Use between pilot phases / before demos /
 * before investor reviews when you want a "clean app, same testers"
 * state.
 *
 *   npm run reset:pilot-data                    # dry-run (default)
 *   npm run reset:pilot-data -- --execute       # actually delete
 *   npm run reset:pilot-data -- --execute --yes # skip typed prompt
 *   npm run reset:pilot-data -- --execute --yes --skip-storage
 *
 * Companion to `scripts/reset-test-data.ts` — that one nukes
 * everything (orders + shops + users + auth). This one preserves
 * `users/{uid}` profiles + Auth accounts so existing testers can
 * sign back in as fresh customers after the wipe. Non-admin
 * users with shop-owner / delivery role state get their Firestore
 * role fields scrubbed AND their custom claims rewritten so the
 * app doesn't try to route them to a deleted shop on next launch.
 *
 * Safety guards (mirrored from reset-test-data.ts):
 *   - Project allowlist (`ALLOWED_PROJECTS` — grocery-mvp-dev only)
 *   - Admin UID protection (env `ADMIN_PROTECT_UID` or
 *     `--admin-uid=<uid>`; aborts if absent)
 *   - Dry-run by default; `--execute` required to actually delete
 *   - Interactive "type DELETE to confirm" unless `--yes`
 *   - Audit log at `scripts/.cleanup-logs/{ISO-timestamp}-pilot.json`
 *
 * Per `.windsurf/test-discipline.md`: pure helpers are unit-tested
 * under `tests/scripts/reset-pilot-data.test.ts`. The firebase-admin
 * glue here is proved by the dry-run smoke (see PR 36.2 prompt).
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type {
  Firestore,
  WriteBatch,
} from 'firebase-admin/firestore';

import {
  ALLOWED_PROJECTS,
  COLLECTIONS_TO_WIPE,
  STORAGE_PATHS_TO_WIPE,
  assertProjectAllowed,
  buildClaimsAfterRoleRevoke,
  parseFlags,
  planUserRoleCleanup,
  type ResetPilotFlags,
  type UserDocSnapshot,
} from './reset-pilot-data.helpers';

// Re-export so external callers (or follow-up scripts) can import
// the same surface from a single module without pulling in
// firebase-admin via the helpers path.
export {
  ALLOWED_PROJECTS,
  COLLECTIONS_TO_WIPE,
  STORAGE_PATHS_TO_WIPE,
  assertProjectAllowed,
  buildClaimsAfterRoleRevoke,
  parseFlags,
  planUserRoleCleanup,
};
export type { ResetPilotFlags };

// -------------------------------------------------------------------
// Terminal output (no chalk dep — plain ANSI escapes)
// -------------------------------------------------------------------
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
};
const banner = (s: string) =>
  console.log(`\n${C.bold}${s}${C.reset}\n${'─'.repeat(s.length)}`);

// -------------------------------------------------------------------
// Service account
// -------------------------------------------------------------------

type ServiceAccount = {
  project_id: string;
  client_email: string;
  type: string;
};

function loadServiceAccount(): ServiceAccount {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../service-account.json') as ServiceAccount;
}

// -------------------------------------------------------------------
// Audit log
// -------------------------------------------------------------------

type AuditLog = {
  scriptVersion: string;
  gitSha: string;
  operator: string;
  projectId: string;
  serviceAccountEmail: string;
  startedAt: string;
  finishedAt: string | null;
  dryRun: boolean;
  flags: ResetPilotFlags;
  plan: {
    collections: Record<string, number>;
    menuSubdocs: number;
    storage: Record<string, { files: number; bytes: number }>;
    usersTotal: number;
    rolesToRevoke: number;
  };
  actual: {
    collections: Record<string, number>;
    menuSubdocs: number;
    storage: Record<string, number>;
    rolesRevoked: number;
  };
  affectedUids: string[];
  errors: Array<{
    phase: string;
    message: string;
    failedRefs?: string[];
  }>;
};

function gitSha(): string {
  try {
    return execSync('git rev-parse HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

function gitOperator(): string {
  try {
    return execSync('git config user.email').toString().trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

function writeAuditLog(audit: AuditLog): string {
  const dir = join(__dirname, '.cleanup-logs');
  mkdirSync(dir, { recursive: true });
  // Filename uses a Windows-safe ISO timestamp + a `-pilot` suffix
  // so it doesn't collide with reset-test-data.ts logs.
  const fname = `${audit.startedAt.replace(/[:.]/g, '-')}-pilot.json`;
  const path = join(dir, fname);
  writeFileSync(path, JSON.stringify(audit, null, 2));
  return path;
}

// -------------------------------------------------------------------
// Firestore deletion helpers
// -------------------------------------------------------------------

/**
 * Delete a list of doc refs in batches of 500. On batch failure,
 * record the failed paths in the audit log and continue. Same
 * semantics as `reset-test-data.ts` — partial state with a complete
 * audit trail is strictly better than crashing mid-run.
 */
async function deleteRefsInBatches(
  db: Firestore,
  refs: FirebaseFirestore.DocumentReference[],
  label: string,
  audit: AuditLog,
): Promise<{ deleted: number; failed: string[] }> {
  const BATCH_SIZE = 500;
  let deleted = 0;
  const failed: string[] = [];

  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const slice = refs.slice(i, i + BATCH_SIZE);
    const batch: WriteBatch = db.batch();
    for (const ref of slice) batch.delete(ref);
    try {
      // eslint-disable-next-line no-await-in-loop
      await batch.commit();
      deleted += slice.length;
      process.stdout.write(`\r  ${label}: ${deleted}/${refs.length}`);
    } catch (e) {
      const ids = slice.map(r => r.path);
      failed.push(...ids);
      audit.errors.push({
        phase: label,
        message: (e as Error).message,
        failedRefs: ids,
      });
      process.stdout.write(
        `\r  ${C.red}${label}: batch ${i}–${i + slice.length} FAILED${C.reset}\n`,
      );
    }
  }
  if (deleted === refs.length && refs.length > 0) {
    process.stdout.write(' ✓\n');
  } else if (refs.length === 0) {
    process.stdout.write(`  ${label}: 0/0 ✓\n`);
  } else {
    process.stdout.write('\n');
  }
  return { deleted, failed };
}

// -------------------------------------------------------------------
// Counting + planning
// -------------------------------------------------------------------

type Plan = {
  collectionRefs: Record<string, FirebaseFirestore.DocumentReference[]>;
  menuRefs: FirebaseFirestore.DocumentReference[];
  storage: Record<string, { files: number; bytes: number }>;
  usersTotal: number;
  uidsToClean: string[];
};

async function gatherPlan(
  db: Firestore,
  adminUid: string,
  flags: ResetPilotFlags,
): Promise<Plan> {
  // 1. Top-level collections we wipe.
  const collectionRefs: Record<string, FirebaseFirestore.DocumentReference[]> =
    {};
  for (const name of COLLECTIONS_TO_WIPE) {
    // eslint-disable-next-line no-await-in-loop
    const snap = await db.collection(name).get();
    collectionRefs[name] = snap.docs.map(d => d.ref);
  }

  // 2. shops/{id}/menu/* subcollections (per-shop descent, mirrors
  //    reset-test-data.ts so the audit log can show menu-vs-shop
  //    counts independently).
  const menuRefs: FirebaseFirestore.DocumentReference[] = [];
  const shopsSnap = await db.collection('shops').get();
  for (const shopDoc of shopsSnap.docs) {
    // eslint-disable-next-line no-await-in-loop
    const ms = await shopDoc.ref.collection('menu').get();
    for (const m of ms.docs) menuRefs.push(m.ref);
  }

  // 3. Storage prefixes (skipped if --skip-storage).
  const storage: Record<string, { files: number; bytes: number }> = {};
  if (!flags.skipStorage) {
    const bucket = getStorage().bucket();
    for (const prefix of STORAGE_PATHS_TO_WIPE) {
      // eslint-disable-next-line no-await-in-loop
      const [files] = await bucket.getFiles({ prefix });
      const bytes = files.reduce((acc, f) => {
        const sz = Number(f.metadata?.size ?? 0);
        return acc + (Number.isFinite(sz) ? sz : 0);
      }, 0);
      storage[prefix] = { files: files.length, bytes };
    }
  } else {
    for (const prefix of STORAGE_PATHS_TO_WIPE) {
      storage[prefix] = { files: 0, bytes: 0 };
    }
  }

  // 4. Users — count total + plan the role-cleanup list.
  const usersSnap = await db.collection('users').get();
  const userSnapshots: UserDocSnapshot[] = usersSnap.docs.map(d => {
    const data = d.data() as Record<string, unknown>;
    return {
      uid: d.id,
      isShopOwner: data.isShopOwner === true ? true : undefined,
      isDelivery: data.isDelivery === true ? true : undefined,
      shopId:
        typeof data.shopId === 'string' && data.shopId
          ? (data.shopId as string)
          : null,
    };
  });
  const { uidsToClean } = planUserRoleCleanup(userSnapshots, adminUid);

  return {
    collectionRefs,
    menuRefs,
    storage,
    usersTotal: usersSnap.size,
    uidsToClean,
  };
}

// -------------------------------------------------------------------
// Storage cleanup
// -------------------------------------------------------------------

async function deleteStoragePrefix(
  prefix: string,
  audit: AuditLog,
): Promise<number> {
  const bucket = getStorage().bucket();
  try {
    // `deleteFiles` paginates internally; returns void on success.
    const [files] = await bucket.getFiles({ prefix });
    const count = files.length;
    if (count === 0) {
      console.log(`  ${prefix}: 0 files ✓`);
      return 0;
    }
    await bucket.deleteFiles({ prefix, force: true });
    console.log(`  ${prefix}: ${count} files ✓`);
    return count;
  } catch (e) {
    audit.errors.push({
      phase: `storage:${prefix}`,
      message: (e as Error).message,
    });
    console.log(`  ${C.red}${prefix}: FAILED — ${(e as Error).message}${C.reset}`);
    return 0;
  }
}

// -------------------------------------------------------------------
// User role cleanup
// -------------------------------------------------------------------

async function revokeUserRoles(
  db: Firestore,
  uids: string[],
  audit: AuditLog,
): Promise<number> {
  const SLEEP_MS = 50; // gentle rate-limit for Auth API
  let revoked = 0;

  for (const uid of uids) {
    try {
      // 1. Firestore field scrub.
      const updates: Record<string, FirebaseFirestore.FieldValue> = {
        isShopOwner: FieldValue.delete(),
        isDelivery: FieldValue.delete(),
        shopId: FieldValue.delete(),
        favorites: FieldValue.delete(),
      };
      // eslint-disable-next-line no-await-in-loop
      await db.doc(`users/${uid}`).update(updates);

      // 2. Auth claims rewrite, preserving admin: true if present.
      // eslint-disable-next-line no-await-in-loop
      const userRecord = await getAuth().getUser(uid);
      const nextClaims = buildClaimsAfterRoleRevoke(
        userRecord.customClaims as Record<string, unknown> | null,
      );
      // eslint-disable-next-line no-await-in-loop
      await getAuth().setCustomUserClaims(uid, nextClaims);

      revoked++;
      process.stdout.write(`\r  role cleanup: ${revoked}/${uids.length}`);

      if (SLEEP_MS > 0) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(r => setTimeout(r, SLEEP_MS));
      }
    } catch (e) {
      audit.errors.push({
        phase: 'user-role-cleanup',
        message: `${uid}: ${(e as Error).message}`,
        failedRefs: [uid],
      });
    }
  }
  if (uids.length > 0) process.stdout.write(' ✓\n');
  else console.log(`  role cleanup: 0/0 ✓`);
  return revoked;
}

// -------------------------------------------------------------------
// Interactive confirmation
// -------------------------------------------------------------------

async function promptDelete(): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => {
    rl.question(
      `\n${C.yellow}This will permanently delete the data above.\n` +
        `Type DELETE (case-sensitive) to confirm: ${C.reset}`,
      answer => {
        rl.close();
        resolve(answer === 'DELETE');
      },
    );
  });
}

// -------------------------------------------------------------------
// Admin UID resolution
// -------------------------------------------------------------------

/**
 * Resolve the admin UID from (in priority order):
 *   1. `--admin-uid=<uid>` flag
 *   2. `ADMIN_PROTECT_UID` env var
 *   3. Firestore lookup: `users` where `isAdmin === true` (single match)
 *
 * Throws if all three fail. The lookup branch is intentionally
 * strict — multiple matches abort rather than guessing.
 */
async function resolveAdminUid(
  db: Firestore,
  flagUid: string | null,
): Promise<string> {
  const fromFlag = flagUid?.trim();
  if (fromFlag) return fromFlag;

  const fromEnv = (process.env.ADMIN_PROTECT_UID ?? '').trim();
  if (fromEnv) return fromEnv;

  // Last resort: query users collection.
  const adminsSnap = await db
    .collection('users')
    .where('isAdmin', '==', true)
    .get();
  if (adminsSnap.size === 1) {
    return adminsSnap.docs[0].id;
  }
  if (adminsSnap.size === 0) {
    throw new Error(
      'REFUSING TO RUN. No admin UID could be detected.\n' +
        'Set ADMIN_PROTECT_UID env var, or pass --admin-uid=<uid>.\n' +
        'Find your UID in Firebase Console → Authentication → Users.',
    );
  }
  throw new Error(
    'REFUSING TO RUN. Multiple users have isAdmin=true; cannot auto-pick.\n' +
      'Set ADMIN_PROTECT_UID env var to the specific UID to preserve.',
  );
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------

async function main(): Promise<number> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  // 1. Parse flags first so a bad flag aborts before firebase init.
  const flags = parseFlags(process.argv.slice(2));

  // 2. Init firebase-admin against the dev service account.
  const sa = loadServiceAccount();
  initializeApp({
    credential: cert(sa as any),
    storageBucket: `${sa.project_id}.firebasestorage.app`,
  });
  const db = getFirestore();

  // 3. Project allowlist guard — FIRST thing after init.
  assertProjectAllowed(sa.project_id);

  // 4. Resolve admin UID (flag > env > Firestore lookup).
  const adminUid = await resolveAdminUid(db, flags.adminUid);

  banner(`reset-pilot-data — project: ${sa.project_id}`);
  console.log(`  service account: ${sa.client_email}`);
  console.log(`  protected admin UID: ${adminUid}`);
  console.log(
    `  mode: ${flags.execute ? `${C.red}EXECUTE${C.reset}` : `${C.green}dry-run${C.reset}`}`,
  );
  if (flags.skipStorage) {
    console.log(`  ${C.cyan}--skip-storage${C.reset}: Storage cleanup will be skipped`);
  }

  // 5. Service account scope sanity check (warn-only).
  if (sa.client_email.includes('prod') || !sa.client_email.includes('dev')) {
    console.log(
      `\n${C.yellow}WARNING${C.reset}: service account email does not contain "dev".\n` +
        '  Double-check you are running against the intended project.',
    );
  }

  // 6. Gather the plan (also runs in dry-run).
  banner('Discovering data to delete');
  const plan = await gatherPlan(db, adminUid, flags);

  // Build a planned-counts shell for the audit log.
  const plannedCounts: Record<string, number> = {};
  for (const name of COLLECTIONS_TO_WIPE) {
    plannedCounts[name] = plan.collectionRefs[name]?.length ?? 0;
  }

  banner(flags.execute ? 'Plan' : 'DRY RUN — nothing will be deleted');
  console.log(`  Collections to wipe:`);
  for (const name of COLLECTIONS_TO_WIPE) {
    const n = plannedCounts[name];
    const extra = name === 'shops' ? ` (+ ${plan.menuRefs.length} menu subdocs)` : '';
    console.log(`    ${name.padEnd(24)} ${n} docs${extra}`);
  }
  console.log('');
  console.log(`  Storage to wipe:`);
  for (const prefix of STORAGE_PATHS_TO_WIPE) {
    const s = plan.storage[prefix];
    const mb = (s.bytes / 1024 / 1024).toFixed(1);
    const note = flags.skipStorage ? ` ${C.dim}(--skip-storage)${C.reset}` : '';
    console.log(`    ${prefix.padEnd(24)} ${s.files} files (${mb} MB)${note}`);
  }
  console.log('');
  console.log(`  Users:`);
  console.log(`    users to keep:           ${plan.usersTotal} (incl. admin)`);
  console.log(
    `    role claims to revoke:   ${plan.uidsToClean.length} non-admin user(s)`,
  );
  console.log('');
  console.log(`  ${C.dim}Would preserve:${C.reset}`);
  console.log(`  ${C.dim}  /users          — all profile + auth data${C.reset}`);
  console.log(`  ${C.dim}  /aiFeatures     — kill-switch docs intact${C.reset}`);
  console.log(`  ${C.dim}  Admin UID       — ${adminUid}, claims preserved${C.reset}`);

  // Initialise the audit log shell.
  const audit: AuditLog = {
    scriptVersion: '1.0.0',
    gitSha: gitSha(),
    operator: gitOperator(),
    projectId: sa.project_id,
    serviceAccountEmail: sa.client_email,
    startedAt,
    finishedAt: null,
    dryRun: !flags.execute,
    flags,
    plan: {
      collections: plannedCounts,
      menuSubdocs: plan.menuRefs.length,
      storage: plan.storage,
      usersTotal: plan.usersTotal,
      rolesToRevoke: plan.uidsToClean.length,
    },
    actual: {
      collections: Object.fromEntries(
        COLLECTIONS_TO_WIPE.map(n => [n, 0]),
      ),
      menuSubdocs: 0,
      storage: Object.fromEntries(STORAGE_PATHS_TO_WIPE.map(p => [p, 0])),
      rolesRevoked: 0,
    },
    affectedUids: plan.uidsToClean.slice(),
    errors: [],
  };

  if (!flags.execute) {
    console.log(`\n${C.dim}To actually delete, re-run with --execute.${C.reset}`);
    audit.finishedAt = new Date().toISOString();
    const logPath = writeAuditLog(audit);
    console.log(`${C.dim}Audit log: ${logPath}${C.reset}`);
    console.log(`${C.dim}Elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s${C.reset}`);
    return 0;
  }

  // No-op short-circuit.
  const totalDocs =
    Object.values(plannedCounts).reduce((a, b) => a + b, 0) +
    plan.menuRefs.length;
  const totalStorage = Object.values(plan.storage).reduce(
    (a, b) => a + b.files,
    0,
  );
  const totalRoleCleanup = plan.uidsToClean.length;
  if (totalDocs === 0 && totalStorage === 0 && totalRoleCleanup === 0) {
    console.log(`\n${C.green}✓ Nothing to delete. Idempotent no-op.${C.reset}`);
    audit.finishedAt = new Date().toISOString();
    const logPath = writeAuditLog(audit);
    console.log(`${C.dim}Audit log: ${logPath}${C.reset}`);
    return 0;
  }

  // 7. Interactive confirmation unless --yes.
  if (!flags.yes) {
    const ok = await promptDelete();
    if (!ok) {
      console.log(`\n${C.red}Aborted: confirmation did not match. No data touched.${C.reset}`);
      audit.finishedAt = new Date().toISOString();
      audit.errors.push({ phase: 'confirm', message: 'DELETE not typed' });
      writeAuditLog(audit);
      return 1;
    }
  }

  // 8. Deletion phases. Each updates audit.actual.
  banner('Deleting');

  // Phase A — shops/*/menu subcollections (descend BEFORE deleting parents).
  console.log(`[A] shops/*/menu subcollections`);
  {
    const r = await deleteRefsInBatches(db, plan.menuRefs, 'menu items', audit);
    audit.actual.menuSubdocs = r.deleted;
  }

  // Phase B — top-level collections (alphabetical, deterministic).
  let phaseN = 1;
  for (const name of COLLECTIONS_TO_WIPE) {
    const refs = plan.collectionRefs[name] ?? [];
    console.log(`[B${phaseN++}] ${name}`);
    // eslint-disable-next-line no-await-in-loop
    const r = await deleteRefsInBatches(db, refs, name, audit);
    audit.actual.collections[name] = r.deleted;
  }

  // Phase C — Storage prefixes.
  if (!flags.skipStorage) {
    console.log(`[C] Storage`);
    for (const prefix of STORAGE_PATHS_TO_WIPE) {
      // eslint-disable-next-line no-await-in-loop
      const n = await deleteStoragePrefix(prefix, audit);
      audit.actual.storage[prefix] = n;
    }
  } else {
    console.log(`[C] Storage ${C.dim}skipped (--skip-storage)${C.reset}`);
  }

  // Phase D — User role cleanup (Firestore field scrub + Auth claims).
  console.log(`[D] User role cleanup`);
  audit.actual.rolesRevoked = await revokeUserRoles(
    db,
    plan.uidsToClean,
    audit,
  );

  // 9. Summary + audit log.
  audit.finishedAt = new Date().toISOString();
  const logPath = writeAuditLog(audit);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  banner('Done');
  console.log(`  Audit log: ${logPath}`);
  console.log(`  Elapsed:   ${elapsed}s`);
  console.log('');
  console.log(`  ${C.dim}Notes:${C.reset}`);
  console.log(
    `  ${C.dim}  • users/{uid} profile docs are intact; only role fields scrubbed.${C.reset}`,
  );
  console.log(
    `  ${C.dim}  • Affected users will land on customer home on next sign-in.${C.reset}`,
  );
  console.log(
    `  ${C.dim}  • aiFeatures kill-switches preserved — flip in console if needed.${C.reset}`,
  );

  return audit.errors.length === 0 ? 0 : 2;
}

// Only run main() when invoked as a script, not when imported by tests.
if (require.main === module) {
  main()
    .then(code => process.exit(code))
    .catch(err => {
      console.error(`\n${C.red}${err.message ?? err}${C.reset}`);
      process.exit(1);
    });
}
