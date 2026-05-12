# Shop → Product → Cart System Design (MVP)

> Companion to `MVP_ARCHITECTURE.md`. This doc drills into the data layer you'll actually code first.

---

## 1. Product Data Model (India-realistic)

Keep the model small but capture what an Indian grocery shopper actually sees on a packet: brand, weight/volume, MRP. That's what makes mock data feel real instead of toy.

```ts
type Unit =
  | 'kg' | 'g'              // atta, dal, sugar, vegetables
  | 'litre' | 'ml'          // oil, milk, soft drinks
  | 'piece'                 // eggs, soap bars, bread loaves
  | 'packet' | 'dozen';     // biscuits, eggs

type Product = {
  id: string;               // 'p_aashirvaad_atta_5kg'
  shopId: string;           // FK → Shop.id
  name: string;             // 'Aashirvaad Whole Wheat Atta'
  brand?: string;           // 'Aashirvaad'
  category: CategoryId;     // 'atta_rice_dal'
  imageUrl: string;
  packSize: {               // shown on the card: "5 kg", "1 L", "200 g"
    value: number;
    unit: Unit;
  };
  mrp: number;              // in rupees, integer paise avoided for MVP
  price: number;            // shop's selling price (≤ mrp)
  inStock: boolean;         // simple boolean for MVP, not a quantity
  tags?: string[];          // ['organic', 'bestseller'] — optional, useful for search
};
```

**Why these fields and not more?**

- No `quantity` / `stockCount` — you said no inventory system. `inStock: boolean` is enough to gray out a card.
- No GST / HSN / nutrition info — not visible to the user in the shopping flow.
- `mrp` + `price` lets you show "₹260 ~~₹275~~" which is what every Indian grocery app does and what users trust.
- `packSize` separated from `unit` so the UI can render "1 kg" cleanly and you can later filter by pack size.

---

## 2. Shop → Product Relationship

**One Shop has many Products. Each Product belongs to exactly one Shop.**

This is the right call for a marketplace of kirana stores because every shop sets its own price for the same SKU. Shop A sells Amul Taaza 1L at ₹68, Shop B at ₹70. They are two distinct `Product` records, both referencing the catalog item "Amul Taaza 1L" only conceptually (via name + brand + packSize).

```
Shop (1) ────< Product (many)
  id              shopId  ← FK
  name            name
  ...             price
                  inStock
```

**Do not** build a global `CatalogItem` table that shops "stock" with prices. That's the right model long-term, but for MVP it doubles your data layer with zero user-visible benefit. Build it when you have 50+ shops sharing 80% of their SKUs.

**Access patterns you need:**

```ts
shopService.getNearbyShops(userLoc): Shop[]
productService.getByShop(shopId): Product[]
productService.search(query): Array<{ shop: Shop; products: Product[] }>
```

The search return shape is the key one — search results in a marketplace are always grouped by shop, never a flat list, because the user has to pick *who* they're buying from.

---

## 3. Categories (How Products Are Grouped)

Use a flat enum, not a tree. Sub-categories are overkill for an MVP catalog of 30–50 products per shop.

```ts
type CategoryId =
  | 'atta_rice_dal'      // Atta, Rice, Dals & Pulses
  | 'oil_ghee'           // Cooking oil, Ghee, Vanaspati
  | 'dairy_eggs'         // Milk, Curd, Paneer, Eggs, Butter
  | 'bakery'             // Bread, Rusks, Buns
  | 'masala_spices'      // Salt, Turmeric, Garam Masala, Whole spices
  | 'snacks_biscuits'    // Parle-G, Lays, Kurkure, Namkeen
  | 'beverages'          // Tea, Coffee, Soft drinks, Juices
  | 'personal_care'      // Soap, Shampoo, Toothpaste
  | 'household'          // Detergent, Phenyl, Dishwash
  | 'fruits_vegetables'; // Onion, Potato, Tomato, Bananas

const CATEGORIES: { id: CategoryId; label: string; icon: string }[] = [
  { id: 'atta_rice_dal',    label: 'Atta, Rice & Dal',  icon: 'grain' },
  { id: 'oil_ghee',         label: 'Oil & Ghee',        icon: 'bottle' },
  { id: 'dairy_eggs',       label: 'Dairy & Eggs',      icon: 'milk' },
  { id: 'bakery',           label: 'Bakery',            icon: 'bread' },
  { id: 'masala_spices',    label: 'Masala & Spices',   icon: 'spice' },
  { id: 'snacks_biscuits',  label: 'Snacks & Biscuits', icon: 'cookie' },
  { id: 'beverages',        label: 'Beverages',         icon: 'cup' },
  { id: 'personal_care',    label: 'Personal Care',     icon: 'soap' },
  { id: 'household',        label: 'Household',         icon: 'broom' },
  { id: 'fruits_vegetables',label: 'Fruits & Veggies',  icon: 'apple' },
];
```

**On `ShopDetailScreen`:** render a `SectionList` grouped by category. Sticky headers. Customers scan vertically through "Dairy → Bakery → Snacks" the same way they walk through a store.

---

## 4 + 5. Multi-shop or Single-shop Cart? (Decision + Justification)

**Decision: SINGLE-SHOP CART for MVP.** No exceptions.

Behavior: when the user taps "Add to Cart" on a product from Shop B while their cart already has items from Shop A, show a confirmation:

> *"Your cart has items from `Shop A`. Adding from `Shop B` will clear your cart. Continue?"*
> [ Keep Cart ]   [ Clear & Add ]

Justification — the four reasons this is correct, in order of importance:

1. **Fulfillment is per-shop.** A kirana store packs and hands off one order. Multi-shop means orchestrating multiple pickups, multiple ETAs, multiple status updates, and (eventually) split payments. You don't have any of that infrastructure and you don't need it to validate the product.

2. **Delivery fee math gets ugly.** With multi-shop you must decide: charge delivery per shop (sticker shock)? Pool it (who eats the loss)? Free above ₹X per shop or total? Every answer needs UI, logic, and a settlement story. Single-shop dodges all of it: one shop, one fee, one total.

3. **Real-world user behavior backs it up.** A typical grocery run is one shop. Zepto, Blinkit, Instamart all launched single-store and most still effectively are (one dark store fulfills your order). BigBasket added multi-vendor late and it took a year to get right.

4. **You can ship Steps 7–10 in a weekend.** Multi-shop cart would add a week minimum: cart-per-shop data structure, per-shop subtotals, checkout that loops over shops, order grouping. Every one of those is a place bugs live.

**When to revisit:** when you have ≥ 20 active shops in one city and you see user research showing carts abandoned because "the one item I need isn't at this shop." Until then, single-shop.

**Implementation rule in the cart store:**

```ts
addItem(product) {
  const { shopId, items } = get();
  if (shopId && shopId !== product.shopId) {
    // surface confirmation in UI; only proceed if user confirms
    throw new DifferentShopError(shopId, product.shopId);
  }
  // ... add or increment
}
```

Screens catch `DifferentShopError`, show the dialog, call `clearCart()` + `addItem()` if confirmed.

---

## 6. Example JSON Structures

Drop these straight into `src/mocks/` as TypeScript const arrays. The values are deliberately realistic so the UI looks alive on first run.

### Shop

```json
{
  "id": "shop_001",
  "name": "Sharma Kirana Store",
  "description": "Daily grocery & household essentials since 1998",
  "address": "Shop 4, Green Park Market, New Delhi",
  "location": { "lat": 28.5605, "lng": 77.2065 },
  "rating": 4.3,
  "isOpen": true,
  "imageUrl": "https://picsum.photos/seed/shop001/600/400",
  "categories": ["atta_rice_dal", "dairy_eggs", "snacks_biscuits", "household"],
  "deliveryFee": 25,
  "minOrder": 99,
  "etaMinutes": 30
}
```

### Product

```json
{
  "id": "p_001_aashirvaad_atta_5kg",
  "shopId": "shop_001",
  "name": "Aashirvaad Whole Wheat Atta",
  "brand": "Aashirvaad",
  "category": "atta_rice_dal",
  "imageUrl": "https://picsum.photos/seed/atta5/300/300",
  "packSize": { "value": 5, "unit": "kg" },
  "mrp": 275,
  "price": 260,
  "inStock": true,
  "tags": ["bestseller"]
}
```

A few more for flavor (you'll want ~30 like these in `mocks/products.ts`):

```json
[
  {
    "id": "p_001_amul_taaza_1l",
    "shopId": "shop_001",
    "name": "Amul Taaza Toned Milk",
    "brand": "Amul",
    "category": "dairy_eggs",
    "imageUrl": "https://picsum.photos/seed/amul1l/300/300",
    "packSize": { "value": 1, "unit": "litre" },
    "mrp": 70, "price": 68, "inStock": true
  },
  {
    "id": "p_001_tata_salt_1kg",
    "shopId": "shop_001",
    "name": "Tata Salt",
    "brand": "Tata",
    "category": "masala_spices",
    "imageUrl": "https://picsum.photos/seed/tatasalt/300/300",
    "packSize": { "value": 1, "unit": "kg" },
    "mrp": 28, "price": 28, "inStock": true
  },
  {
    "id": "p_001_parle_g_800g",
    "shopId": "shop_001",
    "name": "Parle-G Original Glucose Biscuits",
    "brand": "Parle",
    "category": "snacks_biscuits",
    "imageUrl": "https://picsum.photos/seed/parleg/300/300",
    "packSize": { "value": 800, "unit": "g" },
    "mrp": 80, "price": 75, "inStock": true
  },
  {
    "id": "p_001_fortune_oil_1l",
    "shopId": "shop_001",
    "name": "Fortune Sunlite Refined Sunflower Oil",
    "brand": "Fortune",
    "category": "oil_ghee",
    "imageUrl": "https://picsum.photos/seed/fortune/300/300",
    "packSize": { "value": 1, "unit": "litre" },
    "mrp": 165, "price": 159, "inStock": true
  }
]
```

### Cart

```json
{
  "shopId": "shop_001",
  "shopName": "Sharma Kirana Store",
  "items": [
    {
      "productId": "p_001_aashirvaad_atta_5kg",
      "name": "Aashirvaad Whole Wheat Atta",
      "imageUrl": "https://picsum.photos/seed/atta5/300/300",
      "packLabel": "5 kg",
      "price": 260,
      "quantity": 1
    },
    {
      "productId": "p_001_amul_taaza_1l",
      "name": "Amul Taaza Toned Milk",
      "imageUrl": "https://picsum.photos/seed/amul1l/300/300",
      "packLabel": "1 L",
      "price": 68,
      "quantity": 2
    }
  ],
  "subtotal": 396,
  "deliveryFee": 25,
  "total": 421
}
```

Note `packLabel` is a pre-formatted display string ("5 kg", "1 L", "800 g") snapshotted into the cart item. Don't recompute from `packSize` in the cart UI — snapshots protect you when product details change mid-session.

### Order

```json
{
  "id": "ORD-20260511-0001",
  "shopId": "shop_001",
  "shopName": "Sharma Kirana Store",
  "items": [
    {
      "productId": "p_001_aashirvaad_atta_5kg",
      "name": "Aashirvaad Whole Wheat Atta",
      "packLabel": "5 kg",
      "price": 260,
      "quantity": 1
    },
    {
      "productId": "p_001_amul_taaza_1l",
      "name": "Amul Taaza Toned Milk",
      "packLabel": "1 L",
      "price": 68,
      "quantity": 2
    }
  ],
  "subtotal": 396,
  "deliveryFee": 25,
  "total": 421,
  "deliveryAddress": {
    "line1": "B-42, Green Park Extension",
    "line2": "Near Uphaar Cinema",
    "city": "New Delhi",
    "pincode": "110016",
    "phone": "+91 98XXXXXX12"
  },
  "paymentMethod": "cod",
  "status": "pending",
  "createdAt": 1747900800000,
  "estimatedDeliveryAt": 1747902600000
}
```

The Order is essentially a frozen Cart + address + status + timestamps. That symmetry is intentional — `placeOrder()` is a 10-line function.

---

## 7. Simplest Implementation Approach (RN, Windsurf-friendly)

**One screen, one store, one mock file at a time.** Do not try to wire everything at once.

### File-by-file plan

```
src/types/product.ts           ← paste the Product type above
src/types/shop.ts              ← Shop type
src/types/cart.ts              ← CartItem + Cart types
src/constants/categories.ts    ← the CATEGORIES array
src/mocks/shops.ts             ← 8 shops, varied lat/lng around user
src/mocks/products.ts          ← 30+ products, distributed across shops
src/services/shopService.ts    ← getNearbyShops()
src/services/productService.ts ← getByShop(), search()
src/store/useCartStore.ts      ← zustand store with single-shop rule
```

### Zustand cart store (drop-in starter)

```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

type CartItem = {
  productId: string;
  name: string;
  imageUrl: string;
  packLabel: string;
  price: number;
  quantity: number;
};

type CartState = {
  shopId: string | null;
  shopName: string | null;
  deliveryFee: number;
  items: CartItem[];

  addItem: (p: Product, shop: Shop) => { ok: true } | { ok: false; reason: 'different_shop' };
  forceAddItem: (p: Product, shop: Shop) => void;     // called after user confirms clear
  increment: (productId: string) => void;
  decrement: (productId: string) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;

  subtotal: () => number;
  total: () => number;
  itemCount: () => number;
};

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      shopId: null,
      shopName: null,
      deliveryFee: 0,
      items: [],

      addItem: (p, shop) => {
        const { shopId } = get();
        if (shopId && shopId !== p.shopId) return { ok: false, reason: 'different_shop' };
        get().forceAddItem(p, shop);
        return { ok: true };
      },

      forceAddItem: (p, shop) => set(state => {
        const fresh = state.shopId === p.shopId ? state.items : [];
        const existing = fresh.find(i => i.productId === p.id);
        const items = existing
          ? fresh.map(i => i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i)
          : [...fresh, {
              productId: p.id, name: p.name, imageUrl: p.imageUrl,
              packLabel: `${p.packSize.value} ${p.packSize.unit}`,
              price: p.price, quantity: 1,
            }];
        return { items, shopId: shop.id, shopName: shop.name, deliveryFee: shop.deliveryFee };
      }),

      increment: id => set(s => ({ items: s.items.map(i => i.productId === id ? { ...i, quantity: i.quantity + 1 } : i) })),
      decrement: id => set(s => ({
        items: s.items.flatMap(i =>
          i.productId !== id ? [i] :
          i.quantity > 1 ? [{ ...i, quantity: i.quantity - 1 }] : []
        ),
      })),
      removeItem: id => set(s => ({ items: s.items.filter(i => i.productId !== id) })),
      clearCart: () => set({ shopId: null, shopName: null, deliveryFee: 0, items: [] }),

      subtotal: () => get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),
      total: () => get().subtotal() + get().deliveryFee,
      itemCount: () => get().items.reduce((n, i) => n + i.quantity, 0),
    }),
    { name: 'cart-v1', storage: createJSONStorage(() => AsyncStorage) }
  )
);
```

That single file is the entire cart system. ProductCard calls `addItem`, catches the `different_shop` result, shows the dialog, then calls `forceAddItem` if confirmed.

### Wiring the "Add" button on `ProductCard`

```tsx
const { addItem, forceAddItem } = useCartStore();

const onAdd = () => {
  const result = addItem(product, shop);
  if (!result.ok && result.reason === 'different_shop') {
    Alert.alert(
      'Start a new cart?',
      `Your cart has items from ${useCartStore.getState().shopName}. Clear it to add from ${shop.name}?`,
      [
        { text: 'Keep cart', style: 'cancel' },
        { text: 'Clear & add', style: 'destructive', onPress: () => forceAddItem(product, shop) },
      ]
    );
  }
};
```

### Place order — 10 lines

```ts
placeOrder: (address) => {
  const cart = useCartStore.getState();
  const order: Order = {
    id: `ORD-${Date.now()}`,
    shopId: cart.shopId!, shopName: cart.shopName!,
    items: cart.items, subtotal: cart.subtotal(),
    deliveryFee: cart.deliveryFee, total: cart.total(),
    deliveryAddress: address, paymentMethod: 'cod',
    status: 'pending', createdAt: Date.now(),
    estimatedDeliveryAt: Date.now() + 30 * 60 * 1000,
  };
  set(s => ({ orders: [order, ...s.orders] }));
  useCartStore.getState().clearCart();
  return order;
}
```

### Three rules that will save you from rework

1. **Snapshot, don't reference.** Cart items copy `name`, `price`, `packLabel` from the Product at add-time. Don't store just `productId` and look up live — products will change.
2. **Money as rupees (integer or 2-decimal float), one unit, one currency.** No paise, no localization until you scale beyond one city. Format at the view layer only.
3. **`persist` the cart immediately.** Users put the phone down. Coming back to an empty cart kills conversion.

---

## TL;DR

Single-shop cart. Flat category enum. Product has `mrp` + `price` + `packSize` + `inStock` boolean — nothing else. Zustand store handles everything cart-related in ~80 lines including persistence. Build mocks first, screens second, never the other way around.
