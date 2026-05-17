/**
 * Strip shopOwner / shopId / delivery custom claims from a user.
 * Preserves admin and any other claims.
 *
 * Use case: an admin who accidentally accumulated extra roles during
 * dev testing (tapped "Become a delivery partner", registered a shop
 * + approved themselves, etc.) and wants to clean up. The
 * UserManagement UI's revokeShopOwner / revokeDelivery callables
 * refuse self-modification (over-broad protection — original concern
 * was admin lockout, but the rule blocks all self-modifications),
 * so this script is the escape hatch.
 *
 * Safety:
 *   - Refuses to run if the target is not currently an admin. This
 *     ensures we can never accidentally strip someone's ONLY role
 *     and leave them claimless. Use the UserManagement UI for
 *     non-admin role revokes (admin can revoke from anyone else).
 *   - Refuses if no UID is passed.
 *   - Prints before/after claims so the operator can verify.
 *
 * The auth-UX PR (docs/auth-ux-and-profile-windsurf-prompt.md)
 * loosens the over-broad self-protection so admins can self-revoke
 * non-admin claims via the UI. Once that ships, this script becomes
 * unnecessary for routine use — keep it around as the operator-side
 * recovery tool.
 *
 * Usage:
 *   npm run revoke-extra-roles -- <uid>
 *
 * Find a UID: Firebase Console → Authentication → Users → search by
 * phone → copy the User UID column.
 */
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const serviceAccount = require('../service-account.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const uid = process.argv[2];
if (!uid) {
  console.error('Usage: npm run revoke-extra-roles -- <uid>');
  console.error('');
  console.error(
    'Strips shopOwner, shopId, and delivery claims from the target.',
  );
  console.error(
    'Preserves admin (and any other unknown claims). Refuses if the',
  );
  console.error(
    'target is not currently an admin — this script is for admins who',
  );
  console.error(
    'accidentally accumulated extra roles during dev testing.',
  );
  process.exit(1);
}

async function run() {
  const before = await getAuth().getUser(uid);
  const existing = (before.customClaims ?? {}) as Record<string, unknown>;

  if (!existing.admin) {
    console.error(`✗ Refusing: ${uid} is not currently an admin.`);
    console.error('');
    console.error(
      '  This script only strips extra roles from admins (so admin always',
    );
    console.error(
      '  remains as the safety net). To revoke shopOwner / delivery from a',
    );
    console.error(
      '  non-admin user, use the User Management UI — admin can revoke from',
    );
    console.error('  anyone else, just not from themselves.');
    process.exit(1);
  }

  // Strip the role claims, preserve everything else.
  const {
    shopOwner: _shopOwner,
    shopId: _shopId,
    delivery: _delivery,
    ...keep
  } = existing;
  // Explicitly mark unused destructured names so eslint is happy.
  void _shopOwner;
  void _shopId;
  void _delivery;

  await getAuth().setCustomUserClaims(uid, keep);

  // Clear deliveryStatus on the users/{uid} mirror — that field is
  // meaningless once the delivery claim is gone, and leaving it set to
  // 'online' would cause sendNewPickupPushToDelivery to keep trying to
  // push to this user.
  await db.doc(`users/${uid}`).set({ deliveryStatus: null }, { merge: true });

  const after = await getAuth().getUser(uid);
  console.log(`✓ Stripped extra roles from ${uid}`);
  console.log(`  before: ${JSON.stringify(before.customClaims)}`);
  console.log(`  after:  ${JSON.stringify(after.customClaims)}`);
  console.log('');
  console.log("NOTE: existing client tokens cached on devices won't see");
  console.log('the new claims until the next token refresh (up to 1 hour),');
  console.log('or until the user signs out and signs back in. Force-close');
  console.log('the app twice on the affected device to refresh sooner.');
}

run()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
