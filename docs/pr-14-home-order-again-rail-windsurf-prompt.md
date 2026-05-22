# PR 14 — HomeScreen "Order again" rail (Windsurf prompt)

## Why this PR exists

PR 13 made reorder POSSIBLE (button on past order cards in the Orders
tab). PR 14 makes reorder DISCOVERABLE — by surfacing it on the home
screen, where customers actually land when they open the app.

The kirana use case: customer opens the app intending to buy "the usual
stuff from the usual shop." Today they'd:

1. Tap home → see categories
2. Tap a category → see shops
3. Tap a shop → see menu
4. Build cart from scratch (~2 minutes of tapping)

After PR 14:

1. Tap home → see "Order again from Mahesh Kirana" card right at the top
2. Tap → reorder modal → confirm → cart filled → checkout

That's a ~10-second flow vs. ~2 minutes. Industry data (Swiggy
Instamart, Zepto, BlinkIt) shows this rail drives 35–50% of returning-
user sessions for grocery verticals. It's the feature that turns
"installed the app, ordered once" customers into weekly habitues.

This PR is **pure client work that reuses every PR 13 primitive**: same
`buildReorderPlan` helper, same `ReorderModal` component, same
`replaceCartWithItems` cart store method. New code is minimal — one
pure picker function, one rail component, one HomeScreen integration
point.

**JS-only OTA, no schema changes, no server changes, no rollout-order
risk.** Cleanest possible deploy.

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md`.
- `docs/pr-13-repeat-order-windsurf-prompt.md` — context on the
  primitives this PR composes.
- `src/utils/buildReorderPlan.ts` (created in PR 13) — the helper this
  PR's flow consumes.
- `src/components/order/ReorderModal.tsx` (created in PR 13) — the
  modal this PR opens on tap.
- `src/store/useCartStore.ts` — `replaceCartWithItems` is the
  atomic cart-swap primitive added in PR 13.
- `src/screens/OrdersScreen.tsx` — the existing reorder integration.
  The HomeScreen integration is structurally similar but the cards
  represent SHOPS (not orders), and tapping a card uses the SHOP'S
  most recent delivered order as the reorder source.
- `src/screens/HomeScreen.tsx` — the screen this PR modifies. Note the
  existing `useFocusEffect` pattern for refetching on focus; mirror it
  for the order-history fetch.
- `src/services/orderService.ts` — `listMine(uid)` returns the
  customer's order history. Already wired on both native (callable)
  and web (Firestore query). No changes needed.

## Critical lessons from PRs 12 + 13 (do not repeat)

1. **All `useState` calls in HomeScreen MUST be declared above any
   conditional early returns.** PR 12's ETA modal regression was
   caused by violating this; PR 13 fixed it on OrdersScreen with a
   permanent comment. This PR adds reorder modal state to HomeScreen
   — same discipline applies. Add the same comment block citing PR 12.
2. **Zero new `DO NOT REMOVE` markers expected.** The auto-formatter
   discipline has held across PR 10/11/12/13. Keep it clean.
3. **No native module imports** — anything in HomeScreen runs on web
   too. Stick to JS-only patterns.

## Scope (in)

### Part 1 — Pure helper `pickFrequentlyOrderedShops`

New file `src/utils/pickFrequentlyOrderedShops.ts`:

```ts
/**
 * Pure helper that picks the top-N shops a customer has ordered from
 * most frequently, ordered by frequency desc with ties broken by
 * recency. Used by the HomeScreen "Order again" rail.
 *
 * Filters DELIVERED orders only — in-flight orders (pending/accepted/
 * preparing/ready_for_pickup) shouldn't count because the customer
 * hasn't completed the cycle, and cancelled orders shouldn't count
 * either (a customer cancelling isn't a signal they want to repeat).
 *
 * Each returned entry carries the shop identity + the ID of the most
 * recent delivered order from that shop. The rail component passes
 * that order ID into the reorder flow as the "source" for
 * buildReorderPlan.
 *
 * Pure — no Firestore reads, no React, no clock dependency. Pinned
 * by tests/utils/pickFrequentlyOrderedShops.test.ts.
 */
import type { Order } from '../types';

export type FrequentShopEntry = {
  shopId: string;
  shopName: string;
  // The most recent DELIVERED order from this shop — used as the
  // template for reorder. The reorder flow's buildReorderPlan will
  // join its items against the shop's CURRENT menu.
  lastOrderId: string;
  // For diagnostics + sort: how many delivered orders this customer
  // has placed at this shop.
  orderCount: number;
  // Used for tie-breaking (more-recent-first).
  mostRecentDeliveredAt: number;
};

export function pickFrequentlyOrderedShops(
  orders: Order[],
  limit: number = 3,
): FrequentShopEntry[] {
  // Group by shopId, keeping only delivered orders.
  const byShop = new Map<
    string,
    { shopId: string; shopName: string; orders: Order[] }
  >();
  for (const o of orders) {
    if (o.status !== 'delivered') continue;
    if (!o.shopId) continue;
    const existing = byShop.get(o.shopId);
    if (existing) {
      existing.orders.push(o);
    } else {
      byShop.set(o.shopId, {
        shopId: o.shopId,
        shopName: o.shopName,
        orders: [o],
      });
    }
  }

  // For each shop, find the most recent delivered order (by
  // deliveredAt if present, else createdAt).
  const entries: FrequentShopEntry[] = [];
  for (const group of byShop.values()) {
    const sorted = group.orders.slice().sort((a, b) => {
      const aT = typeof a.deliveredAt === 'number' ? a.deliveredAt : a.createdAt;
      const bT = typeof b.deliveredAt === 'number' ? b.deliveredAt : b.createdAt;
      return bT - aT;
    });
    const mostRecent = sorted[0];
    entries.push({
      shopId: group.shopId,
      shopName: group.shopName,
      lastOrderId: mostRecent.id,
      orderCount: group.orders.length,
      mostRecentDeliveredAt:
        typeof mostRecent.deliveredAt === 'number'
          ? mostRecent.deliveredAt
          : mostRecent.createdAt,
    });
  }

  // Sort by orderCount desc, ties broken by recency desc.
  entries.sort((a, b) => {
    if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount;
    return b.mostRecentDeliveredAt - a.mostRecentDeliveredAt;
  });

  return entries.slice(0, Math.max(0, limit));
}
```

### Part 2 — Tests for the picker

New file `tests/utils/pickFrequentlyOrderedShops.test.ts`:

```ts
import { describe, it, expect } from '@jest/globals';
import { pickFrequentlyOrderedShops } from '../../src/utils/pickFrequentlyOrderedShops';
import type { Order } from '../../src/types';

function makeOrder(over: Partial<Order>): Order {
  return {
    id: over.id ?? 'o1',
    shopId: over.shopId ?? 'shop_a',
    shopName: over.shopName ?? 'Shop A',
    customerUid: 'u1',
    status: over.status ?? 'delivered',
    createdAt: over.createdAt ?? 1000,
    deliveredAt: over.deliveredAt,
    items: [],
  } as Order;
}

describe('pickFrequentlyOrderedShops', () => {
  it('returns empty array when no delivered orders', () => {
    const result = pickFrequentlyOrderedShops([]);
    expect(result).toEqual([]);
  });

  it('excludes in-flight orders (pending / accepted / preparing / ready_for_pickup)', () => {
    const orders = [
      makeOrder({ id: 'o1', status: 'pending', shopId: 'shop_a' }),
      makeOrder({ id: 'o2', status: 'accepted', shopId: 'shop_b' }),
      makeOrder({ id: 'o3', status: 'preparing', shopId: 'shop_c' }),
      makeOrder({ id: 'o4', status: 'ready_for_pickup', shopId: 'shop_d' }),
    ];
    expect(pickFrequentlyOrderedShops(orders)).toEqual([]);
  });

  it('excludes cancelled orders', () => {
    const orders = [
      makeOrder({ id: 'o1', status: 'cancelled', shopId: 'shop_a' }),
    ];
    expect(pickFrequentlyOrderedShops(orders)).toEqual([]);
  });

  it('returns one entry per unique shop', () => {
    const orders = [
      makeOrder({ id: 'o1', shopId: 'shop_a' }),
      makeOrder({ id: 'o2', shopId: 'shop_a' }),
      makeOrder({ id: 'o3', shopId: 'shop_b' }),
    ];
    const result = pickFrequentlyOrderedShops(orders);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.shopId).sort()).toEqual(['shop_a', 'shop_b']);
  });

  it('orders by orderCount desc', () => {
    const orders = [
      makeOrder({ id: 'o1', shopId: 'shop_a' }),
      makeOrder({ id: 'o2', shopId: 'shop_b' }),
      makeOrder({ id: 'o3', shopId: 'shop_b' }),
      makeOrder({ id: 'o4', shopId: 'shop_b' }),
      makeOrder({ id: 'o5', shopId: 'shop_c' }),
      makeOrder({ id: 'o6', shopId: 'shop_c' }),
    ];
    const result = pickFrequentlyOrderedShops(orders);
    expect(result[0].shopId).toBe('shop_b'); // 3 orders
    expect(result[1].shopId).toBe('shop_c'); // 2 orders
    expect(result[2].shopId).toBe('shop_a'); // 1 order
  });

  it('breaks orderCount ties by most-recent delivery', () => {
    const orders = [
      makeOrder({ id: 'o1', shopId: 'shop_old', createdAt: 100, deliveredAt: 200 }),
      makeOrder({ id: 'o2', shopId: 'shop_new', createdAt: 100, deliveredAt: 500 }),
    ];
    const result = pickFrequentlyOrderedShops(orders);
    expect(result[0].shopId).toBe('shop_new');
    expect(result[1].shopId).toBe('shop_old');
  });

  it('falls back to createdAt when deliveredAt is missing', () => {
    const orders = [
      makeOrder({ id: 'o1', shopId: 'shop_a', createdAt: 200 }),
      makeOrder({ id: 'o2', shopId: 'shop_b', createdAt: 500 }),
    ];
    const result = pickFrequentlyOrderedShops(orders);
    expect(result[0].shopId).toBe('shop_b');
  });

  it('lastOrderId points at the most-recent order from that shop', () => {
    const orders = [
      makeOrder({ id: 'o_old', shopId: 'shop_a', deliveredAt: 100 }),
      makeOrder({ id: 'o_new', shopId: 'shop_a', deliveredAt: 500 }),
    ];
    const result = pickFrequentlyOrderedShops(orders);
    expect(result[0].lastOrderId).toBe('o_new');
    expect(result[0].orderCount).toBe(2);
  });

  it('respects the limit parameter', () => {
    const orders = [
      makeOrder({ id: 'o1', shopId: 'shop_a' }),
      makeOrder({ id: 'o2', shopId: 'shop_b' }),
      makeOrder({ id: 'o3', shopId: 'shop_c' }),
      makeOrder({ id: 'o4', shopId: 'shop_d' }),
      makeOrder({ id: 'o5', shopId: 'shop_e' }),
    ];
    expect(pickFrequentlyOrderedShops(orders, 2)).toHaveLength(2);
    expect(pickFrequentlyOrderedShops(orders, 0)).toHaveLength(0);
  });

  it('defaults limit to 3', () => {
    const orders = Array.from({ length: 5 }, (_, i) =>
      makeOrder({ id: `o${i}`, shopId: `shop_${i}` }),
    );
    expect(pickFrequentlyOrderedShops(orders)).toHaveLength(3);
  });
});
```

Run once at end per test-discipline.md.

### Part 3 — Component `OrderAgainRail`

New file `src/components/order/OrderAgainRail.tsx`:

A horizontal-scroll rail of "Order again from {shopName}" cards.

Props:

```ts
type Props = {
  entries: FrequentShopEntry[];
  loading: boolean;
  onTap: (entry: FrequentShopEntry) => void;
};
```

Render rules:

- If `loading === true` AND `entries.length === 0`: render a single
  skeleton card with a shimmer, OR render nothing. Either is fine —
  this is a non-critical surface, no need for elaborate loading UI.
- If `entries.length === 0` AND `loading === false`: render
  **nothing** (return null). The rail is hidden for first-time
  customers and for non-customer-role users (admins, delivery,
  shop owners who don't shop themselves).
- Otherwise: render header "Order again" + horizontal ScrollView of
  cards.

Each card:

- Width ~160–200 dp (so 1.5–2 cards visible at a time on a typical
  phone, hinting at horizontal scroll affordance)
- Content: shop name (bold, max 2 lines), small subtext "{orderCount}
  orders" or "Last ordered {N} days ago", "Order again" button (or
  card-press handler)
- Style: same card pattern as the shop list cards on ShopListScreen
  for visual consistency
- `accessibilityRole="button"`, `accessibilityLabel={"Order again from " + shopName}`

Header: matches the existing sectionTitle style on HomeScreen — same
font, same horizontal padding.

```tsx
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';
import type { FrequentShopEntry } from '../../utils/pickFrequentlyOrderedShops';

type Props = {
  entries: FrequentShopEntry[];
  loading: boolean;
  onTap: (entry: FrequentShopEntry) => void;
};

export default function OrderAgainRail({ entries, loading, onTap }: Props) {
  if (entries.length === 0) return null; // also hides during loading
  return (
    <View style={styles.container}>
      <Text style={styles.header}>Order again</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {entries.map(entry => (
          <Pressable
            key={entry.shopId}
            onPress={() => onTap(entry)}
            style={styles.card}
            accessibilityRole="button"
            accessibilityLabel={`Order again from ${entry.shopName}`}
          >
            <Text style={styles.shopName} numberOfLines={2}>
              {entry.shopName}
            </Text>
            <Text style={styles.subtext}>
              {entry.orderCount} {entry.orderCount === 1 ? 'order' : 'orders'}
            </Text>
            <Text style={styles.cta}>Order again →</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const CARD_WIDTH = 180;

const styles = StyleSheet.create({
  container: { marginTop: spacing.md },
  header: {
    ...typography.h3,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  scrollContent: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  card: {
    width: CARD_WIDTH,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  shopName: { ...typography.bodyBold, marginBottom: spacing.xs },
  subtext: { ...typography.caption, color: colors.textSecondary },
  cta: {
    ...typography.bodyBold,
    color: colors.primary,
    marginTop: spacing.md,
  },
});
```

### Part 4 — HomeScreen integration

Modify `src/screens/HomeScreen.tsx`:

**State additions (declare ALL of these at the TOP of the component,
above the existing `pendingShop` state):**

```tsx
// PR 14 — order history + reorder modal state. ALL state declared
// here at the top, above ANY conditional early returns, per the
// Rules-of-Hooks discipline established in PR 12 (ETA modal hotfix)
// and reinforced by PR 13. Adding state below early returns crashes
// the screen the moment data transitions from null → loaded.
const [frequentShops, setFrequentShops] = useState<FrequentShopEntry[]>([]);
const [historyLoading, setHistoryLoading] = useState(true);
const [reorderModalVisible, setReorderModalVisible] = useState(false);
const [reorderLoading, setReorderLoading] = useState(false);
const [reorderPlan, setReorderPlan] = useState<ReorderPlan | null>(null);
const [reorderShopMeta, setReorderShopMeta] = useState<{
  id: string;
  name: string;
  deliveryFee: number;
} | null>(null);
```

**Fetch order history on focus:**

```tsx
useFocusEffect(
  useCallback(() => {
    if (!uid || isAnonymous) {
      setFrequentShops([]);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    orderService
      .listMine(uid)
      .then(orders => {
        if (cancelled) return;
        setFrequentShops(pickFrequentlyOrderedShops(orders, 3));
        setHistoryLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        console.warn('[Home] listMine failed:', err);
        setFrequentShops([]);
        setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uid, isAnonymous]),
);
```

**Reorder tap handler:**

```tsx
const onOrderAgainTap = useCallback(async (entry: FrequentShopEntry) => {
  setReorderModalVisible(true);
  setReorderLoading(true);
  setReorderPlan(null);
  setReorderShopMeta(null);
  try {
    // Fetch the source order (the most recent delivered order from
    // this shop) + the shop's current menu.
    const [pastOrder, shop] = await Promise.all([
      orderService.getOrder(entry.lastOrderId),
      shopService.getById(entry.shopId, /* userLocation */ { lat: 0, lng: 0 }),
    ]);
    if (!pastOrder || !shop) {
      throw new Error('Could not load shop or order');
    }
    // getById returns the shop bundled with menu items on native;
    // on web the menu may need a separate fetch — check shopService
    // for the exact contract and adapt. If menu isn't bundled here,
    // call shopService.getMenuItems(shopId) (or whatever the existing
    // helper is — see ShopDetailScreen for the pattern).
    const plan = buildReorderPlan(pastOrder, shop.menuItems ?? []);
    setReorderPlan(plan);
    setReorderShopMeta({
      id: shop.id,
      name: shop.name,
      deliveryFee: shop.deliveryFee,
    });
    setReorderLoading(false);
  } catch (err: any) {
    console.warn('[Home] reorder fetch failed:', err);
    setReorderModalVisible(false);
    setReorderLoading(false);
    Alert.alert(
      'Could not load shop',
      err?.message ?? 'This shop may no longer be available.',
    );
  }
}, []);
```

**Confirm handler:**

```tsx
const onConfirmReorder = useCallback(() => {
  if (!reorderPlan || !reorderShopMeta) return;
  const cartItems = planToCartItems(reorderPlan);
  useCartStore.getState().replaceCartWithItems(cartItems, reorderShopMeta);
  setReorderModalVisible(false);
  nav.navigate('Cart');
}, [reorderPlan, reorderShopMeta, nav]);
```

**Render placement:**

Insert the rail in the HomeScreen JSX **between the search box and
the category chips**. That's the highest-impact slot — first thing
visible after the search.

```tsx
<OrderAgainRail
  entries={frequentShops}
  loading={historyLoading}
  onTap={onOrderAgainTap}
/>
```

And render the modal at the bottom of the SafeAreaView:

```tsx
<ReorderModal
  visible={reorderModalVisible}
  plan={reorderPlan}
  loading={reorderLoading}
  onConfirm={onConfirmReorder}
  onCancel={() => setReorderModalVisible(false)}
/>
```

### Part 5 — Verify or add `orderService.getOrder` if missing

The reorder flow needs `orderService.getOrder(orderId)`. PR 7 added a
similar `getOrder` callable server-side; verify there's a client-side
service wrapper. If `orderService.listMine` is already loaded into
state via the history fetch, you can avoid the second fetch by
finding the order in the existing list:

```tsx
// Optimisation: reuse the order from the history fetch instead of
// re-fetching it. Track the full order list in state alongside
// frequentShops, and find by lastOrderId at tap time.
const [recentOrders, setRecentOrders] = useState<Order[]>([]);
// ... in the focus effect:
setRecentOrders(orders);
setFrequentShops(pickFrequentlyOrderedShops(orders, 3));
// ... in onOrderAgainTap:
const pastOrder = recentOrders.find(o => o.id === entry.lastOrderId);
if (!pastOrder) throw new Error('Order not found');
```

This is the recommended path — saves one network round-trip per
reorder tap. Use it instead of a separate `getOrder` call unless
there's a reason the order needs to be freshly fetched.

## Scope (out)

- **Tap-to-call shop, shop ratings, distance display on the rail
  cards.** Keep cards minimal — name + count + CTA. Visual fidelity
  is enough.
- **Auto-scroll / carousel behaviour.** Manual swipe only.
- **Rail visibility for non-customer roles** (admins, delivery,
  shop owners). The empty-state check (entries.length === 0) handles
  this naturally — these users have no past customer orders so the
  rail hides itself.
- **Empty-state CTA** (e.g. "No past orders — browse shops"). Just
  hide the rail; the home screen already has Browse Shops below.
- **Pull-to-refresh on HomeScreen.** Out of scope; the focus effect
  already refetches on every return to Home.
- **Reorder from HomeScreen** of a SPECIFIC ITEM (not whole order).
  That's the Shopping List feature — separate PR.

## Acceptance checklist

- [ ] `src/utils/pickFrequentlyOrderedShops.ts` created with the
  exported helper + `FrequentShopEntry` type.
- [ ] `tests/utils/pickFrequentlyOrderedShops.test.ts` covers ≥9
  cases; all pass.
- [ ] `src/components/order/OrderAgainRail.tsx` created per spec.
- [ ] `src/screens/HomeScreen.tsx`:
  - [ ] All 6 new `useState` declarations sit ABOVE any conditional
    early returns. Permanent comment block citing PR 12 + PR 13.
  - [ ] `useFocusEffect` fetches order history via `orderService.listMine`.
  - [ ] Rail rendered between search box and category chips.
  - [ ] `ReorderModal` rendered + wired to confirm + cancel handlers.
- [ ] Tapping a rail card opens the modal with a loading state, then
  resolves to the plan within ~1–2s.
- [ ] Confirm button replaces cart and navigates to Cart screen.
- [ ] Rail is hidden for new users (no delivered orders) and for
  non-customer-role users.
- [ ] `npx tsc --noEmit`: 0 errors (root + functions).
- [ ] `npm test`: existing 516+ tests still pass plus the 9+ new ones.
- [ ] `npm run audit` passes.
- [ ] Deliberate-break demo: change the "orders by orderCount desc"
  test to expect ascending order, confirm red, revert.
- [ ] **Zero new `DO NOT REMOVE` markers added** (auto-formatter
  discipline holding).

## Smoke tests (manual, after OTA)

1. **New customer with no orders** — Open Home. Rail should be hidden
   entirely. No empty card, no loader stuck.
2. **Customer with one delivered order from one shop** — Rail shows
   one card with that shop. Tap → modal opens → plan loads → confirm
   → cart filled → Cart screen.
3. **Customer with mixed history** — 3 orders from Shop A, 2 from
   Shop B, 1 from Shop C. Rail shows all three in order A → B → C
   (orderCount desc).
4. **Customer with in-flight orders** — Should NOT influence the
   rail. Only delivered orders count. Test: place an order, accept it
   as shop, then check Home as customer — rail unchanged from before.
5. **Customer with cancelled order from a shop they've never bought
   from successfully** — Rail does NOT include that shop. Cancelled
   orders don't count.
6. **Shop suspended after delivered order** — Rail still shows the
   shop (we don't pre-filter). Tap → reorder fetch fails → modal
   closes → Alert "This shop may no longer be available." Cart
   unchanged.
7. **Cart had items from a different shop** — Reorder confirm replaces
   the cart entirely. Test the multi-shop blocker is correctly bypassed
   by `replaceCartWithItems`.
8. **Rail updates on return from a fresh delivery** — Place an order
   from a new shop, complete it through to delivered, navigate back to
   Home. Rail should now include that shop on top (most recent).
9. **Hooks-of-Rules sanity** — Pull-to-refresh the Home screen (or
   navigate away and back) several times. Should never crash with
   ErrorBoundary's "Something went wrong" — that was the PR 12 ETA
   modal regression we're preventing here.

## Deploy plan

Pure client OTA, no server changes:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm test
eas update --branch production --message "PR 14 — HomeScreen Order Again rail"
```

Rollback is `eas update --branch production --republish --group <prev-group-id>`
(no server contract to worry about).

Tell team to force-close + reopen TestFlight after publish.

## Estimated time

~2.5–3 hours Windsurf work:

- Part 1 (pure helper): 20 min
- Part 2 (tests): 30 min — 9 cases, mostly mechanical
- Part 3 (rail component): 45 min — visual polish takes most of it
- Part 4 (HomeScreen integration): 60 min — careful state hoisting
  + handler wiring; the modal + history fetcher is the bulk
- Part 5 (verify getOrder / use cached): 15 min
- Smoke testing + deliberate-break: 20 min

Should ship as the smoothest PR yet — no schema work, no breaking
changes, all primitives already tested in PR 13. The discipline from
the previous 4 PRs compounds here.

## Why this PR specifically (closing note)

Repeat Order from the Orders tab (PR 13) is necessary but not
discoverable — customers have to know to navigate to Orders. The
HomeScreen rail (PR 14) is what makes the feature **default**.
Together they convert kirana's underlying weekly-routine behaviour
from a 2-minute friction-laden rebuild into a 10-second tap.

The metric this PR moves: **median time-to-checkout for returning
customers**. Industry data suggests it drops from ~120s to ~20s for
the cohort using the rail. Telemetry follow-up in PRELAUNCH should
add an event that tags reorder taps so you can see this metric for
your own users within a week of family testing.
