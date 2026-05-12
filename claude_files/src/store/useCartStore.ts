import { create } from 'zustand';
import { Product, Shop, CartItem } from '../types';
import { formatPackLabel } from '../utils/format';

type AddResult = { ok: true } | { ok: false; reason: 'different_shop' };

type CartState = {
  shopId: string | null;
  shopName: string | null;
  deliveryFee: number;
  items: CartItem[];

  addItem: (product: Product, shop: Shop) => AddResult;
  forceAddItem: (product: Product, shop: Shop) => void;
  increment: (productId: string) => void;
  decrement: (productId: string) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;

  subtotal: () => number;
  total: () => number;
  itemCount: () => number;
};

export const useCartStore = create<CartState>((set, get) => ({
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

  forceAddItem: (product, shop) =>
    set(state => {
      const base = state.shopId === product.shopId ? state.items : [];
      const existing = base.find(i => i.productId === product.id);
      const items = existing
        ? base.map(i =>
            i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i
          )
        : [
            ...base,
            {
              productId: product.id,
              name: product.name,
              imageUrl: product.imageUrl,
              packLabel: formatPackLabel(product.packSize),
              price: product.price,
              quantity: 1,
            },
          ];
      return {
        items,
        shopId: shop.id,
        shopName: shop.name,
        deliveryFee: shop.deliveryFee,
      };
    }),

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

  removeItem: id =>
    set(state => {
      const next = state.items.filter(i => i.productId !== id);
      return next.length === 0
        ? { items: [], shopId: null, shopName: null, deliveryFee: 0 }
        : { items: next };
    }),

  clearCart: () =>
    set({ items: [], shopId: null, shopName: null, deliveryFee: 0 }),

  subtotal: () =>
    get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),
  total: () => get().subtotal() + get().deliveryFee,
  itemCount: () => get().items.reduce((n, i) => n + i.quantity, 0),
}));
