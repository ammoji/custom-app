import { CategoryId } from '../constants/categories';

export type Unit = 'kg' | 'g' | 'litre' | 'ml' | 'piece' | 'packet' | 'dozen';

export type GeoPoint = { lat: number; lng: number };

export type Shop = {
  id: string;
  name: string;
  description?: string;
  address: string;
  location: GeoPoint;
  distanceKm?: number;
  rating: number;
  isOpen: boolean;
  imageUrl: string;
  categories: CategoryId[];
  deliveryFee: number;
  minOrder: number;
  etaMinutes: number;
};

export type Product = {
  id: string;
  shopId: string;
  name: string;
  brand?: string;
  category: CategoryId;
  imageUrl: string;
  packSize: { value: number; unit: Unit };
  mrp: number;
  price: number;
  inStock: boolean;
  tags?: string[];
};

export type CartItem = {
  productId: string;
  name: string;
  imageUrl: string;
  packLabel: string;
  price: number;
  quantity: number;
};

export type Address = {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  pincode: string;
  phone: string;
};

export type PaymentMethod = 'cod' | 'online';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'not_required';

export type Order = {
  id: string;
  shopId: string;
  shopName: string;
  items: CartItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  deliveryAddress: Address;
  paymentMethod: PaymentMethod;
  // Present for online orders; COD orders may omit these entirely.
  paymentStatus?: PaymentStatus;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  paidAt?: number;
  status: 'pending' | 'accepted' | 'preparing' | 'out_for_delivery' | 'delivered' | 'cancelled';
  createdAt: number;
  estimatedDeliveryAt: number;
};
