/**
 * Phase 12a-v2-ii one-shot backfill: every legacy seeded shop
 * (status='active' but no menu subcollection) gets its menu populated
 * with all global products at default prices.
 *
 * Idempotent: shops that already have any menu items are skipped.
 *
 *   npm run backfill-menus
 *
 * Re-run after seeding new products if the catalog grows; existing
 * shops won't be touched (we only seed when a shop's menu is empty),
 * so newly-added products will need a separate per-shop bootstrap
 * pass. Tracked in PRELAUNCH_CHECKLIST as part of "menu maintenance"
 * follow-ups.
 */
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const serviceAccount = require('../service-account.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

type Product = {
  id: string;
  name: string;
  imageUrl: string;
  packSize: { value: number; unit: string };
  category: string;
  price: number;
  mrp: number;
};

async function bootstrapShopMenu(
  shopId: string,
  products: Product[],
): Promise<void> {
  // Firestore batches cap at 500 writes — chunk to be safe even
  // though the catalog is currently ~33 items.
  const CHUNK = 400;
  const now = Date.now();
  for (let i = 0; i < products.length; i += CHUNK) {
    const batch = db.batch();
    products.slice(i, i + CHUNK).forEach(product => {
      const ref = db.doc(`shops/${shopId}/menu/${product.id}`);
      batch.set(ref, {
        id: product.id,
        shopId,
        productId: product.id,
        name: product.name,
        imageUrl: product.imageUrl,
        packLabel: `${product.packSize.value} ${product.packSize.unit}`,
        category: product.category,
        price: product.price,
        mrp: product.mrp,
        available: true,
        stock: null,
        isCustom: false,
        createdAt: now,
        updatedAt: now,
      });
    });
    await batch.commit();
  }
}

async function main() {
  console.log('Loading products…');
  const productsSnap = await db.collection('products').get();
  const products: Product[] = productsSnap.docs.map(d => d.data() as Product);
  console.log(`  ${products.length} products in catalog.`);
  if (products.length === 0) {
    console.error('No products found — run `npm run seed` first.');
    process.exit(1);
  }

  console.log('Loading shops…');
  const shopsSnap = await db.collection('shops').get();
  console.log(`  ${shopsSnap.size} shops total.`);

  let seeded = 0;
  let skipped = 0;
  let nonActive = 0;

  for (const shopDoc of shopsSnap.docs) {
    const shop = shopDoc.data() as { status?: string; name?: string };
    const shopId = shopDoc.id;
    // Legacy seeded shops predate v2-i and may have no `status` field
    // at all. Treat undefined as active because they are visible in
    // the customer flow (the rules check uses `status == 'active'`
    // strictly, but the shops were seeded BEFORE that rule existed —
    // this script should still seed them so the menu UI works).
    const isLive = shop.status === 'active' || shop.status === undefined;
    if (!isLive) {
      nonActive += 1;
      continue;
    }
    // Idempotency check: skip if any menu items already exist.
    const existing = await db
      .collection(`shops/${shopId}/menu`)
      .limit(1)
      .get();
    if (!existing.empty) {
      console.log(
        `  · ${shopId} ${shop.name ?? ''} — already has a menu, skipping.`,
      );
      skipped += 1;
      continue;
    }
    process.stdout.write(
      `  + ${shopId} ${shop.name ?? ''} — seeding ${products.length} items… `,
    );
    await bootstrapShopMenu(shopId, products);
    process.stdout.write('done\n');
    seeded += 1;
  }

  console.log('');
  console.log(
    `Backfill summary: ${seeded} seeded, ${skipped} already had menus, ${nonActive} non-active (skipped).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
