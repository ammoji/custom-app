/**
 * One-off script: delete EVERY document in the /orders collection.
 *
 *   npx tsx scripts/delete-orders-only.ts                # dry-run
 *   npx tsx scripts/delete-orders-only.ts --execute      # actually delete
 *   npx tsx scripts/delete-orders-only.ts --execute --no-confirm  # skip the prompt
 *
 * Use during family testing when accumulated orders are slowing
 * things down or making the dashboards noisy. Does NOT touch shops,
 * menus, users, or auth — just orders.
 *
 * Safety:
 *   - Only runs against grocery-mvp-dev (allowlist guard).
 *   - Default mode is dry-run; --execute is required to actually delete.
 *   - With --execute, prompts you to type the project ID to confirm
 *     (skip with --no-confirm if you're scripting it).
 *   - Deletes in batches of 500. Partial failures log + continue.
 *
 * What's preserved:
 *   - /shops, /shops/*\/menu, /products, /users, Firebase Auth users,
 *     audit log entries (those reference orders by ID, doesn't matter
 *     that orders are gone).
 *
 * What's NOT cleaned up (out of scope):
 *   - Razorpay test-mode payments — those live on Razorpay's side
 *     and are inert. They don't affect anything in the app.
 *   - statusHistory subdocs — orders don't have subcollections in
 *     this codebase, so nothing else to recursively delete.
 */
import { createInterface } from 'node:readline';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const ALLOWED_PROJECT = 'grocery-mvp-dev';
const BATCH_SIZE = 500;

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  dim: '\x1b[2m',
};

function parseFlags(argv: string[]): { execute: boolean; noConfirm: boolean } {
  return {
    execute: argv.includes('--execute'),
    noConfirm: argv.includes('--no-confirm'),
  };
}

async function promptProjectId(expected: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(
      `\n${C.yellow}Type the project ID to confirm deletion (${expected}): ${C.reset}`,
      answer => {
        rl.close();
        resolve(answer.trim() === expected);
      },
    );
  });
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2));

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sa = require('../service-account.json') as {
    project_id: string;
    client_email: string;
  };

  if (sa.project_id !== ALLOWED_PROJECT) {
    console.error(
      `${C.red}ABORT${C.reset}: service account is for project "${sa.project_id}", ` +
        `not the allowlisted "${ALLOWED_PROJECT}". Refusing to run.`,
    );
    return 1;
  }

  initializeApp({ credential: cert(sa as any) });
  const db = getFirestore();

  console.log(
    `\n${C.bold}delete-orders-only${C.reset} — project ${sa.project_id}`,
  );
  console.log(`  mode: ${flags.execute ? `${C.red}EXECUTE${C.reset}` : `${C.green}dry-run${C.reset}`}`);

  // Count orders.
  const snap = await db.collection('orders').get();
  const total = snap.size;
  console.log(`  orders found: ${total}`);

  if (total === 0) {
    console.log(`\n${C.green}Nothing to delete. Done.${C.reset}`);
    return 0;
  }

  if (!flags.execute) {
    console.log(
      `\n${C.dim}Would delete all ${total} orders. Re-run with --execute to actually delete.${C.reset}`,
    );
    return 0;
  }

  if (!flags.noConfirm) {
    const ok = await promptProjectId(sa.project_id);
    if (!ok) {
      console.log(`\n${C.red}Aborted: project ID did not match.${C.reset}`);
      return 1;
    }
  }

  // Delete in batches of 500.
  const refs = snap.docs.map(d => d.ref);
  let deleted = 0;
  const failed: string[] = [];
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const slice = refs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const ref of slice) batch.delete(ref);
    try {
      await batch.commit();
      deleted += slice.length;
      process.stdout.write(`\r  deleted: ${deleted}/${total}`);
    } catch (e) {
      failed.push(...slice.map(r => r.path));
      console.error(
        `\n${C.red}batch ${i}-${i + slice.length} FAILED: ${(e as Error).message}${C.reset}`,
      );
    }
  }
  process.stdout.write('\n');

  console.log(`\n${C.green}Done.${C.reset}`);
  console.log(`  deleted: ${deleted}`);
  if (failed.length > 0) {
    console.log(`  ${C.red}failed: ${failed.length}${C.reset}`);
    console.log(`  failed paths:\n    ${failed.join('\n    ')}`);
    return 2;
  }
  return 0;
}

if (require.main === module) {
  main()
    .then(code => process.exit(code))
    .catch(err => {
      console.error(`\n${C.red}${err.message ?? err}${C.reset}`);
      process.exit(1);
    });
}
