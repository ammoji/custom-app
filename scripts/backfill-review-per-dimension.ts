/**
 * PR-NEXT-BUNDLE-J §J — Per-dimension correction-state backfill.
 *
 * Populates shopCorrectionState / deliveryCorrectionState (+ per-dimension
 * response fields) on every review doc AND its order doc, derived from the
 * legacy single correctionState. Idempotent (set({ merge: true })).
 *
 * Why: Bundle J splits the single review correctionState into independent
 * shop + delivery states. Pre-Bundle-J reviews only have the legacy field;
 * the attention-queue callables + customer panel now read the per-dimension
 * fields, so un-migrated reviews would vanish from queues. This replays the
 * best-effort reconstruction onto every existing doc.
 *
 * Usage:
 *   Dry run (default):
 *     npx tsx scripts/backfill-review-per-dimension.ts --admin-uid=<uid>
 *   Execute:
 *     npx tsx scripts/backfill-review-per-dimension.ts --admin-uid=<uid> --execute
 *
 * Safety scaffold mirrors scripts/backfill-review-denorm.ts:
 *   - service-account.json credential init
 *   - project allowlist (grocery-mvp-dev only)
 *   - dry-run default; --execute to write
 *   - --admin-uid required
 */

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { deriveBackfillPerDimension } from '../functions/src/reviewDenormHelpers';

// ─── Safety scaffold ────────────────────────────────────────────────────────

const ALLOWED_PROJECT = 'grocery-mvp-dev';

function loadServiceAccount() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../service-account.json') as {
    project_id: string;
    client_email: string;
  };
}

const sa = loadServiceAccount();
if (sa.project_id !== ALLOWED_PROJECT) {
  throw new Error(
    `Refusing: service-account.json project_id is "${sa.project_id}", expected "${ALLOWED_PROJECT}".`,
  );
}

// ─── CLI args ───────────────────────────────────────────────────────────────

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

if (!execute) {
  console.log('[backfill-review-per-dimension] DRY RUN — pass --execute to write');
}

initializeApp({ credential: cert(sa as any), projectId: sa.project_id });
const db = getFirestore();

// ─── Main ───────────────────────────────────────────────────────────────────

async function run() {
  console.log('[backfill-review-per-dimension] Fetching all review docs…');
  const reviewsSnap = await db.collection('reviews').get();
  console.log(`[backfill-review-per-dimension] Found ${reviewsSnap.size} reviews.`);

  let touched = 0;
  let skipped = 0;
  let alreadyMigrated = 0;
  let errors = 0;

  const BATCH_SIZE = 400;
  let batch = db.batch();
  let batchCount = 0;

  for (const reviewDoc of reviewsSnap.docs) {
    const rev = reviewDoc.data() as Record<string, unknown>;

    // Idempotency: skip reviews that already carry both per-dimension fields.
    if (
      rev.shopCorrectionState !== undefined &&
      rev.deliveryCorrectionState !== undefined
    ) {
      alreadyMigrated++;
      continue;
    }

    const orderId = rev.orderId;
    if (typeof orderId !== 'string' || !orderId) {
      console.warn(`[backfill-review-per-dimension] Review ${reviewDoc.id} missing orderId — skip`);
      skipped++;
      continue;
    }

    const perDim = deriveBackfillPerDimension(rev);
    const reviewPayload = { ...perDim, updatedAt: FieldValue.serverTimestamp() };
    const orderPayload = { ...perDim, updatedAt: FieldValue.serverTimestamp() };

    if (execute) {
      batch.set(reviewDoc.ref, reviewPayload, { merge: true });
      batch.set(db.doc(`orders/${orderId}`), orderPayload, { merge: true });
      batchCount += 2;
      touched++;
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        console.log(`[backfill-review-per-dimension] Committed batch of ${batchCount}`);
        batch = db.batch();
        batchCount = 0;
      }
    } else {
      console.log(
        `[backfill-review-per-dimension] [DRY] reviews/${reviewDoc.id} + orders/${orderId}:`,
        JSON.stringify(perDim),
      );
      touched++;
    }
  }

  if (execute && batchCount > 0) {
    await batch.commit();
    console.log(`[backfill-review-per-dimension] Committed final batch of ${batchCount}`);
  }

  console.log(
    `[backfill-review-per-dimension] Done. ` +
      `touched=${touched}, alreadyMigrated=${alreadyMigrated}, skipped=${skipped}, errors=${errors}`,
  );
  if (!execute) {
    console.log('[backfill-review-per-dimension] Re-run with --execute to apply writes.');
  }
}

run().catch(err => {
  console.error('[backfill-review-per-dimension] Fatal:', err);
  process.exit(1);
});
