import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { Analytics } from '../services/analytics';
import { CartItem, MenuItem, Product, Shop } from '../types';
import { formatPackLabel } from '../utils/format';

type AddResult = { ok: true } | { ok: false; reason: 'different_shop' };

type CartState = {
  shopId: string | null;
  shopName: string | null;
  deliveryFee: number;
  items: CartItem[];

  // Legacy product-based add (still used by SearchScreen, which reads
  // from the global products collection). Phase 12a-v2-iii routes
  // ShopDetailScreen through addMenuItem instead.
  addItem: (product: Product, shop: Shop) => AddResult;
  forceAddItem: (product: Product, shop: Shop) => void;
  // Phase 12a-v2-iii: per-shop menu add. Sets `menuItemId` and
  // `priceSnapshot` on the cart line so placeOrder can validate
  // server-side. Cart-line key (`productId`) falls back to
  // menuItemId for CUSTOM items so increment/decrement keep working
  // without an extra key field.
  addMenuItem: (item: MenuItem, shop: Shop) => AddResult;
  forceAddMenuItem: (item: MenuItem, shop: Shop) => void;
  increment: (productId: string) => void;
  decrement: (productId: string) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
  // PR 13 — atomic clear-and-replace for the repeat-order flow.
  // Mirrors the multi-shop replacement UX of Swiggy/Zomato:
  // tapping Reorder always REPLACES the cart (never merges), so
  // there's no "merge mode". Caller is responsible for passing
  // CartItems already at current prices (planToCartItems
  // guarantees this).
  replaceCartWithItems: (
    items: CartItem[],
    shop: { id: string; name: string; deliveryFee: number },
  ) => void;

  subtotal: () => number;
  total: () => number;
  itemCount: () => number;
};

// MenuItem → CartItem mapper. Centralized so addMenuItem and
// forceAddMenuItem stay consistent and the v2-iii fields (menuItemId,
// priceSnapshot) are guaranteed present on every menu-sourced line.
function menuItemToCartLine(item: MenuItem): CartItem {
  return {
    // For GLOBAL items, item.id === item.productId (bootstrap mirrors
    // the productId as the doc id). For CUSTOM items productId is
    // null, so we fall back to the menuItemId to keep the cart-line
    // key unique. Server-side, placeOrder uses menuItemId for
    // validation regardless.
    productId: item.productId ?? item.id,
    menuItemId: item.id,
    name: item.name,
    imageUrl: item.imageUrl,
    packLabel: item.packLabel,
    price: item.price,
    priceSnapshot: item.price,
    quantity: 1,
  };
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
  shopId: null,
  shopName: null,
  deliveryFee: 0,
  items: [],

  addItem: (product, shop) => {
    const { shopId } = get();
    if (shopId && shopId !== product.shopId) {
      return { ok: false, reason: 'different_shop' };
    }
    get().forceAddItem(product, shop);
    return { ok: true };
  },

  forceAddItem: (product, shop) => {
    set(state => {
      const base = state.shopId === product.shopId ? state.items : [];
      const existing = base.find(i => i.productId === product.id);
      const items = existing
        ? base.map(i =>
            i.productId === product.id
              ? {
                  ...i,
                  quantity: i.quantity + 1,
                  // Backfill v2-iii fields on legacy lines that
                  // happen to share a productId with the menu doc.
                  // Safe because bootstrapShopMenu mirrors product.id
                  // as the menu doc id for GLOBAL items.
                  menuItemId: i.menuItemId ?? product.id,
                  priceSnapshot: i.priceSnapshot ?? product.price,
                }
              : i,
          )
        : [
            ...base,
            {
              productId: product.id,
              // Phase 12a-v2-iv hotfix: stamp menuItemId on every new
              // cart line so placeOrder takes the per-shop menu
              // validation path. Previously only addMenuItem (used by
              // ShopDetailScreen) set this field; SearchScreen calls
              // addItem which silently produced cart lines that hit
              // the legacy products-collection path and rejected with
              // "Product X not in this shop". Setting menuItemId =
              // product.id is safe because bootstrapShopMenu uses the
              // productId as the menu doc id for GLOBAL items.
              menuItemId: product.id,
              name: product.name,
              imageUrl: product.imageUrl,
              packLabel: formatPackLabel(product.packSize),
              price: product.price,
              priceSnapshot: product.price,
              quantity: 1,
            },
          ];
      return {
        items,
        shopId: shop.id,
        shopName: shop.name,
        deliveryFee: shop.deliveryFee,
      };
    });
    Analytics.add_to_cart({
      product_id: product.id,
      shop_id: product.shopId,
      price: product.price,
      quantity: 1,
    });
  },

  // Phase 12a-v2-iii equivalents of addItem/forceAddItem that take a
  // MenuItem (per-shop menu doc) instead of a Product. The
  // different-shop guard is identical — multi-shop carts are out of
  // scope per the v2-iii prompt.
  addMenuItem: (item, shop) => {
    const { shopId } = get();
    if (shopId && shopId !== item.shopId) {
      return { ok: false, reason: 'different_shop' };
    }
    get().forceAddMenuItem(item, shop);
    return { ok: true };
  },

  forceAddMenuItem: (item, shop) => {
    const lineKey = item.productId ?? item.id;
    set(state => {
      const base = state.shopId === item.shopId ? state.items : [];
      const existing = base.find(i => i.productId === lineKey);
      const items = existing
        ? base.map(i =>
            i.productId === lineKey
              ? {
                  ...i,
                  quantity: i.quantity + 1,
                  // Refresh the snapshot on each add so a long-lived
                  // cart picks up price changes the customer saw most
                  // recently. placeOrder still validates against the
                  // CURRENT menu price; this just keeps drift small.
                  price: item.price,
                  priceSnapshot: item.price,
                  menuItemId: item.id,
                }
              : i,
          )
        : [...base, menuItemToCartLine(item)];
      return {
        items,
        shopId: shop.id,
        shopName: shop.name,
        deliveryFee: shop.deliveryFee,
      };
    });
    Analytics.add_to_cart({
      product_id: lineKey,
      shop_id: shop.id,
      price: item.price,
      quantity: 1,
    });
  },

  increment: id =>
    set(state => ({
      items: state.items.map(i =>
        i.productId === id ? { ...i, quantity: i.quantity + 1 } : i
      ),
    })),

  decrement: id =>
    set(state => {
      const next = state.items.flatMap(i =>
        i.productId !== id
          ? [i]
          : i.quantity > 1
          ? [{ ...i, quantity: i.quantity - 1 }]
          : []
      );
      return next.length === 0
        ? { items: [], shopId: null, shopName: null, deliveryFee: 0 }
        : { items: next };
    }),

  removeItem: id => {
    set(state => {
      const next = state.items.filter(i => i.productId !== id);
      return next.length === 0
        ? { items: [], shopId: null, shopName: null, deliveryFee: 0 }
        : { items: next };
    });
    Analytics.remove_from_cart({ product_id: id });
  },

  clearCart: () =>
    set({ items: [], shopId: null, shopName: null, deliveryFee: 0 }),

  // PR 13 — repeat order. Atomic clear-and-replace so the reorder
  // flow swaps the cart in one Zustand set() call instead of N
  // sequential forceAddMenuItem calls (which would each emit an
  // add_to_cart Analytics event and could cross shopId guards if
  // the previous cart was from a different shop). The reorder
  // primitive is also reusable: saved-shopping-list and
  // weekly-recurring features (tracked in PRELAUNCH_CHECKLIST)
  // will lean on this same method.
  replaceCartWithItems: (items, shop) => {
    set({
      items,
      shopId: shop.id,
      shopName: shop.name,
      deliveryFee: shop.deliveryFee,
    });
    // One synthetic add_to_cart event for the whole bundle. Using
    // product_id: 'reorder' to distinguish reorder-driven adds in
    // the analytics dashboard from organic browse adds.
    Analytics.add_to_cart({
      product_id: 'reorder',
      shop_id: shop.id,
      price: items.reduce((s, i) => s + i.price * i.quantity, 0),
      quantity: items.reduce((n, i) => n + i.quantity, 0),
    });
  },

      subtotal: () =>
        get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),
      total: () => get().subtotal() + get().deliveryFee,
      itemCount: () => get().items.reduce((n, i) => n + i.quantity, 0),
    }),
    {
      // Phase 12a-v2-iv hotfix: bumped from 'cart-v1' to invalidate
      // any persisted cart whose lines pre-date the v2-iii menuItemId
      // contract. Users with a stale cart-v1 entry would otherwise
      // hydrate lines lacking menuItemId, hit placeOrder's legacy
      // path, and get rejected with "Product X not in this shop".
      // Bumping the version transparently empties their cart on next
      // launch — acceptable because the alternative is a failed
      // checkout for everyone on the rollout.
      name: 'cart-v2',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({
        shopId: state.shopId,
        shopName: state.shopName,
        deliveryFee: state.deliveryFee,
        items: state.items,
      }),
    }
  )
);
