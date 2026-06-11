/**
 * One-shot reset script — wipes transactional + state-derived data
 * while preserving the catalog (shops + their menu subcollections),
 * the products SKU library, and user identity (auth + claims).
 *
 *   npx tsx scripts/reset-keep-catalog.ts                  # dry-run
 *   npx tsx scripts/reset-keep-catalog.ts --execute        # actually delete
 *   npx tsx scripts/reset-keep-catalog.ts --execute --yes  # skip typed prompt
 *
 * Use when you want a clean slate to retest end-to-end flows but
 * don't want to re-seed shops, re-build menus, or re-onboard the
 * same testers. Shop owners stay shop owners, delivery partners
 * stay delivery partners, admin stays admin — they just won't see
 * any past orders, requests, or saved customer addresses.
 *
 * Companion to:
 *   - reset-pilot-data.ts  → wipes shops too (full pilot reset between phases)
 *   - reset-test-data.ts   → nukes users + auth (full project wipe)
 *   - delete-orders-only.ts → orders only, nothing else
 *
 * Sudhir's June 1 2026 ask: "delete all the data except shop, items"
 * with confirmed scope = also keep users + products + push tokens.
 *
 * Safety guards (mirrored from reset-pilot-data.ts):
 *   - Project allowlist (grocery-mvp-dev only)
 *   - Admin UID protection — admin's user doc + claims untouched
 *   - Dry-run by default; --execute required to delete
 *   - Typed "DELETE" confirmation unless --yes
 *   - Audit log at scripts/.cleanup-logs/{ISO-timestamp}-keep-catalog.json
 *
 * One-shot (not unit-tested) — for a permanent --keep-shops flag on
 * reset-pilot-data.ts, draft a PR. This script lives until that flag
 * lands, then delete.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
// PR 39.2 — DO NOT REMOVE. Live-pilot guard helpers used in main() below.
import {
  buildLivePilotRefuseBanner,
  evaluateLivePilotGuard,
  parsePilotStatusFlag,
} from './livePilotGuardHelpers';

const ALLOWED_PROJECT = 'grocery-mvp-dev';
const BATCH_SIZE = 400; // under Firestore's 500/batch cap

// Transactional collections — wiped entirely.
const COLLECTIONS_TO_WIPE = [
  'aiAuditLog',
  'aiQuotas',
  'auditLog',
  'deliveryRequests',
  'featureUsageLog',
  'orders',
  'pendingShopRequests',
  'razorpayWebhookEvents',
  'refunds',
] as const;

// Per-user fields cleared on every user doc EXCEPT the protected admin uid.
// Identity (displayName, phoneNumber via auth) + role claims + push tokens stay.
const USER_FIELDS_TO_CLEAR = [
  'addresses',
  'favorites',
  'defaultAddressId',
  'currentLocation',
  'currentLocationUpdatedAt',
  // Delivery rating rollups reference orders that no longer exist
  // → would render "⭐ 4.8 · 142 deliveries" against zero orders
  // after the wipe (PARTNER-CARD.2 reads these). Reset to clean.
  'deliveryRatingAvg',
  'deliveryRatingCount',
] as const;

// Per-shop fields cleared on every shop doc. Rating rollups reference
// orders that no longer exist → leave the shop list with stale stars
// against zero ratings. Clear so ShopCard / ShopDetail show "New shop
// · be the first to rate" or whatever the empty-state copy is.
const SHOP_FIELDS_TO_CLEAR = ['ratingAvg', 'ratingCount'] as const;

// -------------------------------------------------------------------
// Terminal output (no chalk dep — plain ANSI escapes)
// -------------------------------------------------------------------
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
};

type Flags = {
  execute: boolean;
  yes: boolean;
  adminUid: string | null;
  // PR 39.2 — explicit operator acknowledgement that pilot is
  // live and they intend disaster recovery. NEVER use this
  // casually; the live-pilot guard exists for a reason.
  iKnowPilotIsLive: boolean;
};

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { execute: false, yes: false, adminUid: null, iKnowPilotIsLive: false };
  for (const raw of argv) {
    if (raw === '--execute') flags.execute = true;
    else if (raw === '--yes') flags.yes = true;
    else if (raw === '--i-know-pilot-is-live') flags.iKnowPilotIsLive = true;
    else if (raw.startsWith('--admin-uid=')) {
      const v = raw.slice('--admin-uid='.length).trim();
      if (!v) throw new Error('--admin-uid= requires a value');
      flags.adminUid = v;
    } else {
      throw new Error(
        `Unknown flag: "${raw}". Recognised: --execute, --yes, --admin-uid=<uid>, --i-know-pilot-is-live`,
      );
    }
  }
  if (flags.yes && !flags.execute) {
    throw new Error(
      '--yes requires --execute (nothing to confirm in dry-run).',
    );
  }
  return flags;
}

// -------------------------------------------------------------------
// Live-pilot guard — reads appConfig/pilotStatus with fail-CLOSED posture
// -------------------------------------------------------------------

/**
 * PR 39.2 — Read appConfig/pilotStatus.isLive from Firestore.
 * Fail-CLOSED: any read error is treated as isLive=true to prevent
 * an outage from bypassing the guard.
 */
async function readPilotStatusIsLive(
  db: ReturnType<typeof getFirestore>,
): Promise<boolean> {
  try {
    const snap = await db.doc('appConfig/pilotStatus').get();
    if (!snap.exists) return false; // pre-pilot — missing doc means safe
    return parsePilotStatusFlag(snap.data());
  } catch (err) {
    console.error(
      `${C.red}[livePilotGuard] flag read failed; FAILING CLOSED${C.reset}`,
      err,
    );
    return true; // can't confirm safety → treat as live
  }
}

// -------------------------------------------------------------------
// Service account
// -------------------------------------------------------------------
function loadServiceAccount() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../service-account.json') as {
    project_id: string;
    client_email: string;
  };
}

function resolveAdminUid(flagUid: string | null): string {
  const fromEnv = (process.env.ADMIN_PROTECT_UID ?? '').trim();
  const resolved = (flagUid ?? '').trim() || fromEnv;
  if (!resolved) {
    throw new Error(
      'Refusing to run without admin UID protection.\n' +
        '  Set env ADMIN_PROTECT_UID=<your-admin-uid>, OR\n' +
        '  pass --admin-uid=<your-admin-uid>',
    );
  }
  return resolved;
}

// -------------------------------------------------------------------
// Wipe planner — reports counts before deletion
// -------------------------------------------------------------------
async function planWipes(db: ReturnType<typeof getFirestore>, adminUid: string) {
  const collectionCounts: Record<string, number> = {};
  for (const col of COLLECTIONS_TO_WIPE) {
    const snap = await db.collection(col).count().get();
    collectionCounts[col] = snap.data().count;
  }

  const usersSnap = await db.collection('users').get();
  const userPlans = usersSnap.docs
    .filter(d => d.id !== adminUid)
    .map(d => {
      const data = d.data();
      const fieldsPresent = USER_FIELDS_TO_CLEAR.filter(f => data[f] !== undefined);
      return { uid: d.id, fieldsPresent };
    })
    .filter(p => p.fieldsPresent.length > 0);

  const shopsSnap = await db.collection('shops').get();
  const shopPlans = shopsSnap.docs
    .map(d => {
      const data = d.data();
      const fieldsPresent = SHOP_FIELDS_TO_CLEAR.filter(f => data[f] !== undefined);
      return { shopId: d.id, fieldsPresent };
    })
    .filter(p => p.fieldsPresent.length > 0);

  return { collectionCounts, userPlans, shopPlans };
}

function summarise(plan: Awaited<ReturnType<typeof planWipes>>) {
  console.log(`\n${C.bold}Collections to wipe${C.reset}`);
  for (const [col, n] of Object.entries(plan.collectionCounts)) {
    console.log(`  ${C.dim}${col.padEnd(28)}${C.reset} ${n} doc(s)`);
  }
  console.log(
    `\n${C.bold}Per-user field clears${C.reset}  ${C.dim}(${plan.userPlans.length} non-admin users affected)${C.reset}`,
  );
  for (const p of plan.userPlans.slice(0, 5)) {
    console.log(`  ${C.dim}${p.uid}${C.reset}  fields: ${p.fieldsPresent.join(', ')}`);
  }
  if (plan.userPlans.length > 5) {
    console.log(`  ${C.dim}… +${plan.userPlans.length - 5} more${C.reset}`);
  }
  console.log(
    `\n${C.bold}Per-shop field clears${C.reset}  ${C.dim}(${plan.shopPlans.length} shops affected)${C.reset}`,
  );
  for (const p of plan.shopPlans) {
    console.log(`  ${C.dim}${p.shopId}${C.reset}  fields: ${p.fieldsPresent.join(', ')}`);
  }
  console.log();
}

// -------------------------------------------------------------------
// Wipe executors
// -------------------------------------------------------------------
async function wipeCollection(
  db: ReturnType<typeof getFirestore>,
  name: string,
): Promise<number> {
  let deleted = 0;
  while (true) {
    const snap = await db.collection(name).limit(BATCH_SIZE).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
    process.stdout.write(`\r  ${name}: ${deleted} deleted`);
  }
  process.stdout.write(`\r  ${C.green}✓${C.reset} ${name.padEnd(28)} ${deleted} doc(s) deleted\n`);
  return deleted;
}

async function clearUserFields(
  db: ReturnType<typeof getFirestore>,
  adminUid: string,
): Promise<number> {
  const usersSnap = await db.collection('users').get();
  const patch: Record<string, FirebaseFirestore.FieldValue> = {};
  for (const f of USER_FIELDS_TO_CLEAR) patch[f] = FieldValue.delete();

  let updated = 0;
  let batch = db.batch();
  let inBatch = 0;
  for (const doc of usersSnap.docs) {
    if (doc.id === adminUid) continue;
    const data = doc.data();
    const hasAny = USER_FIELDS_TO_CLEAR.some(f => data[f] !== undefined);
    if (!hasAny) continue;
    batch.update(doc.ref, patch);
    updated += 1;
    inBatch += 1;
    if (inBatch >= BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
      process.stdout.write(`\r  user field clears: ${updated} updated`);
    }
  }
  if (inBatch > 0) await batch.commit();
  process.stdout.write(`\r  ${C.green}✓${C.reset} user field clears        ${updated} doc(s) updated\n`);
  return updated;
}

async function clearShopFields(
  db: ReturnType<typeof getFirestore>,
): Promise<number> {
  const shopsSnap = await db.collection('shops').get();
  const patch: Record<string, FirebaseFirestore.FieldValue> = {};
  for (const f of SHOP_FIELDS_TO_CLEAR) patch[f] = FieldValue.delete();

  let updated = 0;
  let batch = db.batch();
  let inBatch = 0;
  for (const doc of shopsSnap.docs) {
    const data = doc.data();
    const hasAny = SHOP_FIELDS_TO_CLEAR.some(f => data[f] !== undefined);
    if (!hasAny) continue;
    batch.update(doc.ref, patch);
    updated += 1;
    inBatch += 1;
    if (inBatch >= BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();
  console.log(`  ${C.green}✓${C.reset} shop field clears        ${updated} doc(s) updated`);
  return updated;
}

// -------------------------------------------------------------------
// Confirmation prompt
// -------------------------------------------------------------------
async function promptTypedConfirm(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(
      `\n${C.yellow}Type ${C.bold}DELETE${C.reset}${C.yellow} to confirm: ${C.reset}`,
      ans => {
        rl.close();
        resolve(ans.trim() === 'DELETE');
      },
    );
  });
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------
async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const sa = loadServiceAccount();

  if (sa.project_id !== ALLOWED_PROJECT) {
    throw new Error(
      `Refusing: service-account.json project_id is "${sa.project_id}", expected "${ALLOWED_PROJECT}".`,
    );
  }

  const adminUid = resolveAdminUid(flags.adminUid);

  initializeApp({ credential: cert(sa as any), projectId: sa.project_id });
  const db = getFirestore();

  // PR 39.2 — Live-pilot guard. Runs in both dry-run and execute
  // modes so operators see the refuse banner before they ever
  // pass --execute.
  const isLive = await readPilotStatusIsLive(db);
  const verdict = evaluateLivePilotGuard({
    isLive,
    overrideAcknowledged: flags.iKnowPilotIsLive,
  });

  if (!verdict.ok) {
    console.error('\n' + buildLivePilotRefuseBanner() + '\n');
    process.exit(1);
  }

  if (verdict.reason === 'override_acknowledged') {
    console.log(`\n${C.red}${C.bold}⚠️  --i-know-pilot-is-live USED${C.reset}`);
    console.log(`${C.yellow}    Pilot IS live. Operator override acknowledged.`);
    console.log(`    This action will be in the audit log.${C.reset}\n`);
  }

  console.log(
    `${C.dim}  pilot guard   isLive=${isLive} verdict=${verdict.reason}${C.reset}`,
  );

  console.log(`\n${C.bold}${C.cyan}reset-keep-catalog${C.reset}`);
  console.log(`  project       ${sa.project_id}`);
  console.log(`  service acct  ${sa.client_email}`);
  console.log(`  mode          ${flags.execute ? `${C.red}EXECUTE${C.reset}` : `${C.dim}dry-run${C.reset}`}`);
  console.log(`  admin uid     ${adminUid} ${C.dim}(protected)${C.reset}`);

  console.log(`\n${C.dim}Planning wipes…${C.reset}`);
  const plan = await planWipes(db, adminUid);
  summarise(plan);

  if (!flags.execute) {
    console.log(`${C.dim}Dry-run only. Re-run with --execute to apply.${C.reset}\n`);
    return;
  }

  if (!flags.yes) {
    const ok = await promptTypedConfirm();
    if (!ok) {
      console.log(`${C.red}Aborted.${C.reset}\n`);
      process.exit(1);
    }
  }

  console.log(`\n${C.bold}Wiping…${C.reset}`);
  const result: Record<string, number> = {};
  for (const col of COLLECTIONS_TO_WIPE) {
    result[col] = await wipeCollection(db, col);
  }
  result['user-field-clears'] = await clearUserFields(db, adminUid);
  result['shop-field-clears'] = await clearShopFields(db);

  // Audit log
  const logDir = join(process.cwd(), 'scripts', '.cleanup-logs');
  mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = join(logDir, `${stamp}-keep-catalog.json`);
  writeFileSync(
    logFile,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        project: sa.project_id,
        adminUidProtected: adminUid,
        // PR 39.2 — guard verdict recorded for every run (incl. dry-run).
        livePilotGuard: {
          isLive,
          overrideAcknowledged: flags.iKnowPilotIsLive,
          verdict: verdict.reason as 'pilot_not_live' | 'override_acknowledged',
        },
        result,
      },
      null,
      2,
    ),
  );

  console.log(`\n${C.green}${C.bold}Done.${C.reset}  Audit log: ${C.dim}${logFile}${C.reset}\n`);
}

main().catch(err => {
  console.error(`\n${C.red}${err?.stack ?? err}${C.reset}\n`);
  process.exit(1);
});
