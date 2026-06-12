/**
 * HOTFIX-RESPOND-OWNER §C — static guard banning the indirect
 * shop-ownership lookup pattern. The right pattern is a direct shop
 * doc read + ownerUid comparison (see respondToReviewOwnerCheckHelpers.ts).
 * The wrong pattern is `where('ownerUid', '==', X).limit(1)` followed by
 * comparing the arbitrary first result's id to the intended shopId —
 * which breaks for owners of multiple shops.
 *
 * Fourth permanent static guard after authClaimNames (Bundle G),
 * noStaleDeferralComments (Bundle H), and transactionReadOrder
 * (HOTFIX-PUBLISH-TX-ORDER).
 *
 * Deliberate-break demo: revert respondToReview to the inline
 * `where(ownerUid).limit(1)` pattern (without a shop-owner-audit:allow
 * comment) → this test fails. Restore. Passes.
 */
import * as fs from 'fs';
import * as path from 'path';
import { findBannedOwnerLookups } from './shopOwnerCheckDetect';

const FUNCTIONS_SRC = path.resolve(__dirname, '../../functions/src');

function walkTs(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) results.push(...walkTs(full));
    else if (full.endsWith('.ts')) results.push(full);
  }
  return results;
}

describe('shop ownership check audit', () => {
  it('no callable uses where(ownerUid == X).limit(1) for auth (unless allowlisted)', () => {
    const violations: string[] = [];
    for (const file of walkTs(FUNCTIONS_SRC)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const hit of findBannedOwnerLookups(src)) {
        violations.push(`${path.relative(FUNCTIONS_SRC, file)}: ${hit}`);
      }
    }
    if (violations.length > 0) {
      throw new Error(
        'Banned indirect shop-ownership lookups found:\n' +
          violations.map(v => `  ${v}`).join('\n') +
          '\n\nUse a direct shops/{shopId} doc read + ownerUid comparison ' +
          '(validateShopOwnerForReview). For a legitimate "find my own shop" ' +
          'query, add a `shop-owner-audit:allow` comment on/above the line.',
      );
    }
    expect(violations).toEqual([]);
  });
});
