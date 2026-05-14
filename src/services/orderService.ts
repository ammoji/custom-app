import { httpsCallable } from '@firebase/functions';
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import { trace } from 'firebase/performance';
import type { Address, CartItem, Order, PaymentMethod } from '../types';
import type { OrderStatus } from '../utils/orderStateMachine';
import { db, functions, perf } from './firebase';
import { Sentry } from './sentry';

type PlaceOrderInput = {
  shopId: string;
  items: CartItem[];
  address: Address;
  paymentMethod: PaymentMethod;
};

type PlaceOrderResult = {
  orderId: string;
  total: number;
  etaMinutes: number;
  shopName: string;
  razorpayOrderId: string | null;
  razorpayKeyId: string | null;
};

// Firestore stores createdAt/updatedAt as Timestamps (FieldValue.serverTimestamp).
// statusHistory[].at is written as epoch ms. Normalize everything to numbers
// so screens can treat Order as a pure JS shape.
function tsToMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'number') return value;
  if (value && typeof (value as any).toMillis === 'function') {
    return (value as any).toMillis();
  }
  return 0;
}

function toOrder(raw: any): Order {
  return {
    ...raw,
    createdAt: tsToMillis(raw.createdAt),
    estimatedDeliveryAt: tsToMillis(raw.estimatedDeliveryAt),
    statusHistory: Array.isArray(raw.statusHistory)
      ? raw.statusHistory.map((h: any) => ({ ...h, at: tsToMillis(h.at) }))
      : raw.statusHistory,
  } as Order;
}

export const orderService = {
  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const t = perf ? trace(perf, 'orderService.placeOrder') : null;
    t?.start();
    Sentry.addBreadcrumb({
      category: 'order',
      message: `placing order: ${input.items.length} items, ${input.paymentMethod}`,
      level: 'info',
    });
    try {
      const fn = httpsCallable<unknown, PlaceOrderResult>(functions, 'placeOrder');
      const compactItems = input.items.map(i => ({
        productId: i.productId,
        quantity: i.quantity,
      }));
      const result = await fn({
        shopId: input.shopId,
        items: compactItems,
        address: input.address,
        paymentMethod: input.paymentMethod,
      });
      t?.putAttribute('paymentMethod', input.paymentMethod);
      return result.data;
    } finally {
      t?.stop();
    }
  },

  async listMine(customerUid: string): Promise<Order[]> {
    const t = perf ? trace(perf, 'orderService.listMine') : null;
    t?.start();
    try {
      const q = query(
        collection(db, 'orders'),
        where('customerUid', '==', customerUid),
        orderBy('createdAt', 'desc'),
        limit(50),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => toOrder(d.data()));
    } finally {
      t?.stop();
    }
  },

  watchOrder(orderId: string, cb: (order: Order | null) => void): () => void {
    return onSnapshot(doc(db, 'orders', orderId), snap => {
      cb(snap.exists() ? toOrder(snap.data()) : null);
    });
  },

  async updateOrderStatus(input: {
    orderId: string;
    newStatus: OrderStatus;
    reason?: string;
  }): Promise<void> {
    const fn = httpsCallable(functions, 'updateOrderStatus');
    await fn(input);
  },

  watchAllOrders(cb: (orders: Order[]) => void): () => void {
    const q = query(
      collection(db, 'orders'),
      orderBy('createdAt', 'desc'),
      limit(100),
    );
    return onSnapshot(q, snap => {
      cb(snap.docs.map(d => toOrder(d.data())));
    });
  },
};
