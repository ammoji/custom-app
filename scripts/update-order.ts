import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { VALID_ORDER_TRANSITIONS } from '../src/utils/orderStateMachine';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const serviceAccount = require('../service-account.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const VALID: Record<string, string[]> = VALID_ORDER_TRANSITIONS;

const [, , orderId, newStatus, ...rest] = process.argv;
const reason = rest.join(' ').trim() || undefined;

if (!orderId || !newStatus) {
  console.error('Usage: npm run update-order -- <orderId> <newStatus> [reason]');
  console.error('Valid statuses: ' + Object.keys(VALID).join(', '));
  process.exit(1);
}

async function run() {
  const ref = db.doc(`orders/${orderId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`Order ${orderId} not found`);
    process.exit(1);
  }
  const order = snap.data()!;
  const currentStatus = order.status as string;

  if (currentStatus === newStatus) {
    console.log(`Order ${orderId} already ${newStatus} (no change).`);
    process.exit(0);
  }
  if (!VALID[currentStatus]?.includes(newStatus)) {
    console.error(`Invalid transition: ${currentStatus} → ${newStatus}`);
    console.error(
      `From ${currentStatus}, allowed: ${VALID[currentStatus]?.join(', ') || '(none — terminal)'}`,
    );
    process.exit(1);
  }

  const now = Date.now();
  await ref.update({
    status: newStatus,
    updatedAt: FieldValue.serverTimestamp(),
    statusHistory: FieldValue.arrayUnion({
      status: newStatus,
      at: now,
      by: 'cli',
      ...(reason ? { reason } : {}),
    }),
  });

  console.log(`✓ Order ${orderId}: ${currentStatus} → ${newStatus}`);
  if (reason) console.log(`  reason: ${reason}`);
}

run()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
