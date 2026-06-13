/**
 * Companion script to `source-master-catalog-photos.ts` — reads
 * `docs/master-catalog-photo-map.csv` and patches the `imageUrl`
 * field on every `products/{productId}` Firestore document that has a
 * new image URL.
 *
 *   npx tsx scripts/update-master-catalog-photo-urls.ts                  # dry-run
 *   npx tsx scripts/update-master-catalog-photo-urls.ts --execute        # actually write
 *   npx tsx scripts/update-master-catalog-photo-urls.ts --execute --yes  # skip typed prompt
 *
 * Skips rows where source == 'unmatched' (those products stay on
 * picsum placeholders).
 *
 * Idempotent — re-running with the same CSV updates docs to the same
 * URLs (no-op effectively).
 *
 * Safety guards (mirrored from seed-master-catalog.ts):
 *   - Project allowlist (grocery-mvp-dev only)
 *   - Dry-run by default
 *   - Typed "WRITE" confirmation unless --yes
 *   - Audit log
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const ALLOWED_PROJECT = 'grocery-mvp-dev';
const BATCH_SIZE = 400;
const PHOTO_MAP_PATH = join(__dirname, '..', 'docs', 'master-catalog-photo-map.csv');

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
};

type Flags = { execute: boolean; yes: boolean };

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { execute: false, yes: false };
  for (const raw of argv) {
    if (raw === '--execute') flags.execute = true;
    else if (raw === '--yes') flags.yes = true;
    else throw new Error(`Unknown flag: "${raw}". Recognised: --execute, --yes`);
  }
  if (flags.yes && !flags.execute) throw new Error('--yes requires --execute');
  return flags;
}

function loadServiceAccount() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../service-account.json') as { project_id: string };
}

type PhotoMapRow = {
  productId: string;
  newImageUrl: string;
  source: string;
  confidence: string;
};

function parsePhotoMap(text: string): PhotoMapRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  const rows: PhotoMapRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    // Simple CSV parsing — note matchedName column may contain commas wrapped in quotes
    // For our purposes only need first 5 cells
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of lines[i]) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) {
        cells.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current);
    if (cells.length < 5) continue;
    rows.push({
      productId: cells[0].trim(),
      newImageUrl: cells[2].trim(),
      source: cells[3].trim(),
      confidence: cells[4].trim(),
    });
  }
  return rows;
}

function promptConfirm(): Promise<boolean> {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${C.yellow}Type WRITE to confirm: ${C.reset}`, ans => {
      rl.close();
      resolve(ans.trim() === 'WRITE');
    });
  });
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));

  const sa = loadServiceAccount();
  if (sa.project_id !== ALLOWED_PROJECT) {
    throw new Error(
      `Refusing: service-account.json project_id is "${sa.project_id}", expected "${ALLOWED_PROJECT}".`,
    );
  }

  if (!existsSync(PHOTO_MAP_PATH)) {
    throw new Error(
      `Photo map not found at ${PHOTO_MAP_PATH}. Run source-master-catalog-photos.ts --execute first.`,
    );
  }

  console.log(`${C.cyan}[update-photo-urls]${C.reset} project = ${sa.project_id}`);

  const text = readFileSync(PHOTO_MAP_PATH, 'utf8');
  const rows = parsePhotoMap(text);
  const updates = rows.filter(r => r.source !== 'unmatched' && r.newImageUrl.length > 0);
  const skipped = rows.length - updates.length;

  console.log(`${C.cyan}[update-photo-urls]${C.reset} photo map has ${C.bold}${rows.length}${C.reset} rows`);
  console.log(`  ${C.green}${updates.length}${C.reset} have a new image URL (will update Firestore)`);
  console.log(`  ${C.yellow}${skipped}${C.reset} are unmatched (skipped — stay on picsum)`);

  // Confidence breakdown
  const byConfidence = { high: 0, low: 0 };
  for (const u of updates) {
    if (u.confidence === 'high') byConfidence.high++;
    else byConfidence.low++;
  }
  console.log(`    ${C.green}high confidence:${C.reset} ${byConfidence.high}`);
  console.log(`    ${C.yellow}low confidence:${C.reset}  ${byConfidence.low} (review before/after)`);

  if (!flags.execute) {
    console.log('');
    console.log(`${C.yellow}DRY RUN${C.reset} — would patch ${updates.length} docs in products/ collection.`);
    console.log(`${C.dim}Sample (first 5):${C.reset}`);
    updates.slice(0, 5).forEach(u => {
      console.log(`  ${C.dim}→${C.reset} ${u.productId.padEnd(45)} ${C.dim}${u.newImageUrl.slice(0, 80)}...${C.reset}`);
    });
    console.log('');
    console.log(`To actually write: ${C.bold}npx tsx scripts/update-master-catalog-photo-urls.ts --execute${C.reset}`);
    process.exit(0);
  }

  if (!flags.yes) {
    console.log('');
    console.log(`${C.yellow}About to patch imageUrl on ${updates.length} docs in ${C.bold}products/${C.reset}${C.yellow} on ${sa.project_id}.${C.reset}`);
    const ok = await promptConfirm();
    if (!ok) {
      console.log(`${C.red}Aborted.${C.reset}`);
      process.exit(1);
    }
  }

  // Initialize Firebase
  initializeApp({ credential: cert(sa as any), projectId: sa.project_id });
  const db = getFirestore();

  // Batched writes
  let written = 0;
  const startTime = Date.now();
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const slice = updates.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const row of slice) {
      const docRef = db.doc(`products/${row.productId}`);
      batch.set(
        docRef,
        {
          imageUrl: row.newImageUrl,
          imageSource: row.source,
          imageConfidence: row.confidence,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    await batch.commit();
    written += slice.length;
    console.log(`  ${C.green}✓${C.reset} batch ${Math.floor(i / BATCH_SIZE) + 1} (${slice.length} items) — total ${written}/${updates.length}`);
  }

  const elapsedMs = Date.now() - startTime;
  console.log('');
  console.log(`${C.green}[update-photo-urls] Done.${C.reset} ${written} docs patched in ${(elapsedMs / 1000).toFixed(1)}s`);

  // Audit log
  try {
    const logsDir = join(__dirname, '.cleanup-logs');
    mkdirSync(logsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = join(logsDir, `${ts}-update-photo-urls.json`);
    writeFileSync(
      logPath,
      JSON.stringify(
        {
          script: 'update-master-catalog-photo-urls',
          project: sa.project_id,
          timestamp: new Date().toISOString(),
          docsUpdated: written,
          skipped,
          byConfidence,
          elapsedMs,
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
  console.error(`\n${C.red}[update-photo-urls] Fatal:${C.reset}`, err?.message ?? err);
  process.exit(1);
});
