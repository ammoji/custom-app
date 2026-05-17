/**
 * Persisted-cart migration test.
 *
 * The v2-iv hotfix bumped the Zustand persist key from `cart-v1` to
 * `cart-v2` to invalidate any persisted cart whose lines pre-date
 * the menuItemId contract. Without that bump, AsyncStorage would
 * rehydrate stale lines lacking menuItemId and the user would hit
 * "Product X not in this shop" at place-order. THIS test pins the
 * bump: a `cart-v1` payload sitting in storage MUST NOT leak into
 * the new store.
 *
 * Related: tests/store/useCartStore.invariants.test.ts pins the
 * in-memory shape after every add path; this file pins the
 * persistence boundary.
 */
import {
  __resetStorage,
  __setStorageValue,
} from '../__mocks__/async-storage';

const loadCartStore = () => {
  let mod: typeof import('../../src/store/useCartStore');
  jest.isolateModules(() => {
    mod = require('../../src/store/useCartStore');
  });
  // @ts-expect-error assigned inside isolateModules
  return mod.useCartStore;
};

beforeEach(() => {
  __resetStorage();
});

describe('useCartStore persistence — version bump invalidates stale carts', () => {
  test('cart-v1 stale state in AsyncStorage is NOT rehydrated under cart-v2', async () => {
    // Seed AsyncStorage with the OLD persist key + a cart shape
    // that lacks menuItemId — the exact pre-hotfix shape that
    // would fail at place-order.
    const stale = JSON.stringify({
      state: {
        shopId: 'shop_001',
        shopName: 'Old Shop',
        deliveryFee: 20,
        items: [
          {
            productId: 'p_001_atta_5kg',
            // NO menuItemId, NO priceSnapshot — that's the bug shape
            name: 'Atta 5kg',
            imageUrl: '',
            packLabel: '5 kg',
            price: 250,
            quantity: 2,
          },
        ],
      },
      version: 0,
    });
    __setStorageValue('cart-v1', stale);

    const useCartStore = loadCartStore();
    // Wait a microtask for persist middleware's async hydration.
    await Promise.resolve();
    await Promise.resolve();

    const state = useCartStore.getState();
    // The store MUST NOT have rehydrated from cart-v1. The new
    // persist key (cart-v2) starts empty.
    expect(state.shopId).toBeNull();
    expect(state.items).toEqual([]);
    expect(state.shopName).toBeNull();
  });

  test('cart-v2 state IS rehydrated correctly (positive control)', async () => {
    // Seed under the CURRENT persist key. The store should hydrate
    // these items (they already have menuItemId so they pass
    // invariants).
    const fresh = JSON.stringify({
      state: {
        shopId: 'shop_002',
        shopName: 'Fresh Shop',
        deliveryFee: 30,
        items: [
          {
            productId: 'p_002_atta',
            menuItemId: 'p_002_atta',
            name: 'Atta',
            imageUrl: '',
            packLabel: '5 kg',
            price: 245,
            priceSnapshot: 245,
            quantity: 1,
          },
        ],
      },
      version: 0,
    });
    __setStorageValue('cart-v2', fresh);

    const useCartStore = loadCartStore();
    // Zustand's persist middleware hydrates async; give it a few
    // ticks. AsyncStorage mock is synchronous-ish (Promise.resolve)
    // so two ticks are enough.
    for (let i = 0; i < 5; i++) await Promise.resolve();

    const state = useCartStore.getState();
    expect(state.shopId).toBe('shop_002');
    expect(state.items).toHaveLength(1);
    expect(state.items[0].menuItemId).toBe('p_002_atta');
  });
});
