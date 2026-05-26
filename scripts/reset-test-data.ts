/**
 * Destructive cleanup script for the dev Firebase project.
 *
 *   npm run reset:test-data              # dry-run (default)
 *   npm run reset:test-data -- --execute # actually delete
 *
 * Wipes test orders, test shops + their menus, test user profiles,
 * and the matching Firebase Auth users — everything that accumulates
 * during solo / automated testing on the dev project. Preserves the
 * global `/products` catalog and the protected admin UID's auth
 * account + custom claims.
 *
 * See PRELAUNCH_CHECKLIST.md → "Resetting test data" for the full
 * spec, safety guards, and operator instructions. See
 * scripts/reset-test-data.helpers.ts for the pure logic that's unit
 * tested under tests/scripts/.
 *
 * This file is intentionally a thin wiring layer:
 *   - argv → parseFlags                        (testable)
 *   - service account → assertProjectAllowed   (testable)
 *   - admin UID → protectAdminFromUserList     (testable)
 *   - counts → buildDeletionPlan               (testable)
 *   - rest of main() is firebase-admin glue    (proved by dry-run
 *                                               + manual abort demos)
 *
 * Per `.windsurf/test-discipline.md`: run `npm test` once at the end
 * of any change to this file.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type {
  Firestore,
  QueryDocumentSnapshot,
  WriteBatch,
} from 'firebase-admin/firestore';
import type { UserRecord } from 'firebase-admin/auth';

import {
  ALLOWED_PROJECTS,
  assertProjectAllowed,
  buildDeletionPlan,
  parseFlags,
  protectAdminFromUserList,
  type CollectionCounts,
  type DeletionPlan,
  type ResetFlags,
} from './reset-test-data.helpers';

// Re-export so tests can `import { ... } from '../../scripts/reset-test-data'`
// without forcing the firebase-admin side-effect path. (Tests import
// from the helpers module directly; this re-export is a convenience
// for future callers that want one stable import surface.)
export {
  ALLOWED_PROJECTS,
  assertProjectAllowed,
  buildDeletionPlan,
  parseFlags,
  protectAdminFromUserList,
};
export type { CollectionCounts, DeletionPlan, ResetFlags };

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
// Service account + project guard
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
// Firestore deletion helpers
// -------------------------------------------------------------------

/**
 * Delete a list of doc refs in batches of 500. On batch failure, log
 * the failed doc IDs and continue with the next batch — partial
 * state with a complete audit trail is strictly better than a crash
 * mid-run with no record of what got deleted.
 */
async function deleteRefsInBatches(
  db: Firestore,
  refs: FirebaseFirestore.DocumentReference[],
  label: string,
  auditLog: AuditLog,
): Promise<{ deleted: number; failed: string[] }> {
  const BATCH_SIZE = 500;
  let deleted = 0;
  const failed: string[] = [];

  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const slice = refs.slice(i, i + BATCH_SIZE);
    const batch: WriteBatch = db.batch();
    for (const ref of slice) batch.delete(ref);
    try {
      await batch.commit();
      deleted += slice.length;
      process.stdout.write(`\r  ${label}: ${deleted}/${refs.length}`);
    } catch (e) {
      const ids = slice.map(r => r.path);
      failed.push(...ids);
      auditLog.errors.push({
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
// Counting (used by both dry-run and pre-execute preview)
// -------------------------------------------------------------------

async function gatherCounts(
  db: Firestore,
  adminUid: string,
): Promise<{
  counts: CollectionCounts;
  refs: {
    orders: FirebaseFirestore.DocumentReference[];
    shops: QueryDocumentSnapshot[];
    menu: FirebaseFirestore.DocumentReference[];
    users: FirebaseFirestore.DocumentReference[];
    authUsers: UserRecord[];
  };
}> {
  const [ordersSnap, shopsSnap, usersSnap] = await Promise.all([
    db.collection('orders').get(),
    db.collection('shops').get(),
    db.collection('users').get(),
  ]);

  // Menu subcollections — traverse explicitly per spec (no
  // db.recursiveDelete) so the audit log can record per-shop counts
  // if we ever need them.
  const menuRefs: FirebaseFirestore.DocumentReference[] = [];
  for (const shopDoc of shopsSnap.docs) {
    const menuSnap = await shopDoc.ref.collection('menu').get();
    for (const m of menuSnap.docs) menuRefs.push(m.ref);
  }

  // Auth users — paginate; the SDK caps each page at 1000.
  const authUsers: UserRecord[] = [];
  let pageToken: string | undefined;
  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await getAuth().listUsers(1000, pageToken);
    authUsers.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);

  // Filter out the admin from user/auth deletion plans. Two separate
  // protectAdminFromUserList calls so a missing admin in EITHER list
  // aborts loudly — we never want to silently skip the safety check
  // because one side happened to be empty.
  const userDocIds = usersSnap.docs.map(d => d.id);
  const authUids = authUsers.map(u => u.uid);

  // If both lists are empty, there's nothing to protect — skip the
  // assertion. If either is non-empty, the admin MUST be present.
  const protectedUserIds =
    userDocIds.length > 0
      ? protectAdminFromUserList(userDocIds, adminUid)
      : [];
  const protectedAuthUids =
    authUids.length > 0
      ? protectAdminFromUserList(authUids, adminUid)
      : [];

  return {
    counts: {
      orders: ordersSnap.size,
      shops: shopsSnap.size,
      menu: menuRefs.length,
      users: protectedUserIds.length,
      authUsers: protectedAuthUids.length,
    },
    refs: {
      orders: ordersSnap.docs.map(d => d.ref),
      shops: shopsSnap.docs,
      menu: menuRefs,
      users: usersSnap.docs
        .filter(d => protectedUserIds.includes(d.id))
        .map(d => d.ref),
      authUsers: authUsers.filter(u => protectedAuthUids.includes(u.uid)),
    },
  };
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
  flags: ResetFlags;
  plan: DeletionPlan;
  actual: {
    orders: number;
    shops: number;
    menu: number;
    users: number;
    authUsers: number;
  };
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
  // Filename uses a Windows-safe ISO timestamp (`:` replaced with `-`).
  const fname = `${audit.startedAt.replace(/[:.]/g, '-')}.json`;
  const path = join(dir, fname);
  writeFileSync(path, JSON.stringify(audit, null, 2));
  return path;
}

// -------------------------------------------------------------------
// Interactive confirmation
// -------------------------------------------------------------------

async function promptProjectId(expected: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => {
    rl.question(
      `\n${C.yellow}This will permanently delete the data above from project\n` +
        `"${expected}". Type the project ID to confirm: ${C.reset}`,
      answer => {
        rl.close();
        resolve(answer.trim() === expected);
      },
    );
  });
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------

async function main(): Promise<number> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  // 1. Parse flags first so a bad flag aborts before we touch firebase.
  const flags = parseFlags(process.argv.slice(2));

  // 2. Resolve admin UID from flag or env. Empty here is fine — the
  //    protectAdminFromUserList call below will throw with the proper
  //    operator message.
  const adminUid =
    flags.adminUid?.trim() || (process.env.ADMIN_PROTECT_UID ?? '').trim();

  // 3. Init firebase-admin against the service account.
  const sa = loadServiceAccount();
  initializeApp({ credential: cert(sa as any) });
  const db = getFirestore();

  // 4. Project allowlist guard — FIRST thing after init.
  assertProjectAllowed(sa.project_id);

  banner(`reset-test-data — project: ${sa.project_id}`);
  console.log(`  service account: ${sa.client_email}`);
  console.log(`  protected admin UID: ${adminUid || '(unset — will abort)'}`);
  console.log(`  mode: ${flags.execute ? `${C.red}EXECUTE${C.reset}` : `${C.green}dry-run${C.reset}`}`);
  if (flags.keepShops) console.log(`  ${C.cyan}--keep-shops${C.reset}: /shops + /shops/*/menu preserved`);
  if (flags.keepOrders) console.log(`  ${C.cyan}--keep-orders${C.reset}: /orders preserved`);

  // 5. Service account scope sanity check (warn-only, per spec).
  if (sa.client_email.includes('prod') || !sa.client_email.includes('dev')) {
    console.log(
      `\n${C.yellow}WARNING${C.reset}: service account email does not contain "dev".\n` +
        '  Double-check you are running against the intended project.',
    );
  }

  // 6. Gather counts (this is also what runs in dry-run mode).
  banner('Discovering data to delete');
  const { counts, refs } = await gatherCounts(db, adminUid);
  const plan = buildDeletionPlan(counts, flags);

  banner(flags.execute ? 'Plan' : 'DRY RUN — nothing will be deleted');
  console.log(`  Orders:           ${plan.orders} docs`);
  console.log(
    `  Shops:            ${plan.shops} docs (with ${plan.menu} menu items in subcollections)`,
  );
  console.log(`  User profiles:    ${plan.users} docs (excluding admin UID ${adminUid})`);
  console.log(`  Auth users:       ${plan.authUsers} accounts (excluding admin UID ${adminUid})`);
  console.log('');
  console.log(`  ${C.dim}Would preserve:${C.reset}`);
  console.log(`  ${C.dim}  /products       — full catalog, untouched${C.reset}`);
  console.log(`  ${C.dim}  Admin UID       — ${adminUid}, claims preserved${C.reset}`);
  console.log(`  ${C.dim}  Service accounts — never touched${C.reset}`);

  // Initialise audit log shell even for dry-runs so we have a record
  // someone *looked* at the destruction plan.
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
    plan,
    actual: { orders: 0, shops: 0, menu: 0, users: 0, authUsers: 0 },
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

  if (plan.isNoOp) {
    console.log(`\n${C.green}✓ Nothing to delete. Idempotent no-op.${C.reset}`);
    audit.finishedAt = new Date().toISOString();
    const logPath = writeAuditLog(audit);
    console.log(`${C.dim}Audit log: ${logPath}${C.reset}`);
    return 0;
  }

  // 7. Interactive confirmation unless --no-confirm.
  if (!flags.noConfirm) {
    const ok = await promptProjectId(sa.project_id);
    if (!ok) {
      console.log(`\n${C.red}Aborted: project ID did not match. No data touched.${C.reset}`);
      audit.finishedAt = new Date().toISOString();
      audit.errors.push({ phase: 'confirm', message: 'project ID mismatch' });
      writeAuditLog(audit);
      return 1;
    }
  }

  // 8. Deletion phases. Each updates audit.actual.
  banner('Deleting');

  // [1/5] Orders
  console.log(`[1/5] Orders`);
  if (!flags.keepOrders) {
    const r = await deleteRefsInBatches(db, refs.orders, 'orders', audit);
    audit.actual.orders = r.deleted;
  } else {
    console.log(`  ${C.dim}skipped (--keep-orders)${C.reset}`);
  }

  // [2/5] Shop menu subcollections
  console.log(`[2/5] Shop menu subcollections`);
  if (!flags.keepShops) {
    const r = await deleteRefsInBatches(db, refs.menu, 'menu items', audit);
    audit.actual.menu = r.deleted;
  } else {
    console.log(`  ${C.dim}skipped (--keep-shops)${C.reset}`);
  }

  // [3/5] Shop docs (after their menus are gone)
  console.log(`[3/5] Shop docs`);
  if (!flags.keepShops) {
    const r = await deleteRefsInBatches(
      db,
      refs.shops.map(s => s.ref),
      'shops',
      audit,
    );
    audit.actual.shops = r.deleted;
  } else {
    console.log(`  ${C.dim}skipped (--keep-shops)${C.reset}`);
  }

  // [4/5] User profile docs
  console.log(`[4/5] User profile docs`);
  const ru = await deleteRefsInBatches(db, refs.users, 'users', audit);
  audit.actual.users = ru.deleted;

  // [5/5] Auth users — separate API, batch size 1000
  console.log(`[5/5] Firebase Auth users`);
  const AUTH_BATCH = 1000;
  let authDeleted = 0;
  for (let i = 0; i < refs.authUsers.length; i += AUTH_BATCH) {
    const slice = refs.authUsers.slice(i, i + AUTH_BATCH).map(u => u.uid);
    try {
      const res = await getAuth().deleteUsers(slice);
      authDeleted += res.successCount;
      if (res.failureCount > 0) {
        audit.errors.push({
          phase: 'auth-users',
          message: `${res.failureCount} auth deletions failed in batch`,
          failedRefs: res.errors.map(e => slice[e.index]),
        });
      }
      process.stdout.write(`\r  auth users: ${authDeleted}/${refs.authUsers.length}`);
    } catch (e) {
      audit.errors.push({
        phase: 'auth-users',
        message: (e as Error).message,
        failedRefs: slice,
      });
    }
  }
  if (refs.authUsers.length === 0) {
    console.log(`  auth users: 0/0 ✓`);
  } else if (authDeleted === refs.authUsers.length) {
    process.stdout.write(' ✓\n');
  } else {
    process.stdout.write('\n');
  }
  audit.actual.authUsers = authDeleted;

  // 9. Summary + audit log
  audit.finishedAt = new Date().toISOString();
  const logPath = writeAuditLog(audit);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  banner('Done');
  console.log(`  Audit log: ${logPath}`);
  console.log(`  Elapsed:   ${elapsed}s`);
  console.log('');
  console.log(`  ${C.dim}Notes:${C.reset}`);
  console.log(`  ${C.dim}  • Razorpay test payments remain (they're inert).${C.reset}`);
  console.log(
    `  ${C.dim}  • Firebase Auth deletions free up the test phone numbers — fresh OTPs work immediately.${C.reset}`,
  );
  console.log(
    `  ${C.dim}  • Custom claims (shopOwner, delivery) for deleted users are gone automatically; the admin claim on UID ${adminUid} is preserved.${C.reset}`,
  );
  console.log('');
  console.log(`  ${C.dim}Next step (if prepping for family role-play):${C.reset}`);
  console.log(`  ${C.dim}    1. Sign your admin phone in (custom claim already attached).${C.reset}`);
  console.log(`  ${C.dim}    2. Family members sign in fresh on test phone numbers.${C.reset}`);
  console.log(`  ${C.dim}    3. Phones B & C register shops via "Open a shop on HamaraSetu".${C.reset}`);
  console.log(`  ${C.dim}    4. You approve via Pending Shop Approvals → bootstrapShopMenu fires.${C.reset}`);
  console.log(`  ${C.dim}    5. Customer testing begins.${C.reset}`);

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
