import { create } from 'zustand';
import { orderService } from '../services/orderService';
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
  placeOrder: (input: PlaceOrderInput) => Promise<Order>;
};

// Orders no longer live in client state. Reads come from Firestore directly
// (orderService.listMine / watchOrder). This store is a thin pass-through
// for placeOrder so call-sites stay stable.
export const useOrderStore = create<OrderState>(() => ({
  placeOrder: async input => {
    const { orderId, total, etaMinutes, shopName } = await orderService.placeOrder({
      shopId: input.shopId,
      items: input.cart,
      address: input.address,
    });
    const createdAt = Date.now();
    const order: Order = {
      id: orderId,
      shopId: input.shopId,
      shopName,
      items: input.cart,
      subtotal: total - input.deliveryFee,
      deliveryFee: input.deliveryFee,
      total,
      deliveryAddress: input.address,
      paymentMethod: 'cod',
      status: 'pending',
      createdAt,
      estimatedDeliveryAt: createdAt + etaMinutes * 60_000,
    };
    return order;
  },
}));
