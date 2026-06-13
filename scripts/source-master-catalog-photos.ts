/**
 * One-shot script — sources real product photos for the master catalog
 * via Open Food Facts API and uploads them to Firebase Storage at
 * `/products/{productId}.jpg`. Writes a CSV mapping
 * `productId → newImageUrl` to `docs/master-catalog-photo-map.csv`.
 *
 *   npx tsx scripts/source-master-catalog-photos.ts                  # dry-run
 *   npx tsx scripts/source-master-catalog-photos.ts --execute        # actually fetch + upload
 *   npx tsx scripts/source-master-catalog-photos.ts --execute --yes  # skip typed prompt
 *   npx tsx scripts/source-master-catalog-photos.ts --resume         # skip already-uploaded items
 *
 * Source of truth: docs/master-catalog-seed.csv (500 items).
 * Image source: Open Food Facts (https://world.openfoodfacts.org).
 *
 * Pipeline per item:
 *   1. Read row from CSV
 *   2. Query OFF API: search_terms = item.image_search_query
 *   3. Pick best match (first result with a usable image_front_url)
 *   4. Download image (~50KB typical after OFF's own resize)
 *   5. Re-resize to 400×400 JPEG (sharp lib) for catalog consistency
 *   6. Upload to gs://grocery-mvp-dev.firebasestorage.app/products/{id}.jpg
 *   7. Construct Firebase Storage REST URL with embedded download token
 *      (same pattern as getPartnerPhotoUploadUrl post-HOTFIX-PROFILE-PHOTO-4)
 *   8. Append to docs/master-catalog-photo-map.csv:
 *        productId,oldImageUrl,newImageUrl,source,confidence
 *      source = 'open_food_facts' | 'unmatched'
 *      confidence = 'high' | 'low' | 'none'
 *
 * After this script completes, run the companion update script
 * `update-master-catalog-photo-urls.ts` (TBD) to patch `products/{id}.imageUrl`
 * in Firestore from the photo map CSV.
 *
 * Safety guards (mirrored from seed-master-catalog.ts):
 *   - Project allowlist (grocery-mvp-dev only)
 *   - Dry-run by default (--execute required to fetch + upload)
 *   - Typed "FETCH" confirmation unless --yes
 *   - Audit log at scripts/.cleanup-logs/{ISO-timestamp}-source-photos.json
 *   - Resume support — skip items already in the photo map CSV
 *
 * Rate-limiting: 1 request per second to OFF (their docs ask for ≤2 rps).
 * Total run time for 500 items: ~10-15 minutes.
 *
 * Dependencies: needs `sharp` for resize. Install with:
 *   cd ../ && npm install --save-dev sharp
 * (or run from scripts/ dir if scripts has its own package.json).
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import { cert, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import crypto from 'node:crypto';

const ALLOWED_PROJECT = 'grocery-mvp-dev';
const CSV_PATH = join(__dirname, '..', 'docs', 'master-catalog-seed.csv');
const PHOTO_MAP_PATH = join(__dirname, '..', 'docs', 'master-catalog-photo-map.csv');
const OFF_BASE = 'https://world.openfoodfacts.org';
const RATE_LIMIT_MS = 1000; // 1 second between OFF requests
const TARGET_SIZE_PX = 400;

// -------------------------------------------------------------------
// Terminal output
// -------------------------------------------------------------------
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
};

type Flags = {
  execute: boolean;
  yes: boolean;
  resume: boolean;
  limit: number | null;
};

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { execute: false, yes: false, resume: false, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (raw === '--execute') flags.execute = true;
    else if (raw === '--yes') flags.yes = true;
    else if (raw === '--resume') flags.resume = true;
    else if (raw.startsWith('--limit=')) {
      const v = parseInt(raw.slice('--limit='.length), 10);
      if (!Number.isFinite(v) || v <= 0) {
        throw new Error(`--limit must be a positive integer; got "${raw}"`);
      }
      flags.limit = v;
    } else {
      throw new Error(
        `Unknown flag: "${raw}". Recognised: --execute, --yes, --resume, --limit=<n>`,
      );
    }
  }
  if (flags.yes && !flags.execute) {
    throw new Error('--yes requires --execute');
  }
  return flags;
}

// -------------------------------------------------------------------
// Service account
// -------------------------------------------------------------------
function loadServiceAccount() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../service-account.json') as {
    project_id: string;
    client_email: string;
  };
}

// -------------------------------------------------------------------
// CSV parser (matches seed-master-catalog.ts shape)
// -------------------------------------------------------------------
type CsvRow = {
  id: string;
  name: string;
  brand: string;
  category: string;
  pack_value: number;
  pack_unit: string;
  mrp: number;
  suggested_sell_price: number;
  image_search_query: string;
  tags: string;
};

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  const header = lines[0].split(',').map(h => h.trim());
  const idx = (col: string) => header.indexOf(col);
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    while (cells.length < header.length) cells.push('');
    return {
      id: cells[idx('id')].trim(),
      name: cells[idx('name')].trim(),
      brand: cells[idx('brand')].trim(),
      category: cells[idx('category')].trim(),
      pack_value: Number(cells[idx('pack_value')].trim()),
      pack_unit: cells[idx('pack_unit')].trim(),
      mrp: Number(cells[idx('mrp')].trim()),
      suggested_sell_price: Number(cells[idx('suggested_sell_price')].trim()),
      image_search_query: cells[idx('image_search_query')].trim(),
      tags: cells[idx('tags')].trim(),
    };
  });
}

// -------------------------------------------------------------------
// Open Food Facts search — returns best image URL or null
// -------------------------------------------------------------------
type OffSearchResult = {
  imageUrl: string;
  confidence: 'high' | 'low';
  matchedProductName: string;
} | { imageUrl: null; confidence: 'none' };

async function searchOpenFoodFacts(query: string): Promise<OffSearchResult> {
  const url = `${OFF_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=5`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'HamaraSetu-CatalogSourcer/1.0 (sarastacklabs@gmail.com)',
      },
    });
    if (!res.ok) {
      return { imageUrl: null, confidence: 'none' };
    }
    const data = await res.json() as { products?: Array<{ image_front_url?: string; product_name?: string; brands?: string }> };
    if (!data.products || data.products.length === 0) {
      return { imageUrl: null, confidence: 'none' };
    }
    // Pick first product with a non-empty image_front_url
    for (const p of data.products) {
      if (p.image_front_url && p.image_front_url.length > 0) {
        // Confidence heuristic: if the query terms appear in the matched product name, "high"
        const matched = (p.product_name ?? '').toLowerCase();
        const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
        const overlapCount = queryTerms.filter(t => matched.includes(t)).length;
        const confidence: 'high' | 'low' = overlapCount >= Math.min(2, queryTerms.length) ? 'high' : 'low';
        return {
          imageUrl: p.image_front_url,
          confidence,
          matchedProductName: p.product_name ?? '(unnamed)',
        };
      }
    }
    return { imageUrl: null, confidence: 'none' };
  } catch (e: any) {
    console.warn(`${C.yellow}[off-search] error for "${query}": ${e?.message ?? e}${C.reset}`);
    return { imageUrl: null, confidence: 'none' };
  }
}

// -------------------------------------------------------------------
// Download image as buffer
// -------------------------------------------------------------------
async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  } catch (e: any) {
    console.warn(`${C.yellow}[download] error for ${url}: ${e?.message ?? e}${C.reset}`);
    return null;
  }
}

// -------------------------------------------------------------------
// Resize via `sharp` (requires npm install sharp) — falls back to
// uploading the raw image if sharp isn't installed.
// -------------------------------------------------------------------
async function resizeImage(buf: Buffer): Promise<Buffer> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp');
    return await sharp(buf)
      .resize(TARGET_SIZE_PX, TARGET_SIZE_PX, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch (e: any) {
    if (e?.code === 'MODULE_NOT_FOUND') {
      console.warn(
        `${C.yellow}[resize] sharp not installed — uploading raw image (larger size). Install with \`npm install sharp\` for smaller files.${C.reset}`,
      );
      return buf;
    }
    throw e;
  }
}

// -------------------------------------------------------------------
// Upload to Firebase Storage with embedded download token
// (mirrors getPartnerPhotoUploadUrl pattern post-HOTFIX-PROFILE-PHOTO-4)
// -------------------------------------------------------------------
async function uploadToStorage(productId: string, buf: Buffer, bucket: ReturnType<typeof getStorage>['bucket'] extends () => infer T ? T : never): Promise<string> {
  const storagePath = `products/${productId}.jpg`;
  const file = bucket.file(storagePath);
  const downloadToken = crypto.randomUUID();
  await file.save(buf, {
    metadata: {
      contentType: 'image/jpeg',
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
    resumable: false,
  });
  const bucketName = bucket.name;
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
  return downloadUrl;
}

// -------------------------------------------------------------------
// Resume support — read existing photo map to skip already-done items
// -------------------------------------------------------------------
function loadExistingPhotoMap(): Map<string, string> {
  if (!existsSync(PHOTO_MAP_PATH)) return new Map();
  const text = readFileSync(PHOTO_MAP_PATH, 'utf8');
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0 && !l.startsWith('productId,'));
  const map = new Map<string, string>();
  for (const line of lines) {
    const cells = line.split(',');
    if (cells.length >= 2) {
      map.set(cells[0].trim(), cells[2]?.trim() ?? '');
    }
  }
  return map;
}

// -------------------------------------------------------------------
// Confirmation prompt
// -------------------------------------------------------------------
function promptConfirm(): Promise<boolean> {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${C.yellow}Type FETCH to confirm: ${C.reset}`, answer => {
      rl.close();
      resolve(answer.trim() === 'FETCH');
    });
  });
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------
async function main() {
  const flags = parseFlags(process.argv.slice(2));

  const sa = loadServiceAccount();
  if (sa.project_id !== ALLOWED_PROJECT) {
    throw new Error(
      `Refusing: service-account.json project_id is "${sa.project_id}", expected "${ALLOWED_PROJECT}".`,
    );
  }

  console.log(`${C.cyan}[source-photos]${C.reset} project = ${sa.project_id}`);

  const csv = readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(csv);
  console.log(`${C.cyan}[source-photos]${C.reset} parsed ${C.bold}${rows.length}${C.reset} items from CSV`);

  // Resume map
  const existing = flags.resume ? loadExistingPhotoMap() : new Map<string, string>();
  if (flags.resume) {
    console.log(`${C.cyan}[source-photos]${C.reset} resume mode: ${existing.size} items already in photo map, will skip`);
  }

  const todo = rows.filter(r => !existing.has(r.id));
  const subset = flags.limit ? todo.slice(0, flags.limit) : todo;
  console.log(`${C.cyan}[source-photos]${C.reset} ${subset.length} items to process${flags.limit ? ` (limited to ${flags.limit})` : ''}`);
  console.log(`${C.cyan}[source-photos]${C.reset} estimated time @ ${RATE_LIMIT_MS}ms/req: ${Math.ceil((subset.length * RATE_LIMIT_MS) / 60000)} minutes`);

  if (!flags.execute) {
    console.log('');
    console.log(`${C.yellow}DRY RUN${C.reset} — would query OFF + download + upload ${subset.length} items.`);
    console.log(`${C.dim}Sample (first 5):${C.reset}`);
    subset.slice(0, 5).forEach(r => {
      console.log(`  ${C.dim}→${C.reset} ${r.id.padEnd(45)} query: "${r.image_search_query}"`);
    });
    console.log('');
    console.log(`To actually fetch + upload: ${C.bold}npx tsx scripts/source-master-catalog-photos.ts --execute${C.reset}`);
    console.log(`Tip: start with ${C.bold}--limit=10${C.reset} to validate the pipeline on a small batch before the full run.`);
    process.exit(0);
  }

  if (!flags.yes) {
    console.log('');
    console.log(`${C.yellow}About to fetch + upload photos for ${subset.length} items to ${C.bold}${sa.project_id}${C.reset}${C.yellow} Storage bucket.${C.reset}`);
    const ok = await promptConfirm();
    if (!ok) {
      console.log(`${C.red}Aborted.${C.reset}`);
      process.exit(1);
    }
  }

  // Initialize Firebase. We pass storageBucket explicitly — the
  // service-account.json doesn't carry it, and Firebase changed the
  // default bucket-naming convention in April 2024 from
  // `<project>.appspot.com` to `<project>.firebasestorage.app`, so
  // letting admin-sdk guess gives "Bucket name not specified or invalid".
  // Same root cause as HOTFIX-PROFILE-PHOTO step 3.
  const STORAGE_BUCKET = `${sa.project_id}.firebasestorage.app`;
  initializeApp({
    credential: cert(sa as any),
    projectId: sa.project_id,
    storageBucket: STORAGE_BUCKET,
  });
  const bucket = getStorage().bucket();
  console.log(`${C.cyan}[source-photos]${C.reset} storage bucket = ${STORAGE_BUCKET}`);

  // Ensure photo map CSV has header
  if (!existsSync(PHOTO_MAP_PATH)) {
    writeFileSync(PHOTO_MAP_PATH, 'productId,oldImageUrl,newImageUrl,source,confidence,matchedName\n');
  }

  const startTime = Date.now();
  const stats = { ok: 0, miss: 0, error: 0 };

  for (let i = 0; i < subset.length; i++) {
    const row = subset[i];
    const oldImageUrl = `https://picsum.photos/seed/${row.id}/300/300`;
    const prefix = `${C.dim}[${i + 1}/${subset.length}]${C.reset}`;

    try {
      const search = await searchOpenFoodFacts(row.image_search_query);

      if (!search.imageUrl) {
        stats.miss++;
        const line = `${row.id},${oldImageUrl},,unmatched,none,\n`;
        appendFileSync(PHOTO_MAP_PATH, line);
        console.log(`  ${prefix} ${C.yellow}MISS${C.reset} ${row.id.padEnd(45)} "${row.image_search_query}"`);
        await sleep(RATE_LIMIT_MS);
        continue;
      }

      const imgBuf = await downloadImage(search.imageUrl);
      if (!imgBuf) {
        stats.error++;
        console.log(`  ${prefix} ${C.red}DOWNLOAD FAILED${C.reset} ${row.id}`);
        await sleep(RATE_LIMIT_MS);
        continue;
      }

      const resized = await resizeImage(imgBuf);
      const newImageUrl = await uploadToStorage(row.id, resized, bucket);

      const line = `${row.id},${oldImageUrl},${newImageUrl},open_food_facts,${search.confidence},"${search.matchedProductName.replace(/"/g, "'")}"\n`;
      appendFileSync(PHOTO_MAP_PATH, line);

      stats.ok++;
      const confColor = search.confidence === 'high' ? C.green : C.yellow;
      console.log(`  ${prefix} ${confColor}OK ${search.confidence}${C.reset} ${row.id.padEnd(45)} (${(resized.length / 1024).toFixed(0)}KB)`);
    } catch (e: any) {
      stats.error++;
      console.error(`  ${prefix} ${C.red}ERROR${C.reset} ${row.id}: ${e?.message ?? e}`);
    }

    await sleep(RATE_LIMIT_MS);
  }

  const elapsedSec = Math.round((Date.now() - startTime) / 1000);
  console.log('');
  console.log(`${C.green}[source-photos] Done.${C.reset}`);
  console.log(`  ${C.green}OK${C.reset}    ${stats.ok}`);
  console.log(`  ${C.yellow}MISS${C.reset}  ${stats.miss} (these stay on picsum placeholder)`);
  console.log(`  ${C.red}ERROR${C.reset} ${stats.error}`);
  console.log(`  elapsed: ${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`);
  console.log('');
  console.log(`Photo map written to: ${C.bold}${PHOTO_MAP_PATH}${C.reset}`);
  console.log(`Next: run ${C.bold}npx tsx scripts/update-master-catalog-photo-urls.ts --execute${C.reset} to patch Firestore.`);

  // Audit log
  try {
    const logsDir = join(__dirname, '.cleanup-logs');
    mkdirSync(logsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = join(logsDir, `${ts}-source-photos.json`);
    writeFileSync(
      logPath,
      JSON.stringify(
        {
          script: 'source-master-catalog-photos',
          project: sa.project_id,
          timestamp: new Date().toISOString(),
          itemsProcessed: subset.length,
          stats,
          elapsedSec,
        },
        null,
        2,
      ),
    );
    console.log(`${C.dim}Audit log: ${logPath}${C.reset}`);
  } catch (e: any) {
    console.warn(`Could not write audit log: ${e?.message ?? e}`);
  }
}

main().catch(err => {
  console.error(`\n${C.red}[source-photos] Fatal:${C.reset}`, err?.message ?? err);
  process.exit(1);
});
