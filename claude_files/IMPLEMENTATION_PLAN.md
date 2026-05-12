# Implementation Plan — Frontend MVP in 3–5 Days (Windsurf + Expo)

> Companion to the three design docs. This is the build manual.
> Goal: paste any section into Windsurf and get runnable code on the first or second prompt.

---

## 0. Day-by-Day Plan (commit to this shape)

| Day | Theme | Outcome at end of day |
|---|---|---|
| 1 | Foundations + Reusable components | Theme, types, mocks, 8 common components rendering on a sandbox screen |
| 2 | Browse flow | ShopList + ShopDetail working end-to-end with navigation, cart store wired |
| 3 | Cart + Search + Home | Add-to-cart, qty controls, CartScreen totals, SearchScreen, HomeScreen |
| 4 | Checkout + Orders | CheckoutScreen, place order, Confirmation, Orders history + Detail |
| 5 | Polish | AsyncStorage persistence, loading/empty states, pull-to-refresh, bug fixes |

If you slip, drop Day 3's HomeScreen first (Home can just route to ShopList for v0). Then drop SearchScreen. Cart + Checkout + Orders are non-negotiable for a usable MVP.

---

## 1. Step-by-Step Coding Order

Each step is ~30–90 minutes of Windsurf work. Test in Expo Go after every step.

### Day 1 — Foundations

1. **Install dependencies** — one command, locked versions.
2. **Create folder structure** — empty dirs first, then populate.
3. **`src/constants/theme.ts`** — colors, spacing, typography, radii, shadow.
4. **`src/constants/categories.ts`** — the 10 category enum.
5. **`src/types/*.ts`** — `shop.ts`, `product.ts`, `cart.ts`, `order.ts`.
6. **`src/mocks/userLocation.ts`** — `{ lat: 28.5605, lng: 77.2065 }`.
7. **`src/mocks/shops.ts`** — 8 shops scattered around the mock user location.
8. **`src/mocks/products.ts`** — 30+ products with `shopId` references.
9. **`src/utils/distance.ts`** — haversine.
10. **`src/utils/format.ts`** — `formatRupees`, `formatPackLabel`.
11. **`src/components/common/*`** — Button, Card, Input, Badge, Price, QuantityStepper, EmptyState, ScreenHeader. Build them in this order; each is one file.
12. **Sandbox screen** — replace `App.tsx` content temporarily with a screen that renders one of each common component. Visual smoke test on Expo Go.

### Day 2 — Browse flow

13. **`src/services/shopService.ts`** — `getNearbyShops(userLoc)` returns Promise of shops + computed distance.
14. **`src/services/productService.ts`** — `getByShop(shopId)`, `search(query)`.
15. **`src/store/useShopStore.ts`** — Zustand store with `shops`, `loadShops()`, `selectedShop`.
16. **`src/store/useCartStore.ts`** — full implementation from `SHOP_PRODUCT_CART_DESIGN.md`.
17. **`src/components/shop/ShopCard.tsx`** — used everywhere.
18. **`src/components/product/ProductCard.tsx`** — with add-to-cart + qty stepper swap.
19. **`src/screens/ShopListScreen.tsx`** — wire `useShopStore`, render `ShopCard` list.
20. **`src/screens/ShopDetailScreen.tsx`** — wire `productService`, render SectionList by category, sticky cart bar.
21. **`src/navigation/RootNavigator.tsx`** + **`TabNavigator.tsx`** — set up stack + tabs, real navigation between ShopList → ShopDetail → CartScreen (CartScreen stubbed).
22. **Replace `App.tsx`** with `RootNavigator`.

### Day 3 — Cart + Search + Home

23. **`src/components/cart/CartLineItem.tsx`** — image, name, price, stepper, remove.
24. **`src/components/cart/CartSummary.tsx`** — bill details card.
25. **`src/screens/CartScreen.tsx`** — items list, summary, sticky checkout button.
26. **`src/components/product/SearchBar.tsx`** — reusable, with debounce hook.
27. **`src/hooks/useDebouncedValue.ts`** — 200ms default.
28. **`src/screens/SearchScreen.tsx`** — grouped results by shop.
29. **`src/screens/HomeScreen.tsx`** — location header + search trigger + category chips + nearby shops carousel.

### Day 4 — Checkout + Orders

30. **`src/store/useOrderStore.ts`** — `orders[]`, `placeOrder(cart, address)`, `getOrder(id)`.
31. **`src/components/order/OrderStatusChip.tsx`**
32. **`src/screens/CheckoutScreen.tsx`** — address form, summary, payment radios, place button.
33. **`src/screens/OrderConfirmationScreen.tsx`** — success card + 2 buttons.
34. **`src/screens/OrdersScreen.tsx`** — list of past orders.
35. **`src/screens/OrderDetailScreen.tsx`** — full breakdown + status timeline.

### Day 5 — Polish

36. Add `zustand/middleware` `persist` with AsyncStorage to cart + orders.
37. Add `RefreshControl` to ShopList and Orders.
38. Add `Loader` to every async screen.
39. Add `EmptyState` to: ShopList (no shops), Search (no query / no results), Cart (empty), Orders (no orders).
40. Sweep accessibility: every touchable has a `accessibilityLabel`.
41. Final bug bash on Expo Go (iOS + Android if you have both).

---

## 2. Which Files to Create First (Foundation Day 1, in exact order)

```
package.json            (just add deps, don't write new)
src/constants/theme.ts
src/constants/categories.ts
src/types/shop.ts
src/types/product.ts
src/types/cart.ts
src/types/order.ts
src/mocks/userLocation.ts
src/mocks/shops.ts
src/mocks/products.ts
src/utils/distance.ts
src/utils/format.ts
src/components/common/Button.tsx
src/components/common/Card.tsx
src/components/common/Input.tsx
src/components/common/Badge.tsx
src/components/common/Price.tsx
src/components/common/QuantityStepper.tsx
src/components/common/EmptyState.tsx
src/components/common/ScreenHeader.tsx
```

That's Day 1. Stop. Render them on a sandbox screen. Don't touch navigation or services yet.

### Dependency install (one command)

```bash
npx expo install zustand @react-navigation/native @react-navigation/native-stack @react-navigation/bottom-tabs react-native-screens react-native-safe-area-context @react-native-async-storage/async-storage
npm install lucide-react-native
```

---

## 3. Exact Component Breakdown (with prop signatures)

```ts
// common/Button.tsx
type Props = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
};

// common/Card.tsx
type Props = {
  children: React.ReactNode;
  onPress?: () => void;
  padding?: keyof typeof spacing;     // default 'md'
  style?: ViewStyle;
};

// common/Input.tsx
type Props = {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  icon?: React.ReactNode;
  error?: string;
  keyboardType?: 'default' | 'numeric' | 'phone-pad' | 'email-address';
  autoFocus?: boolean;
  multiline?: boolean;
};

// common/Badge.tsx
type Props = {
  label: string;
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
};

// common/Price.tsx
type Props = {
  value: number;          // 260
  mrp?: number;           // 275
  size?: 'sm' | 'md' | 'lg';
};

// common/QuantityStepper.tsx
type Props = {
  value: number;
  onIncrement: () => void;
  onDecrement: () => void;
  min?: number;           // default 0
  max?: number;
};

// common/EmptyState.tsx
type Props = {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onCtaPress?: () => void;
};

// common/ScreenHeader.tsx
type Props = {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
};

// shop/ShopCard.tsx
type Props = {
  shop: Shop;
  onPress: () => void;
  variant?: 'full' | 'compact';   // compact = horizontal carousel on Home
};

// product/ProductCard.tsx
type Props = {
  product: Product;
  onAdd: () => void;
  quantityInCart: number;         // 0 means show [+], else show stepper
  onIncrement?: () => void;
  onDecrement?: () => void;
  disabled?: boolean;             // shop closed / out of stock
};

// cart/CartLineItem.tsx
type Props = {
  item: CartItem;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
};
```

---

## 4. Sample Code (drop-in)

### 4a. Mock data — `src/mocks/shops.ts`

```ts
import type { Shop } from '../types/shop';

export const MOCK_SHOPS: Shop[] = [
  {
    id: 'shop_001',
    name: 'Sharma Kirana Store',
    description: 'Daily grocery & household essentials since 1998',
    address: 'Shop 4, Green Park Market, New Delhi',
    location: { lat: 28.5605, lng: 77.2065 },
    rating: 4.3, isOpen: true,
    imageUrl: 'https://picsum.photos/seed/shop001/600/400',
    categories: ['atta_rice_dal', 'dairy_eggs', 'snacks_biscuits', 'household'],
    deliveryFee: 25, minOrder: 99, etaMinutes: 30,
  },
  {
    id: 'shop_002',
    name: 'Gupta General Store',
    description: 'Wide range of staples and snacks',
    address: 'Main Market Road, Green Park',
    location: { lat: 28.5618, lng: 77.2071 },
    rating: 4.1, isOpen: true,
    imageUrl: 'https://picsum.photos/seed/shop002/600/400',
    categories: ['atta_rice_dal', 'oil_ghee', 'bakery', 'beverages'],
    deliveryFee: 20, minOrder: 99, etaMinutes: 35,
  },
  {
    id: 'shop_003',
    name: 'Krishna Dairy & More',
    description: 'Fresh milk, curd, paneer + groceries',
    address: 'Lane 3, Green Park Extension',
    location: { lat: 28.5598, lng: 77.2078 },
    rating: 4.6, isOpen: false,
    imageUrl: 'https://picsum.photos/seed/shop003/600/400',
    categories: ['dairy_eggs', 'bakery'],
    deliveryFee: 15, minOrder: 49, etaMinutes: 20,
  },
  // ... 5 more, vary lat/lng within ±0.005 of user location
];
```

### 4b. Mock data — `src/mocks/products.ts`

```ts
import type { Product } from '../types/product';

export const MOCK_PRODUCTS: Product[] = [
  // Shop 001 — Sharma Kirana
  { id: 'p_001_atta_5kg', shopId: 'shop_001', name: 'Aashirvaad Whole Wheat Atta', brand: 'Aashirvaad',
    category: 'atta_rice_dal', imageUrl: 'https://picsum.photos/seed/atta/300/300',
    packSize: { value: 5, unit: 'kg' }, mrp: 275, price: 260, inStock: true },
  { id: 'p_001_milk_1l', shopId: 'shop_001', name: 'Amul Taaza Toned Milk', brand: 'Amul',
    category: 'dairy_eggs', imageUrl: 'https://picsum.photos/seed/amul/300/300',
    packSize: { value: 1, unit: 'litre' }, mrp: 70, price: 68, inStock: true },
  { id: 'p_001_salt_1kg', shopId: 'shop_001', name: 'Tata Salt', brand: 'Tata',
    category: 'masala_spices', imageUrl: 'https://picsum.photos/seed/salt/300/300',
    packSize: { value: 1, unit: 'kg' }, mrp: 28, price: 28, inStock: true },
  { id: 'p_001_parleg', shopId: 'shop_001', name: 'Parle-G Original', brand: 'Parle',
    category: 'snacks_biscuits', imageUrl: 'https://picsum.photos/seed/parleg/300/300',
    packSize: { value: 800, unit: 'g' }, mrp: 80, price: 75, inStock: true },
  { id: 'p_001_oil_1l', shopId: 'shop_001', name: 'Fortune Sunflower Oil', brand: 'Fortune',
    category: 'oil_ghee', imageUrl: 'https://picsum.photos/seed/fortune/300/300',
    packSize: { value: 1, unit: 'litre' }, mrp: 165, price: 159, inStock: true },
  // ... add 4-6 per shop, distributed across categories
];
```

### 4c. Distance util — `src/utils/distance.ts`

```ts
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
```

### 4d. Mock service — `src/services/shopService.ts`

```ts
import { MOCK_SHOPS } from '../mocks/shops';
import { MOCK_USER_LOCATION } from '../mocks/userLocation';
import { haversineKm } from '../utils/distance';
import type { Shop } from '../types/shop';

const NEAR_KM = 1;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export const shopService = {
  async getNearbyShops(): Promise<Shop[]> {
    await delay(300);
    return MOCK_SHOPS
      .map(s => ({ ...s, distanceKm: haversineKm(MOCK_USER_LOCATION, s.location) }))
      .filter(s => (s.distanceKm ?? 0) <= NEAR_KM)
      .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
  },
  async getById(shopId: string): Promise<Shop | null> {
    await delay(150);
    const s = MOCK_SHOPS.find(x => x.id === shopId);
    if (!s) return null;
    return { ...s, distanceKm: haversineKm(MOCK_USER_LOCATION, s.location) };
  },
};
```

### 4e. ShopListScreen — `src/screens/ShopListScreen.tsx`

```tsx
import React, { useEffect, useState } from 'react';
import { View, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { shopService } from '../services/shopService';
import type { Shop } from '../types/shop';
import { ShopCard } from '../components/shop/ShopCard';
import { ScreenHeader } from '../components/common/ScreenHeader';
import { Input } from '../components/common/Input';
import { Loader } from '../components/common/Loader';
import { EmptyState } from '../components/common/EmptyState';
import { colors, spacing } from '../constants/theme';

export default function ShopListScreen() {
  const nav = useNavigation<any>();
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');

  const load = async () => {
    const data = await shopService.getNearbyShops();
    setShops(data);
  };

  useEffect(() => {
    (async () => { setLoading(true); await load(); setLoading(false); })();
  }, []);

  const filtered = shops.filter(s =>
    s.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  if (loading) return <Loader fullScreen />;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Shops near you" onBack={() => nav.goBack()} />
      <View style={styles.searchWrap}>
        <Input value={query} onChangeText={setQuery} placeholder="Search shop name" />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={s => s.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        renderItem={({ item }) => (
          <ShopCard
            shop={item}
            onPress={() => nav.navigate('ShopDetail', { shopId: item.id })}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            title="No shops near you"
            subtitle="We're expanding fast — check back soon."
          />
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  searchWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
});
```

### 4f. ShopDetailScreen (core) — `src/screens/ShopDetailScreen.tsx`

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { View, SectionList, StyleSheet, Alert, Text } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { shopService } from '../services/shopService';
import { productService } from '../services/productService';
import type { Shop } from '../types/shop';
import type { Product } from '../types/product';
import { useCartStore } from '../store/useCartStore';
import { ScreenHeader } from '../components/common/ScreenHeader';
import { ProductCard } from '../components/product/ProductCard';
import { Loader } from '../components/common/Loader';
import { Button } from '../components/common/Button';
import { colors, spacing, typography } from '../constants/theme';
import { CATEGORIES, type CategoryId } from '../constants/categories';
import { formatRupees } from '../utils/format';

export default function ShopDetailScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const shopId: string = route.params.shopId;

  const [shop, setShop] = useState<Shop | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const cart = useCartStore();
  const cartHasThisShop = cart.shopId === shopId;

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [s, p] = await Promise.all([
        shopService.getById(shopId),
        productService.getByShop(shopId),
      ]);
      setShop(s);
      setProducts(p);
      setLoading(false);
    })();
  }, [shopId]);

  const sections = useMemo(() => {
    const groups: Record<string, Product[]> = {};
    products.forEach(p => {
      (groups[p.category] ??= []).push(p);
    });
    return CATEGORIES
      .filter(c => groups[c.id]?.length)
      .map(c => ({ title: c.label, data: groups[c.id]! }));
  }, [products]);

  const onAdd = (p: Product) => {
    if (!shop) return;
    const result = cart.addItem(p, shop);
    if (!result.ok && result.reason === 'different_shop') {
      Alert.alert(
        'Start a new cart?',
        `Your cart has items from ${cart.shopName}. Clear it to add from ${shop.name}?`,
        [
          { text: 'Keep cart', style: 'cancel' },
          { text: 'Clear & add', style: 'destructive', onPress: () => cart.forceAddItem(p, shop) },
        ]
      );
    }
  };

  const qtyInCart = (productId: string) =>
    cartHasThisShop ? (cart.items.find(i => i.productId === productId)?.quantity ?? 0) : 0;

  if (loading || !shop) return <Loader fullScreen />;

  return (
    <View style={styles.container}>
      <ScreenHeader title={shop.name} onBack={() => nav.goBack()} />
      <SectionList
        sections={sections}
        keyExtractor={p => p.id}
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingBottom: 120 }}
        ListHeaderComponent={
          <View style={styles.hero}>
            <Text style={typography.h1}>{shop.name}</Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              {shop.address}
            </Text>
            <Text style={[typography.caption, { marginTop: spacing.xs }]}>
              ★ {shop.rating} · {shop.etaMinutes} min · {formatRupees(shop.deliveryFee)} delivery · Min {formatRupees(shop.minOrder)}
            </Text>
          </View>
        }
        renderSectionHeader={({ section: { title } }) => (
          <View style={styles.sectionHeader}>
            <Text style={typography.h3}>{title}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.productRow}>
            <ProductCard
              product={item}
              onAdd={() => onAdd(item)}
              quantityInCart={qtyInCart(item.id)}
              onIncrement={() => cart.increment(item.id)}
              onDecrement={() => cart.decrement(item.id)}
              disabled={!shop.isOpen || !item.inStock}
            />
          </View>
        )}
      />

      {cartHasThisShop && cart.items.length > 0 && (
        <View style={styles.cartBar}>
          <Text style={[typography.bodyBold, { color: '#fff' }]}>
            {cart.itemCount()} items · {formatRupees(cart.subtotal())}
          </Text>
          <Button title="View Cart" variant="ghost" onPress={() => nav.navigate('Cart')} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  hero: { padding: spacing.lg },
  sectionHeader: { backgroundColor: colors.bg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  productRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  cartBar: {
    position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg,
    backgroundColor: colors.primary, borderRadius: 14,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
});
```

### 4g. Cart store — `src/store/useCartStore.ts`

```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Product } from '../types/product';
import type { Shop } from '../types/shop';
import type { CartItem } from '../types/cart';

type AddResult = { ok: true } | { ok: false; reason: 'different_shop' };

type CartState = {
  shopId: string | null;
  shopName: string | null;
  deliveryFee: number;
  items: CartItem[];

  addItem: (p: Product, shop: Shop) => AddResult;
  forceAddItem: (p: Product, shop: Shop) => void;
  increment: (productId: string) => void;
  decrement: (productId: string) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;

  subtotal: () => number;
  total: () => number;
  itemCount: () => number;
};

const packLabel = (p: Product) => `${p.packSize.value} ${p.packSize.unit}`;

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      shopId: null, shopName: null, deliveryFee: 0, items: [],

      addItem: (p, shop) => {
        if (get().shopId && get().shopId !== p.shopId) {
          return { ok: false, reason: 'different_shop' };
        }
        get().forceAddItem(p, shop);
        return { ok: true };
      },

      forceAddItem: (p, shop) => set(state => {
        const base = state.shopId === p.shopId ? state.items : [];
        const existing = base.find(i => i.productId === p.id);
        const items = existing
          ? base.map(i => i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i)
          : [...base, {
              productId: p.id, name: p.name, imageUrl: p.imageUrl,
              packLabel: packLabel(p), price: p.price, quantity: 1,
            }];
        return { items, shopId: shop.id, shopName: shop.name, deliveryFee: shop.deliveryFee };
      }),

      increment: id => set(s => ({
        items: s.items.map(i => i.productId === id ? { ...i, quantity: i.quantity + 1 } : i),
      })),

      decrement: id => set(s => {
        const next = s.items.flatMap(i =>
          i.productId !== id ? [i] :
          i.quantity > 1 ? [{ ...i, quantity: i.quantity - 1 }] : []
        );
        return next.length === 0
          ? { items: [], shopId: null, shopName: null, deliveryFee: 0 }
          : { items: next };
      }),

      removeItem: id => set(s => {
        const next = s.items.filter(i => i.productId !== id);
        return next.length === 0
          ? { items: [], shopId: null, shopName: null, deliveryFee: 0 }
          : { items: next };
      }),

      clearCart: () => set({ items: [], shopId: null, shopName: null, deliveryFee: 0 }),

      subtotal: () => get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),
      total: () => get().subtotal() + get().deliveryFee,
      itemCount: () => get().items.reduce((n, i) => n + i.quantity, 0),
    }),
    { name: 'cart-v1', storage: createJSONStorage(() => AsyncStorage) }
  )
);
```

### 4h. CartScreen — `src/screens/CartScreen.tsx`

```tsx
import React from 'react';
import { View, FlatList, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useCartStore } from '../store/useCartStore';
import { CartLineItem } from '../components/cart/CartLineItem';
import { ScreenHeader } from '../components/common/ScreenHeader';
import { Button } from '../components/common/Button';
import { EmptyState } from '../components/common/EmptyState';
import { colors, spacing, typography } from '../constants/theme';
import { formatRupees } from '../utils/format';

export default function CartScreen() {
  const nav = useNavigation<any>();
  const cart = useCartStore();

  if (cart.items.length === 0) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Your Cart" onBack={() => nav.goBack()} />
        <EmptyState
          title="Your cart is empty"
          subtitle="Add items from a nearby shop to get started."
          ctaLabel="Browse shops"
          onCtaPress={() => nav.navigate('Home')}
        />
      </View>
    );
  }

  const subtotal = cart.subtotal();
  const total = cart.total();

  return (
    <View style={styles.container}>
      <ScreenHeader title="Your Cart" onBack={() => nav.goBack()} />

      <View style={styles.shopBanner}>
        <Text style={typography.bodyBold}>🏪  {cart.shopName}</Text>
      </View>

      <FlatList
        data={cart.items}
        keyExtractor={i => i.productId}
        contentContainerStyle={{ padding: spacing.lg }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        renderItem={({ item }) => (
          <CartLineItem
            item={item}
            onIncrement={() => cart.increment(item.productId)}
            onDecrement={() => cart.decrement(item.productId)}
            onRemove={() => cart.removeItem(item.productId)}
          />
        )}
        ListFooterComponent={
          <View style={styles.summary}>
            <Text style={typography.h3}>Bill details</Text>
            <Row label="Item total" value={formatRupees(subtotal)} />
            <Row label="Delivery fee" value={formatRupees(cart.deliveryFee)} />
            <View style={styles.divider} />
            <Row label="To pay" value={formatRupees(total)} bold />
          </View>
        }
      />

      <View style={styles.ctaWrap}>
        <Button
          title={`Proceed to Checkout · ${formatRupees(total)}`}
          onPress={() => nav.navigate('Checkout')}
          fullWidth
        />
      </View>
    </View>
  );
}

const Row = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
  <View style={styles.row}>
    <Text style={bold ? typography.bodyBold : typography.body}>{label}</Text>
    <Text style={bold ? typography.bodyBold : typography.body}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  shopBanner: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.primaryLight },
  summary: { marginTop: spacing.lg, padding: spacing.lg, backgroundColor: colors.surface, borderRadius: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  ctaWrap: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
});
```

---

## 5. Mock Data Strategy

Three files. That's it.

**`src/mocks/userLocation.ts`** — A constant. Replace later with `expo-location`.

```ts
export const MOCK_USER_LOCATION = { lat: 28.5605, lng: 77.2065 };
```

**`src/mocks/shops.ts`** — 8 shops, scattered ±0.005 lat/lng around the user (≈ 500m radius), so some fall inside the 1 km filter and some don't. This exercises your distance code on day 1.

**`src/mocks/products.ts`** — 30–50 products. Distribution rule: 4–6 products per shop, covering 3–4 categories per shop. Reuse Indian brand names from `SHOP_PRODUCT_CART_DESIGN.md`.

**Image strategy:** `https://picsum.photos/seed/<unique>/300/300` deterministically gives you a stable image per product. Replace later with real ones from a CDN.

**Service layer pretends to be the network.** Every `shopService` and `productService` function returns a Promise with a 150–300ms `setTimeout` delay. This forces you to build loading states correctly today, so Firebase swap-in is invisible to screens.

---

## 6. State Management — Recommendation + Justification

**Use Zustand. Don't use Context + useReducer.**

You asked between `useContext` and "simple state". Both have problems for this app:

- **`useState` alone** — fails as soon as the Cart needs to be visible on `ShopDetailScreen`, `CartScreen`, the tab bar badge, and `CheckoutScreen` simultaneously. Prop-drilling four levels is worse than any state library.
- **`useContext` + `useReducer`** — works, but requires a `Provider` wrapping your app, a reducer file, action types, dispatch wiring, and re-renders the entire context tree on every change. ~120 lines of boilerplate for what Zustand does in 80.

**Zustand wins on every dimension that matters for an MVP:**

| | useState | Context+Reducer | Zustand |
|---|---|---|---|
| Cross-screen access | ❌ | ✅ | ✅ |
| Boilerplate | none | high | low |
| Provider required | no | yes | **no** |
| Persist to AsyncStorage | DIY | DIY | **1 line** |
| Re-render granularity | n/a | whole tree | per-selector |
| Bundle size | 0 | 0 | 1 KB |
| Learning curve | none | medium | **trivial** |

**Use this split:**

- **Cross-screen state** (cart, shops list, orders) → Zustand stores (3 files total).
- **Ephemeral UI state** (input text, modal open, refresh control) → `useState` inside the screen.
- **Route/screen params** (which shopId is open) → React Navigation params, not state.

If you absolutely refuse the dependency, fall back to one Context + useReducer for the cart only — but you'll regret the boilerplate by Day 3.

---

## 7. How to Test Each Step in Expo Go

Set up once:

```bash
npx expo start
```

Scan the QR with the Expo Go app on your phone. Keep this running in a terminal all 5 days — Fast Refresh applies edits in <1 second.

**Per-step test checklist** (do these *every* step, takes 30 seconds):

| After step | Test on Expo Go |
|---|---|
| Day 1 — common components | Sandbox screen renders all 8 components without warnings. Tap each button — see ripple/feedback. |
| Step 11 — ShopCard | Renders one shop with image, name, distance, rating, badge. |
| Step 17 — ShopListScreen | List of nearby shops. Pull-to-refresh works. Search filters by name. Tap → console log shopId. |
| Step 18 — ShopDetailScreen | Tap a shop → sees hero + products by category. Sticky headers stick on scroll. |
| Step 16 — Cart store | After tapping `[+]` on ProductCard, console.log `useCartStore.getState()` shows the item. |
| Step 22 — Navigation | Stack + tabs working. Tab badge shows item count when cart has items. |
| Step 25 — CartScreen | Items render. Stepper increments/decrements. Removing last item shows EmptyState. |
| Step 32 — CheckoutScreen | Address form validates. Place Order navigates to Confirmation. |
| Step 36 — Persistence | Add items → kill app → reopen → cart still has items. |

**Two debugging tips that save hours:**

1. **`react-native-debugger` is overkill for MVP.** Use `console.log` + Expo's in-app dev menu (shake phone) → Toggle Inspector.
2. **For Zustand state inspection:** drop `console.log(useCartStore.getState())` anywhere. The whole store prints. No Redux DevTools setup needed.

**iOS vs Android quirks to watch for:**

- `SafeAreaView` behaves differently. Use `react-native-safe-area-context`'s `SafeAreaView` everywhere, never the RN one.
- `KeyboardAvoidingView` needs `behavior="padding"` on iOS, `"height"` on Android — handle on Checkout's address form.
- Shadows: iOS uses `shadowColor/shadowOpacity/shadowRadius/shadowOffset`; Android needs `elevation`. Your `shadow.card` token already has both — just spread it.

---

## Wrap

You now have four design artifacts that compose end-to-end:

1. `MVP_ARCHITECTURE.md` — what the app is
2. `SHOP_PRODUCT_CART_DESIGN.md` — how the data is shaped
3. `UI_SCREENS_DESIGN.md` — what every screen looks like
4. `IMPLEMENTATION_PLAN.md` — the build manual (this doc)

For each Windsurf prompt, paste:
- The relevant section of this doc (e.g. "Step 19 — ShopListScreen")
- The matching wireframe + spec from `UI_SCREENS_DESIGN.md`
- The matching type from `SHOP_PRODUCT_CART_DESIGN.md`

That triplet is everything Windsurf needs to produce code that fits your codebase without rework.

Ship Day 5 means a customer can: open the app → see nearby shops → enter a shop → add items → see cart → place order → see confirmation → view past orders. All offline, all with mock data, all in a structure that will accept Firebase without screen-level rewrites.
