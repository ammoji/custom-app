/**
 * Manually set a user as the owner of a specific shop. Bypasses the
 * claimShop callable's atomicity check — intended for dev/testing,
 * re-assignment, or fixing stuck states.
 *
 *   npm run set-shop-owner -- <uid> <shopId>
 *
 * Effects:
 *   - Sets users/{uid} custom claims: { shopOwner: true, shopId }
 *     (merged onto existing claims so admin/delivery survive).
 *   - Sets shops/{shopId}.ownerUid = uid.
 *
 * Note: existing client tokens cached on the device won't see the new
 * claims until the next refresh (~1h) or until the app calls
 * authService.refreshClaims() (e.g. by signing out/in or restarting).
 */
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const serviceAccount = require('../service-account.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const uid = process.argv[2];
const shopId = process.argv[3];
if (!uid || !shopId) {
  console.error('Usage: npm run set-shop-owner -- <uid> <shopId>');
  process.exit(1);
}

async function run() {
  const shopRef = db.doc(`shops/${shopId}`);
  const shopSnap = await shopRef.get();
  if (!shopSnap.exists) {
    console.error(`Shop ${shopId} not found`);
    process.exit(1);
  }

  // Merge claims so we don't drop unrelated roles (admin, delivery).
  const userRecord = await getAuth().getUser(uid);
  const existing = userRecord.customClaims ?? {};
  await getAuth().setCustomUserClaims(uid, {
    ...existing,
    shopOwner: true,
    shopId,
  });

  await shopRef.update({
    ownerUid: uid,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Mirror the shopOwner claim into users/{uid}. Mirrors the same
  // pattern set-admin / setDeliveryStatus use so role queries (push
  // fan-out, dashboards) can be served from Firestore directly.
  await db.doc(`users/${uid}`).set(
    { isShopOwner: true, shopId },
    { merge: true },
  );

  const refreshed = await getAuth().getUser(uid);
  console.log(`✓ Shop ${shopId} → owner ${uid}`);
  console.log(`  email: ${refreshed.email ?? '(none)'}`);
  console.log(`  phone: ${refreshed.phoneNumber ?? '(none)'}`);
  console.log(`  claims: ${JSON.stringify(refreshed.customClaims)}`);
  console.log('');
  console.log("NOTE: existing client tokens won't see the new claims");
  console.log('until the next refresh (up to 1h), or until the user signs');
  console.log('out and signs back in.');
}

run()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
