/**
 * PR-NEXT-BUNDLE-H §F — static-source guard: no stale
 * "deferred to a future PR" comments in src/components/ or
 * src/screens/.
 *
 * Institutional guard pattern mirrors authClaimNamesAudit.test.ts
 * (Bundle G). These comments should be in docs/ROADMAP.md, not
 * silently left in component headers. If you need to defer a feature,
 * add a [ ] ROADMAP item and remove the inline comment.
 *
 * Deliberate-break demo:
 *   Add a comment "deferred to a future PR" to any file under
 *   src/components/ → this test fails. Remove the comment. Passes.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '../../src');
const SCANNED_DIRS = ['components', 'screens'];
const PATTERN = /deferred to a future PR/i;

function walkFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkFiles(full));
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      results.push(full);
    }
  }
  return results;
}

describe('noStaleDeferralComments', () => {
  it('src/components/ + src/screens/ have zero "deferred to a future PR" comments', () => {
    const hits: string[] = [];
    for (const subdir of SCANNED_DIRS) {
      const dir = path.join(SRC_ROOT, subdir);
      if (!fs.existsSync(dir)) continue;
      for (const file of walkFiles(dir)) {
        const content = fs.readFileSync(file, 'utf8');
        if (PATTERN.test(content)) {
          hits.push(path.relative(SRC_ROOT, file));
        }
      }
    }
    if (hits.length > 0) {
      throw new Error(
        `Found "deferred to a future PR" in ${hits.length} file(s):\n` +
          hits.map(h => `  src/${h}`).join('\n') +
          '\n\nMove deferrals to docs/ROADMAP.md and remove the inline comments.',
      );
    }
    expect(hits).toHaveLength(0);
  });
});
