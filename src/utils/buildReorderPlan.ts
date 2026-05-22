/**
 * PR 13 — Repeat order helper.
 *
 * Pure helper that joins a past order's line items against the
 * shop's CURRENT menu to produce a reorder plan. The plan tells the
 * UI which items are still available (at what price), which are
 * gone, and whether any prices have changed since the original
 * order.
 *
 * Join key: CartItem.menuItemId → MenuItem.id. PR 4's cart
 * integrity hotfix guaranteed menuItemId is present on every order
 * line written from then on. Legacy orders without menuItemId fall
 * back to matching by productId; if that also fails, the item is
 * treated as removed_from_menu (the menu doc was probably deleted).
 *
 * Pure — no Firestore reads, no React, no clock. Pinned by
 * tests/utils/buildReorderPlan.test.ts.
 */

import type { CartItem, MenuItem, Order } from '../types';

export type ReorderLineStatus =
  | 'available_same_price'
  | 'available_price_increased'
  | 'available_price_decreased'
  | 'out_of_stock'
  | 'removed_from_menu';

export type ReorderLine = {
  // Identity carried over from the past order. For
  // removed_from_menu items we fall back to productId so the UI
  // still has SOMETHING to render as the row key.
  menuItemId: string;
  // Past-order snapshot — what the customer ORIGINALLY paid.
  oldPrice: number;
  oldQuantity: number;
  // Past-order display fields, used as a fallback when the menu
  // item has been deleted (currentMenuItem === null) so the row
  // can still render a name + image.
  pastName: string;
  pastImageUrl: string;
  pastPackLabel: string;
  // Live values from the current menu (or null if unavailable).
  currentMenuItem: MenuItem | null;
  // Derived status flag.
  status: ReorderLineStatus;
  // For unavailable items, a customer-friendly reason string.
  reason?: string;
};

export type ReorderPlan = {
  shopId: string;
  shopName: string;
  lines: ReorderLine[];
  // Derived counts for the modal CTA copy.
  availableCount: number;
  unavailableCount: number;
  hasPriceChanges: boolean;
};

export function buildReorderPlan(
  pastOrder: Order,
  currentMenuItems: MenuItem[],
): ReorderPlan {
  const menuByMenuItemId = new Map<string, MenuItem>();
  const menuByProductId = new Map<string, MenuItem>();
  for (const m of currentMenuItems) {
    menuByMenuItemId.set(m.id, m);
    if (m.productId) menuByProductId.set(m.productId, m);
  }

  const lines: ReorderLine[] = pastOrder.items.map(item => {
    // Prefer menuItemId join (post-PR-4 contract). Fall back to
    // productId for legacy orders. Both lookups defend against the
    // empty-string edge case (some old orders have menuItemId === '').
    const live: MenuItem | null =
      (item.menuItemId && menuByMenuItemId.get(item.menuItemId)) ||
      (item.productId && menuByProductId.get(item.productId)) ||
      null;

    const base = {
      menuItemId: item.menuItemId || item.productId,
      oldPrice: item.price,
      oldQuantity: item.quantity,
      pastName: item.name,
      pastImageUrl: item.imageUrl,
      pastPackLabel: item.packLabel,
    };

    if (!live) {
      return {
        ...base,
        currentMenuItem: null,
        status: 'removed_from_menu',
        reason: 'No longer offered by the shop',
      };
    }

    // PR 8 added per-menu-item availability + optional stock count.
    // Treat available === false as out of stock, regardless of count.
    if (live.available === false) {
      return {
        ...base,
        menuItemId: live.id,
        currentMenuItem: live,
        status: 'out_of_stock',
        reason: 'Currently unavailable',
      };
    }
    if (
      typeof live.stock === 'number' &&
      live.stock !== null &&
      live.stock <= 0
    ) {
      return {
        ...base,
        menuItemId: live.id,
        currentMenuItem: live,
        status: 'out_of_stock',
        reason: 'Currently out of stock',
      };
    }

    // Available — categorise by price drift.
    let status: ReorderLineStatus = 'available_same_price';
    if (live.price > item.price) status = 'available_price_increased';
    else if (live.price < item.price) status = 'available_price_decreased';

    return {
      ...base,
      menuItemId: live.id,
      currentMenuItem: live,
      status,
    };
  });

  const availableCount = lines.filter(l =>
    l.status.startsWith('available_'),
  ).length;
  const unavailableCount = lines.length - availableCount;
  const hasPriceChanges = lines.some(
    l =>
      l.status === 'available_price_increased' ||
      l.status === 'available_price_decreased',
  );

  return {
    shopId: pastOrder.shopId,
    shopName: pastOrder.shopName,
    lines,
    availableCount,
    unavailableCount,
    hasPriceChanges,
  };
}

/**
 * Convert the available lines of a ReorderPlan into CartItem shape
 * ready to push into useCartStore.replaceCartWithItems(). Drops
 * unavailable lines silently — the modal shows those in a separate
 * section so the customer knows what's missing before confirming.
 *
 * Prices are CURRENT (live menu price), quantities are PRESERVED
 * from the past order. priceSnapshot is set to the same current
 * price so placeOrder's drift validation passes immediately.
 */
export function planToCartItems(plan: ReorderPlan): CartItem[] {
  return plan.lines
    .filter(
      (l): l is ReorderLine & { currentMenuItem: MenuItem } =>
        l.currentMenuItem !== null && l.status.startsWith('available_'),
    )
    .map(l => {
      const m = l.currentMenuItem;
      return {
        // For GLOBAL items productId === menuItemId; for CUSTOM items
        // productId is null on the menu doc, so we fall back to the
        // menuItemId so increment/decrement keep working — same
        // contract menuItemToCartLine in useCartStore uses.
        productId: m.productId ?? m.id,
        menuItemId: m.id,
        name: m.name,
        imageUrl: m.imageUrl,
        packLabel: m.packLabel,
        price: m.price,
        priceSnapshot: m.price,
        quantity: l.oldQuantity,
      };
    });
}
