/**
 * HOTFIX-PARTNER-STATUS-DISPLAY §C — fifth permanent static-source
 * guard. Any subtitle/label string containing "On the way" or
 * "Heading to" MUST be inside a render block that also checks for
 * finalized order status (delivered/cancelled). Catches two-state
 * subtitle bugs at npm test time, before they ship.
 *
 * Companion to:
 *   - authClaimNamesAudit (Bundle G)
 *   - noStaleDeferralComments (Bundle H)
 *   - transactionReadOrderAudit (HOTFIX-PUBLISH-TX-ORDER)
 *   - shopOwnerCheckAudit (HOTFIX-OWNER-CARD-AMEND)
 *   - partnerStatusAudit (this guard) ← NEW
 *
 * Deliberate-break demo: revert §A's helper consumption back to the
 * two-state ternary on `pickedUp` (no delivered/cancelled branch) →
 * this test fails with a file:line pinpoint. Restore. Passes.
 */
import * as fs from 'fs';
import * as path from 'path';
import { findUnguardedInflightStrings } from './partnerStatusDetect';

const SRC = path.resolve(__dirname, '../../src');
// The helper itself is the source of truth for the three-state copy.
const IGNORE = new Set([path.resolve(SRC, 'utils/derivePartnerCardSubtitle.ts')]);

function walkSrc(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) results.push(...walkSrc(full));
    else if (
      (full.endsWith('.tsx') || full.endsWith('.ts')) &&
      !full.includes('.test.') &&
      !IGNORE.has(full)
    ) {
      results.push(full);
    }
  }
  return results;
}

describe('partner status display audit', () => {
  it('every "On the way" / "Heading to" usage sits below a delivered/cancelled branch', () => {
    const violations: string[] = [];
    for (const file of walkSrc(SRC)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const hit of findUnguardedInflightStrings(src)) {
        violations.push(`${path.relative(SRC, file)}:${hit}`);
      }
    }
    if (violations.length > 0) {
      throw new Error(
        'Two-state (in-flight only) partner status strings found — they go ' +
          'stale after delivery/cancellation:\n' +
          violations.map(v => `  ${v}`).join('\n') +
          '\n\nGate the copy on a finalized-status branch (delivered/cancelled) ' +
          'or consume derivePartnerCardSubtitle(). For an intentional exception, ' +
          'add an inline `partner-status-audit:allow` comment.',
      );
    }
    expect(violations).toEqual([]);
  });
});
