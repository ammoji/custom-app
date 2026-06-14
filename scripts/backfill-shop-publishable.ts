/**
 * PR-NEXT-BUNDLE-M §G — Backfill `isPublishable` + `publishGateState`
 * on shops/.
 *
 * Every existing shop predates the publish gate, so none carry the
 * denormalized `isPublishable` field. Until this runs, the Rule 5
 * fail-closed default means `listShopsPublic` hides ALL shops from
 * customers. This script computes the gate for every shop and writes
 * the result back, so already-ready shops become visible again.
 *
 * For each shop:
 *   1. Read live (non-soft-deleted) menu count from shops/{id}/menu
 *   2. Read appConfig/pilotConfig.minMenuItemsForPublish (default 5)
 *   3. Compute evaluateShopPublishStatus(...) (the SAME pure helper the
 *      triggers + callable use)
 *   4. Write isPublishable + publishGateState + computedAt
 *
 * Idempotent: re-running just recomputes the same result.
 *
 * Usage:
 *   Dry run (default):
 *     npx tsx scripts/backfill-shop-publishable.ts --admin-uid=<uid>
 *   Execute:
 *     npx tsx scripts/backfill-shop-publishable.ts --admin-uid=<uid> --execute
 *   Skip the typed-WRITE confirm:
 *     ... --execute --yes
 *
 * Safety scaffold mirrors backfill-products-status.ts:
 *   - service-account.json credential init
 *   - project allowlist (grocery-mvp-dev only)
 *   - dry-run default; --execute to write
 *   - typed "WRITE" confirm unless --yes
 *   - --admin-uid required
 *   - audit log appended to scripts/.cleanup-logs/
 */

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
// Reuse the byte-identical client mirror of the gate helper — tsx
// compiles TS on the fly so the import path resolves at runtime. The
// server copy (functions/src/shopPublishHelpers.ts) lives under a
// separate tsconfig; the client copy is the canonical importable one
// for repo-root scripts.
import {
  evaluateShopPublishStatus,
  type PublishGateInput,
} from '../src/utils/shopPublishHelpers';

// ─── Safety scaffold ────────────────────────────────────────────────────────

const ALLOWED_PROJECT = 'grocery-mvp-dev';
const DEFAULT_MIN_MENU_ITEMS = 5;

function loadServiceAccount() {
  return require('../service-account.json') as {
    project_id: string;
    client_email: string;
  };
}

// ─── Pure helpers (exported for unit tests) ──────────────────────────────────

/**
 * Build the gate input from a raw shop doc + computed menu count +
 * the configured minimum. Mirrors `buildPublishGateInput` in
 * functions/src/index.ts. Pure: no Firestore reads.
 */
export function buildBackfillGateInput(
  shop: Record<string, unknown>,
  menuItemCount: number,
  minMenuItems: number,
): PublishGateInput {
  const reg = shop.registrationData as
    | { hours?: { open?: unknown; close?: unknown } }
    | undefined;
  const hours = reg?.hours;
  const loc = shop.location as { lat?: unknown; lng?: unknown } | null | undefined;
  return {
    shopStatus: (shop.status as string | undefined) ?? 'pending',
    menuItemCount,
    hoursOpen: typeof hours?.open === 'string' ? hours.open : null,
    hoursClose: typeof hours?.close === 'string' ? hours.close : null,
    location:
      loc && typeof loc === 'object'
        ? {
            lat: typeof loc.lat === 'number' ? loc.lat : undefined,
            lng: typeof loc.lng === 'number' ? loc.lng : undefined,
          }
        : null,
    locationVerifiedAt:
      typeof shop.locationVerifiedAt === 'number'
        ? shop.locationVerifiedAt
        : null,
    forcePublishOverride: shop.forcePublishOverride === true,
    minMenuItems,
  };
}

/**
 * Build the Firestore patch for one shop. Pure + exported so the
 * backfill's write payload can be unit-tested without a live DB.
 */
export function buildShopPublishBackfillUpdate(
  shop: Record<string, unknown>,
  menuItemCount: number,
  minMenuItems: number,
  now: number = Date.now(),
): Record<string, unknown> {
  const result = evaluateShopPublishStatus(
    buildBackfillGateInput(shop, menuItemCount, minMenuItems),
  );
  return {
    isPublishable: result.isPublishable,
    publishGateState: {
      missing: result.missing,
      menuItemCount,
      signal: result.signal,
      computedAt: now,
    },
  };
}

// ─── Audit log ───────────────────────────────────────────────────────────────

function appendAuditLog(line: string): void {
  const dir = path.join(__dirname, '.cleanup-logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'backfill-shop-publishable.log');
  fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
}

// ─── Backfill logic ─────────────────────────────────────────────────────────

async function countLiveMenuItems(db: Firestore, shopId: string): Promise<number> {
  const snap = await db.collection(`shops/${shopId}/menu`).get();
  let count = 0;
  for (const doc of snap.docs) {
    const data = doc.data() as { deletedAt?: unknown };
    if (data.deletedAt == null) count += 1;
  }
  return count;
}

async function readMinMenuItems(db: Firestore): Promise<number> {
  try {
    const snap = await db.doc('appConfig/pilotConfig').get();
    const raw = (snap.data() as { minMenuItemsForPublish?: unknown } | undefined)
      ?.minMenuItemsForPublish;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return Math.floor(raw);
    }
  } catch {
    /* fall through to default */
  }
  return DEFAULT_MIN_MENU_ITEMS;
}

async function run(
  db: Firestore,
  execute: boolean,
  adminUid: string,
): Promise<void> {
  console.log(`[backfill-shop-publishable] mode=${execute ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`[backfill-shop-publishable] adminUid=${adminUid}`);

  const minMenuItems = await readMinMenuItems(db);
  console.log(`[backfill-shop-publishable] minMenuItemsForPublish=${minMenuItems}`);

  const snap = await db.collection('shops').get();
  console.log(`[backfill-shop-publishable] total shops: ${snap.size}`);

  let publishable = 0;
  let unpublishable = 0;

  const batch = db.batch();
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const menuItemCount = await countLiveMenuItems(db, doc.id);
    const update = buildShopPublishBackfillUpdate(data, menuItemCount, minMenuItems);
    if (update.isPublishable) publishable += 1;
    else unpublishable += 1;

    if (execute) {
      batch.set(doc.ref, update, { merge: true });
    } else {
      console.log(
        `  [DRY] shops/${doc.id}: isPublishable=${update.isPublishable} ` +
          `menuItems=${menuItemCount} ` +
          `missing=${JSON.stringify((update.publishGateState as any).missing)}`,
      );
    }
  }

  console.log(
    `[backfill-shop-publishable] publishable: ${publishable}, unpublishable: ${unpublishable}`,
  );

  if (execute) {
    await batch.commit();
    console.log(`[backfill-shop-publishable] committed ${snap.size} writes.`);
    appendAuditLog(
      `EXECUTE by ${adminUid}: ${snap.size} shops, ` +
        `${publishable} publishable, ${unpublishable} unpublishable.`,
    );
  }

  console.log('[backfill-shop-publishable] done.');
}

// ─── CLI entry point ──────────────────────────────────────────────────────────
// Guarded so importing this module for unit tests does NOT trigger
// service-account loading, Firestore init, or the write batch.

function confirmWrite(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => {
    rl.question('Type WRITE to confirm execute against shops/: ', answer => {
      rl.close();
      resolve(answer.trim() === 'WRITE');
    });
  });
}

async function main(): Promise<void> {
  const sa = loadServiceAccount();
  if (sa.project_id !== ALLOWED_PROJECT) {
    throw new Error(
      `Refusing: service-account.json project_id is "${sa.project_id}", expected "${ALLOWED_PROJECT}".`,
    );
  }

  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const skipConfirm = args.includes('--yes');
  const adminUidArg = args.find(a => a.startsWith('--admin-uid='));
  if (!adminUidArg) {
    console.error('Error: --admin-uid=<uid> is required.');
    process.exit(1);
  }
  const adminUid = adminUidArg.split('=')[1];
  if (!adminUid) {
    console.error('Error: --admin-uid value is empty.');
    process.exit(1);
  }

  if (execute && !skipConfirm) {
    const ok = await confirmWrite();
    if (!ok) {
      console.log('Aborted: confirmation not received.');
      process.exit(0);
    }
  }

  initializeApp({ credential: cert(sa as Parameters<typeof cert>[0]) });
  const db = getFirestore();

  await run(db, execute, adminUid).catch(err => {
    console.error('[backfill-shop-publishable] fatal:', err);
    process.exit(1);
  });
}

if (require.main === module) {
  void main();
}
