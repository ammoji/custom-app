/**
 * PR-NEXT-BUNDLE-K §J — Remove legacy `price` field from products/.
 *
 * Early seed data may have written a `price` field onto product docs.
 * Per-shop pricing is authoritative in `shops/{shopId}/menu/` items;
 * the `price` field on the master catalog doc is misleading and is
 * removed here. The `mrp` field (suggested retail price) is kept.
 *
 * Idempotent: docs without a `price` field are skipped cleanly.
 *
 * Usage:
 *   Dry run (default):
 *     npx tsx scripts/cleanup-master-catalog-price-field.ts --admin-uid=<uid>
 *   Execute:
 *     npx tsx scripts/cleanup-master-catalog-price-field.ts --admin-uid=<uid> --execute
 *
 * Safety scaffold mirrors backfill-products-status.ts.
 */

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';

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
 * Returns `true` if the doc has a `price` field that should be removed.
 * Pure: no Firestore reads. Exported for unit tests.
 */
export function hasLegacyPriceField(
  data: Record<string, unknown> | undefined,
): boolean {
  if (!data) return false;
  return 'price' in data;
}

// ─── Cleanup logic ──────────────────────────────────────────────────────────

async function run(db: Firestore, execute: boolean, adminUid: string): Promise<void> {
  console.log(`[cleanup-master-catalog-price-field] mode=${execute ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`[cleanup-master-catalog-price-field] adminUid=${adminUid}`);

  const snap = await db.collection('products').get();
  console.log(`[cleanup-master-catalog-price-field] total docs: ${snap.size}`);

  let toClean = 0;
  let skipped = 0;

  const batch = db.batch();
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (hasLegacyPriceField(data)) {
      toClean++;
      if (execute) {
        batch.update(doc.ref, { price: FieldValue.delete() });
      } else {
        console.log(
          `  [DRY] would delete price field on products/${doc.id} (price=${data.price})`,
        );
      }
    } else {
      skipped++;
    }
  }

  console.log(
    `[cleanup-master-catalog-price-field] to clean: ${toClean}, skipped: ${skipped}`,
  );

  if (execute && toClean > 0) {
    await batch.commit();
    console.log(`[cleanup-master-catalog-price-field] committed ${toClean} writes.`);
  }

  console.log('[cleanup-master-catalog-price-field] done.');
}

// ─── CLI entry point ──────────────────────────────────────────────────────────
// Guarded so importing this module for unit tests does NOT trigger
// service-account loading, Firestore init, or the delete batch.

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
    console.error('[cleanup-master-catalog-price-field] fatal:', err);
    process.exit(1);
  });
}

if (require.main === module) {
  main();
}
