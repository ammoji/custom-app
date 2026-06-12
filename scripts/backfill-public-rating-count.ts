/**
 * PR-NEXT-BUNDLE-G §C — Backfill script
 *
 * Iterates all reviews with correctionState='published', counts per
 * shopId → shops/{shopId}.publicRatingCount, and per deliveryPersonId
 * → users/{uid}.publicDeliveryRatingCount.
 *
 * Usage: npx ts-node scripts/backfill-public-rating-count.ts
 *
 * Safe to run multiple times — set({merge:true}) converges to correct count.
 */

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  countPublishedShopReviews,
  countPublishedPartnerReviews,
} from '../functions/src/publicCountHelpers';

// PR-NEXT-BUNDLE-G §C — DO NOT REMOVE. Service-account init pattern
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
  console.log('[backfill-public-rating-count] Fetching published reviews…');
  const snap = await db
    .collection('reviews')
    .where('correctionState', '==', 'published')
    .get();

  console.log(`[backfill-public-rating-count] Found ${snap.size} published reviews.`);

  const reviews = snap.docs.map(d => ({
    shopId: d.data().shopId ?? null,
    deliveryPersonId: d.data().deliveryPersonId ?? null,
    correctionState: 'published',
  }));

  // Collect unique shopIds and partnerUids
  const shopIds = new Set<string>(reviews.map(r => r.shopId).filter(Boolean) as string[]);
  const partnerUids = new Set<string>(
    reviews.map(r => r.deliveryPersonId).filter(Boolean) as string[],
  );

  console.log(
    `[backfill-public-rating-count] ${shopIds.size} shops, ${partnerUids.size} partners.`,
  );

  const BATCH_SIZE = 400;

  // --- Shops ---
  const shopEntries = Array.from(shopIds).map(shopId => ({
    shopId,
    count: countPublishedShopReviews(reviews, shopId),
  }));

  for (let i = 0; i < shopEntries.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const { shopId, count } of shopEntries.slice(i, i + BATCH_SIZE)) {
      batch.set(
        db.doc(`shops/${shopId}`),
        { publicRatingCount: count },
        { merge: true },
      );
    }
    await batch.commit();
    console.log(
      `[backfill-public-rating-count] Wrote shop batch ${Math.floor(i / BATCH_SIZE) + 1}`,
    );
  }

  // --- Partners ---
  const partnerEntries = Array.from(partnerUids).map(uid => ({
    uid,
    count: countPublishedPartnerReviews(reviews, uid),
  }));

  for (let i = 0; i < partnerEntries.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const { uid, count } of partnerEntries.slice(i, i + BATCH_SIZE)) {
      batch.set(
        db.doc(`users/${uid}`),
        { publicDeliveryRatingCount: count },
        { merge: true },
      );
    }
    await batch.commit();
    console.log(
      `[backfill-public-rating-count] Wrote partner batch ${Math.floor(i / BATCH_SIZE) + 1}`,
    );
  }

  console.log('[backfill-public-rating-count] Done.');
}

run().catch(err => {
  console.error('[backfill-public-rating-count] Fatal:', err);
  process.exit(1);
});
