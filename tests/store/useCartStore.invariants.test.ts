/**
 * Invariant tests for useCartStore.
 *
 * Why this exists: the v2-iv solo-test bug ("Product X not in this
 * shop") had two latent vectors — SearchScreen's legacy `addItem`
 * path and `forceAddItem`'s inline literal — both of which produced
 * cart lines lacking `menuItemId`. The store had ZERO tests asserting
 * this invariant. After-the-fact regression tests for the helpers
 * (placeOrderPayload) caught the wire bug, but the in-memory shape
 * was never pinned. This file fixes that.
 *
 * Pinned invariants for EVERY add path:
 *   1. Every line in `state.items` has `menuItemId: string`
 *      (non-empty) AND `priceSnapshot: number`. The server uses
 *      both for v2-iii menu validation; missing either pushes the
 *      order down the legacy path.
 *   2. Switching shops clears the cart before adding the new line.
 *   3. Re-adding the same product increments quantity and
 *      backfills v2-iii fields if missing.
 */
import { useCartStore } from '../../src/store/useCartStore';
import type { MenuItem, Product, Shop } from '../../src/types';

const shopA: Shop = {
  id: 'shop_a',
  name: 'Shop A',
  address: 'Addr A',
  location: { lat: 0, lng: 0 },
  rating: 4.5,
  deliveryFee: 20,
  isOpen: true,
} as unknown as Shop;

const shopB: Shop = {
  ...shopA,
  id: 'shop_b',
  name: 'Shop B',
} as unknown as Shop;

const productA1: Product = {
  id: 'p_a_atta',
  shopId: 'shop_a',
  name: 'Atta 5kg',
  imageUrl: 'http://x/atta.jpg',
  price: 250,
  packSize: '5kg',
  category: 'staples',
} as unknown as Product;

const productB1: Product = {
  ...productA1,
  id: 'p_b_atta',
  shopId: 'shop_b',
};

const menuItemA1: MenuItem = {
  id: 'p_a_atta',
  productId: 'p_a_atta',
  shopId: 'shop_a',
  name: 'Atta 5kg',
  imageUrl: 'http://x/atta.jpg',
  packLabel: '5 kg',
  price: 245,
  available: true,
  isCustom: false,
} as unknown as MenuItem;

const menuItemCustom: MenuItem = {
  id: 'custom_1700_abc',
  productId: null,
  shopId: 'shop_a',
  name: 'Custom item',
  imageUrl: '',
  packLabel: '',
  price: 99,
  available: true,
  isCustom: true,
} as unknown as MenuItem;

function reset() {
  useCartStore.getState().clearCart();
}

function assertInvariants(_label: string) {
  // The label parameter is for caller-side documentation: every
  // invariant call site names the path it just exercised so a
  // failure stack trace tells you which add path regressed.
  const items = useCartStore.getState().items;
  for (const i of items) {
    expect(typeof i.menuItemId === 'string' && i.menuItemId.length > 0).toBe(
      true,
    );
    expect(typeof i.priceSnapshot === 'number').toBe(true);
    expect(Number.isFinite(i.priceSnapshot)).toBe(true);
    expect(typeof i.productId === 'string' && i.productId.length > 0).toBe(
      true,
    );
  }
}

describe('useCartStore — line-shape invariants (every add path)', () => {
  beforeEach(reset);

  test('addItem (legacy product path) produces a line with menuItemId AND priceSnapshot', () => {
    // The exact regression that tipped Sudhir's v2-iv solo test.
    // SearchScreen still calls cart.addItem(...) and the line MUST
    // carry menuItemId so placeOrder takes the v2-iii menu path.
    const result = useCartStore.getState().addItem(productA1, shopA);
    expect(result.ok).toBe(true);
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].menuItemId).toBe('p_a_atta');
    expect(items[0].priceSnapshot).toBe(250);
    assertInvariants('addItem');
  });

  test('forceAddItem produces a line with menuItemId AND priceSnapshot', () => {
    useCartStore.getState().forceAddItem(productA1, shopA);
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].menuItemId).toBe('p_a_atta');
    expect(items[0].priceSnapshot).toBe(250);
    assertInvariants('forceAddItem');
  });

  test('addMenuItem produces a line with menuItemId AND priceSnapshot (GLOBAL item)', () => {
    const result = useCartStore.getState().addMenuItem(menuItemA1, shopA);
    expect(result.ok).toBe(true);
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].menuItemId).toBe('p_a_atta');
    expect(items[0].priceSnapshot).toBe(245);
    assertInvariants('addMenuItem (global)');
  });

  test('addMenuItem CUSTOM item: productId falls back to menuItemId, both present', () => {
    useCartStore.getState().addMenuItem(menuItemCustom, shopA);
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    // CUSTOM lines key on the menuItemId because product.id is null.
    expect(items[0].productId).toBe('custom_1700_abc');
    expect(items[0].menuItemId).toBe('custom_1700_abc');
    expect(items[0].priceSnapshot).toBe(99);
    assertInvariants('addMenuItem (custom)');
  });

  test('forceAddMenuItem produces a line with menuItemId AND priceSnapshot', () => {
    useCartStore.getState().forceAddMenuItem(menuItemA1, shopA);
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].menuItemId).toBe('p_a_atta');
    expect(items[0].priceSnapshot).toBe(245);
    assertInvariants('forceAddMenuItem');
  });

  test('adding the same product twice increments and PRESERVES menuItemId', () => {
    // Regression guard: the existing-line update branch must not
    // accidentally drop menuItemId when bumping quantity.
    useCartStore.getState().addItem(productA1, shopA);
    useCartStore.getState().addItem(productA1, shopA);
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
    expect(items[0].menuItemId).toBe('p_a_atta');
    expect(items[0].priceSnapshot).toBe(250);
    assertInvariants('addItem×2');
  });

  test('adding the same menu item twice REFRESHES priceSnapshot to current price', () => {
    // Long-lived carts: when the user re-adds an item after a price
    // change in the menu doc, the snapshot follows. placeOrder still
    // re-validates against the live menu price; this just keeps the
    // displayed total honest.
    useCartStore.getState().addMenuItem(menuItemA1, shopA);
    const updated: MenuItem = { ...menuItemA1, price: 260 };
    useCartStore.getState().addMenuItem(updated, shopA);
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
    expect(items[0].priceSnapshot).toBe(260);
    assertInvariants('addMenuItem×2');
  });

  test('addItem rejects different-shop adds with reason: different_shop', () => {
    useCartStore.getState().addItem(productA1, shopA);
    const result = useCartStore.getState().addItem(productB1, shopB);
    expect(result).toEqual({ ok: false, reason: 'different_shop' });
    // Cart should still hold ONLY shop A's item.
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].productId).toBe('p_a_atta');
    assertInvariants('addItem cross-shop reject');
  });

  test('forceAddItem switches shops by replacing the cart, new line still has menuItemId', () => {
    useCartStore.getState().forceAddItem(productA1, shopA);
    useCartStore.getState().forceAddItem(productB1, shopB);
    const state = useCartStore.getState();
    expect(state.shopId).toBe('shop_b');
    expect(state.items).toHaveLength(1);
    expect(state.items[0].productId).toBe('p_b_atta');
    expect(state.items[0].menuItemId).toBe('p_b_atta');
    assertInvariants('forceAddItem cross-shop replace');
  });

  test('mixed sequence (addItem then addMenuItem same shop) keeps invariants on every line', () => {
    // The realistic user flow: add atta from SearchScreen
    // (legacy addItem), then more items from ShopDetail (addMenuItem
    // path). Both lines must carry menuItemId so placeOrder can
    // dispatch correctly for either.
    useCartStore.getState().addItem(productA1, shopA);
    useCartStore.getState().addMenuItem(menuItemCustom, shopA);
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(2);
    assertInvariants('mixed addItem + addMenuItem');
    expect(items.map(i => i.menuItemId).sort()).toEqual(
      ['custom_1700_abc', 'p_a_atta'].sort(),
    );
  });
});
