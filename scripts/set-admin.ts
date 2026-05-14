import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const serviceAccount = require('../service-account.json');

initializeApp({ credential: cert(serviceAccount) });

const uid = process.argv[2];
if (!uid) {
  console.error('Usage: npm run set-admin -- <uid>');
  process.exit(1);
}

async function run() {
  await getAuth().setCustomUserClaims(uid, { admin: true });
  const user = await getAuth().getUser(uid);
  console.log(`✓ Admin claim set on ${uid}`);
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
