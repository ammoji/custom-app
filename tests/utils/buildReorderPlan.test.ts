/**
 * Pure-helper tests for `buildReorderPlan` + `planToCartItems`
 * (PR 13 — repeat order button).
 *
 * The helper joins a past order's line items against the shop's
 * CURRENT menu and produces a plan the modal renders. Pinned
 * because:
 *   - Price drift categorisation drives the +/- badge in the modal.
 *   - The legacy productId fallback keeps pre-PR-4 orders reorderable
 *     even though their lines lack `menuItemId`.
 *   - planToCartItems must use CURRENT prices (not the past
 *     snapshot) — placeOrder validates against the live menu and
 *     would reject stale snapshots.
 */
import {
  buildReorderPlan,
  planToCartItems,
} from '../../src/utils/buildReorderPlan';
import type { CartItem, MenuItem, Order } from '../../src/types';

function makeOrder(
  items: Partial<CartItem>[],
  overrides: Partial<Order> = {},
): Order {
  return {
    id: 'order_1',
    shopId: 'shop_1',
    shopName: 'Test Shop',
    customerUid: 'u1',
    items: items.map((i, idx) => ({
      productId: i.productId ?? `p_${idx}`,
      menuItemId: i.menuItemId,
      name: i.name ?? `Item ${idx}`,
      imageUrl: i.imageUrl ?? 'x',
      packLabel: i.packLabel ?? '1 kg',
      price: i.price ?? 100,
      quantity: i.quantity ?? 1,
      priceSnapshot: i.priceSnapshot ?? i.price ?? 100,
    })),
    subtotal: 0,
    deliveryFee: 0,
    total: 0,
    deliveryAddress: {} as any,
    paymentMethod: 'cod',
    status: 'delivered',
    createdAt: 0,
    estimatedDeliveryAt: 0,
    ...overrides,
  } as Order;
}

function makeMenuItem(over: Partial<MenuItem>): MenuItem {
  return {
    id: over.id ?? 'm_1',
    shopId: over.shopId ?? 'shop_1',
    productId: over.productId ?? null,
    name: over.name ?? 'Test',
    imageUrl: over.imageUrl ?? 'x',
    packLabel: over.packLabel ?? '1 kg',
    category: 'staples' as any,
    price: over.price ?? 100,
    mrp: over.mrp ?? over.price ?? 100,
    available: over.available !== false,
    stock: over.stock ?? null,
    isCustom: over.isCustom ?? false,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('buildReorderPlan', () => {
  test('marks an item with unchanged price as available_same_price', () => {
    const past = makeOrder([{ menuItemId: 'm_1', price: 100, quantity: 2 }]);
    const menu = [makeMenuItem({ id: 'm_1', price: 100 })];
    const plan = buildReorderPlan(past, menu);
    expect(plan.lines[0].status).toBe('available_same_price');
    expect(plan.availableCount).toBe(1);
    expect(plan.unavailableCount).toBe(0);
    expect(plan.hasPriceChanges).toBe(false);
  });

  test('marks price_increased when current price is higher', () => {
    const past = makeOrder([{ menuItemId: 'm_1', price: 100, quantity: 1 }]);
    const menu = [makeMenuItem({ id: 'm_1', price: 120 })];
    const plan = buildReorderPlan(past, menu);
    expect(plan.lines[0].status).toBe('available_price_increased');
    expect(plan.hasPriceChanges).toBe(true);
  });

  test('marks price_decreased when current price is lower', () => {
    const past = makeOrder([{ menuItemId: 'm_1', price: 100, quantity: 1 }]);
    const menu = [makeMenuItem({ id: 'm_1', price: 80 })];
    const plan = buildReorderPlan(past, menu);
    expect(plan.lines[0].status).toBe('available_price_decreased');
    expect(plan.hasPriceChanges).toBe(true);
  });

  test('marks removed_from_menu when no menu item matches', () => {
    const past = makeOrder([{ menuItemId: 'm_gone', price: 50, quantity: 1 }]);
    const menu = [makeMenuItem({ id: 'm_other', price: 200 })];
    const plan = buildReorderPlan(past, menu);
    expect(plan.lines[0].status).toBe('removed_from_menu');
    expect(plan.lines[0].currentMenuItem).toBeNull();
    expect(plan.lines[0].reason).toMatch(/no longer/i);
    expect(plan.unavailableCount).toBe(1);
  });

  test('marks out_of_stock when menu item has available=false', () => {
    const past = makeOrder([{ menuItemId: 'm_1', price: 100, quantity: 1 }]);
    const menu = [makeMenuItem({ id: 'm_1', price: 100, available: false })];
    const plan = buildReorderPlan(past, menu);
    expect(plan.lines[0].status).toBe('out_of_stock');
    expect(plan.lines[0].reason).toMatch(/unavailable/i);
  });

  test('marks out_of_stock when stock <= 0', () => {
    const past = makeOrder([{ menuItemId: 'm_1', price: 100, quantity: 1 }]);
    const menu = [makeMenuItem({ id: 'm_1', price: 100, stock: 0 })];
    const plan = buildReorderPlan(past, menu);
    expect(plan.lines[0].status).toBe('out_of_stock');
    expect(plan.lines[0].reason).toMatch(/out of stock/i);
  });

  test('treats stock=null as unlimited (not out of stock)', () => {
    // PR 8 distinguishes "available=true, stock=null" (no count
    // tracked, sell freely) from "available=true, stock=0" (count
    // tracked, sold out). Pinning so a future change to the helper
    // doesn't accidentally treat null as zero.
    const past = makeOrder([{ menuItemId: 'm_1', price: 100, quantity: 1 }]);
    const menu = [makeMenuItem({ id: 'm_1', price: 100, stock: null })];
    const plan = buildReorderPlan(past, menu);
    expect(plan.lines[0].status).toBe('available_same_price');
  });

  test('falls back to productId join for legacy orders without menuItemId', () => {
    const past = makeOrder([
      {
        productId: 'p_legacy',
        menuItemId: undefined,
        price: 100,
        quantity: 1,
      },
    ]);
    const menu = [
      makeMenuItem({ id: 'm_1', productId: 'p_legacy', price: 100 }),
    ];
    const plan = buildReorderPlan(past, menu);
    expect(plan.lines[0].status).toBe('available_same_price');
    expect(plan.lines[0].menuItemId).toBe('m_1'); // resolved to live id
    expect(plan.availableCount).toBe(1);
  });

  test('mixes available + unavailable in a single plan', () => {
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
    // Order is preserved.
    expect(plan.lines.map(l => l.status)).toEqual([
      'available_same_price',
      'removed_from_menu',
      'out_of_stock',
    ]);
  });

  test('preserves shopId + shopName from past order', () => {
    const past = makeOrder([{ menuItemId: 'm_1' }], {
      shopId: 'shop_42',
      shopName: 'Mahesh Kirana',
    });
    const menu = [makeMenuItem({ id: 'm_1' })];
    const plan = buildReorderPlan(past, menu);
    expect(plan.shopId).toBe('shop_42');
    expect(plan.shopName).toBe('Mahesh Kirana');
  });

  test('preserves past name/image/pack on removed lines for fallback rendering', () => {
    // Removed items can no longer pull display fields from the menu
    // doc (it's gone), so the modal renders the past-order snapshot.
    // Pinning to ensure the helper carries those fields through.
    const past = makeOrder([
      {
        menuItemId: 'm_gone',
        name: 'Aashirvaad Atta',
        imageUrl: 'https://example.com/atta.jpg',
        packLabel: '5 kg',
        price: 250,
        quantity: 1,
      },
    ]);
    const plan = buildReorderPlan(past, []);
    expect(plan.lines[0].pastName).toBe('Aashirvaad Atta');
    expect(plan.lines[0].pastImageUrl).toBe('https://example.com/atta.jpg');
    expect(plan.lines[0].pastPackLabel).toBe('5 kg');
  });
});

describe('planToCartItems', () => {
  test('returns only available items at CURRENT price with OLD quantity', () => {
    // Note: explicit productIds on past items so the productId
    // fallback join doesn't accidentally match m_gone to m_1's
    // doc (the default `p_${idx}` ids would otherwise collide
    // with the menu item's productId).
    const past = makeOrder([
      { productId: 'p_atta', menuItemId: 'm_1', price: 100, quantity: 5 },
      { productId: 'p_dal', menuItemId: 'm_gone', price: 50, quantity: 2 },
    ]);
    const menu = [
      makeMenuItem({ id: 'm_1', productId: 'p_atta', price: 120 }),
    ];
    const plan = buildReorderPlan(past, menu);
    const cart = planToCartItems(plan);
    expect(cart).toHaveLength(1);
    expect(cart[0].price).toBe(120); // current, not old 100
    expect(cart[0].priceSnapshot).toBe(120); // matches current — server validation passes
    expect(cart[0].quantity).toBe(5); // preserved from past order
    expect(cart[0].menuItemId).toBe('m_1');
    expect(cart[0].productId).toBe('p_atta');
  });

  test('uses menuItemId as productId fallback for CUSTOM items (productId null)', () => {
    const past = makeOrder([{ menuItemId: 'm_custom', price: 50, quantity: 2 }]);
    const menu = [
      makeMenuItem({
        id: 'm_custom',
        productId: null,
        isCustom: true,
        price: 60,
      }),
    ];
    const plan = buildReorderPlan(past, menu);
    const cart = planToCartItems(plan);
    expect(cart).toHaveLength(1);
    expect(cart[0].productId).toBe('m_custom'); // fallback — keeps cart-line key unique
    expect(cart[0].menuItemId).toBe('m_custom');
  });

  test('returns empty array when nothing is available', () => {
    const past = makeOrder([{ menuItemId: 'm_gone', price: 50, quantity: 1 }]);
    const plan = buildReorderPlan(past, []);
    expect(planToCartItems(plan)).toEqual([]);
  });
});
