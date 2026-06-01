/**
 * PR-NEXT-ENH-3 (finding #6 follow-up) — filter a menu list down to
 * a single category. Reference-equality return when no category is
 * selected (matches PR-NEXT-9's `filterMenuByQuery` posture so the
 * screen's useMemo doesn't churn on empty filters).
 *
 * Defensive: items with non-string `category` are dropped silently.
 * Should never happen in practice — `addCustomMenuItem` validates
 * category against the whitelist — but the cost of the check is one
 * comparison per item.
 *
 * Pinned by tests/utils/filterMenuByCategory.test.ts.
 */
import type { CategoryId } from '../constants/categories';

export function filterMenuByCategory<T extends { category: string }>(
  items: T[],
  selectedCategory: CategoryId | null,
): T[] {
  if (selectedCategory == null) return items;
  return items.filter(
    i => typeof i.category === 'string' && i.category === selectedCategory,
  );
}
