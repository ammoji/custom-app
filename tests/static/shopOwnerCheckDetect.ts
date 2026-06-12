/**
 * HOTFIX-RESPOND-OWNER §C — pure detector for the banned indirect
 * shop-ownership lookup pattern. Shared by the static guard
 * (shopOwnerCheckAudit.test.ts) and its detection unit tests.
 *
 * BANNED:  `.where('ownerUid', '==', <x>) ... .limit(1)` used for an
 *          auth check (resolve an arbitrary shop, compare its id).
 * CORRECT: read the SPECIFIC shop doc by id, compare ownerUid.
 *
 * Allowlist: a legitimate "find my own shop" query (no specific shop
 * intended) may opt out with a `shop-owner-audit:allow` comment on the
 * match line or within the 3 lines immediately preceding it. The
 * allowlist is LINE-scoped, not file-scoped, so other violations in
 * the same file are still caught.
 */

const BANNED = /\.where\(['"]ownerUid['"],\s*['"]==['"],\s*[\w.]+\)[\s\S]{0,40}?\.limit\(1\)/g;
const ALLOW_TOKEN = 'shop-owner-audit:allow';

/** Returns the matched substrings that are NOT line-allowlisted. */
export function findBannedOwnerLookups(src: string): string[] {
  const violations: string[] = [];
  const lines = src.split('\n');
  // Precompute the char offset at the start of each line.
  const lineStart: number[] = [];
  let acc = 0;
  for (const line of lines) {
    lineStart.push(acc);
    acc += line.length + 1; // +1 for the stripped '\n'
  }
  const lineNumberAt = (idx: number): number => {
    let lo = 0;
    let hi = lineStart.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStart[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  let m: RegExpExecArray | null;
  BANNED.lastIndex = 0;
  while ((m = BANNED.exec(src)) !== null) {
    const startLine = lineNumberAt(m.index);
    const endLine = lineNumberAt(m.index + m[0].length - 1);
    const ctxFrom = Math.max(0, startLine - 3);
    const context = lines.slice(ctxFrom, endLine + 1).join('\n');
    if (!context.includes(ALLOW_TOKEN)) {
      violations.push(m[0]);
    }
  }
  return violations;
}
