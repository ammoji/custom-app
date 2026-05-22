# PR 15 — Active orders rail on HomeScreen (Windsurf prompt)

## Why this PR exists

PR 14 added a "Order again" rail for **past** orders on the home
screen. PR 15 adds a symmetric rail for **active (in-flight)** orders
right above it. Together, the home screen becomes the customer's
order command center — they no longer need to navigate to the Orders
tab to see what's happening with current orders.

Today's flow when a customer wants to check their order:

1. Open app → Home
2. Tap bottom-tab "Orders"
3. Wait for list to load
4. Find their order
5. See current status

After PR 15:

1. Open app → Home → status visible immediately on a card with chip + ETA + tap-to-detail

The kirana fit: customers who just placed an order want passive
reassurance their order is progressing. The Orders tab works but
requires intent. Putting a live-updating card on Home shows the
order without the customer asking.

**Pure client OTA** — reuses PR 14's `listMine` fetch (already
running in `useFocusEffect`), no schema changes, no server work, no
rollout risk. ~1.5–2 hours.

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md`.
- `docs/pr-14-home-order-again-rail-windsurf-prompt.md` — PR 14 is
  the architectural twin of this PR. Read its HomeScreen integration
  section especially; PR 15 mirrors the pattern exactly.
- `src/screens/HomeScreen.tsx` — the screen this PR modifies. PR 14
  already added the `listMine` fetch in `useFocusEffect` and stored
  the result in state. PR 15 derives a new value (`activeOrders`)
  from the same source, so no additional network calls.
- `src/components/order/OrderAgainRail.tsx` (created in PR 14) — the
  visual reference. Style and structure of `ActiveOrdersRail`
  should mirror it for visual consistency.
- `src/components/order/OrderStatusChip.tsx` — reuse for the status
  chip on each card. Pass `audience="customer"` so it shows
  customer-facing copy ("Out for delivery" not "Ready for Pickup").
- `src/types/index.ts` — `Order` type, `OrderStatus` union. The
  non-terminal statuses are `pending`, `accepted`, `preparing`,
  `ready_for_pickup` (post-PR-12 rename).

## Critical lessons from PRs 12 + 13 + 14 (do not repeat)

1. **All `useState` calls in HomeScreen MUST sit above conditional
   early returns.** PR 14 hoisted six new state vars; PR 15 adds
   none (it reads from PR 14's state), so this is mostly a non-issue,
   but verify the existing PR 14 comment block stays intact.
2. **Zero new `DO NOT REMOVE` markers** expected. Five PRs in a row
   without strips — keep the streak.
3. **No new native module imports.** HomeScreen runs on web too.

## Scope (in)

### Part 1 — Pure helper `pickActiveOrders`

New file `src/utils/pickActiveOrders.ts`:

```ts
/**
 * Pure helper that filters a customer's order list down to currently
 * IN-FLIGHT orders, sorted most-recent-first. Used by the
 * HomeScreen "Active orders" rail.
 *
 * "Active" = non-terminal status:
 *   - `pending` (just placed, awaiting shop acceptance)
 *   - `accepted` (shop accepted with ETA)
 *   - `preparing` (shop is preparing)
 *   - `ready_for_pickup` (post-PR-12 rename of out_for_delivery)
 *
 * Terminal statuses (excluded):
 *   - `delivered` (cycle complete)
 *   - `cancelled` (cycle aborted)
 *
 * Sort: by createdAt desc — most recently placed orders surface
 * first. Customers care about their newest order, not their oldest
 * in-flight one.
 *
 * Pure — no Firestore reads, no React, no clock. Pinned by
 * tests/utils/pickActiveOrders.test.ts.
 */
import type { Order } from '../types';

// Single source of truth for which statuses count as "active".
// Mirror of (the inverse of) the terminal-status set used in PR 13's
// reorder filter, and the AVAILABLE_POOL_STATUSES set on the
// delivery server. Keep these synced if the state machine evolves.
const ACTIVE_STATUSES = new Set<string>([
  'pending',
  'accepted',
  'preparing',
  'ready_for_pickup',
]);

export function pickActiveOrders(orders: Order[]): Order[] {
  return orders
    .filter(o => ACTIVE_STATUSES.has(o.status))
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);
}
```

### Part 2 — Tests for the picker

New file `tests/utils/pickActiveOrders.test.ts`:

```ts
import { describe, it, expect } from '@jest/globals';
import { pickActiveOrders } from '../../src/utils/pickActiveOrders';
import type { Order } from '../../src/types';

function makeOrder(over: Partial<Order>): Order {
  return {
    id: over.id ?? 'o1',
    shopId: 'shop_a',
    shopName: 'Shop A',
    customerUid: 'u1',
    status: over.status ?? 'pending',
    createdAt: over.createdAt ?? 1000,
    items: [],
  } as Order;
}

describe('pickActiveOrders', () => {
  it('returns empty when no orders', () => {
    expect(pickActiveOrders([])).toEqual([]);
  });

  it('includes all four non-terminal statuses', () => {
    const orders = [
      makeOrder({ id: 'o1', status: 'pending' }),
      makeOrder({ id: 'o2', status: 'accepted' }),
      makeOrder({ id: 'o3', status: 'preparing' }),
      makeOrder({ id: 'o4', status: 'ready_for_pickup' }),
    ];
    expect(pickActiveOrders(orders)).toHaveLength(4);
  });

  it('excludes delivered and cancelled', () => {
    const orders = [
      makeOrder({ id: 'o1', status: 'delivered' }),
      makeOrder({ id: 'o2', status: 'cancelled' }),
    ];
    expect(pickActiveOrders(orders)).toEqual([]);
  });

  it('sorts by createdAt desc (newest first)', () => {
    const orders = [
      makeOrder({ id: 'old', status: 'pending', createdAt: 100 }),
      makeOrder({ id: 'new', status: 'pending', createdAt: 500 }),
      makeOrder({ id: 'mid', status: 'preparing', createdAt: 300 }),
    ];
    const result = pickActiveOrders(orders);
    expect(result.map(o => o.id)).toEqual(['new', 'mid', 'old']);
  });

  it('mixes active + terminal in input, returns active only', () => {
    const orders = [
      makeOrder({ id: 'a1', status: 'pending', createdAt: 100 }),
      makeOrder({ id: 't1', status: 'delivered', createdAt: 200 }),
      makeOrder({ id: 'a2', status: 'preparing', createdAt: 150 }),
      makeOrder({ id: 't2', status: 'cancelled', createdAt: 250 }),
    ];
    const result = pickActiveOrders(orders);
    expect(result.map(o => o.id)).toEqual(['a2', 'a1']);
  });

  it('does not mutate the input array', () => {
    const orders = [
      makeOrder({ id: 'o1', status: 'pending', createdAt: 100 }),
      makeOrder({ id: 'o2', status: 'pending', createdAt: 200 }),
    ];
    const snapshot = orders.map(o => o.id);
    pickActiveOrders(orders);
    expect(orders.map(o => o.id)).toEqual(snapshot);
  });

  it('handles unknown statuses gracefully (treats as terminal)', () => {
    // If a future server-side change introduces a status the client
    // doesn't recognise, it shouldn't appear in the active rail. The
    // ACTIVE_STATUSES allowlist is deliberately strict.
    const orders = [
      makeOrder({ id: 'o1', status: 'unknown_status' as any }),
    ];
    expect(pickActiveOrders(orders)).toEqual([]);
  });
});
```

### Part 3 — Component `ActiveOrdersRail`

New file `src/components/order/ActiveOrdersRail.tsx`:

Visual structure mirrors `OrderAgainRail` (horizontal scroll, same
card width, same header style) but each card represents an active
order instead of a frequent shop.

Card content per order:

- Top: shop name (bold, max 2 lines)
- Middle: `<OrderStatusChip status={order.status} audience="customer" />`
- Subtext: human-readable ETA — "Arriving in ~X min" if
  `estimatedDeliveryAt` is in the future, "Arriving soon" if past
  but order still active. For `ready_for_pickup` orders that have a
  `pickedUpAt`, show "Out for delivery". For ones without,
  show "Almost ready."
- Tap target: whole card. Navigates to `OrderDetail` with the
  orderId.

Props:

```ts
type Props = {
  orders: Order[];
  onTap: (order: Order) => void;
};
```

Render rules:

- If `orders.length === 0`: return `null`. Same hide-when-empty
  pattern as `OrderAgainRail`.
- Header: "Your active orders" — matches sectionTitle style.
- Card layout: same width (~180dp), same spacing, same surface
  background as `OrderAgainRail`. Visual consistency lets the two
  rails feel like a unified module on the home screen.

```tsx
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';
import OrderStatusChip from './OrderStatusChip';
import type { Order } from '../../types';

type Props = {
  orders: Order[];
  onTap: (order: Order) => void;
};

function etaText(order: Order): string {
  // ready_for_pickup with pickedUpAt set → partner is en route.
  if (order.status === 'ready_for_pickup' && order.pickedUpAt) {
    return 'Out for delivery';
  }
  if (order.status === 'ready_for_pickup') {
    return 'Almost ready';
  }
  const eta = order.estimatedDeliveryAt;
  if (typeof eta !== 'number') return '';
  const minsLeft = Math.round((eta - Date.now()) / 60_000);
  if (minsLeft <= 0) return 'Arriving soon';
  return `Arriving in ~${minsLeft} min`;
}

export default function ActiveOrdersRail({ orders, onTap }: Props) {
  if (orders.length === 0) return null;
  return (
    <View style={styles.container}>
      <Text style={styles.header}>Your active orders</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {orders.map(order => (
          <Pressable
            key={order.id}
            onPress={() => onTap(order)}
            style={styles.card}
            accessibilityRole="button"
            accessibilityLabel={`Open order from ${order.shopName}`}
          >
            <Text style={styles.shopName} numberOfLines={2}>
              {order.shopName}
            </Text>
            <View style={styles.chipRow}>
              <OrderStatusChip status={order.status} audience="customer" />
            </View>
            <Text style={styles.eta}>{etaText(order)}</Text>
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
    backgroundColor: colors.primaryLight,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  shopName: { ...typography.bodyBold, marginBottom: spacing.sm },
  chipRow: { marginBottom: spacing.sm },
  eta: { ...typography.caption, color: colors.primaryDark },
});
```

Note the deliberately different card background (`colors.primaryLight`
with primary border) vs `OrderAgainRail`'s neutral surface — this
visually distinguishes "live, needs attention" from "past, optional"
without requiring the customer to read the headers.

### Part 4 — HomeScreen integration

Modify `src/screens/HomeScreen.tsx`:

**No new state hoisting needed.** PR 14 already added `recentOrders`
state (the full order list cached from `listMine`). PR 15 derives
`activeOrders` from it via `useMemo` to avoid recomputing on every
render:

```tsx
// PR 15 — active orders derived from the same listMine cache PR 14
// uses for frequentShops. No additional fetch. useMemo so the rail
// only re-renders when the underlying order list changes.
const activeOrders = useMemo(
  () => pickActiveOrders(recentOrders),
  [recentOrders],
);
```

**Tap handler:**

```tsx
const onActiveOrderTap = useCallback(
  (order: Order) => {
    nav.navigate('OrderDetail', { orderId: order.id });
  },
  [nav],
);
```

**Render placement:**

Insert the rail in HomeScreen JSX **above the "Order again" rail**.
That's the priority slot — active orders need glanceable attention
more than reorder prompts.

```tsx
<ActiveOrdersRail orders={activeOrders} onTap={onActiveOrderTap} />

<OrderAgainRail
  entries={frequentShops}
  loading={historyLoading}
  onTap={onOrderAgainTap}
/>
```

Both rails hide themselves when empty, so a first-time user with no
orders sees neither — clean home screen with just search + categories.

### Part 5 — Tick the ETA copy

Active order cards show "Arriving in ~X min" computed from
`order.estimatedDeliveryAt - Date.now()`. Without a re-render trigger,
this stays stale until the next focus-effect refetch.

For PR 15: **acceptable to leave it static** — the focus-effect
fetches on every Home return, and that's the typical user pattern
(close app → reopen → see updated ETA). A per-second ticker would be
nicer but adds wakeup churn for marginal value.

**Tracked follow-up in PRELAUNCH:** add a `useEffect` interval that
re-renders the rail every 60s so the ETA decrements visibly while
the user lingers on Home. ~10 min change later if testers report
it feels stale.

## Scope (out)

- **Live re-rendering ETA ticker** — deferred (see Part 5).
- **Action buttons on cards** (e.g. "Cancel" for in-window-cancellable
  orders). Tap-to-detail is enough for MVP; in-flight actions stay
  on OrderDetailScreen.
- **Reorder for in-flight orders.** Reorder is for terminal-state
  orders only. Active orders don't get a reorder affordance — they're
  already ordered.
- **Push notifications when status changes.** Separate infrastructure
  (Expo Push or FCM). Tracked separately in PRELAUNCH.
- **Real-time updates via Firestore onSnapshot.** Today's polling
  cadence is fine for the rail. Real-time would require a
  HomeScreen-level subscription that disrupts the focus-effect model.

## Acceptance checklist

- [ ] `src/utils/pickActiveOrders.ts` created with the exported helper.
- [ ] `tests/utils/pickActiveOrders.test.ts` covers ≥7 cases; all pass.
- [ ] `src/components/order/ActiveOrdersRail.tsx` created per spec,
  with distinct visual styling (primary-tinted background) vs
  OrderAgainRail.
- [ ] `src/screens/HomeScreen.tsx`:
  - [ ] `pickActiveOrders` imported and called via `useMemo` on
    `recentOrders` (PR 14's cached list).
  - [ ] `onActiveOrderTap` handler defined.
  - [ ] `<ActiveOrdersRail>` rendered ABOVE `<OrderAgainRail>` in
    the JSX tree.
  - [ ] PR 14's existing hooks-discipline comment block intact.
  - [ ] No new `useState` calls added (this PR adds only `useMemo`
    + `useCallback`).
- [ ] OrderStatusChip on each card uses `audience="customer"` so
  copy reads "Out for delivery" not "Ready for Pickup".
- [ ] Hide-when-empty behaviour: if no active orders, rail renders
  null and HomeScreen layout shifts up.
- [ ] `npx tsc --noEmit`: 0 errors (root + functions).
- [ ] `npm test`: existing 527+ tests still pass plus the 7+ new ones.
- [ ] `npm run audit` passes.
- [ ] Deliberate-break demo: change the "excludes delivered and
  cancelled" test to expect length 2, confirm red, revert.
- [ ] **Zero new `DO NOT REMOVE` markers added** (auto-formatter
  discipline at 5 PRs and counting).

## Smoke tests (manual, after OTA)

1. **Customer places an order** — open Home before the order is
   accepted. Rail shows one card "Shop name · Pending · Arriving in
   ~X min." Tap → navigates to OrderDetail.
2. **Order gets accepted by shop** — return to Home (or pull-down /
   navigate back). Rail card now shows "Accepted" chip + ETA
   computed from `readyByEstimate` (or `estimatedDeliveryAt` if
   `readyByEstimate` isn't set).
3. **Order goes through full lifecycle** — pending → accepted →
   preparing → ready_for_pickup → picked_up → delivered. The card
   updates label/chip at each stage on Home return. When status
   becomes `delivered`, the card disappears from the active rail
   AND the shop appears in the "Order again" rail below. Symmetric
   handoff.
4. **Multiple active orders** — place 3 orders from 3 different
   shops. Rail shows all 3, newest first (left-to-right).
5. **Cancelled order** — cancel an in-flight order. Card disappears
   from the active rail. Shop does NOT show in the "Order again"
   rail (PR 14 filters cancelled).
6. **First-time user / non-customer role** — empty active rail
   AND empty order-again rail. Home screen renders cleanly with
   just search + categories.
7. **Customer-facing label sanity** — confirm a `ready_for_pickup`
   order shows "Out for delivery" on the chip (audience override
   working). Not "Ready for Pickup" — that's the shop/admin label.

## Deploy plan

Pure client OTA, no server changes:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm test
eas update --branch production --message "PR 15 — Active orders rail on Home"
```

Rollback is `eas update --branch production --republish --group <prev-group-id>`.

Tell team to force-close + reopen TestFlight after publish to pick
up the new bundle.

## Estimated time

~1.5–2 hours Windsurf work:

- Part 1 (pure helper): 15 min
- Part 2 (tests): 20 min — 7 cases, all simple
- Part 3 (rail component): 40 min — visual polish + ETA copy
- Part 4 (HomeScreen integration): 25 min — useMemo + handler + render
- Part 5 (note the deferred ticker in PRELAUNCH): 5 min
- Smoke + deliberate-break: 15 min

The smallest PR shipped since PR 8.1's cleanup bundle. Compounding
discipline payoff: by the time you ship 10 PRs in a row that mirror
each other architecturally, the marginal cost of feature #11 drops
substantially.

## Why this PR matters

It closes the loop. PR 14 made past-order behaviour visible on Home;
PR 15 makes present-order behaviour visible on Home. Tomorrow,
when a tester opens the app, they see their entire ordering life:
"Here's what you have in flight right now" + "Here are the shops
you keep coming back to." That's the kirana customer's mental model
expressed as UI in two glances.

Tomorrow's metric to watch: **how often customers navigate to the
Orders tab.** If the active rail is doing its job, that tab gets
visited dramatically less for in-flight check-ins — they all happen
on Home now. The Orders tab becomes a historical archive rather than
a daily destination, which is exactly the goal.
