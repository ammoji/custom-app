# PR 13 — Repeat order button (Windsurf prompt)

## Why this PR exists

The single highest-leverage retention feature for a grocery app. Indian
kirana shopping is fundamentally **weekly-routine** — same atta, same
rice, same dal, every week. Re-creating the cart from scratch each time
is friction that competitors (Swiggy Instamart, Zepto, BlinkIt) have
solved with one-tap reorder. Without this feature, customers churn back
to those competitors after one or two cycles.

The UX target: in OrdersScreen, tap "Reorder" on a past order card →
modal opens showing the items being re-added with current prices and
availability → tap "Add to cart" → cart is replaced with those items →
navigate to Cart screen.

Critically, this PR is **JS-only client work** — no schema changes, no
server changes, no Cloud Functions, no Firestore rules. The existing
`shopService.getById` and `listShopMenuPublic` callable already
return the current menu; we just need to cross-reference past order
items against it and rebuild the cart.

Single OTA. ~3–4 hours Windsurf work.

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md`.
- `src/store/useCartStore.ts` — note `forceAddMenuItem` (per-item add)
  and `clearCart` (empty). The pattern for the new `replaceCartWithItems`
  method should mirror their style + write Analytics breadcrumb.
- `src/services/shopService.ts` — `getById(shopId, userLocation)`
  returns the shop. For the menu, native uses `listShopMenuPublic`
  callable, web uses `getDocs(collection(db, 'shops/{shopId}/menu'))`.
  Note: PR 12 broadened the shop visibility on web — the existing
  query path stays valid.
- `src/screens/OrdersScreen.tsx` — the list this PR adds the button
  to. Each card currently shows order summary + status; we're adding
  one new button per card on terminal-status orders.
- `src/types/index.ts` — `Order`, `OrderItem`, `MenuItem`, `CartItem`
  shapes. Note `OrderItem` carries `menuItemId` (added in PR 4 hotfix);
  this is the key that joins past-order items to current-menu items.
- `src/components/common/Button.tsx` — reuse for the modal's primary
  and secondary actions. Same pattern as PR 12's ETA modal.
- Critical lesson from PR 12: **any `useState` in a screen MUST be
  declared above any conditional early returns.** React's Rules of
  Hooks require the same hook call order on every render. The PR 12
  ETA modal regression was caused by violating this — don't repeat.

## Scope (in)

### Part 1 — Pure helper `buildReorderPlan`

New file `src/utils/buildReorderPlan.ts`:

```ts
/**
 * Pure helper that joins a past order's line items against the
 * shop's CURRENT menu to produce a reorder plan. The plan tells the
 * UI which items are still available (at what price), which are
 * gone, and whether any prices have changed since the original
 * order.
 *
 * Join key: OrderItem.menuItemId → MenuItem.id. PR 4's cart
 * integrity hotfix guaranteed menuItemId is present on every order
 * line written from then on. Legacy orders without menuItemId fall
 * back to matching by productId; if that also fails, the item is
 * treated as unavailable (the menu doc was probably deleted).
 *
 * Pure — no Firestore reads, no React, no clock. Pinned by
 * tests/utils/buildReorderPlan.test.ts.
 */
import type { CartItem, MenuItem, Order } from '../types';

export type ReorderLine = {
  // Identity carried over from the past order.
  menuItemId: string;
  // Snapshot from the past order — what the customer ORIGINALLY paid.
  oldPrice: number;
  oldQuantity: number;
  // Live values from the current menu (or null if unavailable).
  currentMenuItem: MenuItem | null;
  // Derived status flags.
  status:
    | 'available_same_price'
    | 'available_price_increased'
    | 'available_price_decreased'
    | 'out_of_stock'
    | 'removed_from_menu';
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
    // productId for legacy orders.
    const live =
      (item.menuItemId && menuByMenuItemId.get(item.menuItemId)) ||
      menuByProductId.get(item.productId) ||
      null;

    if (!live) {
      return {
        menuItemId: item.menuItemId ?? item.productId,
        oldPrice: item.price,
        oldQuantity: item.quantity,
        currentMenuItem: null,
        status: 'removed_from_menu',
        reason: 'No longer offered by the shop',
      };
    }

    // PR 8 added per-menu-item availability + optional stock count.
    // Treat available === false as out of stock, regardless of count.
    if (live.available === false) {
      return {
        menuItemId: live.id,
        oldPrice: item.price,
        oldQuantity: item.quantity,
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
        menuItemId: live.id,
        oldPrice: item.price,
        oldQuantity: item.quantity,
        currentMenuItem: live,
        status: 'out_of_stock',
        reason: 'Currently out of stock',
      };
    }

    // Available — categorise by price drift.
    let status: ReorderLine['status'] = 'available_same_price';
    if (live.price > item.price) status = 'available_price_increased';
    else if (live.price < item.price) status = 'available_price_decreased';

    return {
      menuItemId: live.id,
      oldPrice: item.price,
      oldQuantity: item.quantity,
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
 * unavailable lines silently — the UI shows those separately so the
 * customer knows what's missing before confirming.
 */
export function planToCartItems(plan: ReorderPlan): CartItem[] {
  return plan.lines
    .filter(l => l.currentMenuItem && l.status.startsWith('available_'))
    .map(l => {
      const m = l.currentMenuItem!;
      return {
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
```

### Part 2 — Tests for the pure helper

New file `tests/utils/buildReorderPlan.test.ts`:

```ts
import { describe, it, expect } from '@jest/globals';
import {
  buildReorderPlan,
  planToCartItems,
} from '../../src/utils/buildReorderPlan';
import type { MenuItem, Order } from '../../src/types';

function makeOrder(items: Partial<Order['items'][number]>[]): Order {
  return {
    id: 'order_1',
    shopId: 'shop_1',
    shopName: 'Test Shop',
    customerUid: 'u1',
    items: items.map((i, idx) => ({
      productId: i.productId ?? `p_${idx}`,
      menuItemId: i.menuItemId,
      name: i.name ?? `Item ${idx}`,
      imageUrl: 'x',
      packLabel: '1 kg',
      price: i.price ?? 100,
      quantity: i.quantity ?? 1,
      priceSnapshot: i.priceSnapshot ?? i.price ?? 100,
    })) as Order['items'],
    // other Order fields filled with safe defaults
  } as Order;
}

function makeMenuItem(over: Partial<MenuItem>): MenuItem {
  return {
    id: over.id ?? 'm_1',
    shopId: over.shopId ?? 'shop_1',
    productId: over.productId,
    name: over.name ?? 'Test',
    imageUrl: 'x',
    packLabel: '1 kg',
    price: over.price ?? 100,
    available: over.available !== false,
    stock: over.stock,
  } as MenuItem;
}

describe('buildReorderPlan', () => {
  it('marks an item with unchanged price as available_same_price', () => {
    const past = makeOrder([{ menuItemId: 'm_1', price: 100, quantity: 2 }]);
    const menu = [makeMenuItem({ id: 'm_1', price: 100 })];
    const plan = buildReorderPlan(past, menu);
    expect(plan.lines[0].status).toBe('available_same_price');
    expect(plan.availableCount).toBe(1);
    expect(plan.hasPriceChanges).toBe(false);
  });

  it('marks price_increased when current price is higher', () => {
    const past = makeOrder([{ menuItemId: 'm_1', price: 100, quantity: 1 }]);
    const menu = [makeMenuItem({ id: 'm_1', price: 120 })];
    const plan = buildReorderPlan(past, menu);
    expect(plan.lines[0].status).toBe('available_price_increased');
    expect(plan.hasPriceChanges).toBe(true);
  });

  it('marks price_decreased when current price is lower', () => {
    const past = makeOrder([{ menuItemId: 'm_1', price: 100, quantity: 1 }]);
    const menu = [makeMenuItem({ id: 'm_1', price: 80 })];
    const plan = buildReorderPlan(past, menu);
    expect(plan.lines[0].status).toBe('available_price_decreased');
    expect(plan.hasPriceChanges).toBe(true);
  });

  it('marks removed_from_menu when no menu item matches', () => {
    const past = makeOrder([{ menuItemId: 'm_gone', price: 50, quantity: 1 }]);
    const menu = [makeMenuItem({ id: 'm_other', price: 200 })];
    const plan = buildReorderPlan(past, menu);
    expect(plan.lines[0].status).toBe('removed_from_menu');
    expect(plan.unavailableCount).toBe(1);
  });

  it('marks out_of_stock when menu item has available=false', () => {
    const past = makeOrder([{ menuItemId: 'm_1', price: 100, quantity: 1 }]);
    const menu = [makeMenuItem({ id: 'm_1', price: 100, available: false })];
    const plan = buildReorderPlan(past, menu);
    expect(plan.lines[0].status).toBe('out_of_stock');
  });

  it('marks out_of_stock when stock <= 0', () => {
    const past = makeOrder([{ menuItemId: 'm_1', price: 100, quantity: 1 }]);
    const menu = [makeMenuItem({ id: 'm_1', price: 100, stock: 0 })];
    const plan = buildReorderPlan(past, menu);
    expect(plan.lines[0].status).toBe('out_of_stock');
  });

  it('falls back to productId join for legacy orders without menuItemId', () => {
    const past = makeOrder([
      { productId: 'p_legacy', menuItemId: undefined, price: 100, quantity: 1 },
    ]);
    const menu = [makeMenuItem({ id: 'm_1', productId: 'p_legacy', price: 100 })];
    const plan = buildReorderPlan(past, menu);
    expect(plan.lines[0].status).toBe('available_same_price');
    expect(plan.availableCount).toBe(1);
  });

  it('mixes available + unavailable in a single plan', () => {
    const past = makeOrder([
      { menuItemId: 'm_1', price: 100, quantity: 2 },
      { menuItemId: 'm_gone', price: 50, quantity: 1 },
      { menuItemId: 'm_2', price: 30, quantity: 3 },
    ]);
    const menu = [
      makeMenuItem({ id: 'm_1', price: 100 }),
      makeMenuItem({ id: 'm_2', price: 30, available: false }),
    ];
    const plan = buildReorderPlan(past, menu);
    expect(plan.availableCount).toBe(1);
    expect(plan.unavailableCount).toBe(2);
  });
});

describe('planToCartItems', () => {
  it('returns only available items at CURRENT price with OLD quantity', () => {
    const past = makeOrder([
      { menuItemId: 'm_1', price: 100, quantity: 5 },
      { menuItemId: 'm_gone', price: 50, quantity: 2 },
    ]);
    const menu = [makeMenuItem({ id: 'm_1', price: 120 })];
    const plan = buildReorderPlan(past, menu);
    const cart = planToCartItems(plan);
    expect(cart).toHaveLength(1);
    expect(cart[0].price).toBe(120); // current price, not old
    expect(cart[0].priceSnapshot).toBe(120);
    expect(cart[0].quantity).toBe(5); // preserved from past order
    expect(cart[0].menuItemId).toBe('m_1');
  });

  it('returns empty array when nothing is available', () => {
    const past = makeOrder([{ menuItemId: 'm_gone', price: 50, quantity: 1 }]);
    const menu: MenuItem[] = [];
    const plan = buildReorderPlan(past, menu);
    expect(planToCartItems(plan)).toEqual([]);
  });
});
```

Run once at the end per test-discipline.md.

### Part 3 — Cart store gets `replaceCartWithItems`

Add to `src/store/useCartStore.ts` next to `clearCart`:

```ts
// Type addition in CartState:
replaceCartWithItems: (
  items: CartItem[],
  shop: { id: string; name: string; deliveryFee: number },
) => void;
```

Implementation inside the create():

```ts
// PR 13 — repeat order. Atomic clear-and-replace so the reorder
// flow can swap the cart in one Zustand set() call instead of N
// sequential forceAddMenuItem calls. Mirrors the multi-shop
// replacement UX of Swiggy/Zomato: tapping Reorder always REPLACES
// the cart (never merges), so there's no need for a "merge mode".
// Quantities come from the past order; prices are CURRENT.
replaceCartWithItems: (items, shop) => {
  set({
    items,
    shopId: shop.id,
    shopName: shop.name,
    deliveryFee: shop.deliveryFee,
  });
  Analytics.add_to_cart({
    product_id: 'reorder',
    shop_id: shop.id,
    price: items.reduce((s, i) => s + i.price * i.quantity, 0),
    quantity: items.reduce((n, i) => n + i.quantity, 0),
  });
},
```

The Analytics event uses a synthetic `product_id: 'reorder'` and
the totals; this is the conventional pattern for bulk cart events
in their data model.

### Part 4 — Reorder preview modal

New file `src/components/order/ReorderModal.tsx`:

A modal that takes a `ReorderPlan` and shows three sections:

1. **Header**: "Reorder from {shopName}"
2. **Available items** (one row each): item name, pack label, current
   price + old price (if changed), quantity. Use a green check icon.
   For price changes, show `₹120` (current) with `₹100` struck through
   beside it, plus a small "+20%" or "-15%" badge.
3. **Unavailable items** (one row each, dimmed): item name, pack,
   reason ("Out of stock" / "No longer offered"). Use a grey X icon.
4. **Total preview**: subtotal of available items at current prices.
5. **CTA row**: "Cancel" (secondary) + "Add {N} items to cart" (primary).
   If `availableCount === 0`, primary becomes "No items available"
   and is disabled.

UX rules:
- Modal scrolls if many items.
- Tap outside / hardware back closes via `onRequestClose`.
- Pass `onConfirm(cartItems)` callback; modal's job is presentation
  only — no Zustand calls inside. The screen orchestrates state.

Component shape:

```tsx
type Props = {
  visible: boolean;
  plan: ReorderPlan | null;
  loading: boolean; // while menu is being fetched
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ReorderModal({ visible, plan, loading, onConfirm, onCancel }: Props) {
  // Loading state: spinner + "Checking availability..."
  // Empty plan + not loading: shouldn't happen if visibility is gated,
  // but defensive empty-state.
  // Rendered plan: header + sections + CTA row.
}
```

Styles follow the same pattern as `cancelWindowCard` in
OrderDetailScreen — `colors.primaryLight` background, rounded corners,
clear hierarchy.

### Part 5 — OrdersScreen integration

Modify `src/screens/OrdersScreen.tsx`:

1. **Add a "Reorder" button to each card** where
   `order.status === 'delivered' || order.status === 'cancelled'`
   (terminal states only — don't show for in-progress orders, the
   customer should follow that order to completion first).
2. **Tap handler `onReorderPress(order)`**:
   - Sets `selectedOrder` state to the tapped order
   - Sets `reorderLoading: true`
   - Opens the modal
   - Async: call `shopService.getById(order.shopId, userLocation)` to
     get current menu items (the existing getById already returns menu
     bundled for native via listShopMenuPublic — verify; if not, also
     fetch menu separately)
   - Build `ReorderPlan` via `buildReorderPlan(order, menuItems)`
   - Set `reorderPlan` state, `reorderLoading: false`
   - If shop fetch fails: close modal, show Alert
     ("This shop is no longer accepting orders. Try a different shop.")
3. **Tap handler `onConfirmReorder()`**:
   - Build cart items via `planToCartItems(reorderPlan)`
   - Call `useCartStore.getState().replaceCartWithItems(cartItems, {
       id: reorderPlan.shopId,
       name: reorderPlan.shopName,
       deliveryFee: <fetched from shop>,
     })`
   - Close modal
   - `nav.navigate('Cart')`
4. **Rules of Hooks compliance**: declare ALL new state
   (`selectedOrder`, `reorderPlan`, `reorderLoading`) at the TOP of
   the component, alongside the other `useState` calls. **Do not
   declare any `useState` after the early-return guards** — this was
   the PR 12 hotfix issue and must not recur. Add a comment block
   citing the PR 12 incident as a permanent warning.

### Part 6 — DO NOT TOUCH OrderDetailScreen for now

Out of scope for this PR. The orders list is the natural entry point;
the detail screen reorder button can come in a follow-up if testers
ask for it. Keeps blast radius small.

## Scope (out)

- **Reorder from HomeScreen "Order again" cards.** Premature without
  data on which shops are top reorders per user. Track for v2.
- **Partial reorder** (let user pick which items to include before
  confirming). Adds significant UX complexity for marginal value at
  MVP. Reorder is "all available items" or nothing.
- **Reorder for in-progress orders** (status = pending / accepted /
  preparing / ready_for_pickup). Surface only on terminal states.
- **Saved shopping lists / favorites.** Separate feature, will reuse
  `replaceCartWithItems` when built.
- **Push notification reminder** ("It's been 7 days since your last
  order from Mahesh Kirana — reorder?"). Out of scope; needs the
  push infrastructure not yet built.
- **Subscription / weekly recurring orders.** Distinct feature. The
  cart-replacement primitive here unblocks it; that's a future PR.

## Acceptance checklist

- [ ] `src/utils/buildReorderPlan.ts` created with `buildReorderPlan`
  and `planToCartItems` pure helpers.
- [ ] `tests/utils/buildReorderPlan.test.ts` covers ≥9 cases; all pass.
- [ ] `src/store/useCartStore.ts` has new `replaceCartWithItems`
  method; type added to `CartState`.
- [ ] `src/components/order/ReorderModal.tsx` created with the spec'd
  three sections + loading state + empty state.
- [ ] `src/screens/OrdersScreen.tsx` shows a "Reorder" button on
  terminal-status order cards. Tap opens the modal.
- [ ] **All new `useState` calls in OrdersScreen sit ABOVE any
  conditional early returns** (lesson from PR 12 hotfix).
- [ ] Confirm button replaces cart and navigates to Cart screen.
- [ ] Failed shop fetch shows a clean Alert (no crash, no stuck modal).
- [ ] `npx tsc --noEmit`: 0 errors (root + functions).
- [ ] `npm test`: existing 486+ tests still pass plus the 9+ new ones.
- [ ] `npm run audit` passes.
- [ ] Deliberate-break demo: change the `available_price_increased`
  test to expect `available_same_price`, confirm red, revert.
- [ ] **Zero new `DO NOT REMOVE` markers added** (auto-formatter fix
  should hold).

## Smoke tests (manual, after OTA)

1. **Happy path same prices.** Customer A has a delivered order from
   Mahesh Kirana for atta + rice + dal. None of those items have
   changed price. Tap Reorder → modal shows all 3 as available, same
   prices, no badges. Tap Add → cart has those 3 items at the same
   prices and same quantities. Navigate to Cart screen.
2. **Price change.** Shop changed atta price from ₹250 → ₹275. Tap
   Reorder → modal shows atta with `₹275` (current) and `₹250`
   struck through, plus "+10%" badge. Add → cart line for atta has
   price ₹275 (current) and priceSnapshot ₹275.
3. **Some items unavailable.** Shop marked rice as `available: false`
   via the bulk action from PR 8. Tap Reorder → modal shows atta + dal
   in available section, rice in unavailable section ("Currently
   unavailable"). CTA shows "Add 2 items to cart." Add → cart has 2
   items (no rice).
4. **All items unavailable.** Shop suspended all items. Tap Reorder →
   modal shows everything in the unavailable section. CTA shows "No
   items available" and is disabled. Tap Cancel → modal closes, cart
   unchanged.
5. **Shop suspended.** Customer reorders from a shop that admin has
   since suspended. Shop fetch fails → modal closes → Alert "This
   shop is no longer accepting orders. Try a different shop." Cart
   unchanged.
6. **Replace cart from different shop.** Customer has 5 items from
   Shop A in cart. Taps Reorder on a past order from Shop B. Modal
   shows Shop B items. Confirm → cart now has Shop B items, Shop A
   items GONE. (Zomato/Swiggy behavior: reorder always replaces.)
7. **Reorder a cancelled order.** Customer cancelled a paid order via
   the 2-min window (PR 7). Reorder button STILL appears (cancelled
   is a terminal state). Flow works identically.

## Deploy plan

Pure client OTA. Per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm test
eas update --branch production --message "PR 13 — Repeat order button"
```

No functions deploy, no rules deploy, no native rebuild. Single OTA
from clean tree. Tell team to force-close + reopen TestFlight after
publish to pick up the new bundle.

## Estimated time

~3–4 hours Windsurf work:

- Part 1 (pure helper): 30 min
- Part 2 (tests): 45 min — 9 cases is the bulk
- Part 3 (cart store method): 15 min
- Part 4 (modal component): 60–90 min — most visual polish lives here
- Part 5 (OrdersScreen integration): 45 min — straightforward state
  + handlers if hooks discipline is observed
- Smoke testing + deliberate-break demo: 30 min

If the auto-formatter discipline + Rules-of-Hooks comment land
cleanly, this PR should ship as the smoothest one in a while —
no schema work, no breaking changes, no rollout-order considerations.

## Why this is the right next PR

Compounding value: every subsequent PR that touches cart-creation
(saved shopping list, weekly recurring orders, share cart with
family member) builds on `replaceCartWithItems`. Shipping it now via
the lowest-risk feature (reorder) means future features get an
already-tested primitive to lean on.

Behavioral impact: at family-testing scale, you'll see reorder taps
within the first week. The metric to watch: "% of orders that were
initiated by reorder vs. fresh browse." Industry numbers from
Swiggy/Zomato suggest this hits ~40% within a month for grocery
verticals. Below 15% means the UX has friction; above 50% suggests
shoppers are settling into routines (the goal).
