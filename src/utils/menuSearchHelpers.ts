/**
 * PR-NEXT-9 (finding #6) — pure helpers for in-shop menu search +
 * recent-query history. Lives outside the screen components so the
 * substring-match, normalise, and history-update contracts can be
 * unit-tested without booting React or AsyncStorage.
 *
 * Mirrors the validator-Result + pure-state-machine pattern from
 * `pollFailureGate` (PR-NEXT-5), `reorderModalDismissals` (PR-NEXT-8),
 * and the COD-payment helpers (PR-NEXT-3).
 */

/**
 * Normalise a raw text-input query for both filtering AND history
 * storage. Trim ends, collapse internal whitespace to single spaces,
 * lowercase. Returns '' for the empty case so callers can branch
 * cleanly on truthiness.
 *
 * Why collapse whitespace before storage: `"atta "` and `"atta"` and
 * `"  atta"` are the same intent; storing them as distinct history
 * entries clutters the chips.
 *
 * Hindi / Devanagari note: `toLowerCase()` is a no-op for Devanagari
 * codepoints (no upper/lower case in the script), so this normaliser
 * works for mixed-script names without special handling.
 */
export function normalizeSearchQuery(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Case-insensitive substring filter on item `name`. Returns the
 * input array verbatim (same reference, not a copy) when the query
 * normalises to empty — saves a useless re-render at the screen
 * level and signals "no filter applied" to the caller.
 *
 * Defensive: items with non-string names are dropped silently.
 * Should never happen in practice (MenuItem.name is required), but
 * the cost of the typeof check is one comparison per item and the
 * upside is a malformed doc can't crash the menu screen.
 */
export function filterMenuByQuery<T extends { name: string }>(
  items: T[],
  rawQuery: string | null | undefined,
): T[] {
  const q = normalizeSearchQuery(rawQuery);
  if (!q) return items;
  return items.filter(
    i => typeof i.name === 'string' && i.name.toLowerCase().includes(q),
  );
}

/**
 * Dedup-then-move-to-front history update. `max` caps the result.
 *
 *  - Empty / whitespace-only query → return input unchanged (don't
 *    pollute history with empty submits).
 *  - Query already present at any index → move to position 0,
 *    preserve the rest in original order, drop the old slot.
 *  - Query not present → unshift, then truncate to max.
 *  - Returns the same array reference iff nothing changed (saves a
 *    useless AsyncStorage write at the call site).
 */
export const DEFAULT_HISTORY_MAX = 5;

export function pushToSearchHistory(
  history: readonly string[],
  rawQuery: string | null | undefined,
  max: number = DEFAULT_HISTORY_MAX,
): string[] {
  const q = normalizeSearchQuery(rawQuery);
  if (!q) return history as string[];
  if (history.length > 0 && history[0] === q) {
    // Idempotent: re-saving the most-recent query is a no-op. Keeps
    // `onBlur` + `onSubmitEditing` firing back-to-back from doubling
    // up.
    return history as string[];
  }
  const next = [q, ...history.filter(h => h !== q)];
  if (next.length > max) next.length = max;
  return next;
}
