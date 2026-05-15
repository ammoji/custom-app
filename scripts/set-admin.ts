import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const serviceAccount = require('../service-account.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const uid = process.argv[2];
if (!uid) {
  console.error('Usage: npm run set-admin -- <uid>');
  process.exit(1);
}

async function run() {
  // Merge claims so we don't drop unrelated roles (shopOwner/delivery).
  const userRecord = await getAuth().getUser(uid);
  const existing = userRecord.customClaims ?? {};
  await getAuth().setCustomUserClaims(uid, { ...existing, admin: true });

  // Mirror onto users/{uid} so the registerShop pushToAdmins query
  // (`where isAdmin == true`) can find this admin's push tokens.
  // The claim is still the auth source of truth; this mirror exists
  // purely for fan-out queries.
  await db.doc(`users/${uid}`).set({ isAdmin: true }, { merge: true });

  const user = await getAuth().getUser(uid);
  console.log(`✓ Admin claim set on ${uid} (+ users/${uid}.isAdmin mirror)`);
  console.log(`  email: ${user.email ?? '(none)'}`);
  console.log(`  claims: ${JSON.stringify(user.customClaims)}`);
  console.log('');
  console.log("NOTE: existing client tokens cached on devices won't see");
  console.log('the new claim until the next token refresh (up to 1 hour),');
  console.log('or until the user signs out and signs back in.');
}

run()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
