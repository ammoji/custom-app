/**
 * Sources real product photos from Open Food Facts (OFF) and rehosts
 * them on Firebase Storage. Updates src/mocks/products.ts in place so
 * the next `npm run seed` writes the new URLs to Firestore.
 *
 * Idempotent caveat: re-running overwrites Storage objects but only
 * rewrites mocks/products.ts entries whose OFF lookup succeeds again.
 * If you've MANUALLY edited an imageUrl, do NOT re-run this script —
 * it would clobber your replacement with whatever OFF returns today.
 *
 * Usage:
 *   npm run import-images
 *
 * Requires:
 *   - service-account.json at project root (gitignored).
 *   - Firebase Storage bucket provisioned (default
 *     <project-id>.firebasestorage.app on modern projects).
 *   - storage.rules deployed so the rehosted URLs are publicly readable
 *     (see firebase.json + storage.rules).
 */

import { cert, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { MOCK_PRODUCTS } from '../src/mocks/products';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const serviceAccount = require('../service-account.json');

// Modern Firebase Storage buckets default to <project-id>.firebasestorage.app
// (older projects use .appspot.com). Override with FIREBASE_STORAGE_BUCKET
// env var if your bucket name doesn't match the default.
const storageBucket =
  process.env.FIREBASE_STORAGE_BUCKET ??
  `${serviceAccount.project_id}.firebasestorage.app`;

initializeApp({
  credential: cert(serviceAccount),
  storageBucket,
});
const bucket = getStorage().bucket();

type OFFProduct = {
  image_front_url?: string;
  image_url?: string;
};

type OFFSearchResponse = {
  products?: OFFProduct[];
};

async function searchOFF(
  brand: string | undefined,
  name: string,
): Promise<string | null> {
  const q = encodeURIComponent(`${brand ?? ''} ${name}`.trim());
  const url =
    `https://world.openfoodfacts.org/cgi/search.pl` +
    `?search_terms=${q}&json=1&page_size=5` +
    `&fields=image_front_url,image_url`;

  // OFF returns 5xx under light load. Retry up to 3 times with
  // exponential backoff (2s, 4s, 8s) before giving up.
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'grocery-mvp-image-importer/1.0 (admin@grocery-mvp.local)',
      },
    });
    if (res.ok) {
      const data = (await res.json()) as OFFSearchResponse;
      for (const product of data.products ?? []) {
        const img = product.image_front_url ?? product.image_url;
        // Skip OFF's placeholder images (filenames start with "default-").
        if (img && !img.includes('default-')) return img;
      }
      return null;
    }
    lastStatus = res.status;
    if (res.status < 500) break; // only retry 5xx
    await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
  }
  throw new Error(`OFF search failed: HTTP ${lastStatus}`);
}

// Skip products whose imageUrl already points at our Storage bucket.
// Makes re-runs idempotent and preserves manual replacements.
function alreadyRehosted(imageUrl: string): boolean {
  return imageUrl.includes('firebasestorage.googleapis.com');
}

async function downloadAndUpload(
  productId: string,
  imageUrl: string,
): Promise<string> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const tmpFile = path.join(os.tmpdir(), `${productId}.jpg`);
  await fs.writeFile(tmpFile, buffer);

  const remotePath = `products/${productId}.jpg`;
  await bucket.upload(tmpFile, {
    destination: remotePath,
    metadata: {
      contentType: 'image/jpeg',
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });
  await fs.unlink(tmpFile);

  // Use the Firebase Storage download URL (?alt=media). Public reads
  // are gated by storage.rules (`allow read: if true` on products/**),
  // so no signed-URL token is required. This URL keeps working even on
  // buckets with uniform bucket-level access enabled (the modern
  // default), where ACL-based makePublic() would fail.
  return (
    `https://firebasestorage.googleapis.com/v0/b/${bucket.name}` +
    `/o/${encodeURIComponent(remotePath)}?alt=media`
  );
}

async function main() {
  console.log(`Bucket: ${bucket.name}`);
  console.log(`Importing ${MOCK_PRODUCTS.length} products...\n`);

  const results: Record<string, string> = {};
  const failed: string[] = [];

  let skipped = 0;
  for (const product of MOCK_PRODUCTS) {
    if (alreadyRehosted(product.imageUrl)) {
      skipped++;
      continue;
    }
    const label = `${product.brand ?? ''} ${product.name}`.trim();
    process.stdout.write(`[${product.id}] "${label}" ... `);
    try {
      const offUrl = await searchOFF(product.brand, product.name);
      if (!offUrl) {
        console.log('no OFF match');
        failed.push(product.id);
        continue;
      }
      const newUrl = await downloadAndUpload(product.id, offUrl);
      results[product.id] = newUrl;
      console.log('ok');
    } catch (err: any) {
      console.log(`failed: ${err?.message ?? err}`);
      failed.push(product.id);
    }
    // Respect OFF's rate limits (~100/min unauthenticated).
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(
    `\nUploaded ${Object.keys(results).length} / ${MOCK_PRODUCTS.length} ` +
      `(skipped ${skipped} already-rehosted)`,
  );
  if (failed.length) {
    console.log(
      `Failed (${failed.length}): ${failed.join(', ')} — original URLs preserved`,
    );
  }

  // Rewrite src/mocks/products.ts in place. The regex looks for the
  // imageUrl that appears AFTER `id: '<id>'` on the same product line.
  // products.ts is one product per line so the dot-not-newline default
  // of `[^}]*` is safe.
  const file = path.join(__dirname, '..', 'src', 'mocks', 'products.ts');
  let src = await fs.readFile(file, 'utf8');
  let rewrites = 0;
  for (const [id, url] of Object.entries(results)) {
    const re = new RegExp(
      `(id:\\s*'${id}'[^}]*imageUrl:\\s*)'[^']+'`,
    );
    const next = src.replace(re, `$1'${url}'`);
    if (next !== src) {
      rewrites++;
      src = next;
    } else {
      console.warn(`  ! could not find imageUrl line for ${id}`);
    }
  }
  await fs.writeFile(file, src);
  console.log(`\nRewrote ${rewrites} imageUrl entries in src/mocks/products.ts`);
  console.log('Next: npm run seed');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
