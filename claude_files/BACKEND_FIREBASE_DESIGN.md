# Backend Design — Firebase Migration Plan (Post-MVP)

> Companion to the four frontend docs. This is the bridge from "mock data" to "real backend" without rewriting screens.
> Core principle: **the `services/` layer is the only thing that changes.** Stores, screens, and components stay untouched.

---

## 1. Firebase Architecture (MVP-scale)

You don't need every Firebase product. Use these four on Day 1 of the backend phase, add the rest only when usage forces it.

| Firebase Product | Use for | When to add |
|---|---|---|
| **Authentication** | Phone OTP login (India default) | Phase 1 |
| **Cloud Firestore** | All app data — shops, products, orders | Phase 1 |
| **Cloud Storage** | Product/shop images uploaded by shop owners | Phase 1 |
| **Cloud Functions** | Order lifecycle hooks (notify shop, send SMS) | Phase 2 |
| **Cloud Messaging (FCM)** | Push notifications on order status | Phase 2 |
| **App Check** | Block scraping / abuse | Phase 3 |
| **Crashlytics + Analytics** | Visibility on real users | Phase 2 |

**Why Firestore over Realtime Database:** richer queries (where + orderBy), better scaling, indexes you can reason about, and the "snapshot listener" model maps cleanly onto order-status live updates.

**Architecture diagram:**

```
┌─────────────────────────┐
│   React Native (Expo)    │
│   ├─ screens/            │
│   ├─ stores/             │  (Zustand — unchanged)
│   └─ services/  ◄────────┼──── THE ONLY SWAP POINT
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────────────────────────────┐
│                  Firebase                        │
│  ┌────────────┐  ┌────────────┐  ┌───────────┐  │
│  │   Auth     │  │ Firestore  │  │  Storage  │  │
│  │ Phone OTP  │  │ collections│  │  images   │  │
│  └────────────┘  └─────┬──────┘  └───────────┘  │
│                        │                         │
│                        ▼ triggers                │
│              ┌──────────────────┐               │
│              │ Cloud Functions  │ ──► FCM push  │
│              │  on order write  │ ──► SMS via   │
│              └──────────────────┘     3rd party │
└─────────────────────────────────────────────────┘
```

---

## 2. Collections

Five top-level Firestore collections. Flat structure beats nested subcollections for MVP — querying across shops, computing totals, and building admin tooling all get harder with subcollections.

### `users/{uid}`

```jsonc
{
  "uid": "auto-from-auth",
  "phone": "+919876543210",
  "name": "Sudhir Davim",
  "email": null,
  "defaultAddressId": "addr_1",
  "addresses": [
    {
      "id": "addr_1",
      "label": "Home",
      "line1": "B-42, Green Park Extension",
      "line2": "Near Uphaar Cinema",
      "city": "New Delhi",
      "pincode": "110016",
      "phone": "+919876543210",
      "location": { "lat": 28.5605, "lng": 77.2065 }
    }
  ],
  "createdAt": "<server timestamp>",
  "lastActiveAt": "<server timestamp>"
}
```

Addresses sit inline as an array. For MVP, users have 1–3 addresses; firing a subquery for each is wasteful. Switch to a subcollection only if users start managing 10+ addresses.

### `shops/{shopId}`

```jsonc
{
  "id": "shop_001",
  "ownerUid": "uid_of_shopkeeper",       // links to a user account
  "name": "Sharma Kirana Store",
  "description": "Daily grocery & household essentials since 1998",
  "address": "Shop 4, Green Park Market, New Delhi",
  "city": "delhi",
  "pincode": "110016",
  "location": { "lat": 28.5605, "lng": 77.2065 },
  "geohash": "ttnfv28h",                 // for radius queries (geofire-common)
  "rating": 4.3,
  "ratingsCount": 142,
  "isOpen": true,
  "openHours": { "open": "09:00", "close": "21:00" },
  "imageUrl": "gs://.../shops/shop_001/cover.jpg",
  "categories": ["atta_rice_dal", "dairy_eggs", "snacks_biscuits"],
  "deliveryFee": 25,
  "minOrder": 99,
  "etaMinutes": 30,
  "status": "active",                    // active | paused | suspended
  "createdAt": "<ts>",
  "updatedAt": "<ts>"
}
```

The `geohash` field is the key to "shops within 1 km." With Firestore + `geofire-common`, you can query by geohash range to get a coarse set, then refine client-side with haversine. This is the standard Firebase geo pattern.

### `products/{productId}`

Top-level, not a subcollection of `shops`. Reasons: global search across shops, easier admin tooling, simpler security rules.

```jsonc
{
  "id": "p_001_atta_5kg",
  "shopId": "shop_001",                  // FK
  "name": "Aashirvaad Whole Wheat Atta",
  "nameLower": "aashirvaad whole wheat atta",  // for case-insensitive search
  "brand": "Aashirvaad",
  "category": "atta_rice_dal",
  "imageUrl": "gs://.../products/p_001_atta_5kg.jpg",
  "packSize": { "value": 5, "unit": "kg" },
  "mrp": 275,
  "price": 260,
  "inStock": true,
  "tags": ["bestseller", "staple"],
  "searchTokens": ["aashirvaad", "atta", "wheat", "whole", "5kg"], // for prefix search
  "createdAt": "<ts>",
  "updatedAt": "<ts>"
}
```

`searchTokens` is a denormalization for cheap prefix search via `array-contains`. Real search (typo tolerance, ranking) needs Algolia or Typesense later — out of MVP scope.

### `orders/{orderId}`

```jsonc
{
  "id": "ORD-20260511-0001",
  "customerUid": "uid_of_customer",
  "shopId": "shop_001",
  "shopName": "Sharma Kirana Store",       // denormalized
  "items": [                                // snapshot at order time
    {
      "productId": "p_001_atta_5kg",
      "name": "Aashirvaad Whole Wheat Atta",
      "packLabel": "5 kg",
      "imageUrl": "gs://...",
      "price": 260,
      "quantity": 1
    }
  ],
  "subtotal": 396,
  "deliveryFee": 25,
  "total": 421,
  "deliveryAddress": { /* full snapshot */ },
  "paymentMethod": "cod",
  "paymentStatus": "pending",               // pending | paid | failed | refunded
  "status": "pending",                      // see lifecycle below
  "statusHistory": [
    { "status": "pending", "at": "<ts>", "by": "system" }
  ],
  "estimatedDeliveryAt": "<ts>",
  "createdAt": "<ts>",
  "updatedAt": "<ts>"
}
```

**Why denormalize `shopName` and the full item snapshot:** prices change, products get renamed, shops rebrand. The order is a legal/transactional record; it must remain accurate even if the source documents mutate. Same reason you never re-query products to render order history.

### `carts/{uid}` — **OPTIONAL for MVP**

**Recommendation: don't put carts in Firestore for the MVP.** Keep them client-only via Zustand + AsyncStorage. Reasons:

1. Carts are ephemeral. A round-trip per add-to-cart is wasted writes and worse UX.
2. Cross-device sync is a 1% user need at MVP scale.
3. Server carts introduce sync conflict logic (which device wins?) — not worth it yet.

When you eventually need it (e.g., when you launch a web app):

```jsonc
// carts/{uid}
{
  "uid": "user_uid",
  "shopId": "shop_001",
  "items": [ /* same shape as cart items */ ],
  "updatedAt": "<ts>"
}
```

Write strategy: debounce writes (500ms) so rapid `+/−` taps don't hammer Firestore.

---

## 3. Mock → Firebase Mapping

Side-by-side, so you know exactly what changes when you migrate:

| Mock today | Firestore tomorrow | What changes |
|---|---|---|
| `MOCK_SHOPS` array in `mocks/shops.ts` | `shops` collection | `services/shopService.ts` body swaps; signature stays |
| `MOCK_PRODUCTS` array in `mocks/products.ts` | `products` collection | `services/productService.ts` swaps |
| `MOCK_USER_LOCATION` constant | `users/{uid}.addresses[].location` + `expo-location` for real GPS | `services/userService.ts` (new) |
| `useCartStore` (Zustand + AsyncStorage) | **No change.** Stays client-only. | Nothing |
| `useOrderStore` (Zustand) | `orders` collection | `services/orderService.ts` swaps; `placeOrder` writes a doc instead of pushing to local array |
| Hardcoded user in checkout | Firebase Auth `currentUser` | Auth wired into `useUserStore` |

**Critical contract guarantee:** every service function keeps its current `Promise<T>` return shape. The mock service already returns Promises with a 150–300 ms delay precisely so the screens never know whether they're talking to mocks or Firestore.

---

## 4. Migration Strategy

Here's the order of operations. Each step is one PR. Frontend stays runnable on Expo Go after every step.

### Phase 1 — Firebase Project Setup (Day 1 of migration)

1. Create Firebase project. Enable Auth (Phone), Firestore (production mode), Storage.
2. Install: `npx expo install firebase` (web SDK works in Expo apps for MVP scale).
3. Add `src/services/firebase.ts` initializing the SDK with config from `.env`.
4. Add security rules from Section 8 below (start strict).

### Phase 2 — Auth (Day 2)

5. Add `src/store/useAuthStore.ts` — wraps `onAuthStateChanged`, exposes `user`, `loading`.
6. Add `src/screens/LoginScreen.tsx` — phone input → OTP input.
7. Gate checkout behind auth: if `user === null`, redirect to login from `CheckoutScreen`. Browsing stays public.
8. Optionally: enable Anonymous Auth so every browsing session has a `uid` (lets you persist a server-side cart later without forcing signup upfront).

### Phase 3 — Shops + Products read path (Day 3)

9. Seed Firestore with your mock data. Write a one-off `scripts/seed.ts` that uploads `MOCK_SHOPS` and `MOCK_PRODUCTS` to Firestore. Run once.
10. Replace **only the body** of `shopService.getNearbyShops()` to query Firestore. Test on Expo Go — ShopListScreen should render the same data.
11. Replace `productService.getByShop()` and `productService.search()` bodies.
12. Delete `src/mocks/` files. Done.

### Phase 4 — Orders write path (Day 4)

13. Replace `useOrderStore.placeOrder()` body — write a doc to `orders` instead of pushing locally. Return the created order.
14. Replace `useOrderStore.loadOrders()` — query `orders` where `customerUid == auth.uid`, orderBy `createdAt desc`.
15. Add real-time listener for the active order in `OrderDetailScreen` so status updates appear without refresh:
    ```ts
    onSnapshot(doc(db, 'orders', orderId), snap => setOrder(snap.data()));
    ```

### Phase 5 — Polish (Day 5+)

16. Cloud Function: `onOrderCreate` → send SMS to shop owner with order details.
17. Cloud Function: `onOrderStatusChange` → FCM push to customer.
18. Add App Check.
19. Add Crashlytics.

**The non-negotiable rule throughout:** never touch a screen file during migration. If you find yourself editing a screen, the service abstraction is leaking — fix the service instead.

---

## 5. API Structure (Service Layer Contracts)

Even though Firebase has no REST endpoints in your code, treat each service function as one "endpoint." This discipline is what makes the swap painless.

```ts
// services/shopService.ts
export const shopService = {
  getNearbyShops(opts: { location: GeoPoint; radiusKm: number }): Promise<Shop[]>;
  getById(shopId: string): Promise<Shop | null>;
  // ── post-MVP ──
  watchShop(shopId: string, cb: (s: Shop) => void): Unsubscribe;
};

// services/productService.ts
export const productService = {
  getByShop(shopId: string): Promise<Product[]>;
  search(opts: { query: string; categoryId?: CategoryId; limit?: number }): Promise<Array<{ shop: Shop; products: Product[] }>>;
  getById(productId: string): Promise<Product | null>;
};

// services/orderService.ts
export const orderService = {
  placeOrder(input: {
    customerUid: string;
    cart: CartSnapshot;
    address: Address;
    paymentMethod: 'cod';
  }): Promise<Order>;

  getById(orderId: string): Promise<Order | null>;
  listMine(customerUid: string, limit?: number): Promise<Order[]>;
  watchOrder(orderId: string, cb: (o: Order) => void): Unsubscribe;
  cancelOrder(orderId: string, reason: string): Promise<void>;  // customer-side; restricted
};

// services/userService.ts (new in Phase 2)
export const userService = {
  getMe(): Promise<User | null>;
  upsertProfile(input: Partial<User>): Promise<User>;
  addAddress(addr: Address): Promise<User>;
  setDefaultAddress(addressId: string): Promise<User>;
};

// services/authService.ts (new in Phase 2)
export const authService = {
  startPhoneAuth(phone: string): Promise<{ verificationId: string }>;
  confirmOtp(verificationId: string, code: string): Promise<{ uid: string }>;
  signOut(): Promise<void>;
  subscribe(cb: (uid: string | null) => void): Unsubscribe;
};
```

These signatures already match what your mock services should be doing. If they don't, fix the mock service to match — that's the actual migration prep.

---

## 6. Authentication Flow

**Pattern: anonymous-first, phone-upgrade at checkout.** This maximizes conversion.

```
App start
  │
  ▼
auth.onAuthStateChanged
  │
  ├─ user exists ──────────────► main app
  │
  └─ no user ──► signInAnonymously()
                  │
                  ▼
              anon uid assigned
                  │
                  ▼
              main app (browse, add to cart freely)
                  │
        user taps "Checkout"
                  │
                  ▼
        is user anonymous?
                  │
        ┌─────────┴─────────┐
        no                  yes
        │                   │
   proceed             show LoginScreen
                            │
                            ▼
                   enter phone → OTP
                            │
                            ▼
                  linkWithCredential(anonUser, phoneCred)
                            │
                            ▼
                  same uid, now phone-authenticated
                            │
                            ▼
                       proceed to checkout
```

`linkWithCredential` is the magic: it upgrades the anonymous user to a real one **without changing the uid**, so any data already associated (server cart, browsing history) stays attached.

**Why phone OTP, not email:**
- India: phone numbers are universal, email penetration in tier-2/3 is low.
- Phone is also the contact channel for delivery — duplicate entry avoided.
- Cost: Firebase gives 10k free verifications/month, enough for MVP.

**Session persistence:** Firebase Auth web SDK persists to AsyncStorage in RN automatically (with proper init). User stays logged in until explicit sign-out.

**Code shape (Phase 2):**

```ts
// services/firebase.ts
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});
```

---

## 7. Order Lifecycle Backend Design

State machine. Six states, narrow transition rules, every transition logged.

```
          ┌─────────────┐
          │   pending   │  ← created by customer
          └──────┬──────┘
                 │ shop accepts
                 ▼
          ┌─────────────┐
          │  accepted   │
          └──────┬──────┘
                 │ shop starts packing
                 ▼
          ┌─────────────┐
          │  preparing  │
          └──────┬──────┘
                 │ shop hands to delivery
                 ▼
          ┌──────────────────┐
          │ out_for_delivery │
          └────────┬─────────┘
                   │ delivered (or COD collected)
                   ▼
          ┌─────────────┐
          │  delivered  │  ◄── terminal (success)
          └─────────────┘

  From any pre-delivery state:
          ┌─────────────┐
          │  cancelled  │  ◄── terminal (failure)
          └─────────────┘
```

### Who can transition what

| Transition | Allowed actor |
|---|---|
| `pending` → `accepted` | Shop owner |
| `pending` → `cancelled` | Customer (within 2 min) OR Shop (with reason) |
| `accepted` → `preparing` | Shop owner |
| `accepted` → `cancelled` | Shop owner (with reason, refund flag if paid) |
| `preparing` → `out_for_delivery` | Shop owner |
| `out_for_delivery` → `delivered` | Shop owner / delivery person |
| Any other transition | **Rejected by Cloud Function or security rules** |

### Implementation

Don't let clients update `status` directly. Two-layer enforcement:

1. **Security rules** allow `status` writes only by shop owner of that shop, customer for cancel-within-2-min, or service accounts.
2. **Cloud Function `onOrderUpdate`** validates the transition is legal (no jumping from `pending` → `delivered`) and appends to `statusHistory`. Reject with error if invalid.

```ts
// pseudo-code for the Function
const VALID = {
  pending:          ['accepted', 'cancelled'],
  accepted:         ['preparing', 'cancelled'],
  preparing:        ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered'],
  delivered:        [],
  cancelled:        [],
};

export const validateOrderStatus = functions.firestore
  .document('orders/{id}')
  .onUpdate((change) => {
    const before = change.before.data();
    const after  = change.after.data();
    if (before.status === after.status) return null;
    if (!VALID[before.status].includes(after.status)) {
      // revert
      return change.after.ref.update({ status: before.status });
    }
    return change.after.ref.update({
      statusHistory: [...(before.statusHistory ?? []), {
        status: after.status, at: FieldValue.serverTimestamp(), by: 'system',
      }],
    });
  });
```

### Notifications

On every status change:
- **FCM push to customer** ("Your order is being prepared", etc.)
- **SMS to shop owner** on initial `pending` create (catches them even if app is closed)

Both are downstream side-effects of the same `onOrderUpdate` function. Keep them in one place.

### ETA computation

`estimatedDeliveryAt = createdAt + shop.etaMinutes`. Simple, accurate enough for MVP. Recompute on `out_for_delivery` if you want a tighter "Arriving in X min" countdown.

---

## 8. Security Rules (starting point)

Paste into `firestore.rules`. Tighten as you go.

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // helpers
    function isSignedIn() { return request.auth != null; }
    function isOwner(uid) { return isSignedIn() && request.auth.uid == uid; }
    function isShopOwner(shopId) {
      return isSignedIn() &&
        get(/databases/$(database)/documents/shops/$(shopId)).data.ownerUid == request.auth.uid;
    }

    // users — only owner can read/write own doc
    match /users/{uid} {
      allow read, write: if isOwner(uid);
    }

    // shops — public read, write only by owner
    match /shops/{shopId} {
      allow read: if true;
      allow create: if isSignedIn();       // tighten later: require admin
      allow update, delete: if isShopOwner(shopId);
    }

    // products — public read, write only by shop owner
    match /products/{productId} {
      allow read: if true;
      allow create: if isShopOwner(request.resource.data.shopId);
      allow update, delete: if isShopOwner(resource.data.shopId);
    }

    // orders — customer reads own, shop reads orders for own shop
    match /orders/{orderId} {
      allow read: if isOwner(resource.data.customerUid)
                  || isShopOwner(resource.data.shopId);

      allow create: if isOwner(request.resource.data.customerUid)
                    && request.resource.data.status == 'pending';

      // customer can only cancel within 2 minutes
      allow update: if (
        isOwner(resource.data.customerUid)
        && request.resource.data.status == 'cancelled'
        && resource.data.status == 'pending'
        && request.time < resource.data.createdAt + duration.value(2, 'm')
      ) || isShopOwner(resource.data.shopId);

      allow delete: if false;
    }
  }
}
```

---

## 9. Firestore Indexes You'll Need

Add these to `firestore.indexes.json`. Firestore prompts you for them in console errors as you build, but pre-creating saves debugging time.

| Collection | Fields | Purpose |
|---|---|---|
| `shops` | `city ASC`, `geohash ASC` | Nearby-shop radius queries |
| `shops` | `city ASC`, `isOpen ASC`, `rating DESC` | "Top rated open shops in Delhi" |
| `products` | `shopId ASC`, `category ASC` | Shop detail grouped by category |
| `products` | `category ASC`, `inStock ASC` | Global category browse |
| `orders` | `customerUid ASC`, `createdAt DESC` | Order history |
| `orders` | `shopId ASC`, `status ASC`, `createdAt DESC` | Shop dashboard "pending orders" |

---

## 10. MVP Cost & Scaling Notes

For a city-launch MVP (target: 100 active users, 50 shops, 200 orders/day):

- **Firestore:** comfortably free tier (50k reads/day). The expensive operation is the product list on `ShopDetailScreen` — cache aggressively client-side (5 min) to avoid re-reads.
- **Auth:** 10k phone verifications/month free. Roughly 300/day. Plenty.
- **Storage:** ~5 GB free. Plenty for 50 shops with 30 products each at 50 KB/image.
- **Functions:** 2M invocations/month free. Order volume is far below this.

You won't pay Firebase for ~6 months. Watch for one expensive habit: chatty `onSnapshot` listeners that stay open after the screen unmounts. Always return the unsubscribe in `useEffect` cleanup.

---

## TL;DR

**Five collections** (`users`, `shops`, `products`, `orders` + optional `carts`). **Auth via anonymous-first, phone-upgrade at checkout.** **Service layer is the migration seam — never touch screens.** **Order state machine enforced by Cloud Function, not by client.** **Carts stay client-only on AsyncStorage until you have a web app.**

The mock services you're building this week already match this design. That's not a coincidence — the architecture chose Firebase compatibility on Day 1 of the frontend so this migration doc has nothing surprising in it.
