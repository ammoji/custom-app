/**
 * One-shot script — seeds the master product catalog at the top-level
 * `products/{productId}` Firestore collection from
 * `docs/master-catalog-seed.csv`.
 *
 *   npx tsx scripts/seed-master-catalog.ts                  # dry-run
 *   npx tsx scripts/seed-master-catalog.ts --execute        # actually write
 *   npx tsx scripts/seed-master-catalog.ts --execute --yes  # skip typed prompt
 *
 * Source of truth: docs/master-catalog-seed.csv (editable in Excel).
 * Each row writes to `products/{id}` with `merge: true` so the script
 * is idempotent — re-running updates existing docs in place. Shop
 * menu subcollections at `shops/{shopId}/menu/{menuItemId}` reference
 * these products via `productId`, so the customer-facing menu paths
 * pick up name + image updates automatically (per the GLOBAL menu
 * item contract documented in src/types).
 *
 * Per the architecture note in src/types:
 *   "GLOBAL menu items inherit name + image from products/{productId}
 *    but denormalize them so the customer never has to do a second
 *    read. Shop owner can override price/availability/stock only —
 *    name and image are protected to keep cross-shop comparisons
 *    honest."
 *
 * Placeholder images use picsum.photos seeded by product id. Real
 * product photos come in a separate sourcing pass (`scripts/seed-
 * master-catalog-images.ts`, TBD) that updates only the imageUrl
 * field.
 *
 * Safety guards (mirrored from reset-pilot-data.ts):
 *   - Project allowlist (grocery-mvp-dev only)
 *   - Dry-run by default; --execute required to write
 *   - Typed "WRITE" confirmation unless --yes
 *   - Audit log at scripts/.cleanup-logs/{ISO-timestamp}-seed-master-catalog.json
 *
 * Idempotent — safe to re-run after editing the CSV.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const ALLOWED_PROJECT = 'grocery-mvp-dev';
const BATCH_SIZE = 400; // under Firestore's 500/batch cap
const CSV_PATH = join(__dirname, '..', 'docs', 'master-catalog-seed.csv');

// -------------------------------------------------------------------
// Terminal output (no chalk dep — plain ANSI escapes)
// -------------------------------------------------------------------
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
};

type Flags = {
  execute: boolean;
  yes: boolean;
};

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { execute: false, yes: false };
  for (const raw of argv) {
    if (raw === '--execute') flags.execute = true;
    else if (raw === '--yes') flags.yes = true;
    else {
      throw new Error(
        `Unknown flag: "${raw}". Recognised: --execute, --yes`,
      );
    }
  }
  if (flags.yes && !flags.execute) {
    throw new Error('--yes requires --execute (nothing to confirm in dry-run).');
  }
  return flags;
}

// -------------------------------------------------------------------
// Service account (mirrors reset-keep-catalog.ts pattern)
// -------------------------------------------------------------------
function loadServiceAccount() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../service-account.json') as {
    project_id: string;
    client_email: string;
  };
}

// -------------------------------------------------------------------
// CSV parser — simple split (CSV is hand-authored, no commas in values)
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
  if (lines.length === 0) {
    throw new Error('CSV is empty');
  }
  const header = lines[0].split(',').map(h => h.trim());
  const expected = [
    'id',
    'name',
    'brand',
    'category',
    'pack_value',
    'pack_unit',
    'mrp',
    'suggested_sell_price',
    'image_search_query',
    'tags',
  ];
  for (const col of expected) {
    if (!header.includes(col)) {
      throw new Error(`CSV missing required column: "${col}"`);
    }
  }
  const idx = (col: string) => header.indexOf(col);
  return lines.slice(1).map((line, i) => {
    const cells = line.split(',');
    if (cells.length < header.length) {
      // Tolerate trailing missing cells (e.g., empty tags)
      while (cells.length < header.length) cells.push('');
    }
    const row: CsvRow = {
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
    if (!row.id) throw new Error(`Row ${i + 2}: missing id`);
    if (!row.name) throw new Error(`Row ${i + 2}: missing name`);
    if (!row.category) throw new Error(`Row ${i + 2}: missing category`);
    if (!Number.isFinite(row.pack_value)) {
      throw new Error(`Row ${i + 2} (${row.id}): pack_value not numeric: "${cells[idx('pack_value')]}"`);
    }
    if (!Number.isFinite(row.mrp)) {
      throw new Error(`Row ${i + 2} (${row.id}): mrp not numeric: "${cells[idx('mrp')]}"`);
    }
    if (!Number.isFinite(row.suggested_sell_price)) {
      throw new Error(`Row ${i + 2} (${row.id}): suggested_sell_price not numeric`);
    }
    return row;
  });
}

// -------------------------------------------------------------------
// CSV row → Firestore doc shape
// -------------------------------------------------------------------
function buildProductDoc(row: CsvRow): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    category: row.category,
    packSize: { value: row.pack_value, unit: row.pack_unit },
    mrp: row.mrp,
    price: row.suggested_sell_price,
    // Placeholder image keyed by id so it's stable across runs. Real
    // photos come in a separate sourcing pass.
    imageUrl: `https://picsum.photos/seed/${row.id}/300/300`,
    inStock: true,
    isMasterCatalog: true,
    // PR-NEXT-BUNDLE-K §A — admin-seeded catalog items are
    // customer-visible immediately. Shop-proposed items
    // (proposeMasterCatalogItem) start as 'pending' instead.
    status: 'approved',
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (row.brand) doc.brand = row.brand;
  if (row.tags) doc.tags = [row.tags];
  return doc;
}

// -------------------------------------------------------------------
// Per-category summary for the dry-run report
// -------------------------------------------------------------------
function summarizeByCategory(rows: CsvRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.category] = (counts[row.category] ?? 0) + 1;
  }
  return counts;
}

// -------------------------------------------------------------------
// Typed confirmation prompt
// -------------------------------------------------------------------
function promptConfirm(): Promise<boolean> {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(
      `${C.yellow}Type WRITE to confirm: ${C.reset}`,
      answer => {
        rl.close();
        resolve(answer.trim() === 'WRITE');
      },
    );
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
  initializeApp({ credential: cert(sa as any), projectId: sa.project_id });
  const db = getFirestore();

  console.log(`${C.cyan}[seed-master-catalog]${C.reset} project = ${sa.project_id}`);

  const csvText = readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(csvText);
  console.log(`${C.cyan}[seed-master-catalog]${C.reset} parsed ${C.bold}${rows.length}${C.reset} items from CSV`);

  // Sanity — check for duplicate ids
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) dupes.push(row.id);
    seen.add(row.id);
  }
  if (dupes.length > 0) {
    throw new Error(`Duplicate ids in CSV: ${dupes.join(', ')}`);
  }

  // Per-category summary
  const byCat = summarizeByCategory(rows);
  console.log(`${C.cyan}[seed-master-catalog]${C.reset} items per category:`);
  for (const [cat, count] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(20)} ${count}`);
  }

  if (!flags.execute) {
    console.log('');
    console.log(`${C.yellow}DRY RUN${C.reset} — would write ${rows.length} items to ${C.bold}products/${C.reset} collection.`);
    console.log(`${C.dim}Sample (first 5):${C.reset}`);
    rows.slice(0, 5).forEach(r => {
      console.log(`  ${C.dim}→${C.reset} ${r.id.padEnd(45)} ${r.name.padEnd(40)} ₹${r.mrp}`);
    });
    console.log(`  ${C.dim}... and ${rows.length - 5} more${C.reset}`);
    console.log('');
    console.log(`To actually write: ${C.bold}npx tsx scripts/seed-master-catalog.ts --execute${C.reset}`);
    process.exit(0);
  }

  // Confirmation (unless --yes)
  if (!flags.yes) {
    console.log('');
    console.log(`${C.yellow}About to write ${rows.length} items to ${C.bold}products/${C.reset}${C.yellow} on ${sa.project_id}.${C.reset}`);
    console.log(`${C.dim}Existing docs will be merged in place (idempotent — name/price/category/etc. overwritten).${C.reset}`);
    const confirmed = await promptConfirm();
    if (!confirmed) {
      console.log(`${C.red}Aborted.${C.reset}`);
      process.exit(1);
    }
  }

  // Batched writes
  let written = 0;
  const startTime = Date.now();
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const slice = rows.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const row of slice) {
      const docRef = db.doc(`products/${row.id}`);
      batch.set(docRef, buildProductDoc(row), { merge: true });
    }
    await batch.commit();
    written += slice.length;
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(rows.length / BATCH_SIZE);
    console.log(`  ${C.green}✓${C.reset} batch ${batchNum}/${totalBatches} (${slice.length} items) — running total ${written}/${rows.length}`);
  }

  const elapsedMs = Date.now() - startTime;
  console.log('');
  console.log(`${C.green}[seed-master-catalog] Done.${C.reset} ${written} items written in ${(elapsedMs / 1000).toFixed(1)}s`);

  // Audit log
  try {
    const logsDir = join(__dirname, '.cleanup-logs');
    mkdirSync(logsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = join(logsDir, `${ts}-seed-master-catalog.json`);
    writeFileSync(
      logPath,
      JSON.stringify(
        {
          script: 'seed-master-catalog',
          project: sa.project_id,
          timestamp: new Date().toISOString(),
          csvPath: CSV_PATH,
          itemsWritten: written,
          elapsedMs,
          itemsByCategory: byCat,
        },
        null,
        2,
      ),
    );
    console.log(`${C.dim}Audit log: ${logPath}${C.reset}`);
  } catch (e: any) {
    console.warn(`${C.yellow}Could not write audit log:${C.reset} ${e?.message ?? e}`);
  }

  // Git SHA for traceability
  try {
    const sha = execSync('git rev-parse --short HEAD').toString().trim();
    console.log(`${C.dim}Repo SHA at time of seed: ${sha}${C.reset}`);
  } catch {
    // Non-fatal
  }
}

main().catch(err => {
  console.error(`\n${C.red}[seed-master-catalog] Fatal:${C.reset}`, err?.message ?? err);
  process.exit(1);
});
