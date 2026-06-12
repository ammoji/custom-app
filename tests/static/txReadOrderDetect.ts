/**
 * HOTFIX-PUBLISH-TX-ORDER §D — pure detection helpers for the
 * transaction read-order static guard. Extracted so both the static
 * guard (transactionReadOrderAudit.test.ts) and the unit tests
 * (txReadOrderDetect.test.ts) share one implementation.
 */

/**
 * Strip string literals (', ", `), line comments, and block comments from
 * source, replacing their contents with spaces (preserving length + newlines).
 * This lets the brace matcher count only structural braces and avoids false
 * positives from braces inside strings/comments/template literals.
 */
function blankStringsAndComments(src: string): string {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    // Line comment
    if (c === '/' && next === '/') {
      let j = i + 2;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    // Block comment
    if (c === '/' && next === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      j = Math.min(j + 2, n);
      blank(i, j);
      i = j;
      continue;
    }
    // String / template literal
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === quote) { j++; break; }
        j++;
      }
      blank(i + 1, j - 1);
      i = j;
      continue;
    }
    i++;
  }
  return out.join('');
}

/** Extract the body (including braces) of each runTransaction async callback. */
export function extractTransactionBodies(src: string): string[] {
  const clean = blankStringsAndComments(src);
  const bodies: string[] = [];
  const start = /runTransaction\s*\(\s*async\s+\w+\s*=>\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = start.exec(clean)) !== null) {
    const openIdx = m.index + m[0].lastIndexOf('{');
    let depth = 0;
    let i = openIdx;
    while (i < clean.length) {
      if (clean[i] === '{') depth++;
      else if (clean[i] === '}') {
        depth--;
        if (depth === 0) {
          bodies.push(clean.slice(openIdx, i + 1));
          break;
        }
      }
      i++;
    }
  }
  return bodies;
}

/** True when a tx.get appears after any tx.set/update/delete in the body. */
export function hasReadAfterWrite(body: string): boolean {
  const firstWriteIdx = body.search(/\btx\.(set|update|delete)\s*\(/);
  if (firstWriteIdx === -1) return false;
  const afterWrites = body.slice(firstWriteIdx);
  return /\btx\.get\s*\(/.test(afterWrites);
}
