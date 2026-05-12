# Grocery Marketplace — MVP Architecture (Stage 2)

> **Scope:** React Native (Expo) marketplace connecting customers to nearby kirana stores.
> **Constraint:** Mock data only. Firebase wired in later. Keep the surface small.

---

## 1. App Architecture (Frontend Modules)

Think of the app as five vertical feature modules sitting on top of a thin shared layer. Each module owns its screens, components, store slice, and mock service.

| Module | Responsibility |
|---|---|
| `discovery` | Nearby-shop browsing, location filter (1 km), search across shops |
| `shop` | Single shop view, its product catalog |
| `cart` | Add/remove items, quantity, subtotal — **single-shop cart** for MVP |
| `order` | Checkout, place order, order history, order detail |
| `user` | Placeholder profile + delivery address (no real auth yet) |
| `shared` | UI primitives, hooks, theme, mock services, types |

**Why modular now?** When Firebase comes in, you swap each module's `services/` file from mock → Firestore without touching screens.

---

## 2. New Screens Required

You already have Home → ShopList. Add these, roughly in this order of priority:

1. **ShopListScreen** (upgrade existing) — shops within 1 km, distance + open/closed badge, search input
2. **ShopDetailScreen** — shop header + product catalog grouped by category
3. **SearchScreen** — global product search across all shops, results grouped by shop
4. **CartScreen** — line items, qty controls, subtotal, "Proceed to Checkout"
5. **CheckoutScreen** — delivery address (mock), payment method (COD only for MVP), place order
6. **OrderConfirmationScreen** — success state, ETA, "View Order" / "Back to Home"
7. **OrdersScreen** — list of past orders with status chip
8. **OrderDetailScreen** — full order breakdown + status timeline

Skip for MVP: ProductDetailScreen (add-to-cart from card is enough), Login, Filters.

---

## 3. Component Structure

Keep components dumb. Screens hold logic, components render.

```
common/
  Button.tsx              primary | secondary | ghost variants
  Input.tsx               with icon + error slot
  Card.tsx                base elevated container
  EmptyState.tsx          illustration + title + CTA
  Loader.tsx              full-screen + inline
  Badge.tsx               open/closed, status chips
  QuantityStepper.tsx     - 0 +
  Price.tsx               formats currency consistently

shop/
  ShopCard.tsx            used in ShopList
  ShopHeader.tsx          used in ShopDetail
  DistanceBadge.tsx

product/
  ProductCard.tsx         image, name, price, add button
  ProductList.tsx         grouped-by-category renderer
  SearchBar.tsx

cart/
  CartLineItem.tsx
  CartSummary.tsx         subtotal, delivery fee, total

order/
  OrderStatusChip.tsx
  OrderTimeline.tsx
  OrderSummaryRow.tsx
```

---

## 4. State Management (MVP Level)

**Use Zustand.** It is the lowest-overhead option that still scales — no providers, no boilerplate, persists easily later.

Three small stores:

```ts
// store/useCartStore.ts
{
  shopId: string | null,          // cart is locked to one shop
  items: CartItem[],
  addItem(product, qty),
  removeItem(productId),
  updateQty(productId, qty),
  clearCart(),
  // derived: subtotal, itemCount
}

// store/useShopStore.ts
{
  shops: Shop[],
  selectedShop: Shop | null,
  loadShops(),                    // calls mock service
  selectShop(shopId),
}

// store/useOrderStore.ts
{
  orders: Order[],
  placeOrder(cart, address) → Order,
  getOrder(id),
}
```

**Rule of thumb:** server-ish data → store, ephemeral UI state (input text, modal open) → `useState`.

Avoid Redux/RTK for now. Don't reach for React Query until you have a real backend.

---

## 5. Navigation Flow

Root: **Stack Navigator** wrapping a **Bottom Tab Navigator**.

```
RootStack
├── (Tabs)                  ← Bottom tabs, the default home
│   ├── HomeTab     → ShopListScreen
│   ├── SearchTab   → SearchScreen
│   ├── CartTab     → CartScreen          (badge = itemCount)
│   └── OrdersTab   → OrdersScreen
│
├── ShopDetailScreen        ← pushed from ShopList / Search
├── CheckoutScreen          ← pushed from Cart
├── OrderConfirmationScreen ← replace from Checkout
└── OrderDetailScreen       ← pushed from Orders
```

**User journeys:**

```
Browse:   Home(ShopList) → ShopDetail → [Add to cart] → CartTab → Checkout → Confirmation
Search:   SearchTab → ShopDetail → [Add] → CartTab → Checkout → Confirmation
Reorder:  OrdersTab → OrderDetail → [Reorder] → CartTab
```

Use `@react-navigation/native` + `@react-navigation/native-stack` + `@react-navigation/bottom-tabs`. All Expo-compatible.

---

## 6. Data Models

TypeScript-first. These live in `src/types/`.

```ts
// Shop
type Shop = {
  id: string;
  name: string;
  description?: string;
  address: string;
  location: { lat: number; lng: number };
  distanceKm?: number;          // computed client-side from user loc
  rating: number;               // 0..5
  isOpen: boolean;
  imageUrl: string;
  categories: string[];         // ["fruits", "dairy", ...]
  deliveryFee: number;
  minOrder: number;
};

// Product
type Product = {
  id: string;
  shopId: string;               // every product belongs to one shop
  name: string;
  description?: string;
  price: number;                // in paise/cents to avoid float math, or rupees with care
  unit: 'kg' | 'g' | 'piece' | 'litre' | 'ml' | 'packet';
  imageUrl: string;
  category: string;
  inStock: boolean;
};

// Cart  (single-shop cart for MVP)
type CartItem = {
  productId: string;
  name: string;
  price: number;
  unit: Product['unit'];
  imageUrl: string;
  quantity: number;
};

type Cart = {
  shopId: string | null;
  shopName: string | null;
  items: CartItem[];
  // derived:
  // subtotal = sum(items.price * quantity)
  // deliveryFee from shop
  // total = subtotal + deliveryFee
};

// Order
type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

type Order = {
  id: string;
  shopId: string;
  shopName: string;
  items: CartItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  deliveryAddress: {
    line1: string;
    line2?: string;
    city: string;
    pincode: string;
    phone: string;
  };
  paymentMethod: 'cod';         // online added later
  status: OrderStatus;
  createdAt: number;            // epoch ms
  estimatedDeliveryAt: number;
};
```

**MVP simplification:** the cart holds items from **one shop only**. If a user tries to add from a second shop, prompt to clear the cart first. This avoids a hairy multi-shop checkout flow that you don't need yet.

---

## 7. Folder Structure

```
my-app/
├── App.tsx
├── app.json
├── package.json
├── tsconfig.json
└── src/
    ├── navigation/
    │   ├── RootNavigator.tsx
    │   └── TabNavigator.tsx
    │
    ├── screens/
    │   ├── ShopListScreen.tsx
    │   ├── ShopDetailScreen.tsx
    │   ├── SearchScreen.tsx
    │   ├── CartScreen.tsx
    │   ├── CheckoutScreen.tsx
    │   ├── OrderConfirmationScreen.tsx
    │   ├── OrdersScreen.tsx
    │   └── OrderDetailScreen.tsx
    │
    ├── components/
    │   ├── common/    (Button, Input, Card, Loader, Badge, Price, QuantityStepper)
    │   ├── shop/      (ShopCard, ShopHeader, DistanceBadge)
    │   ├── product/   (ProductCard, ProductList, SearchBar)
    │   ├── cart/      (CartLineItem, CartSummary)
    │   └── order/     (OrderStatusChip, OrderTimeline)
    │
    ├── store/
    │   ├── useCartStore.ts
    │   ├── useShopStore.ts
    │   └── useOrderStore.ts
    │
    ├── services/                  (swap-out point for Firebase later)
    │   ├── shopService.ts
    │   ├── productService.ts
    │   └── orderService.ts
    │
    ├── mocks/
    │   ├── shops.ts
    │   ├── products.ts
    │   └── userLocation.ts
    │
    ├── hooks/
    │   ├── useDistance.ts
    │   └── useDebouncedValue.ts
    │
    ├── utils/
    │   ├── distance.ts            (haversine)
    │   ├── format.ts              (currency, time)
    │   └── id.ts                  (generateOrderId)
    │
    ├── constants/
    │   ├── theme.ts               (colors, spacing, radii, typography)
    │   └── config.ts              (RADIUS_KM = 1, DELIVERY_ETA_MIN = 30)
    │
    └── types/
        ├── shop.ts
        ├── product.ts
        ├── cart.ts
        └── order.ts
```

---

## 8. What to Build NEXT (Step-by-Step)

Each step is one focused PR/commit. Should be 1-3 hours each in Windsurf.

**Step 1 — Foundations**
Install deps: `zustand`, `@react-navigation/native-stack`, `@react-navigation/bottom-tabs`.
Scaffold the folder structure above. Set up `src/constants/theme.ts` and `src/types/*`.

**Step 2 — Mock data**
Create `src/mocks/shops.ts` with 8–10 shops (varied lat/lng around a fixed point).
Create `src/mocks/products.ts` with 30–50 products mapped to those shopIds.
Create `src/mocks/userLocation.ts` with a hardcoded user lat/lng.

**Step 3 — Services layer**
Build `shopService.getNearbyShops()`, `productService.getByShop(shopId)`, `productService.search(query)`. All return Promises that resolve from mocks with a 300 ms delay (so loading states are visible).

**Step 4 — Common components**
`Button`, `Card`, `Loader`, `Badge`, `Price`, `QuantityStepper`. Style with the theme constants.

**Step 5 — Shop discovery**
Build `ShopCard`. Rebuild `ShopListScreen` to call `shopService`, compute distance with `utils/distance.ts`, filter to ≤ 1 km, sort by distance. Add empty state.

**Step 6 — Shop detail + products**
Build `ProductCard` (with add-to-cart button — wires to cart store in next step).
Build `ShopDetailScreen` — header + product list grouped by category.

**Step 7 — Cart store + Cart screen**
Implement `useCartStore` with the single-shop rule (alert when switching shops).
Add tab bar with badge showing item count.
Build `CartScreen` with line items, qty stepper, summary, "Checkout" button.

**Step 8 — Search**
Build `SearchBar` + `SearchScreen`. Debounced input, results grouped by shop, tap result → ShopDetail.

**Step 9 — Checkout + order placement**
Build `CheckoutScreen` (mock address form, COD only).
Implement `useOrderStore.placeOrder()` which creates an Order from the cart, clears the cart, returns the order.
Navigate to `OrderConfirmationScreen`.

**Step 10 — Orders history**
Build `OrdersScreen` (list) and `OrderDetailScreen` (full breakdown + status chip).
Add a "Reorder" button that re-populates the cart.

**Step 11 — Polish + persistence**
Persist cart + orders to AsyncStorage via Zustand's `persist` middleware.
Add pull-to-refresh on ShopList and Orders.
Add basic error states.

**After MVP — Firebase swap**
Replace the bodies of `services/*.ts` with Firestore queries. Screens and stores stay untouched. That's the payoff for the services layer.

---

## Decisions Locked In (so you don't re-debate later)

- **Single-shop cart** for MVP. Multi-shop later.
- **Zustand** over Redux/Context+Reducer.
- **TypeScript** everywhere — Windsurf's autocomplete is dramatically better with types.
- **COD only** at checkout. Payment gateway is post-MVP.
- **Mock user location** until you wire `expo-location`. Wire it after Step 5 if you want, but don't block on permissions UX now.
- **No login** until Firebase Auth is added. Treat user as anonymous with a generated device id.
