/**
 * HOTFIX-SILENT-CATCH-GUARD — pure detector backing the sixth permanent
 * static-source guard (tests/static/noSilentCatchAudit.test.ts).
 *
 * A `.catch(...) => { ... }` block with a body that does NOT do at least
 * one of:
 *   - report to Sentry (captureException / captureMessage)
 *   - rethrow
 *   - set an error state (setXxxError)
 *   - log (console.error / console.warn)
 *   - surface to the user (Alert.alert / showAlert)
 * swallows the failure with zero breadcrumb. That single pattern masked
 * the dashboard `count = 0` bug for an entire retest cycle (missing
 * callable / building index / IAM ACAB all looked identical to
 * success-with-empty-data).
 *
 * Detection is robust to one-liners, nested braces, strings and comments
 * (so a `{` inside a string or a `throw` inside a comment never fools the
 * brace matcher or the acceptability check).
 *
 * Allowlist: an inline `silent-catch-audit:allow` comment on the catch
 * line or the line directly above exempts a genuinely fire-and-forget
 * catch (telephony deep-links, haptics, best-effort telemetry). The
 * comment must carry a one-line justification.
 */

export const ACCEPTABLE_CATCH =
  /Sentry\.(?:captureException|captureMessage)|\bthrow\b|set\w*[Ee]rror|console\.(?:error|warn)|Alert\.alert|showAlert/;

const CATCH_OPEN =
  /\.catch\(\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g;

/** Returns the index of the `}` matching the `{` at `openIdx`, or -1. */
function matchBrace(src: string, openIdx: number): number {
  let depth = 0;
  let inStr: string | null = null;
  let inLine = false;
  let inBlock = false;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLine) {
      if (ch === '\n') inLine = false;
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inStr) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

export function isCatchBodyAcceptable(body: string): boolean {
  return ACCEPTABLE_CATCH.test(stripComments(body));
}

/**
 * Returns the 1-indexed line numbers of every silent `.catch` block in
 * `src`. Skips matches that are themselves inside a comment line and any
 * carrying a `silent-catch-audit:allow` annotation.
 */
export function findSilentCatches(src: string): number[] {
  const lines = src.split('\n');
  const violations: number[] = [];
  CATCH_OPEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CATCH_OPEN.exec(src)) !== null) {
    const braceStart = m.index + m[0].length - 1;
    const end = matchBrace(src, braceStart);
    if (end === -1) continue;
    const body = src.slice(braceStart + 1, end);
    const line = src.slice(0, m.index).split('\n').length; // 1-indexed

    const lineText = lines[line - 1] ?? '';
    const trimmed = lineText.trim();
    // The `.catch(` token sits inside a comment — not real code.
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    // Allowlist: the catch line itself, or anywhere in the contiguous
    // comment block immediately above it. Walking the whole block (rather
    // than just the single line above) lets the justification span several
    // `//` lines without the annotation falling out of range.
    let allowed = lineText.includes('silent-catch-audit:allow');
    for (let i = line - 2; i >= 0 && !allowed; i--) {
      const t = (lines[i] ?? '').trim();
      if (!t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')) break;
      if (t.includes('silent-catch-audit:allow')) allowed = true;
    }
    if (allowed) continue;

    if (!isCatchBodyAcceptable(body)) violations.push(line);
  }
  return violations;
}
