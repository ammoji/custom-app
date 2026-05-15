import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { MOCK_PRODUCTS } from '../src/mocks/products';
import { MOCK_SHOPS } from '../src/mocks/shops';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const serviceAccount = require('../service-account.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function seed() {
  console.log(`Seeding ${MOCK_SHOPS.length} shops...`);
  // Pre-existing demo shops are stamped status='active' so the customer
  // browsing flow keeps working through the Phase 12a-v2 redesign.
  // They are flagged (status set + ownerUid: null) and will be deleted
  // by a cleanup script before family role-play. Real shops created via
  // registerShop go through pending → active and never use this path.
  const placeholderRegistration = {
    phone: '+91-0000000000',
    hours: { open: '09:00', close: '21:00' },
    gstNumber: null,
    fssaiLicense: null,
    submittedAt: Date.now(),
  };
  for (const shop of MOCK_SHOPS) {
    await db
      .collection('shops')
      .doc(shop.id)
      .set(
        {
          ...shop,
          ownerUid: null,
          status: 'active',
          registrationData: placeholderRegistration,
        },
        { merge: true },
      );
    console.log(`  ✓ ${shop.id} ${shop.name}`);
  }
  console.log(`Seeding ${MOCK_PRODUCTS.length} products...`);
  for (const product of MOCK_PRODUCTS) {
    await db.collection('products').doc(product.id).set(product);
  }
  console.log('Done.');
}

seed()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
