/**
 * Set the delivery custom claim for a user.
 *
 *   npm run set-delivery -- <uid>
 *
 * Useful for testing the Phase 12b flow before the self-service UI
 * goes live, or for admin overrides post-launch.
 */
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const serviceAccount = require('../service-account.json');

initializeApp({ credential: cert(serviceAccount) });

const uid = process.argv[2];
if (!uid) {
  console.error('Usage: npm run set-delivery -- <uid>');
  process.exit(1);
}

async function run() {
  // Merge claims to preserve admin / shopOwner / shopId.
  const userRecord = await getAuth().getUser(uid);
  const existing = userRecord.customClaims ?? {};
  await getAuth().setCustomUserClaims(uid, { ...existing, delivery: true });

  const refreshed = await getAuth().getUser(uid);
  console.log(`✓ Delivery claim set on ${uid}`);
  console.log(`  email: ${refreshed.email ?? '(none)'}`);
  console.log(`  phone: ${refreshed.phoneNumber ?? '(none)'}`);
  console.log(`  claims: ${JSON.stringify(refreshed.customClaims)}`);
  console.log('');
  console.log("NOTE: existing client tokens won't see the new claim");
  console.log('until the next refresh (up to 1h), or until the user signs');
  console.log('out and signs back in.');
}

run()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
