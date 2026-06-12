/**
 * HOTFIX-PUBLISH-TX-ORDER §D — static-source guard: no Firestore
 * transaction body has a `tx.get` after a `tx.set`, `tx.update`,
 * or `tx.delete`. Regex-based structural check.
 *
 * Third permanent guard after authClaimNamesAudit (Bundle G) and
 * noStaleDeferralComments (Bundle H).
 *
 * Deliberate-break demo:
 *   Move `tx.get(partnerRef)` back below a `tx.set(...)` in
 *   _publishReview → this test fails. Restore. Passes.
 */
import * as fs from 'fs';
import * as path from 'path';
import { extractTransactionBodies, hasReadAfterWrite } from './txReadOrderDetect';

const FUNCTIONS_SRC = path.resolve(__dirname, '../../functions/src');

function walkTs(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkTs(full));
    } else if (full.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

describe('Firestore transaction read-order audit', () => {
  it('all runTransaction bodies have tx.get reads before tx.set/update/delete writes', () => {
    const violations: string[] = [];
    for (const file of walkTs(FUNCTIONS_SRC)) {
      const src = fs.readFileSync(file, 'utf8');
      const bodies = extractTransactionBodies(src);
      for (const body of bodies) {
        if (hasReadAfterWrite(body)) {
          violations.push(
            `${path.relative(FUNCTIONS_SRC, file)}: tx.get found after tx.set/update/delete`,
          );
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Firestore transaction read-after-write violations:\n` +
          violations.map(v => `  ${v}`).join('\n') +
          '\n\nAll tx.get calls must come before any tx.set/update/delete in the same transaction body.',
      );
    }
    expect(violations).toHaveLength(0);
  });
});
