# UI Screens & Design System (MVP)

> Companion to `MVP_ARCHITECTURE.md` and `SHOP_PRODUCT_CART_DESIGN.md`.
> Goal: every screen is described tightly enough that you can hand a single section to Windsurf and get working JSX back.

---

## A. Minimal Design System

Codify this in `src/constants/theme.ts` **before** building any screen. Every component pulls from this; you never hand-type a color or spacing value.

### Color tokens

```ts
export const colors = {
  // Brand
  primary:        '#0E7C3A',   // kirana green
  primaryDark:    '#0A5E2C',
  primaryLight:   '#E6F4EC',

  // Neutrals
  bg:             '#FFFFFF',
  surface:        '#F7F8FA',
  border:         '#E5E7EB',
  textPrimary:    '#111827',
  textSecondary:  '#6B7280',
  textMuted:      '#9CA3AF',

  // Status
  success:        '#16A34A',
  warning:        '#F59E0B',
  danger:         '#DC2626',
  info:           '#2563EB',

  // MRP / discount
  mrpStrike:      '#9CA3AF',
  discountTag:    '#16A34A',
};
```

### Spacing (4-point scale)

```ts
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
```

Rule: padding/margin always uses these tokens. If you find yourself typing `padding: 10` — stop, pick `sm` (8) or `md` (12).

### Typography

```ts
export const typography = {
  h1:       { fontSize: 22, fontWeight: '700' as const, lineHeight: 28 },
  h2:       { fontSize: 18, fontWeight: '700' as const, lineHeight: 24 },
  h3:       { fontSize: 16, fontWeight: '600' as const, lineHeight: 22 },
  body:     { fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
  bodyBold: { fontSize: 14, fontWeight: '600' as const, lineHeight: 20 },
  caption:  { fontSize: 12, fontWeight: '400' as const, lineHeight: 16 },
  price:    { fontSize: 15, fontWeight: '700' as const, lineHeight: 20 },
};
```

### Radii + elevation

```ts
export const radii   = { sm: 6, md: 10, lg: 14, pill: 999 };
export const shadow  = {
  card: { elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
};
```

### Layout rules (memorize these — they replace half of design review)

- Screen horizontal padding: `spacing.lg` (16).
- Vertical gap between sections: `spacing.xl` (24).
- Vertical gap between rows in a list: `spacing.md` (12).
- Touch targets: minimum 44×44.
- Sticky CTAs (cart bar, "Place Order") sit at the bottom with `spacing.lg` padding and a top border.

---

## B. Reusable Components

Build these once, use everywhere. All live in `src/components/common/` except the domain ones.

| Component | Props (essential) | Notes |
|---|---|---|
| `Button` | `title`, `onPress`, `variant: 'primary' \| 'secondary' \| 'ghost'`, `loading`, `disabled`, `fullWidth` | Single source of truth for tap actions |
| `Input` | `value`, `onChangeText`, `placeholder`, `icon?`, `error?` | Used in search + checkout form |
| `Card` | `children`, `onPress?` | Surface with `radii.md`, `shadow.card`, padding `md` |
| `Loader` | `size?`, `fullScreen?` | Spinner with optional centered overlay |
| `Badge` | `label`, `tone: 'success' \| 'warning' \| 'danger' \| 'info'` | Pill, used for "Open", "Closed", order status |
| `Price` | `value`, `mrp?`, `size?` | Renders `₹260` + struck-out `₹275` if mrp provided |
| `QuantityStepper` | `value`, `onIncrement`, `onDecrement`, `min?`, `max?` | The `−  1  +` control |
| `EmptyState` | `icon`, `title`, `subtitle?`, `cta?` | Used when no shops / empty cart / no orders |
| `ScreenHeader` | `title`, `onBack?`, `right?` | Consistent top bar |
| `SectionTitle` | `title`, `actionLabel?`, `onAction?` | "Nearby shops" / "See all" pattern |
| `ShopCard` | `shop`, `onPress` | Image + name + distance + rating + eta |
| `ProductCard` | `product`, `onAdd`, `quantityInCart` | Image + name + pack + price + add/stepper |
| `CartLineItem` | `item`, `onIncrement`, `onDecrement`, `onRemove` | Used in `CartScreen` |

**Convention:** every reusable component accepts a `style` prop that merges onto the root view. No exceptions. This saves you from re-prop'ing later.

---

## C. Screen Specs

Each section follows the same shape: **Layout → Components → State → Actions → Navigation → Edge cases.**

ASCII wireframes are a cheat-sheet, not pixel-precise — use them to anchor structure when prompting Windsurf.

---

### 1. Home Screen

```
┌─────────────────────────────────────┐
│ Deliver to ▼  Green Park, Delhi     │  ← location header
│ ─────────────────────────────────── │
│  🔍  Search for atta, milk, soap... │  ← tappable search bar (no input)
│                                     │
│  Categories                         │
│  [🌾] [🥛] [🍞] [🧂] [🍪] [🥤] [🧴] │  ← horizontal chips, scrollable
│                                     │
│  Shops near you      See all →     │  ← SectionTitle
│  ┌────────┐ ┌────────┐ ┌────────┐  │
│  │ Shop A │ │ Shop B │ │ Shop C │  │  ← horizontal carousel of ShopCard
│  │ 0.4 km │ │ 0.7 km │ │ 0.9 km │  │
│  └────────┘ └────────┘ └────────┘  │
│                                     │
│  Why shop locally?  (info card)     │  ← optional, drop if short on time
└─────────────────────────────────────┘
```

**Layout** — `ScrollView` with vertical sections. Sticky-free; nothing pinned.

**Components** — `ScreenHeader` (custom: location label + chevron), tappable `Input` pretender, category chip row (FlatList horizontal), `SectionTitle`, horizontal `FlatList<ShopCard>`.

**State** — `nearbyShops: Shop[]` from `useShopStore`, `userLocationLabel` from `useUserStore` (hardcoded for MVP).

**Actions**
- Tap location → no-op for MVP (later: address picker)
- Tap search bar → navigate to `SearchScreen`
- Tap category chip → navigate to `SearchScreen` with prefilled category filter
- Tap shop card → `ShopDetailScreen`
- Tap "See all" → `ShopListScreen`

**Navigation in** — Tab default (HomeTab).
**Navigation out** — `SearchScreen`, `ShopListScreen`, `ShopDetailScreen`.

**Edge cases**
- No shops within 1 km → show inline `EmptyState`: "No shops near you yet. We're expanding fast."
- Slow load → `Loader` inline in the shops section, not full-screen (let categories render).
- User has items in cart → show small "View Cart (2 items · ₹420)" bar above the tab bar.

---

### 2. Shop List Screen

```
┌─────────────────────────────────────┐
│ ←  Shops near you                   │  ← ScreenHeader
│ ─────────────────────────────────── │
│ 🔍  Search shop name                │
│ [All] [Open now] [Top rated]        │  ← filter chips
│ ─────────────────────────────────── │
│ ┌─────────────────────────────────┐ │
│ │ [img] Sharma Kirana   ★ 4.3     │ │
│ │       0.4 km · 30 min · ₹25 fee │ │
│ │       [OPEN]                    │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ [img] Gupta General   ★ 4.1     │ │
│ │       0.7 km · 35 min           │ │
│ │       [CLOSED]                  │ │
│ └─────────────────────────────────┘ │
│ ...                                 │
└─────────────────────────────────────┘
```

**Layout** — `FlatList` of `ShopCard`s, header above with search + filter chips.

**Components** — `ScreenHeader`, `Input` (with search icon), filter chip row, `ShopCard`, `Loader`, `EmptyState`.

**State**
- `shops: Shop[]` from `useShopStore`
- Local: `query: string`, `activeFilter: 'all' | 'open' | 'top_rated'`
- Derived: `filteredShops` (memoized)
- `loading`, `refreshing`

**Actions**
- Type in search → filters by name (debounced 200ms)
- Tap filter chip → updates `activeFilter`
- Tap shop → `ShopDetailScreen`, pass `shopId`
- Pull-to-refresh → re-fetch shops

**Navigation in** — Home "See all", Tab "Home" if you make Home === ShopList instead.
**Navigation out** — `ShopDetailScreen`.

**Edge cases**
- 0 shops within 1 km → `EmptyState` with "Try widening to 3 km" (button stubbed for MVP).
- 0 results after filtering → "No matches for `paneer wali dukan`. Clear filters."
- Closed shops → still listed, with `[CLOSED]` badge, tap still allowed (let them browse), add-to-cart blocked at shop level.

---

### 3. Shop Detail Screen

```
┌─────────────────────────────────────┐
│ ←  Sharma Kirana          🔍 ❤      │  ← ScreenHeader + actions
│ ─────────────────────────────────── │
│ [shop image — hero]                 │
│ Sharma Kirana Store        ★ 4.3   │
│ Green Park Market, Delhi            │
│ 30 min · ₹25 delivery · Min ₹99    │
│ ─────────────────────────────────── │
│ 🔍 Search products in this shop     │  ← inline input
│ ─────────────────────────────────── │
│ ▼ Atta, Rice & Dal                  │  ← sticky section header
│ ┌──────┐ ┌──────┐ ┌──────┐         │
│ │ [im] │ │ [im] │ │ [im] │         │  ← ProductCard grid (2 cols)
│ │ Atta │ │ Rice │ │ Dal  │         │
│ │ 5kg  │ │ 1kg  │ │ 1kg  │         │
│ │ ₹260 │ │ ₹78  │ │ ₹140 │         │
│ │ [ + ]│ │ [+ ] │ │ [ + ]│         │
│ └──────┘ └──────┘ └──────┘         │
│ ▼ Dairy & Eggs                      │
│ ...                                 │
├─────────────────────────────────────┤
│ 🛒  2 items · ₹396   View Cart →   │  ← sticky bottom bar (only if cart has items)
└─────────────────────────────────────┘
```

**Layout** — `SectionList` keyed by category. Sticky section headers. Shop hero scrolls away normally. Sticky bottom "View Cart" bar appears only when cart is non-empty AND from this shop.

**Components** — `ScreenHeader`, `ShopHeader` (the hero block), `Input`, `SectionList`, `ProductCard` (2-column grid via `numColumns={2}` trick on FlatList — or render 2-up rows inside each section), sticky `CartBar`.

**State**
- `shopId` from route params
- `products: Product[]` via `productService.getByShop(shopId)`
- Local: `query`
- Derived: `productsByCategory: Record<CategoryId, Product[]>`
- Cart subscription: `itemCount`, `subtotal`, `cartShopId` (to decide whether sticky bar shows)

**Actions**
- Tap back → pop
- Type search → filters products within this shop
- Tap product `[+]` → `addItem(product, shop)`; if `different_shop`, show clear-cart Alert
- Increment/decrement on cards already in cart (ProductCard swaps `[+]` for `QuantityStepper`)
- Tap "View Cart" sticky bar → `CartScreen`

**Navigation in** — `ShopListScreen`, `SearchScreen`, Home carousel, `OrderDetailScreen` (reorder).
**Navigation out** — `CartScreen`, back.

**Edge cases**
- Shop is closed → disable all `[+]` buttons, show banner "Shop is closed. Opens at 9:00 AM tomorrow."
- Product out of stock → render card with reduced opacity, replace `[+]` with "Out of stock" label.
- Cart has items from a DIFFERENT shop → sticky bar does NOT appear; on `[+]` tap, surface the clear-cart Alert.
- Below min order at checkout time → handled in `CartScreen`, not here.

---

### 4. Product List / Search Screen

This is the "search across all shops" surface. Also reachable with a pre-applied category filter from Home.

```
┌─────────────────────────────────────┐
│ ←  🔍 Search for atta, milk, soap   │  ← input with back arrow
│ ─────────────────────────────────── │
│ [All] [Atta] [Dairy] [Snacks] ...   │  ← category chips
│ ─────────────────────────────────── │
│ Sharma Kirana · 0.4 km     See all→ │
│ ┌──────┐ ┌──────┐ ┌──────┐         │
│ │ Atta │ │ Atta │ │ Atta │         │  ← top 3 results from that shop
│ │ ₹260 │ │ ₹275 │ │ ₹248 │         │
│ │ [ + ]│ │ [+ ] │ │ [ + ]│         │
│ └──────┘ └──────┘ └──────┘         │
│                                     │
│ Gupta General · 0.7 km     See all→ │
│ ┌──────┐ ┌──────┐                   │
│ │ Atta │ │ Atta │                   │
│ └──────┘ └──────┘                   │
└─────────────────────────────────────┘
```

**Layout** — Search input at top (auto-focus), category chip row, then a vertical list of "shop groups". Each group: shop label + horizontal scroll of `ProductCard`s + "See all in this shop" tap.

**Components** — `Input` (auto-focus), category chip row, group header row, horizontal `FlatList<ProductCard>`, `EmptyState`.

**State**
- Local: `query`, `selectedCategory`
- `results: Array<{ shop: Shop; products: Product[] }>` from `productService.search()`
- `recentSearches: string[]` (AsyncStorage, optional)
- `loading`

**Actions**
- Type query (debounced 250ms) → re-search
- Tap category chip → filter results by category
- Tap product `[+]` → same add-to-cart logic; opens the different-shop dialog if needed
- Tap "See all" → `ShopDetailScreen` for that shop (pass query for in-shop filter)
- Tap recent search → repopulate input

**Navigation in** — Home search tap, Home category chip, SearchTab.
**Navigation out** — `ShopDetailScreen`, `CartScreen`.

**Edge cases**
- Empty query → show recent searches + popular categories. Don't show "0 results."
- Query < 2 chars → don't search yet; show hint "Type at least 2 characters."
- No results → `EmptyState`: "No `kurkure` near you. Try a different name."
- Multiple shops match → keep groups in distance order, ascending.

---

### 5. Cart Screen

```
┌─────────────────────────────────────┐
│ ←  Your Cart                        │
│ ─────────────────────────────────── │
│ 🏪  Sharma Kirana · 30 min          │  ← shop banner (cart is for this shop)
│ ─────────────────────────────────── │
│ ┌─────────────────────────────────┐ │
│ │ [img] Aashirvaad Atta 5 kg      │ │
│ │       ₹260   [ −  1  + ]    🗑  │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ [img] Amul Taaza 1 L            │ │
│ │       ₹68    [ −  2  + ]    🗑  │ │
│ └─────────────────────────────────┘ │
│ ─────────────────────────────────── │
│ Bill details                        │
│   Item total              ₹396      │
│   Delivery fee            ₹25       │
│   ─────────────────────────         │
│   To pay                  ₹421      │
│                                     │
│ ⚠ Add ₹3 more to meet ₹99 min       │  ← warning if applicable (not in this case)
├─────────────────────────────────────┤
│ ₹421  ›  Proceed to Checkout        │  ← sticky CTA
└─────────────────────────────────────┘
```

**Layout** — `ScrollView` with shop banner, cart items, bill summary. Sticky bottom CTA.

**Components** — `ScreenHeader`, shop banner row, `CartLineItem` (image + name + qty stepper + remove), `Card` for bill summary, sticky `Button`.

**State** — entirely from `useCartStore` (`items`, `shopId`, `shopName`, `subtotal`, `deliveryFee`, `total`, `itemCount`). Plus shop's `minOrder` (lookup from shopStore by `shopId`).

**Actions**
- Increment/decrement item qty → store mutations
- Decrement at qty 1 → remove item (store handles via `decrement` logic)
- Tap trash → `removeItem`
- Tap "Proceed to Checkout" → `CheckoutScreen` (disabled if below min order)
- Tap shop banner → `ShopDetailScreen` (add more items)
- Tap back → previous screen

**Navigation in** — Tab `CartTab`, sticky bar on `ShopDetailScreen`.
**Navigation out** — `CheckoutScreen`, `ShopDetailScreen`, back.

**Edge cases**
- Empty cart → render `EmptyState`: "Your cart is empty" + "Browse shops" CTA → `ShopListScreen`. Hide the sticky CTA entirely.
- Below min order → show warning under bill, disable checkout button (don't hide it — disabled state is more discoverable).
- Last item decremented → remove item; if cart now empty, transition to empty state (don't navigate away).
- Cart persisted across sessions (via Zustand `persist`).

---

### 6. Checkout Screen

```
┌─────────────────────────────────────┐
│ ←  Checkout                         │
│ ─────────────────────────────────── │
│ Delivery to                         │
│ ┌─────────────────────────────────┐ │
│ │ Sudhir Davim                    │ │
│ │ B-42, Green Park Extension      │ │
│ │ New Delhi, 110016               │ │
│ │ +91 98XXXXXX12         Change › │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Order summary                       │
│ ┌─────────────────────────────────┐ │
│ │ Sharma Kirana · 2 items         │ │
│ │ Aashirvaad Atta 5 kg × 1   ₹260 │ │
│ │ Amul Taaza 1 L × 2         ₹136 │ │
│ │ Delivery fee                ₹25 │ │
│ │ ─────────────────────────────── │ │
│ │ Total                      ₹421 │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Payment                             │
│ ⦿ Cash on Delivery                  │
│ ◯ Online (coming soon)              │
│                                     │
│ Arriving in ~30 min                 │
├─────────────────────────────────────┤
│ Place Order · ₹421                  │  ← sticky CTA
└─────────────────────────────────────┘
```

**Layout** — `ScrollView` with three sections: address, order summary, payment. Sticky bottom CTA.

**Components** — `ScreenHeader`, address `Card` (with "Change" link — for MVP, opens an inline form modal or just edits in place), summary `Card`, payment radio rows, sticky `Button`.

**State**
- `address` — start with mock from `useUserStore`, editable locally
- Cart snapshot from `useCartStore` (read-only here)
- `paymentMethod: 'cod'` (locked for MVP)
- `placing: boolean` for button loading state

**Actions**
- Tap Change on address → open address form (modal or replace card with inline `Input`s for line1, line2, city, pincode, phone)
- Tap payment radio → only `cod` selectable; "online" shows toast "Coming soon"
- Tap Place Order → `useOrderStore.placeOrder({ address, cart })`, set loading, navigate replace to `OrderConfirmationScreen` with order ID

**Navigation in** — `CartScreen`.
**Navigation out** — `OrderConfirmationScreen` (replace, not push — back from confirmation should land on Home, not checkout).

**Edge cases**
- Address fields invalid (empty line1/pincode/phone) → inline errors, button disabled.
- Pincode validation → simple regex `/^\d{6}$/` for MVP.
- Phone validation → 10 digits after optional +91.
- Place order fails → in mock, won't happen; in code path, catch and show toast "Couldn't place order. Try again." Keep cart intact.
- User backgrounds the app during place → idempotency not needed for mocks; add when Firebase comes in.

---

### 7. Order Confirmation Screen

```
┌─────────────────────────────────────┐
│                                     │
│            [ ✓ green circle ]       │  ← big success icon
│                                     │
│         Order placed!               │  ← h1
│      We've notified Sharma Kirana   │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ Order ID    ORD-20260511-0001   │ │
│ │ ETA         ~30 min             │ │
│ │ Total       ₹421                │ │
│ │ Payment     Cash on Delivery    │ │
│ └─────────────────────────────────┘ │
│                                     │
│  [ View Order ]    (primary)        │
│  [ Back to Home ]  (ghost)          │
│                                     │
└─────────────────────────────────────┘
```

**Layout** — Centered column, no `ScrollView` needed unless very small device. No sticky bar — both buttons in body.

**Components** — Success icon (lucide `CheckCircle2`), title text, summary `Card`, two `Button`s.

**State** — `orderId` from route params; `order` looked up via `useOrderStore.getOrder(orderId)`.

**Actions**
- Tap "View Order" → `OrderDetailScreen` (replace)
- Tap "Back to Home" → reset navigation stack to Home tab
- Hardware back button → same as Back to Home (intercept with `useFocusEffect` + `BackHandler`)

**Navigation in** — `CheckoutScreen` (via `navigation.replace`).
**Navigation out** — `OrderDetailScreen`, Home (`navigation.popToTop` + tab switch).

**Edge cases**
- Order not found (unlikely with mocks) → fallback message "Order saved. Check Orders tab."
- User taps back during the success transition → swallow; only the two buttons should navigate away.
- After 5s of inactivity, auto-focus "View Order" button for accessibility — nice-to-have.

---

## D. Build Order (Screens)

Match the architecture doc's step list. Concretely for screens:

1. Build the design system + reusable components (`Button`, `Card`, `Input`, `Badge`, `Price`, `QuantityStepper`, `EmptyState`).
2. `ShopListScreen` — simplest, exercises `ShopCard` + filter chips + EmptyState.
3. `ShopDetailScreen` — exercises `SectionList`, sticky cart bar, `ProductCard`.
4. `HomeScreen` — composes ShopCard horizontally + categories. Build last among "browse" screens because it depends on the others working.
5. `CartScreen` — pure store-driven, no service calls.
6. `CheckoutScreen` — form-heavy; copy address mock into editable state.
7. `OrderConfirmationScreen` — tiny.
8. `SearchScreen` — easy once `ProductCard` + service `search()` exist.

Why this order? Each screen reuses the previous ones' components. `ProductCard` from ShopDetail is identical in Search. `ShopCard` from ShopList shows up shrunken on Home. You write the hard components once.

---

## E. Three Sanity Checks Before You Write Any Screen

1. **Does it have a loading state?** Skeleton or `Loader` — pick one and use it consistently. Empty white screens during fetch is the #1 MVP UX smell.
2. **Does it have an empty state?** Every list screen needs one. Use the `EmptyState` component, not bare text.
3. **Does it have a sticky CTA where there's a primary action?** Cart, Checkout, ShopDetail (when items in cart). Sticky CTAs convert. Inline buttons in long-scroll screens get missed.

If you can answer yes to all three for a screen, ship it.
