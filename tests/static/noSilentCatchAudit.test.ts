/**
 * HOTFIX-SILENT-CATCH-GUARD — sixth permanent static-source guard.
 * Bans empty / log-less `.catch(() => {...})` blocks across src/. Each
 * silent catch hides three failure modes (missing server callable,
 * building composite index, IAM denial) and blocks Sentry visibility.
 *
 * Companion to:
 *   - noStaleDeferralComments (Bundle H)
 *   - transactionReadOrderAudit (HOTFIX-PUBLISH-TX-ORDER)
 *   - shopOwnerCheckAudit (HOTFIX-OWNER-CARD-AMEND)
 *   - partnerStatusAudit (HOTFIX-PARTNER-STATUS-DISPLAY)
 *   - noSilentCatchAudit (this guard) ← NEW
 *
 * Allowlist: inline `silent-catch-audit:allow` on the catch line or the
 * line directly above, with a one-line justification. Use sparingly.
 *
 * Deliberate-break demo: revert any migrated data-fetch catch back to
 * `.catch(() => {})` → this test fails with a file:line pinpoint.
 */
import * as fs from 'fs';
import * as path from 'path';
import { findSilentCatches } from './noSilentCatchDetect';

const SRC = path.resolve(__dirname, '../../src');

function walkSrc(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) results.push(...walkSrc(full));
    else if (
      (full.endsWith('.tsx') || full.endsWith('.ts')) &&
      !full.includes('.test.')
    ) {
      results.push(full);
    }
  }
  return results;
}

describe('silent catch audit', () => {
  it('every .catch(() => {...}) in src/ logs, rethrows, sets error state, or surfaces to the user', () => {
    const violations: string[] = [];
    for (const file of walkSrc(SRC)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const line of findSilentCatches(src)) {
        violations.push(`${path.relative(SRC, file)}:${line}`);
      }
    }
    if (violations.length > 0) {
      throw new Error(
        'Silent .catch blocks found — a swallowed failure is ' +
          'indistinguishable from success-with-empty-data:\n' +
          violations.map(v => `  ${v}`).join('\n') +
          '\n\nAdd Sentry.captureException, set an error state, log, or ' +
          'surface to the user. For a genuinely fire-and-forget catch, add ' +
          'an inline `silent-catch-audit:allow` comment with a justification.',
      );
    }
    expect(violations).toEqual([]);
  });
});
