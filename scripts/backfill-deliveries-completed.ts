/**
 * PR-NEXT-BUNDLE-G §A — Backfill script
 *
 * Iterates all orders with status='delivered', counts per deliveryPersonId,
 * and writes `deliveriesCompleted` to the users/{uid} doc.
 *
 * Usage: npx ts-node scripts/backfill-deliveries-completed.ts
 *
 * Safe to run multiple times — uses set({merge:true}) so subsequent runs
 * converge to the correct count.
 */

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { computeDeliveriesCompleted } from '../functions/src/deliveriesCompletedHelpers';

// PR-NEXT-BUNDLE-G §A — DO NOT REMOVE. Service-account init pattern
// mirrors reset-keep-catalog.ts. Bare `admin.initializeApp()` fell
// back to Application Default Credentials which aren't set up on
// Sudhir's local machine — the script needs the service-account.json
// at the repo root to authenticate as the admin service account.
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
initializeApp({ credential: cert(sa as any), projectId: sa.project_id });
const db = getFirestore();

async function run() {
  console.log('[backfill-deliveries-completed] Fetching delivered orders…');
  const snap = await db
    .collection('orders')
    .where('status', '==', 'delivered')
    .get();

  console.log(`[backfill-deliveries-completed] Found ${snap.size} delivered orders.`);

  const orders = snap.docs.map(d => ({
    deliveryPersonId: d.data().deliveryPersonId ?? null,
    status: 'delivered',
  }));

  const counts = computeDeliveriesCompleted(orders);
  console.log(`[backfill-deliveries-completed] ${counts.size} unique partners.`);

  const BATCH_SIZE = 400;
  const entries = Array.from(counts.entries());
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const [uid, count] of entries.slice(i, i + BATCH_SIZE)) {
      batch.set(
        db.doc(`users/${uid}`),
        { deliveriesCompleted: count },
        { merge: true },
      );
    }
    await batch.commit();
    console.log(
      `[backfill-deliveries-completed] Wrote batch ${Math.floor(i / BATCH_SIZE) + 1}`,
    );
  }

  console.log('[backfill-deliveries-completed] Done.');
}

run().catch(err => {
  console.error('[backfill-deliveries-completed] Fatal:', err);
  process.exit(1);
});
