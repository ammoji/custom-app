# PR 36 — Customer CRM for shop owner (Windsurf prompt)

## Why this PR exists

A kirana shop owner's single biggest disadvantage versus chains
like Blinkit is **loss of relationship visibility.** In a
physical shop, the owner knows their regulars by face. The
moment ordering goes through an app, that relationship
disappears — unless the app gives it back. PR 36 gives it back.

After PR 36 the shop owner can answer, from one screen:

- Who are my top 10 customers by revenue?
- Who ordered most recently?
- Who used to order regularly but hasn't in 30+ days?

That's the **killer merchant feature** from `docs/ROADMAP.md`'s
strategic refresh: a daily-use hook even when no new order has
just arrived. Combined with PR 37 (Udhaar ledger) and PR 38
(observability), it's pilot-critical.

**What ships:**

- Server: new `listShopCustomers` callable that aggregates the
  shop's order history into per-customer rollups
  (uid, phone, name, order count, total spent, first/last order
  date). Pure helpers extracted for testing.
- Client: new `ShopCustomersScreen` reachable from
  `ShopOwnerDashboardScreen` via a "👥 My customers" tile.
  Three tabs: **Top by revenue**, **Recent**, **Stopped
  ordering 30d+**. Period filter (90d / all-time) at top.
- Analytics events per Strategic Principle 8.

**Reads existing data only.** No new collections. No new
schema. No new SDKs. ~1–1.5 days. Server-first deploy. OTA-
eligible (no native changes).

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md`.
- `docs/ROADMAP.md`:
  - Mission North Star + Trust Principles
  - Strategic Principle 4 (merchant daily-use hooks)
  - Phase B PR 36 entry
- `functions/src/index.ts` line 2642 — `listShopOrders` is the
  shape to mirror (same auth gate via `validateShopOrdersAccess`,
  same Firestore query path on `orders` collection filtered by
  `shopId`). PR 36's new callable extends this with aggregation
  + a higher per-shop limit (capped at 1000 orders / 1 year).
- `functions/src/shopOrdersHelpers.ts` — the pure validation
  helper PR 36's callable will also call.
- `src/screens/shop/ShopOwnerDashboardScreen.tsx` — where the
  new tile lives.
- `src/services/orderService.ts` — pattern for the new client
  wrapper (web + native dispatch).
- `src/services/analytics.ts` — PR 38 added shop-side event
  signatures; this PR adds its own `shop_customers_*` events.

## Critical lessons from PRs 25–38 (do not repeat)

1. **OTA-eligible.** Confirm via the new `.windsurf/deploy-
   discipline.md` "OTA vs eas build" check: no plugin changes,
   no permissions, no native deps. OTA-only deploy.
2. **Server-first.** New callable. Deploy server before OTA per
   Rule 1. One `--only` target per command.
3. **Never strip imports.** Files touched: `index.ts` (one new
   callable + import), new `customerCrmHelpers.ts`,
   `orderService.ts` (+1 wrapper), `analytics.ts` (+events),
   new `ShopCustomersScreen.tsx`, `ShopOwnerDashboardScreen.tsx`
   (+1 tile), `AppNavigator.tsx` (+1 route),
   `src/types/index.ts` (+ShopCustomer type).
4. **Hooks order:** all `useState` in `ShopCustomersScreen`
   above any early return.
5. **Schema-additive only.** No writes; this PR only reads.
6. **No `DO NOT REMOVE` markers expected.**
7. **Strategic Principle 8.** Wire `shop_customers_viewed`
   and `shop_customer_tapped` per PR 38's expansion. Both
   events become live in `featureUsageLog/` once PR 38 also
   ships; the wiring lives here regardless.
8. **Privacy.** A shop owner sees ONLY their own customers
   (server-side gated by `shopId` claim). Customer phone +
   name are already visible to the shop in order detail
   screens, so re-exposing them in the CRM aggregator does
   not change the privacy surface.

## Scope (in)

### Part 1 — Pure helpers in `functions/src/customerCrmHelpers.ts`

```ts
/**
 * PR 36 — pure aggregator. Given a flat list of order docs for
 * one shop, group by customer (`userId` field) and roll up:
 * orderCount, totalSpent, firstOrderAt, lastOrderAt.
 * Returns sorted/filtered slices per the requested view.
 *
 * Tested in isolation; the callable wires it together.
 */

export type ShopOrderRaw = {
  id: string;
  userId?: string;
  total?: number;
  status?: string;
  createdAt?: number; // epoch ms
  address?: {
    name?: string;
    phone?: string;
  };
};

export type ShopCustomer = {
  uid: string;
  phone: string | null;
  displayName: string | null;
  orderCount: number;
  totalSpent: number; // in rupees (matches order.total)
  firstOrderAt: number; // epoch ms
  lastOrderAt: number; // epoch ms
};

export type ShopCustomersView =
  | { sortBy: 'top_revenue'; limit?: number }
  | { sortBy: 'recent'; limit?: number }
  | { sortBy: 'stopped'; minDaysSinceLastOrder?: number; limit?: number };

export function aggregateShopCustomers(
  orders: ShopOrderRaw[],
): ShopCustomer[] {
  const byUid = new Map<string, ShopCustomer>();

  for (const o of orders) {
    if (!o.userId || typeof o.userId !== 'string') continue;
    // Don't double-count cancelled orders against revenue, but
    // do count them as evidence of customer activity.
    const isRevenue =
      o.status !== 'cancelled' && o.status !== 'refunded';
    const total = isRevenue && typeof o.total === 'number' ? o.total : 0;
    const ts = typeof o.createdAt === 'number' ? o.createdAt : 0;
    if (ts === 0) continue;

    const existing = byUid.get(o.userId);
    if (!existing) {
      byUid.set(o.userId, {
        uid: o.userId,
        phone: o.address?.phone?.trim() ?? null,
        displayName: o.address?.name?.trim() || null,
        orderCount: 1,
        totalSpent: total,
        firstOrderAt: ts,
        lastOrderAt: ts,
      });
    } else {
      existing.orderCount += 1;
      existing.totalSpent += total;
      if (ts < existing.firstOrderAt) existing.firstOrderAt = ts;
      if (ts > existing.lastOrderAt) existing.lastOrderAt = ts;
      // Phone/name comes from the most recent order with non-empty
      // values (customer may have changed delivery address between
      // orders; latest is the most useful for the shop to call).
      if (ts === existing.lastOrderAt) {
        if (o.address?.phone) existing.phone = o.address.phone.trim();
        if (o.address?.name) existing.displayName = o.address.name.trim();
      }
    }
  }

  return Array.from(byUid.values());
}

export function viewShopCustomers(
  customers: ShopCustomer[],
  view: ShopCustomersView,
  nowMs: number,
): ShopCustomer[] {
  const limit = 'limit' in view && view.limit ? view.limit : 50;

  if (view.sortBy === 'top_revenue') {
    return [...customers]
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, limit);
  }
  if (view.sortBy === 'recent') {
    return [...customers]
      .sort((a, b) => b.lastOrderAt - a.lastOrderAt)
      .slice(0, limit);
  }
  // stopped: customers whose lastOrderAt is older than N days
  // (default 30), sorted by lastOrderAt descending (most recent
  // among the lapsed first — they're easiest to win back).
  const minDays =
    view.minDaysSinceLastOrder ?? 30;
  const cutoff = nowMs - minDays * 86_400_000;
  return customers
    .filter(c => c.lastOrderAt < cutoff)
    .sort((a, b) => b.lastOrderAt - a.lastOrderAt)
    .slice(0, limit);
}
```

### Part 2 — Callable `listShopCustomers`

In `functions/src/index.ts`, near `listShopOrders`:

```ts
import {
  aggregateShopCustomers,
  viewShopCustomers,
  type ShopCustomersView,
  type ShopOrderRaw,
} from './customerCrmHelpers';

export const listShopCustomers = onCall<{
  shopId?: string;
  sortBy: 'top_revenue' | 'recent' | 'stopped';
  period?: 'all' | '90d' | '180d';
  limit?: number;
  minDaysSinceLastOrder?: number; // only for sortBy='stopped'
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');

    // Reuse the same validation as listShopOrders.
    const result = validateShopOrdersAccess({
      claims: auth.token ?? {},
      requestedShopId: request.data?.shopId,
    });
    if (!result.ok) {
      throw new HttpsError(result.code, result.message);
    }
    const { targetShopId } = result;

    const { sortBy, period = '180d', limit = 50, minDaysSinceLastOrder } =
      request.data ?? ({} as any);
    if (!['top_revenue', 'recent', 'stopped'].includes(sortBy)) {
      throw new HttpsError(
        'invalid-argument',
        'sortBy must be one of: top_revenue, recent, stopped',
      );
    }

    // Period gate: pull orders within the period for aggregation.
    // Higher hard cap than listShopOrders (1000 vs 100) because
    // aggregation needs more history; bounded so a runaway shop
    // doesn't blow memory.
    let startedAtCutoff = 0;
    if (period === '90d') startedAtCutoff = Date.now() - 90 * 86_400_000;
    else if (period === '180d') startedAtCutoff = Date.now() - 180 * 86_400_000;

    let q = db
      .collection('orders')
      .where('shopId', '==', targetShopId)
      .orderBy('createdAt', 'desc')
      .limit(1000);
    // No additional `where('createdAt', '>=', cutoff)` —
    // composite index would need to exist. We grab the 1000
    // most recent and filter in memory; if a shop has >1000
    // orders in 180 days, we cap. Add a hint in the audit log.

    const snap = await q.get();
    const allOrders: ShopOrderRaw[] = snap.docs.map(d => {
      const data = d.data() as Record<string, any>;
      return {
        id: d.id,
        userId: data.userId,
        total: typeof data.total === 'number' ? data.total : undefined,
        status: data.status,
        createdAt: data.createdAt?.toMillis?.() ?? data.createdAt,
        address: data.address,
      };
    });

    const inPeriod =
      startedAtCutoff > 0
        ? allOrders.filter(o => (o.createdAt ?? 0) >= startedAtCutoff)
        : allOrders;

    const customers = aggregateShopCustomers(inPeriod);
    const view = viewShopCustomers(
      customers,
      { sortBy, limit, minDaysSinceLastOrder } as ShopCustomersView,
      Date.now(),
    );

    return {
      ok: true,
      customers: view,
      // Summary tile data for the screen header.
      totalUniqueCustomers: customers.length,
      totalRevenue: customers.reduce((sum, c) => sum + c.totalSpent, 0),
      ordersScanned: allOrders.length,
      ordersInPeriod: inPeriod.length,
      truncated: allOrders.length === 1000, // hint for the UI
    };
  },
);
```

### Part 3 — Client wrapper in `orderService.ts`

```ts
async listShopCustomers(args: {
  shopId?: string;
  sortBy: 'top_revenue' | 'recent' | 'stopped';
  period?: 'all' | '90d' | '180d';
  limit?: number;
  minDaysSinceLastOrder?: number;
}): Promise<{
  ok: true;
  customers: ShopCustomer[];
  totalUniqueCustomers: number;
  totalRevenue: number;
  ordersScanned: number;
  ordersInPeriod: number;
  truncated: boolean;
}> { /* same web/native dispatch as other wrappers */ },
```

### Part 4 — `ShopCustomer` type in `src/types/index.ts`

Export the same `ShopCustomer` shape as the server helper:

```ts
export type ShopCustomer = {
  uid: string;
  phone: string | null;
  displayName: string | null;
  orderCount: number;
  totalSpent: number;
  firstOrderAt: number;
  lastOrderAt: number;
};
```

### Part 5 — `ShopCustomersScreen`

New file: `src/screens/shop/ShopCustomersScreen.tsx`.

**Layout:**
- Header: "My customers" + back button.
- Top stats card (3 mini-tiles):
  - Total unique customers (`totalUniqueCustomers`)
  - Total revenue ₹ (period-aware)
  - Period selector pill ("90d" / "180d" / "All time" — default 180d)
- Tab strip: **Top by revenue** / **Recent** / **Stopped 30d+**
- Customer list (scrollable):
  - Each row: avatar circle (initial of displayName or "?"), name (or phone if no name), phone, "₹X across N orders", "Last order: X days ago" / "Last order: 45 days ago"
  - Tap row → expanded modal (or inline expand) with the full per-customer view: phone tap-to-call, full order history list, first-order date.
- Empty state: "No customers in this view yet" with a friendly explanation per tab.
- "Truncated" banner when `truncated === true`: "Showing the most recent 1000 orders. Older orders not included in this view."

**State pattern:**

```tsx
const [tab, setTab] = useState<'top_revenue' | 'recent' | 'stopped'>('top_revenue');
const [period, setPeriod] = useState<'90d' | '180d' | 'all'>('180d');
const [data, setData] = useState<{
  customers: ShopCustomer[];
  totalUniqueCustomers: number;
  totalRevenue: number;
  truncated: boolean;
} | null>(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
const [expandedUid, setExpandedUid] = useState<string | null>(null);
```

All `useState` above any conditional return.

**Refetch trigger:** any change to `tab` or `period`. Use a `useEffect` with cancellation guard (mirror PR 31.1's `kycUrls` fetch pattern).

**Analytics:**
```ts
useEffect(() => {
  if (!data) return;
  Analytics.shop_customers_viewed({
    shop_id: shopId ?? '',
    tab,
    period,
    customer_count: data.customers.length,
  });
}, [data, tab, period, shopId]);

const onCustomerTap = (c: ShopCustomer) => {
  Analytics.shop_customer_tapped({
    shop_id: shopId ?? '',
    customer_uid: c.uid,
  });
  setExpandedUid(c.uid === expandedUid ? null : c.uid);
};
```

(These are new events; add them to `analytics.ts` per Part 6.)

### Part 6 — Analytics events in `src/services/analytics.ts`

```ts
// PR 36 — Customer CRM for shop owner. The view event tracks
// which tab + period combination shop owners actually use,
// which is the signal for whether the CRM hook is daily-used
// (high view count) vs. a one-and-done curiosity (single view
// then drops off).
shop_customers_viewed: (params: {
  shop_id: string;
  tab: 'top_revenue' | 'recent' | 'stopped';
  period: '90d' | '180d' | 'all';
  customer_count: number;
}) => track('shop_customers_viewed', params),

shop_customer_tapped: (params: {
  shop_id: string;
  customer_uid: string;
}) => track('shop_customer_tapped', params),
```

### Part 7 — Wire the tile into `ShopOwnerDashboardScreen`

Add a new "👥 My customers" tile alongside the existing
shop-management tiles. Visual treatment matches the existing
tiles exactly.

Register the route in `src/navigation/AppNavigator.tsx`:

```tsx
<Stack.Screen
  name="ShopCustomers"
  component={ShopCustomersScreen}
/>
```

### Part 8 — Tests

`tests/functions/customerCrmHelpers.test.ts` — pure helper
tests:

```ts
import {
  aggregateShopCustomers,
  viewShopCustomers,
  type ShopOrderRaw,
} from '../../functions/src/customerCrmHelpers';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

describe('PR 36 — customerCrmHelpers', () => {
  test('aggregates orders by userId with correct totals', () => {
    const orders: ShopOrderRaw[] = [
      { id: '1', userId: 'u1', total: 100, status: 'delivered', createdAt: NOW - 10 * DAY, address: { name: 'Amit', phone: '+919876543210' } },
      { id: '2', userId: 'u1', total: 200, status: 'delivered', createdAt: NOW - 5 * DAY, address: { name: 'Amit', phone: '+919876543210' } },
      { id: '3', userId: 'u2', total: 50, status: 'delivered', createdAt: NOW - 8 * DAY, address: { name: 'Bharti', phone: '+919811111111' } },
    ];
    const customers = aggregateShopCustomers(orders);
    expect(customers).toHaveLength(2);
    const u1 = customers.find(c => c.uid === 'u1')!;
    expect(u1.orderCount).toBe(2);
    expect(u1.totalSpent).toBe(300);
    expect(u1.firstOrderAt).toBe(NOW - 10 * DAY);
    expect(u1.lastOrderAt).toBe(NOW - 5 * DAY);
    expect(u1.displayName).toBe('Amit');
    expect(u1.phone).toBe('+919876543210');
  });

  test('excludes cancelled/refunded orders from totalSpent but counts them in orderCount', () => {
    const orders: ShopOrderRaw[] = [
      { id: '1', userId: 'u1', total: 100, status: 'delivered', createdAt: NOW - 5 * DAY, address: {} },
      { id: '2', userId: 'u1', total: 200, status: 'cancelled', createdAt: NOW - 3 * DAY, address: {} },
    ];
    const customers = aggregateShopCustomers(orders);
    expect(customers[0].orderCount).toBe(2);
    expect(customers[0].totalSpent).toBe(100);
  });

  test('skips orders missing userId or createdAt', () => {
    const orders: ShopOrderRaw[] = [
      { id: '1', userId: 'u1', total: 100, status: 'delivered', createdAt: NOW, address: {} },
      { id: '2', total: 200, status: 'delivered', createdAt: NOW, address: {} } as any, // missing userId
      { id: '3', userId: 'u2', total: 50, status: 'delivered', address: {} } as any, // missing createdAt
    ];
    expect(aggregateShopCustomers(orders)).toHaveLength(1);
  });

  test('view top_revenue sorts by totalSpent descending and respects limit', () => {
    const customers = [
      { uid: 'a', totalSpent: 100, lastOrderAt: NOW, orderCount: 1, firstOrderAt: NOW, phone: null, displayName: null },
      { uid: 'b', totalSpent: 500, lastOrderAt: NOW, orderCount: 1, firstOrderAt: NOW, phone: null, displayName: null },
      { uid: 'c', totalSpent: 300, lastOrderAt: NOW, orderCount: 1, firstOrderAt: NOW, phone: null, displayName: null },
    ];
    const top2 = viewShopCustomers(customers, { sortBy: 'top_revenue', limit: 2 }, NOW);
    expect(top2.map(c => c.uid)).toEqual(['b', 'c']);
  });

  test('view recent sorts by lastOrderAt descending', () => {
    const customers = [
      { uid: 'a', totalSpent: 100, lastOrderAt: NOW - 10 * DAY, orderCount: 1, firstOrderAt: NOW, phone: null, displayName: null },
      { uid: 'b', totalSpent: 100, lastOrderAt: NOW - 1 * DAY, orderCount: 1, firstOrderAt: NOW, phone: null, displayName: null },
    ];
    const recent = viewShopCustomers(customers, { sortBy: 'recent' }, NOW);
    expect(recent.map(c => c.uid)).toEqual(['b', 'a']);
  });

  test('view stopped returns only customers whose lastOrderAt is older than minDays', () => {
    const customers = [
      { uid: 'a', totalSpent: 100, lastOrderAt: NOW - 60 * DAY, orderCount: 1, firstOrderAt: NOW, phone: null, displayName: null },
      { uid: 'b', totalSpent: 100, lastOrderAt: NOW - 10 * DAY, orderCount: 1, firstOrderAt: NOW, phone: null, displayName: null },
      { uid: 'c', totalSpent: 100, lastOrderAt: NOW - 40 * DAY, orderCount: 1, firstOrderAt: NOW, phone: null, displayName: null },
    ];
    const stopped = viewShopCustomers(customers, { sortBy: 'stopped', minDaysSinceLastOrder: 30 }, NOW);
    expect(stopped.map(c => c.uid)).toEqual(['c', 'a']); // most recent among the lapsed first
  });

  test('view stopped defaults minDays to 30', () => {
    const customers = [
      { uid: 'a', totalSpent: 100, lastOrderAt: NOW - 31 * DAY, orderCount: 1, firstOrderAt: NOW, phone: null, displayName: null },
    ];
    const stopped = viewShopCustomers(customers, { sortBy: 'stopped' }, NOW);
    expect(stopped).toHaveLength(1);
  });

  test('phone/displayName come from the most recent order with non-empty values', () => {
    const orders: ShopOrderRaw[] = [
      { id: '1', userId: 'u1', total: 100, status: 'delivered', createdAt: NOW - 10 * DAY, address: { phone: '+91old' } },
      { id: '2', userId: 'u1', total: 200, status: 'delivered', createdAt: NOW - 5 * DAY, address: { phone: '+91new', name: 'Amit' } },
    ];
    const customers = aggregateShopCustomers(orders);
    expect(customers[0].phone).toBe('+91new');
    expect(customers[0].displayName).toBe('Amit');
  });
});
```

### Part 9 — PRELAUNCH_CHECKLIST

Append a PR 36 entry. Key follow-ups to log:

- **Customer dedup across multiple uids** — same phone with two
  uids (e.g., reinstall edge case) shows as two customers. v1
  accepts this; future PR can merge by phone.
- **Sub-1k orders cap** — large shops (>1000 orders / 180d) get
  truncated data. Add aggregation Cloud Function with daily
  rollup if pilot shows this regularly.
- **Tap-to-call from the customer row** — add an explicit `tel:`
  link in the per-customer expand. Tiny UX add; not critical.
- **Tap-to-WhatsApp** — same idea, opens WhatsApp with the
  customer's phone. Useful for "we noticed you haven't ordered
  in a while" outreach. Phase B+ polish.
- **"Customer notes"** — shop owner adds a private note ("prefers
  fresh atta, avoids onions"). New `shops/{id}/customerNotes/{uid}`
  subcollection. Future PR.

## Scope (out)

- **Customer notes / tags / segments.** Future PR (the
  documented follow-up above).
- **Outbound messaging (WhatsApp / SMS) from this screen.**
  Future PR. v1 is read-only insight.
- **Cross-shop customer profile** ("this customer also shops
  at 3 other kirana"). Privacy + business-sense red flag;
  out of scope.
- **Per-customer revenue chart over time.** Nice to have;
  defer until pilot shows shop owners ask for it.
- **Customer reorder prediction** (auto-replenishment per
  customer). Phase C territory (PR 48).

## Acceptance checklist

- [ ] `functions/src/customerCrmHelpers.ts` — pure
  `aggregateShopCustomers` + `viewShopCustomers`.
- [ ] `listShopCustomers` callable — auth gated via
  `validateShopOrdersAccess` (same as `listShopOrders`),
  configurable `sortBy` + `period` + `limit`, returns
  customers + summary counters + `truncated` hint.
- [ ] `src/services/orderService.ts` — wrapper (web + native).
- [ ] `src/types/index.ts` — `ShopCustomer` type exported.
- [ ] `src/services/analytics.ts` — 2 new events.
- [ ] `src/screens/shop/ShopCustomersScreen.tsx` — 3 tabs +
  period selector + scrollable list + expand-on-tap. All
  `useState` above conditional returns.
- [ ] `src/screens/shop/ShopOwnerDashboardScreen.tsx` — new
  tile.
- [ ] `src/navigation/AppNavigator.tsx` — `ShopCustomers`
  route registered.
- [ ] `tests/functions/customerCrmHelpers.test.ts` — 8 tests,
  all pass.
- [ ] `npx tsc --noEmit` (root + functions): 0 errors.
- [ ] `npm test`: green.
- [ ] PRELAUNCH_CHECKLIST: PR 36 entry appended.

## Deliberate-break check

Before declaring done, temporarily change `aggregateShopCustomers`
to NOT exclude cancelled orders from `totalSpent`. Run
`npm test -- --testPathPattern="customerCrmHelpers"`. The
"excludes cancelled/refunded orders from totalSpent" test
must fail. Revert.

## Smoke tests (after server-first deploy + OTA)

1. Sign in as an approved shop owner with at least 5 past
   orders. Navigate to dashboard → tap "👥 My customers".
2. **Top by revenue** tab — sorted descending. Top customer
   matches your mental model (you know who your biggest
   buyer is).
3. **Recent** tab — sorted by most recent order. Top entry's
   "Last order: X days ago" matches your last order.
4. **Stopped 30d+** — empty for a freshly-launched shop;
   for an older shop, shows lapsed customers.
5. **Period switch** — 180d → 90d → all-time. Numbers
   change as expected.
6. **Tap a customer** — expanded view shows phone, full
   order count, total spent, first order date.
7. **Analytics fired** — check Firebase Analytics DebugView
   for `shop_customers_viewed` events on tab/period change.
   (And `featureUsageLog/` Firestore docs if PR 38 has
   already shipped.)
8. **Permission check** — try `orderService.listShopCustomers
   ({ shopId: '<some-other-shop-id>' })` from a console.
   Should throw `permission-denied`.

## Deploy plan

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm test
cd functions; npm run build; cd ..
firebase deploy --only functions:listShopCustomers
firebase functions:list | Select-String -Pattern "listShopCustomers"

git add functions/src/customerCrmHelpers.ts functions/src/index.ts
git add src/services/orderService.ts src/services/analytics.ts
git add src/types/index.ts
git add src/screens/shop/ShopCustomersScreen.tsx
git add src/screens/shop/ShopOwnerDashboardScreen.tsx
git add src/navigation/AppNavigator.tsx
git add tests/functions/customerCrmHelpers.test.ts
git add PRELAUNCH_CHECKLIST.md
git add docs/pr-36-customer-crm-for-shop-owner-windsurf-prompt.md
git commit -m "PR 36: Customer CRM for shop owner (Top customers / Recent / Stopped 30d+ tabs)"
git push origin main

eas update --branch production --message "PR 36 - Customer CRM"
```

## Estimated time

~1–1.5 days Windsurf work:

- Part 1 (pure helpers): 30 min
- Part 2 (callable): 45 min
- Part 3 (wrapper): 10 min
- Part 4 (types): 5 min
- Part 5 (`ShopCustomersScreen`): 3–4 hr
- Part 6 (analytics events): 10 min
- Part 7 (tile + route): 20 min
- Part 8 (tests): 45 min
- Part 9 (PRELAUNCH): 10 min
- Deliberate-break + final test: 15 min

## Why this PR matters

A shop owner who opens the app only when an order arrives
forgets about the platform. PR 36 gives them a reason to open
the app on zero-order days: to check who their best customer
was last week, who they haven't seen in a month, who's worth a
quick personal call ("haven't seen you, everything okay?").

That single behavior — *opening the app even when the order
queue is empty* — is the measurable signal that the platform
is becoming part of the merchant's daily routine. PR 38's
admin dashboard surfaces this as `shop_customers_viewed`
weekly active rate. **If that number is healthy after 30 days
of pilot, the merchant retention thesis is validated. If not,
something fundamental about the CRM design is wrong.**

The follow-up retention features (Udhaar ledger PR 37,
auto-replenishment PR 48, subscription PR 62) layer on top of
this base. PR 36 doesn't have to be the killer feature on its
own — it has to be the daily-use hook that earns the right to
build the next one.
