/**
 * Static audit: every composite Firestore query in
 * `functions/src/index.ts` must have a matching index in
 * `firestore.indexes.json`.
 *
 * Why this exists: the v2-iv "Shop Dashboard INTERNAL" bug came
 * from `listShopOrders` running
 * `where('shopId', '==', X).orderBy('createdAt', 'desc')` with no
 * matching composite index. Firestore returned FAILED_PRECONDITION;
 * the RNFB SDK bubbled it up to the device as `INTERNAL`. NO test
 * exercises the actual query path, so the gap was invisible until
 * Sudhir hit it on a real device.
 *
 * Heuristic parser (intentional — keeps the script in plain Node
 * with zero deps):
 *   - Find every `.collection('<name>')` call
 *   - Walk forward, collecting `.where('<field>', '==', ...)` /
 *     `.where('<field>', 'in', ...)` filter fields and
 *     `.orderBy('<field>', '<dir>')` ordering fields up to the
 *     terminating `.get()` / `.limit()` / `;`
 *   - If the chain has BOTH ≥1 where-eq filter AND ≥1 orderBy,
 *     OR ≥2 orderBy fields, declare it a composite query and
 *     check `firestore.indexes.json` for a matching index entry.
 *
 * Exit code 1 if any composite query lacks an index. CI must run
 * `node scripts/audit-firestore-indexes.js` after build.
 *
 * Run: `npx tsx scripts/audit-firestore-indexes.ts`
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

type IndexFieldOrder = 'ASCENDING' | 'DESCENDING';
type IndexField = { fieldPath: string; order?: IndexFieldOrder };
type IndexDef = {
  collectionGroup: string;
  fields: IndexField[];
};

type ParsedQuery = {
  collection: string;
  whereEq: string[];
  whereIn: string[];
  orderBy: { field: string; dir: IndexFieldOrder }[];
  loc: string; // file:line for the .collection() call
};

function readIndexes(repoRoot: string): IndexDef[] {
  const file = path.join(repoRoot, 'firestore.indexes.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  return (json.indexes ?? []).map((i: any) => ({
    collectionGroup: i.collectionGroup,
    fields: (i.fields ?? []).map((f: any) => ({
      fieldPath: f.fieldPath,
      order: f.order as IndexFieldOrder | undefined,
    })),
  }));
}

function parseQueries(source: string, fileLabel: string): ParsedQuery[] {
  // Strip line comments to avoid false positives in commentary.
  const stripped = source
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
    .join('\n');

  const queries: ParsedQuery[] = [];
  const collRe = /\.collection\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;

  while ((m = collRe.exec(stripped)) !== null) {
    const collection = m[1];
    const startIdx = m.index;
    // Walk forward until the next semicolon at the SAME chain depth,
    // or until we see a chain-terminator like .get( / .limit(... ).get(
    // — for our purposes we just collect everything until the next
    // top-level `;` or 600 chars of slack.
    const sliceEnd = Math.min(stripped.length, startIdx + 600);
    const window = stripped.slice(startIdx, sliceEnd);
    const semi = window.indexOf(';');
    const chain = semi === -1 ? window : window.slice(0, semi);

    const lineNumber =
      stripped.slice(0, startIdx).split('\n').length;
    const loc = `${fileLabel}:${lineNumber}`;

    const whereEqRe = /\.where\(\s*['"]([^'"]+)['"]\s*,\s*['"]==['"]/g;
    const whereInRe = /\.where\(\s*['"]([^'"]+)['"]\s*,\s*['"]in['"]/g;
    const orderByRe =
      /\.orderBy\(\s*['"]([^'"]+)['"](?:\s*,\s*['"](asc|desc)['"])?/g;

    const whereEq: string[] = [];
    let mm: RegExpExecArray | null;
    while ((mm = whereEqRe.exec(chain)) !== null) whereEq.push(mm[1]);

    const whereIn: string[] = [];
    while ((mm = whereInRe.exec(chain)) !== null) whereIn.push(mm[1]);

    const orderBy: ParsedQuery['orderBy'] = [];
    while ((mm = orderByRe.exec(chain)) !== null) {
      const dir: IndexFieldOrder =
        (mm[2] ?? 'asc').toLowerCase() === 'desc' ? 'DESCENDING' : 'ASCENDING';
      orderBy.push({ field: mm[1], dir });
    }

    queries.push({ collection, whereEq, whereIn, orderBy, loc });
  }

  return queries;
}

function isComposite(q: ParsedQuery): boolean {
  // Composite index requirements per Firestore docs:
  //   - Multiple equality filters alone are served by single-field
  //     indexes (Firestore intersects them implicitly). NOT composite.
  //   - Equality on field X combined with orderBy on a DIFFERENT
  //     field requires a composite. (Equality + orderBy on the SAME
  //     field is single-field.)
  //   - 2+ orderBy fields require a composite.
  //   - `in` / array-contains-any with another equality OR orderBy
  //     requires a composite.
  if (q.orderBy.length >= 2) return true;

  if (q.whereEq.length >= 1 && q.orderBy.length >= 1) {
    const eqAndOrderSame =
      q.whereEq.length === 1 &&
      q.orderBy.length === 1 &&
      q.whereEq[0] === q.orderBy[0].field;
    if (!eqAndOrderSame) return true;
  }

  // `in` / `array-contains-any` combined with anything else needs a
  // composite. Alone it doesn't.
  if (q.whereIn.length >= 1 && (q.whereEq.length >= 1 || q.orderBy.length >= 1)) {
    return true;
  }

  return false;
}

function indexCovers(q: ParsedQuery, idx: IndexDef): boolean {
  if (idx.collectionGroup !== q.collection) return false;
  // The index's field order must start with all equality filters
  // (in any order) followed by the orderBy fields in declared order
  // with matching direction. We do a relaxed check: every equality
  // field must appear in the index, and the orderBy fields must
  // appear in declared order at the END of the index.
  const idxFieldNames = idx.fields.map(f => f.fieldPath);
  for (const eq of q.whereEq) {
    if (!idxFieldNames.includes(eq)) return false;
  }
  // Trailing orderBy alignment.
  const tail = idx.fields.slice(idx.fields.length - q.orderBy.length);
  if (tail.length !== q.orderBy.length) return false;
  for (let i = 0; i < q.orderBy.length; i++) {
    if (tail[i].fieldPath !== q.orderBy[i].field) return false;
    if (tail[i].order && tail[i].order !== q.orderBy[i].dir) return false;
  }
  return true;
}

function main(): number {
  const repoRoot = path.resolve(__dirname, '..');
  const fnFile = path.join(repoRoot, 'functions', 'src', 'index.ts');
  if (!fs.existsSync(fnFile)) {
    console.error(`[audit-indexes] missing ${fnFile}`);
    return 1;
  }

  const source = fs.readFileSync(fnFile, 'utf8');
  const queries = parseQueries(source, 'functions/src/index.ts');
  const indexes = readIndexes(repoRoot);

  const composites = queries.filter(isComposite);
  const missing: { q: ParsedQuery; reason: string }[] = [];

  for (const q of composites) {
    const covered = indexes.some(idx => indexCovers(q, idx));
    if (!covered) {
      missing.push({
        q,
        reason: `No matching index in firestore.indexes.json for ${q.collection}(${[
          ...q.whereEq.map(f => `${f} ==`),
          ...q.whereIn.map(f => `${f} in`),
          ...q.orderBy.map(o => `${o.field} ${o.dir.toLowerCase()}`),
        ].join(', ')})`,
      });
    }
  }

  console.log(
    `[audit-indexes] scanned ${queries.length} query chains, ${composites.length} composite, ${missing.length} missing`,
  );

  if (missing.length === 0) {
    console.log('[audit-indexes] OK — all composite queries have indexes');
    return 0;
  }

  console.error('\n[audit-indexes] FAIL — missing composite indexes:');
  for (const { q, reason } of missing) {
    console.error(`  • ${q.loc}`);
    console.error(`    ${reason}`);
  }
  console.error(
    '\nAdd the missing entries to firestore.indexes.json and run\n  firebase deploy --only firestore:indexes\n',
  );
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

// Exported for testing.
export { indexCovers, isComposite, parseQueries, readIndexes };
export type { IndexDef, ParsedQuery };

