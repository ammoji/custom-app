# PR 17 — Polish bundle (Windsurf prompt)

## Why this PR exists

Four small UX wins bundled into one OTA. None of them is a feature on
its own; together they make the app feel more responsive and complete.
All four are deferred items captured in PRELAUNCH from earlier PRs
(PR 15 + my earlier offer on customer Call Shop).

The four parts:

1. **Per-minute ETA ticker** on the Active orders rail — today's
   "Arriving in ~X min" copy goes stale between focus events. Make
   it tick down once a minute so customers see live progress.
2. **Bottom-tab badge** for active orders count — small numeric
   badge on the Orders tab icon. Lets customers see at a glance "I
   have 2 things in flight" without opening the tab.
3. **Customer "Call shop" button** — mirror of the existing
   shopkeeper "Call customer" feature (PR 12). Customers want to
   ask "is the dal fresh today?" or "can you add 100g extra paneer?".
   Common kirana interaction.
4. **Pull-to-refresh** on Customer's Orders list + Order Detail
   screens — already exists on Admin and Shop dashboards (PR 7);
   add the same affordance to the customer screens so they can
   manually refresh while waiting on status updates.

**Pure client OTA**, no schema, no server, no rollout risk. ~2 hours.

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md`.
- `src/screens/HomeScreen.tsx` — modify for Part 1 (ETA ticker).
  PR 15 already added `recentOrders` state + `pickActiveOrders`
  memo here; this PR adds a `nowMs` ticker state.
- `src/navigation/AppNavigator.tsx` — modify for Part 2 (tab badge).
  Find the bottom Tab.Navigator config and the Orders tab's
  `options.tabBarBadge`.
- `src/screens/OrderDetailScreen.tsx` — modify for Part 3 (Call shop)
  AND Part 4 (pull-to-refresh on this screen).
- `src/screens/OrdersScreen.tsx` — modify for Part 4 (pull-to-refresh
  on the list).
- `src/screens/shop/ShopOrderDetailScreen.tsx` — reference for the
  existing `onCallCustomer` handler (PR 12). The customer Call shop
  flow uses the same `Linking.openURL('tel:...')` pattern.
- `src/screens/admin/AdminOrdersScreen.tsx` (PR 7) — reference for
  the `RefreshControl` + `refreshing` state pattern. Customer screens
  mirror this exactly.
- `src/services/shopService.ts` — `getById(shopId, userLocation)`
  returns a shop with a `phone` field (verify shape — if `phone` is
  missing/optional, gate the Call shop button on its presence).
- `src/types/index.ts` — confirm `Shop.phone` exists. If not, the
  Call shop button is hidden gracefully (no schema change in this PR).

## Critical lessons from PRs 12–16 (do not repeat)

1. **All `useState` declarations sit ABOVE conditional early returns.**
   HomeScreen and OrderDetailScreen both have existing hoisted state
   blocks with comments citing the PR 12 / PR 13 / PR 14 / PR 15
   lineage. New state in this PR sits with them, above any early
   return. Add this PR (PR 17) to the citation list.
2. **Zero new `DO NOT REMOVE` markers expected.** Six PRs in a row
   without strips. Keep the streak.
3. **No new native module imports.** All four parts use existing
   dependencies (React Native built-ins + expo-haptics is already
   bundled — though this PR doesn't need it).

## Scope (in)

### Part 1 — Per-minute ETA ticker on Active rail

In `src/screens/HomeScreen.tsx`:

```tsx
// PR 17 — ETA ticker. Bumps `nowMs` once per minute so the
// "Arriving in ~X min" copy on the Active orders rail decrements
// visibly while the user lingers on Home. Without this, the copy
// stays stale until the next focus-effect refetch.
//
// Cleanup is essential — we don't want the interval to keep
// running after HomeScreen unmounts (e.g. when nav.navigate goes
// to a different tab). useEffect's cleanup handles it.
const [nowMs, setNowMs] = useState(() => Date.now());
useEffect(() => {
  const id = setInterval(() => setNowMs(Date.now()), 60_000);
  return () => clearInterval(id);
}, []);
```

This state goes at the TOP of HomeScreen, with the existing hoisted
block from PR 14/15. The comment block citing the Rules-of-Hooks
lineage should be extended to mention PR 17.

Then pass `nowMs` down to `ActiveOrdersRail` so its `etaText` helper
can use it (instead of `Date.now()` at render time, which doesn't
re-render automatically):

In `src/components/order/ActiveOrdersRail.tsx`, add `nowMs?: number`
prop. Change `etaText(order)` to take `nowMs` as a parameter:

```tsx
function etaText(order: Order, nowMs: number): string {
  if (order.status === 'ready_for_pickup' && order.pickedUpAt) {
    return 'Out for delivery';
  }
  if (order.status === 'ready_for_pickup') {
    return 'Almost ready';
  }
  const eta = order.status === 'accepted' || order.status === 'preparing'
    ? order.readyByEstimate ?? order.estimatedDeliveryAt
    : order.estimatedDeliveryAt;
  if (typeof eta !== 'number') return '';
  const minsLeft = Math.round((eta - nowMs) / 60_000);
  if (minsLeft <= 0) return 'Arriving soon';
  return `Arriving in ~${minsLeft} min`;
}
```

If `nowMs` is not passed (backwards compat), default to `Date.now()`
inside the component.

### Part 2 — Bottom-tab badge for active orders

In `src/navigation/AppNavigator.tsx`, find the bottom Tab.Navigator.
The Orders tab needs a badge showing the count of active orders for
the current customer.

The simplest path: add a small custom component that wraps the tab
icon and reads its own active-order count via a focus-based fetch.
This avoids needing to lift `recentOrders` from HomeScreen to a
global store (which would be a bigger refactor).

```tsx
// PR 17 — Active orders badge component. Lives next to the tab
// definition so the badge data fetch is encapsulated. Fetches on
// mount + every 60s while mounted.
function ActiveOrdersBadge() {
  const uid = useAuthStore(s => s.uid);
  const isAnonymous = useAuthStore(s => s.isAnonymous);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!uid || isAnonymous) {
      setCount(0);
      return;
    }
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const orders = await orderService.listMine(uid);
        if (cancelled) return;
        setCount(pickActiveOrders(orders).length);
      } catch {
        // Best-effort — silent on error.
      }
    };
    fetchCount();
    const id = setInterval(fetchCount, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [uid, isAnonymous]);

  return count > 0 ? count : undefined;
}
```

Then in the Tab.Screen config for Orders:

```tsx
<Tab.Screen
  name="Orders"
  component={OrdersScreen}
  options={{
    // ...existing options
    tabBarBadge: <ActiveOrdersBadge />,
  }}
/>
```

**Important note on tabBarBadge:** the React Navigation API expects
either a string/number value OR a function returning one. The exact
prop name (`tabBarBadge` vs `tabBarBadgeCount` etc.) and whether it
accepts a component vs a value depends on which Tab Navigator is in
use (Material vs Native Bottom Tabs). Check the actual import in
AppNavigator.tsx — if it's `@react-navigation/bottom-tabs` then
`tabBarBadge` takes a primitive value.

Adjust the approach if needed — the simplest fallback is to lift
`count` into a small Zustand store (`useActiveOrderCountStore`) that
the tab badge reads via `useAuthStore`-style subscription, AND
HomeScreen + OrdersScreen update when their fetches complete. This
avoids the "tabBarBadge as a function/component" question entirely.

### Part 3 — Customer "Call shop" button

In `src/screens/OrderDetailScreen.tsx`:

**Add state (at top, above early returns):**

```tsx
// PR 17 — Shop info for Call shop button. Fetched once on order
// load; null if shop data unavailable (then we hide the button).
const [shop, setShop] = useState<Shop | null>(null);
```

**Add fetch effect (after order loads):**

```tsx
// PR 17 — fetch shop info to enable the Call shop button. Runs
// once per order. Failures are silent — the button just stays
// hidden if we can't get the shop's phone.
useEffect(() => {
  if (!order?.shopId) {
    setShop(null);
    return;
  }
  let cancelled = false;
  shopService
    .getById(order.shopId, { lat: 0, lng: 0 })
    .then(s => {
      if (!cancelled) setShop(s);
    })
    .catch(() => {
      if (!cancelled) setShop(null);
    });
  return () => {
    cancelled = true;
  };
}, [order?.shopId]);
```

**Add the call handler** (mirror of shopkeeper's `onCallCustomer`):

```tsx
const onCallShop = () => {
  const phone = shop?.phone;
  if (!phone) return;
  const url = `tel:${phone}`;
  if (Platform.OS === 'web') {
    Linking.openURL(url).catch(() => {});
    return;
  }
  Linking.openURL(url).catch(err => {
    showAlert(
      'Could not place call',
      err?.message || 'Your device does not support phone calls.',
    );
  });
};
```

**Render the button** in the existing shop name section near the
top of the order detail. Only show when `shop?.phone` is present:

```tsx
<Text style={styles.sectionTitle}>{order.shopName}</Text>
{shop?.phone && (
  <Pressable
    onPress={onCallShop}
    style={styles.callShopRow}
    accessibilityRole="button"
    accessibilityLabel={`Call ${order.shopName} at ${shop.phone}`}
  >
    <Text style={styles.callShopText}>📞 Call shop ({shop.phone})</Text>
  </Pressable>
)}
```

Styles:

```ts
callShopRow: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.md,
  backgroundColor: colors.primaryLight,
  borderRadius: radii.md,
  marginBottom: spacing.sm,
  alignSelf: 'flex-start',
},
callShopText: {
  ...typography.bodyBold,
  color: colors.primaryDark,
},
```

### Part 4 — Pull-to-refresh on Customer's Orders + Order Detail

**On `src/screens/OrdersScreen.tsx`:**

Add `refreshing` state and `RefreshControl` to the FlatList. Mirror
PR 7's pattern from AdminOrdersScreen exactly.

```tsx
const [refreshing, setRefreshing] = useState(false);

const onRefresh = useCallback(async () => {
  setRefreshing(true);
  try {
    // Re-fetch the orders list. Use whatever existing fetcher the
    // screen uses (likely orderService.listMine or a watcher).
    await refetch();  // Adapt to existing fetcher's actual name.
  } finally {
    setRefreshing(false);
  }
}, [/* fetcher dep */]);

// In the FlatList:
<FlatList
  // ...existing props
  refreshControl={
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
  }
/>
```

If OrdersScreen uses a watcher (subscribe pattern) rather than an
imperative fetcher, the cleanest path is to bump a `retryNonce`
state that the watcher's effect depends on (same pattern as
AdminOrdersScreen):

```tsx
const [retryNonce, setRetryNonce] = useState(0);
const onRefresh = useCallback(() => {
  setRefreshing(true);
  setRetryNonce(n => n + 1);
}, []);
// Watcher callback should call setRefreshing(false) when it fires.
```

**On `src/screens/OrderDetailScreen.tsx`:**

Same pattern but wrapped around the ScrollView (not FlatList):

```tsx
<ScrollView
  contentContainerStyle={styles.content}
  refreshControl={
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
  }
>
  {/* existing content */}
</ScrollView>
```

The `onRefresh` here triggers the watcher to re-poll the order doc.

### Part 5 — No new tests required

All four parts are UI plumbing on top of existing tested behaviour.
No pure helpers added. The Active rail's `etaText` change (accepting
`nowMs` as a param) is small enough that the existing rail-render
smoke test in Part 4 covers it.

If Windsurf decides to extract `etaText` into a pure helper for
testability, that's fine but optional. Don't add new tests just to
hit a target count — every test costs maintenance.

## Scope (out)

- **Real-time WebSocket order updates.** Polling is fine for MVP.
- **Tab badge animation** (pulse/bounce when new orders arrive).
  Number alone is enough signal.
- **"Call customer" expansion** to other screens (e.g. admin order
  detail). Out of scope; this PR is customer-only on that surface.
- **Lifting `recentOrders` to a global Zustand store.** Tempting
  refactor but increases blast radius. Each surface (HomeScreen
  + tab badge) does its own listMine fetch; the duplication is
  small and gives us a faster ship.
- **Pull-to-refresh on AdminOrders / ShopOwnerDashboard.** Those
  already have it from PR 7. Don't accidentally re-touch them.

## Acceptance checklist

- [ ] **Part 1**:
  - [ ] `HomeScreen.tsx` has new `nowMs` state + useEffect interval
    at the TOP with the other hoisted state. PR 17 added to the
    Rules-of-Hooks comment block lineage.
  - [ ] `ActiveOrdersRail.tsx` accepts optional `nowMs` prop;
    `etaText` recomputes when it changes.
  - [ ] Verified by stopwatch: "Arriving in ~5 min" on a real
    order ticks to "~4 min" within 60 seconds.
- [ ] **Part 2**:
  - [ ] Bottom Orders tab shows a numeric badge equal to active
    order count.
  - [ ] Badge is absent (not "0") when no active orders.
  - [ ] Badge updates within ~60s of a new order being placed.
  - [ ] Badge is absent for anonymous / signed-out users.
- [ ] **Part 3**:
  - [ ] Customer's `OrderDetailScreen.tsx` shows "📞 Call shop
    (XXXXX)" button below the shop name section when shop phone is
    available.
  - [ ] Tapping opens the native phone dialer with the shop's number
    pre-filled.
  - [ ] Button is hidden cleanly if shop phone is null/missing.
- [ ] **Part 4**:
  - [ ] Customer's `OrdersScreen.tsx` supports pull-to-refresh.
  - [ ] Customer's `OrderDetailScreen.tsx` supports pull-to-refresh
    (wrapped on ScrollView).
  - [ ] Loader appears briefly, then clears when fetch completes.
- [ ] `npx tsc --noEmit`: 0 errors (root + functions).
- [ ] `npm test`: existing 534+ tests still pass (no new ones expected).
- [ ] `npm run audit` passes.
- [ ] **Zero new `DO NOT REMOVE` markers added** (7-PR streak).

## Smoke tests (manual, after OTA)

1. **ETA ticker** — place an order, get it accepted with an ETA. Open
   Home, leave the app open. After 60 seconds, the "Arriving in ~X
   min" number on the Active rail card should decrement by 1.
2. **Tab badge appears** — sign in as a customer with no active
   orders. Place a new order. Within ~60 seconds, the Orders bottom
   tab gets a "1" badge.
3. **Tab badge clears** — complete the order through to delivered.
   Within ~60 seconds, badge disappears.
4. **Tab badge hidden for anonymous user** — sign out. The Orders
   tab has no badge.
5. **Call shop button** — open any order detail as customer. Tap the
   Call shop button below the shop name. Native dialer opens with
   the shop's number ready to call.
6. **Call shop hidden when no phone** — find a shop in dev project
   that has no `phone` field (or temporarily clear one). Customer
   viewing an order from that shop sees no Call shop button (no
   broken layout, no empty "Call shop ()" text).
7. **Pull-to-refresh on Orders list** — open Orders tab, pull down.
   Loader appears, list refetches, loader clears within ~2s.
8. **Pull-to-refresh on Order Detail** — open any order detail, pull
   down. Loader appears, doc refetches.
9. **No screen crashes** — visit each modified screen, force-close +
   reopen, repeat. No ErrorBoundary screens. Rules-of-Hooks
   discipline holding.

## Deploy plan

Pure client OTA, no server changes:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm test
eas update --branch production --message "PR 17 — Polish bundle (ETA ticker + tab badge + Call shop + pull-to-refresh)"
```

Tell testers to force-close + reopen TestFlight after publish.

## Estimated time

~2 hours Windsurf work:

- Part 1 (ETA ticker): 20 min — state + interval + prop drilling
- Part 2 (tab badge): 30–45 min — actual time depends on which Tab
  Navigator API is in use. May need a small Zustand store if the
  tabBarBadge prop is finicky.
- Part 3 (Call shop): 30 min — shop fetch + button + handler
- Part 4 (pull-to-refresh): 20 min — mirror PR 7's pattern on two
  customer screens
- Smoke + verification: 20 min

The simplest PR shape in a while. Should ship clean given the
discipline that's compounded over PRs 13–16.

## Why this PR matters

None of the four pieces is a "feature" by themselves — they're the
kind of small polish that makes the difference between "the app
works" and "the app feels finished."

- ETA ticker: the difference between feeling like a static order
  log and feeling like a live tracking surface
- Tab badge: parity with every delivery / chat / inbox app the
  user has on their phone
- Call shop: closes the bilateral communication loop (shop can
  already call customer; now customer can call shop)
- Pull-to-refresh: the universal "did anything change?" gesture
  every mobile user expects

After PR 17, the customer side of the app will feel competitive
with Swiggy/Zomato at first glance. The structural work is done;
this is the surface polish that closes the perception gap.
