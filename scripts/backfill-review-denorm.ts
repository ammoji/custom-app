/**
 * HOTFIX-REVIEW-DENORM §F — Backfill script
 *
 * Re-syncs the denormalized review fields on every order doc from
 * the source-of-truth review doc. Idempotent — set({ merge: true })
 * so running multiple times converges to the correct state.
 *
 * Usage:
 *   Dry run (default — prints planned writes, writes nothing):
 *     npx tsx scripts/backfill-review-denorm.ts --admin-uid=<uid>
 *
 *   Execute (performs actual writes):
 *     npx tsx scripts/backfill-review-denorm.ts --admin-uid=<uid> --execute
 *
 * Fields synced:
 *   correctionState, responseText, responseBy, responseAt,
 *   shopRating (if amended), deliveryRating (if amended),
 *   publishedAt, publishedReason, updatedAt
 *
 * Safety scaffold mirrors scripts/reset-keep-catalog.ts:
 *   - service-account.json credential init
 *   - project allowlist (grocery-mvp-dev only)
 *   - dry-run default; --execute to write
 *   - --admin-uid required
 */

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { deriveDenormFromReview } from '../functions/src/reviewDenormHelpers';

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
  console.log('[backfill-review-denorm] DRY RUN — pass --execute to write');
}

initializeApp({ credential: cert(sa as any), projectId: sa.project_id });
const db = getFirestore();

// ─── Main ───────────────────────────────────────────────────────────────────

async function run() {
  console.log('[backfill-review-denorm] Fetching all review docs…');
  const reviewsSnap = await db.collection('reviews').get();
  console.log(`[backfill-review-denorm] Found ${reviewsSnap.size} reviews.`);

  let touched = 0;
  let skipped = 0;
  let mismatched = 0;
  let errors = 0;

  const BATCH_SIZE = 400;
  let batch = db.batch();
  let batchCount = 0;

  for (const reviewDoc of reviewsSnap.docs) {
    const rev = reviewDoc.data() as Record<string, unknown>;
    const orderId = rev.orderId;
    if (typeof orderId !== 'string' || !orderId) {
      console.warn(`[backfill-review-denorm] Review ${reviewDoc.id} missing orderId — skip`);
      skipped++;
      continue;
    }

    let orderSnap;
    try {
      orderSnap = await db.doc(`orders/${orderId}`).get();
    } catch (e) {
      console.warn(`[backfill-review-denorm] Could not read orders/${orderId}:`, e);
      errors++;
      continue;
    }

    if (!orderSnap.exists) {
      console.warn(`[backfill-review-denorm] orders/${orderId} not found — skip`);
      skipped++;
      continue;
    }

    const order = orderSnap.data() as Record<string, unknown>;
    const orderState = order.correctionState ?? null;
    const reviewState = rev.correctionState ?? null;

    if (orderState !== reviewState) {
      mismatched++;
      console.log(
        `[backfill-review-denorm] MISMATCH orders/${orderId}: ` +
          `order.correctionState="${orderState}" review.correctionState="${reviewState}"`,
      );
    }

    const payload = deriveDenormFromReview(rev);
    // Stamp with current server time for updatedAt consistency.
    payload.updatedAt = FieldValue.serverTimestamp();

    if (execute) {
      batch.set(db.doc(`orders/${orderId}`), payload, { merge: true });
      batchCount++;
      touched++;

      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        console.log(`[backfill-review-denorm] Committed batch of ${batchCount}`);
        batch = db.batch();
        batchCount = 0;
      }
    } else {
      console.log(
        `[backfill-review-denorm] [DRY] Would write to orders/${orderId}:`,
        JSON.stringify(
          Object.fromEntries(
            Object.entries(payload).map(([k, v]) => [
              k,
              v && typeof v === 'object' && '_methodName' in (v as any)
                ? '<ServerTimestamp>'
                : v,
            ]),
          ),
          null,
          2,
        ),
      );
      touched++;
    }
  }

  if (execute && batchCount > 0) {
    await batch.commit();
    console.log(`[backfill-review-denorm] Committed final batch of ${batchCount}`);
  }

  console.log(
    `[backfill-review-denorm] Done. ` +
      `touched=${touched}, skipped=${skipped}, mismatched=${mismatched}, errors=${errors}`,
  );
  if (!execute) {
    console.log('[backfill-review-denorm] Re-run with --execute to apply writes.');
  }
}

run().catch(err => {
  console.error('[backfill-review-denorm] Fatal:', err);
  process.exit(1);
});
