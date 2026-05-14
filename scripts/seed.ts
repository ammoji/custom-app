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
  for (const shop of MOCK_SHOPS) {
    await db.collection('shops').doc(shop.id).set(shop);
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
