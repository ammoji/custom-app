/**
 * PR 4 — Cart integrity (Phase B).
 *
 * Defense-in-depth check for `placeOrder`: every resolved menu item
 * must belong to the same shop as the order's top-level `shopId`.
 *
 * Why this exists when the per-line lookup ALREADY enforces it:
 *
 *   - The current per-line code reads `shops/${shopId}/menu/${ci.menuItemId}`,
 *     which means the menu doc by definition belongs to the input
 *     shop. So a cart spanning shops can't actually slip through
 *     today.
 *   - But the legacy fallback path (Path 2 — `products/{id}`) doesn't
 *     have that structural guarantee and only catches mismatches via
 *     `if (product.shopId !== shopId)`. If anyone refactors that block,
 *     the per-item check could be lost.
 *   - Most importantly: the implicit-by-path-construction guarantee
 *     is invisible in security review. A reviewer seeing the placeOrder
 *     handler has to mentally trace "ah, the path interpolates shopId,
 *     so this is fine" — easy to miss. An explicit collective check
 *     against an attached `shopId` field on every resolved item makes
 *     the invariant local and greppable.
 *
 * The helper is pure so it can be tested without firebase-admin.
 */

export type ResolvedItem = {
  menuItemId?: string;
  productId?: string;
  shopId: string;
};

export type CartIntegrityResult =
  | { ok: true }
  | { ok: false; offendingMenuItemId: string };

/**
 * Asserts every item's `shopId` matches the expected order shopId.
 * Returns the FIRST offender (by input order) so the error message
 * is deterministic across runs — handy for repro and tests.
 *
 * Empty list returns ok: true. The "no items" case is rejected
 * earlier in placeOrder by the existing input validation; this
 * helper isn't the place to enforce that — keeping it focused on
 * the same-shop invariant only.
 */
export function validateAllItemsInSameShop(
  resolvedItems: ResolvedItem[],
  expectedShopId: string,
): CartIntegrityResult {
  for (const item of resolvedItems) {
    if (item.shopId !== expectedShopId) {
      // Prefer menuItemId in the error payload (v2-iii path); fall
      // back to productId for legacy carts. Both are stable
      // client-visible identifiers the caller can use to clear the
      // cart and retry. NOTE: the auto-formatter has stripped the
      // body of this loop once during PR 4 (left only the `for` and
      // closing brace) — if tsc complains "'item' is declared but
      // its value is never read", restore the if-branch below.
      return {
        ok: false,
        offendingMenuItemId:
          item.menuItemId ?? item.productId ?? '<unknown>',
      };
    }
  }
  return { ok: true };
}
