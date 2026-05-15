import { CategoryId } from '../constants/categories';

export type Unit = 'kg' | 'g' | 'litre' | 'ml' | 'piece' | 'packet' | 'dozen';

export type GeoPoint = { lat: number; lng: number };

// Shop lifecycle (Phase 12a-v2-i):
//   pending   → just registered, awaiting admin review
//   active    → approved + customer-visible
//   rejected  → admin declined; owner sees reason and can resubmit
//   suspended → admin pulled the plug post-launch (rules support it,
//               UI ships in a later phase)
export type ShopStatus = 'pending' | 'active' | 'rejected' | 'suspended';

export type ShopRegistrationData = {
  phone: string;
  hours: { open: string; close: string }; // "HH:mm" 24h
  gstNumber?: string | null;
  fssaiLicense?: string | null;
  submittedAt: number; // epoch ms
};

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
  // Phase 12a-v2-i. Optional so existing mocks (MOCK_SHOPS) and any
  // legacy in-memory Shop literals keep typechecking. Cloud Functions
  // (registerShop / approveShop) enforce presence on real registered
  // shops; the seed script backfills `status: 'active'` on the
  // pre-existing 8 shops so the customer flow keeps working.
  status?: ShopStatus;
  ownerUid?: string | null;
  registrationData?: ShopRegistrationData;
  approvedAt?: number;
  approvedBy?: string;
  rejectedAt?: number;
  rejectedReason?: string;
  // Phase 12a-v2-i-bis: admin can suspend an active shop. Customer
  // listings filter on status==active so suspended shops drop out
  // of the customer flow without losing their owner / history.
  suspendedAt?: number | null;
  suspendedBy?: string | null;
  suspendedReason?: string | null;
};

// Returned by `listAllUsers` callable. Mirrors the subset of
// FirebaseAuth UserRecord we need on the client to render the admin
// user-management list, plus resolved role booleans (claims aren't
// queryable, so we return them already-flattened).
export type UserInfo = {
  uid: string;
  phoneNumber: string | null;
  isAnonymous: boolean;
  isAdmin: boolean;
  isShopOwner: boolean;
  shopId: string | null;
  isDelivery: boolean;
  createdAt: number | null;
  lastSignInAt: number | null;
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

// Phase 12a-v2-ii: per-shop menu. Each shop owns a `menu` subcollection
// (`shops/{shopId}/menu/{menuItemId}`). Two flavors of menu item exist:
//   - GLOBAL  (productId set, isCustom: false): inherits name + image
//             from products/{productId} but denormalizes them so the
//             customer never has to do a second read. Shop owner can
//             override price/availability/stock only — name and image
//             are protected to keep cross-shop comparisons honest.
//   - CUSTOM  (productId null, isCustom: true): shop-defined item that
//             only exists in this shop's menu. Owner can edit every
//             field including the destructive Delete (whereas GLOBAL
//             items only soft-toggle via available=false).
//
// `stock: null` means "in stock, no count tracked" — this is the
// default for bootstrapped GLOBAL items. A numeric stock is purely
// informational in MVP; auto-decrement on order placement is tracked
// in PRELAUNCH_CHECKLIST. The customer-facing ShopDetailScreen will
// switch to reading from this collection in Phase 12a-v2-iii.
export type MenuItem = {
  id: string;
  shopId: string;
  productId: string | null;
  name: string;
  imageUrl: string;
  packLabel: string;
  category: CategoryId;
  price: number;
  mrp: number;
  available: boolean;
  stock: number | null;
  isCustom: boolean;
  createdAt: number;
  updatedAt: number;
};

// Input for addCustomMenuItem callable. imageUrl + stock are optional;
// the server fills in a placeholder image if blank and defaults stock
// to null.
export type NewMenuItemInput = {
  name: string;
  price: number;
  mrp: number;
  packLabel: string;
  category: CategoryId;
  imageUrl?: string;
  stock?: number | null;
};

// Phase 12a-v2-iii: cart lines now optionally carry a `menuItemId` and
// `priceSnapshot` so placeOrder can validate against the per-shop menu
// (price drift / availability / stock). Both fields are optional so
// AsyncStorage carts that survive across the OTA upgrade keep working
// — the server falls back to the legacy products-collection path when
// `menuItemId` is absent. `productId` always carries a unique key for
// cart-line dedup; for CUSTOM menu items (no underlying product) we
// set it to the menuItemId so increment/decrement keep working
// without an additional cart-line key field.
export type CartItem = {
  productId: string;
  name: string;
  imageUrl: string;
  packLabel: string;
  price: number;
  quantity: number;
  menuItemId?: string;
  priceSnapshot?: number;
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
  // Delivery-flow fields (Phase 12b). All three are null on a freshly
  // placed order. We don't add new statuses to the state machine; the
  // combination of (status, deliveryPersonId, pickedUpAt) encodes the
  // substate:
  //   out_for_delivery + deliveryPersonId=null              → available pickup
  //   out_for_delivery + deliveryPersonId=X + pickedUpAt=null → claimed, en route to shop
  //   out_for_delivery + deliveryPersonId=X + pickedUpAt=ts  → picked up, on the way to customer
  //   delivered        + deliveredAt=ts                     → done
  deliveryPersonId: string | null;
  pickedUpAt: number | null;
  deliveredAt: number | null;
  // Audit trail of every status change. Server (Cloud Functions) is
  // the only writer; toOrder() normalizes `.at` to epoch ms. Optional
  // because legacy orders predate this field.
  statusHistory?: Array<{
    status: string;
    at: number;
    by: string;
    reason?: string;
  }>;
};
