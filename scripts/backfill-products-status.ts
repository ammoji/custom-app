/**
 * PR-NEXT-BUNDLE-K §A — Backfill `status: 'approved'` on products/.
 *
 * Every existing product in the `products/` collection was seeded
 * before the `status` field was introduced. This script adds
 * `status: 'approved'` to every doc that is missing the field.
 * Idempotent: docs that already have a `status` field are skipped.
 *
 * Usage:
 *   Dry run (default):
 *     npx tsx scripts/backfill-products-status.ts --admin-uid=<uid>
 *   Execute:
 *     npx tsx scripts/backfill-products-status.ts --admin-uid=<uid> --execute
 *
 * Safety scaffold mirrors scripts/backfill-review-per-dimension.ts:
 *   - service-account.json credential init
 *   - project allowlist (grocery-mvp-dev only)
 *   - dry-run default; --execute to write
 *   - --admin-uid required
 */

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

// ─── Safety scaffold ────────────────────────────────────────────────────────

const ALLOWED_PROJECT = 'grocery-mvp-dev';

function loadServiceAccount() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../service-account.json') as {
    project_id: string;
    client_email: string;
  };
}

// ─── Pure helper (exported for unit tests) ───────────────────────────────────

/**
 * Given a raw Firestore product doc, returns `true` if the
 * `status` field needs to be backfilled (missing or falsy).
 * Pure: no Firestore reads. Exported for unit tests.
 */
export function needsStatusBackfill(
  data: Record<string, unknown> | undefined,
): boolean {
  if (!data) return true;
  return !data.status;
}

// ─── Backfill logic ─────────────────────────────────────────────────────────

async function run(db: Firestore, execute: boolean, adminUid: string): Promise<void> {
  console.log(`[backfill-products-status] mode=${execute ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`[backfill-products-status] adminUid=${adminUid}`);

  const snap = await db.collection('products').get();
  console.log(`[backfill-products-status] total docs: ${snap.size}`);

  let toUpdate = 0;
  let skipped = 0;

  const batch = db.batch();
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (needsStatusBackfill(data)) {
      toUpdate++;
      if (execute) {
        batch.set(doc.ref, { status: 'approved' }, { merge: true });
      } else {
        console.log(`  [DRY] would set status=approved on products/${doc.id}`);
      }
    } else {
      skipped++;
    }
  }

  console.log(`[backfill-products-status] to update: ${toUpdate}, skipped: ${skipped}`);

  if (execute && toUpdate > 0) {
    await batch.commit();
    console.log(`[backfill-products-status] committed ${toUpdate} writes.`);
  }

  console.log('[backfill-products-status] done.');
}

// ─── CLI entry point ──────────────────────────────────────────────────────────
// Guarded so importing this module for unit tests does NOT trigger
// service-account loading, Firestore init, or the write batch.

function main(): void {
  const sa = loadServiceAccount();
  if (sa.project_id !== ALLOWED_PROJECT) {
    throw new Error(
      `Refusing: service-account.json project_id is "${sa.project_id}", expected "${ALLOWED_PROJECT}".`,
    );
  }

  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
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

  initializeApp({ credential: cert(sa as Parameters<typeof cert>[0]) });
  const db = getFirestore();

  run(db, execute, adminUid).catch(err => {
    console.error('[backfill-products-status] fatal:', err);
    process.exit(1);
  });
}

if (require.main === module) {
  main();
}
