import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { Address, CartItem, Order } from '../types';

type PlaceOrderInput = {
  cart: CartItem[];
  address: Address;
  shopId: string;
  shopName: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
  etaMinutes: number;
};

type OrderState = {
  orders: Order[];
  placeOrder: (input: PlaceOrderInput) => Order;
  getById: (orderId: string) => Order | undefined;
};

export const useOrderStore = create<OrderState>()(
  persist(
    (set, get) => ({
      orders: [],

      placeOrder: input => {
    const createdAt = Date.now();
    const order: Order = {
      id: `ORD-${createdAt}`,
      shopId: input.shopId,
      shopName: input.shopName,
      items: input.cart,
      subtotal: input.subtotal,
      deliveryFee: input.deliveryFee,
      total: input.total,
      deliveryAddress: input.address,
      paymentMethod: 'cod',
      status: 'pending',
      createdAt,
      estimatedDeliveryAt: createdAt + input.etaMinutes * 60_000,
    };
        set(state => ({ orders: [order, ...state.orders] }));
        return order;
      },

      getById: orderId => get().orders.find(o => o.id === orderId),
    }),
    {
      name: 'orders-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({ orders: state.orders }),
    }
  )
);
