/**
 * PR-NEXT-8 §A (finding #14) — pure helpers for the dismissable-✕
 * behavior on Unavailable rows in `ReorderModal`.
 *
 * Pre-PR the ✕ glyph next to each unavailable row was a static
 * `<Text>` — visual-only, no `onPress`. Every UI convention reads a
 * red ✕ as "tap to dismiss," so customers tapped, nothing happened,
 * and the modal felt broken. The fix wires the ✕ to a real
 * `Pressable` whose `onPress` adds the row's `menuItemId` to a
 * modal-local `Set<string>`; the render path filters dismissed IDs
 * out of the visible list. Dismissal state is intentionally
 * ephemeral — closing and reopening the modal restores the full
 * Unavailable list (each reorder is a fresh decision).
 *
 * Pure / no React. The screen owns the `Set<string>` state in
 * `useState`; this module just owns the immutable-update + plan-key
 * logic so the contract is testable without rendering.
 *
 * Test suite: `tests/utils/reorderModalDismissals.test.ts`.
 */

/**
 * Add `id` to a dismissal set immutably (returns a fresh `Set` so
 * React's `setState` reference-comparison detects the change). If
 * `id` is already present, returns the same set instance — saves a
 * spurious re-render. Defensive: `null` / `undefined` / empty `id`
 * is a no-op (returns the input set unchanged).
 */
export function addDismissedId(
  current: Set<string>,
  id: string | null | undefined,
): Set<string> {
  if (!id) return current;
  if (current.has(id)) return current;
  const next = new Set(current);
  next.add(id);
  return next;
}

/**
 * Build a stable string key from a reorder plan's identity-bearing
 * contents (`shopId` + the ordered list of menu-item IDs). The
 * `ReorderModal`'s reset effect keys on this string — NOT on the
 * plan object reference — because the parent screen
 * (`HomeScreen` / `OrdersScreen`) may re-create the same plan
 * object across renders. Keying on identity-stable contents avoids
 * spurious dismissal-set resets when the modal re-renders for any
 * other reason.
 *
 * Returns `null` when the plan is null/undefined; the effect's
 * dependency array carries `null` cleanly through React's identity
 * comparison so the reset only fires on a real plan change.
 */
export function buildPlanKey(
  plan: { shopId?: string; lines?: { menuItemId: string }[] } | null | undefined,
): string | null {
  if (!plan) return null;
  const shopId = plan.shopId ?? '';
  const lineIds = Array.isArray(plan.lines)
    ? plan.lines.map(l => l.menuItemId).join(',')
    : '';
  return `${shopId}:${lineIds}`;
}
