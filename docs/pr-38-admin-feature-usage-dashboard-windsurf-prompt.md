# PR 38 — Admin feature-usage dashboard + analytics expansion (Windsurf prompt)

## Why this PR exists

PR 32 and PR 34 codified **Strategic Principle 8** in
`docs/ROADMAP.md`: every feature PR adds Analytics calls for
its main user actions. Both shipped with their analytics events
wired (`scan_menu_*`, `voice_onboarding_*`). The **customer
side** of the app has been instrumented since pre-PR-32
(`view_shop_list`, `add_to_cart`, `begin_checkout`,
`place_order`, etc.).

**But every other surface has zero analytics today:**

- Shop owner core actions: adding/editing/disabling menu
  items, accepting orders, setting ETAs, updating settings —
  no events.
- Delivery partner actions: going online/offline, accepting
  pickups, marking delivered — no events.
- Admin actions: approving/rejecting shops, suspending shops,
  promoting users — no events.

This means the question "did anyone use feature X" gets
answered with vibes today. Once pilot starts and decisions
need to be made about what to keep / what to kill, vibes
aren't enough.

**PR 38 does three things in one shipment:**

1. **Expand `src/services/analytics.ts`** to cover the shop
   owner / delivery partner / admin event surface, and wire
   the new events into the right call sites.
2. **Parallel-write each event to a new `featureUsageLog/`
   Firestore collection** alongside the existing Firebase
   Analytics call. Reason: Firebase Analytics has sampling +
   24–48hr latency + no easy per-user/per-shop queries.
   `featureUsageLog/` gives exact counts queryable by role,
   shop, feature, date range — the data the admin dashboard
   needs.
3. **Build `AdminUsageScreen`** — accessible from the admin
   tile group on HomeScreen — that aggregates 7-day / 30-day
   usage breakdowns sorted by most-used descending, with
   role and per-shop drilldowns.

After this PR ships, the pilot answers usage questions with
queries, not guesses. **This is pilot-critical** per Mission
North Star Strategic Principle 7: time-to-first-menu-item,
merchant weekly active, customer repeat-order — all three are
data the pilot needs from day 1, and PR 38 is the substrate.

~2 days Windsurf work. Client-only (no server callables; the
Firestore write is direct from client with rules enforcement).
No new SDKs, no new secrets, no native rebuild — OTA-only.

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md`.
  - **Especially the new "OTA vs `eas build`" section** added
    during PR 34 — verify PR 38 is OTA-eligible (no plugin
    changes, no permission changes, no native deps). It is.
- `docs/ROADMAP.md` Strategic Principles 7 + 8. The whole PR
  exists to honor Principle 8.
- `src/services/analytics.ts` — the existing wrapper.
  Customer-side events are lines 16–36. PR 32 added lines
  37–64. PR 34 added 65–101. PR 38 extends this same surface.
- `src/screens/HomeScreen.tsx` lines 423–479 — the admin
  tile group (`AdminOrders`, `PendingShops`, `UserManagement`,
  `ShopManagement`, `AuditLog`). PR 38 adds a new tile
  ("Feature Usage" or similar) right next to these.
- `firestore.rules` — the existing `auditLog/{entryId}` rule
  (line 218) is the closest precedent. PR 38 adds a sibling
  `featureUsageLog/{eventId}` rule.
- `src/screens/admin/AuditLogScreen.tsx` — the closest UX
  precedent for "scrollable list of recent admin/system
  events." `AdminUsageScreen` is similar in structure but
  shows aggregated counts, not individual events.
- `src/services/firebase.ts` — for the Firestore client
  handle. PR 38's write helper uses it.

## Critical lessons from PRs 25–34 (do not repeat)

1. **OTA-eligible. No native build needed.** Per the new
   `.windsurf/deploy-discipline.md` "OTA vs eas build"
   section: PR 38 adds no plugin, no permission, no native
   dep. `eas update --branch production` is sufficient.
2. **Never strip imports between edits.** Files touched:
   `analytics.ts` (extended), every shop/delivery/admin
   screen where new events fire, `AdminUsageScreen.tsx`
   (new), `HomeScreen.tsx` (one new tile), `orderService.ts`
   (one read wrapper), `firestore.rules` (one new block).
3. **All `useState` calls above conditional early returns.**
   `AdminUsageScreen` has multiple state hooks (period
   selector, loading, data, error). Stack them at the top.
4. **Schema-additive only.** New collection
   `featureUsageLog/` is net-new. Won't break anything
   existing. The Firebase Analytics calls continue to fire
   unchanged — PR 38's Firestore write happens *alongside*,
   not *instead of*.
5. **Strategic Principle 8 is self-honoring for PR 38.** The
   dashboard reads from the same `featureUsageLog/`
   collection it builds the writes for. Don't recurse —
   PR 38 itself does NOT need to log "user opened
   AdminUsageScreen" (well, it can, but that's a one-line
   addition; don't over-engineer).
6. **No `DO NOT REMOVE` markers expected** — no new
   long-lived imports at risk.
7. **`firestore.rules` change → run `npm run test:rules`** at
   acceptance time. Per `.windsurf/test-discipline.md`.

## Scope (in)

### Part 1 — Extend `analytics.ts` with the missing event surface

In `src/services/analytics.ts`, add the following event
families to the `Analytics` object. Mirror the JSDoc style of
the PR 32 + PR 34 blocks.

```ts
// PR 38 — Shop owner core actions. The events that determine
// whether a shop owner is using the platform on a typical
// non-AI day. Mission North Star Strategic Principle 7's
// "merchant weekly active" metric is computed from these
// firing or not firing.
shop_menu_item_added: (params: {
  shop_id: string;
  source: 'custom' | 'extracted' | 'bootstrap';
}) => track('shop_menu_item_added', params),

shop_menu_item_edited: (params: {
  shop_id: string;
  field_changed: 'price' | 'mrp' | 'stock' | 'available' | 'name' | 'image' | 'other';
}) => track('shop_menu_item_edited', params),

shop_menu_item_disabled: (params: { shop_id: string }) =>
  track('shop_menu_item_disabled', params),

shop_menu_bulk_toggle: (params: {
  shop_id: string;
  count: number;
  action: 'enable' | 'disable';
}) => track('shop_menu_bulk_toggle', params),

shop_order_accepted: (params: {
  shop_id: string;
  order_id: string;
  minutes_to_accept: number; // time from order placed to accepted
}) => track('shop_order_accepted', params),

shop_order_status_changed: (params: {
  shop_id: string;
  order_id: string;
  from_status: string;
  to_status: string;
}) => track('shop_order_status_changed', params),

shop_eta_set: (params: {
  shop_id: string;
  order_id: string;
  eta_minutes: number;
}) => track('shop_eta_set', params),

shop_settings_updated: (params: {
  shop_id: string;
  field: 'delivery_fee' | 'min_order' | 'hours' | 'description' | 'image' | 'other';
}) => track('shop_settings_updated', params),

shop_signed_in: (params: { shop_id: string }) =>
  track('shop_signed_in', params),

// PR 38 — Delivery partner actions.
delivery_online_toggled: (params: { is_online: boolean }) =>
  track('delivery_online_toggled', params),

delivery_pickup_accepted: (params: {
  order_id: string;
  shop_id: string;
}) => track('delivery_pickup_accepted', params),

delivery_picked_up: (params: { order_id: string }) =>
  track('delivery_picked_up', params),

delivery_delivered: (params: {
  order_id: string;
  minutes_since_pickup: number;
}) => track('delivery_delivered', params),

delivery_signed_in: () => track('delivery_signed_in', {}),

// PR 38 — Admin actions.
admin_shop_approved: (params: { shop_id: string }) =>
  track('admin_shop_approved', params),

admin_shop_rejected: (params: { shop_id: string; reason_length: number }) =>
  track('admin_shop_rejected', params),

admin_shop_suspended: (params: { shop_id: string }) =>
  track('admin_shop_suspended', params),

admin_shop_unsuspended: (params: { shop_id: string }) =>
  track('admin_shop_unsuspended', params),

admin_delivery_approved: (params: { uid: string }) =>
  track('admin_delivery_approved', params),

admin_delivery_rejected: (params: { uid: string }) =>
  track('admin_delivery_rejected', params),

admin_user_role_set: (params: {
  uid: string;
  role: 'admin' | 'shop_owner' | 'delivery';
}) => track('admin_user_role_set', params),

admin_signed_in: () => track('admin_signed_in', {}),
```

### Part 2 — Add Firestore parallel-write to `featureUsageLog/`

The Firebase Analytics call already happens in `track()` at the
top of the file. Add a sibling write that also logs to
Firestore for queryable per-user / per-shop counts.

Modify `track()` in `src/services/analytics.ts`:

```ts
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase'; // assume db is exported; if not, add the export

import { logEvent as fbLogEvent } from 'firebase/analytics';
import { analytics } from './firebase';
import { useAuthStore } from '../store/useAuthStore';

type EventParams = Record<string, string | number | boolean | undefined>;

// PR 38 — Resolve the current user's role for the Firestore
// log entry. Reads the auth store's snapshot synchronously;
// fires on each event without an extra round-trip.
function currentRole(): 'customer' | 'shop_owner' | 'delivery' | 'admin' | 'anonymous' {
  const s = useAuthStore.getState();
  if (s.isAdmin) return 'admin';
  if (s.isShopOwner) return 'shop_owner';
  if (s.isDelivery) return 'delivery';
  if (s.isAnonymous) return 'anonymous';
  return 'customer';
}

function track(name: string, params: EventParams) {
  // Firebase Analytics (unchanged — keep firing).
  if (analytics) {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined),
    ) as Record<string, string | number | boolean>;
    fbLogEvent(analytics, name, clean as Record<string, string | number>);
  }

  // PR 38 — Firestore parallel write. Fire-and-forget; failure
  // (offline, rules reject) is non-fatal and silent. This is
  // observability data, not a transactional record.
  void writeFeatureUsageLog(name, params);
}

async function writeFeatureUsageLog(
  name: string,
  params: EventParams,
): Promise<void> {
  try {
    const s = useAuthStore.getState();
    const uid = s.uid;
    if (!uid) return; // anonymous + unauthenticated events skip the log
    const role = currentRole();
    // YYYY-MM-DD in the device's local time. Used by the
    // admin dashboard for date-range filtering without
    // a full timestamp scan.
    const date = new Date().toISOString().slice(0, 10);
    const docData: Record<string, unknown> = {
      uid,
      role,
      feature: name,
      date,
      timestamp: serverTimestamp(),
    };
    // Pull shop_id into a top-level field when present so
    // queries can filter on it without param-shape variance.
    if (typeof params.shop_id === 'string') {
      docData.shopId = params.shop_id;
    }
    await addDoc(collection(db, 'featureUsageLog'), docData);
  } catch (e) {
    // Silent — observability writes never block UX.
    // eslint-disable-next-line no-console
    console.warn('[analytics] featureUsageLog write failed:', e);
  }
}
```

### Part 3 — Firestore rules for `featureUsageLog/`

In `firestore.rules`, add a new match block, sibling to
`auditLog/{entryId}`:

```
// PR 38 — Feature usage log. Every analytics event writes a
// document here in parallel with the Firebase Analytics call.
// Writes are append-only and authenticated. Reads are
// admin-only — usage data is operational, not user-visible.
match /featureUsageLog/{eventId} {
  // Append-only: authenticated users can create, but never
  // update or delete (history integrity).
  allow create: if request.auth != null
                && request.resource.data.uid == request.auth.uid;
  allow update, delete: if false;
  // Admin-only read for the dashboard.
  allow read: if request.auth != null
              && request.auth.token.admin == true;
}
```

Note: the `request.resource.data.uid == request.auth.uid`
clause ensures clients can't forge events as another user.
Combined with the `void writeFeatureUsageLog` write being
non-blocking, this is the safest write posture.

### Part 4 — Composite Firestore indexes

In `firestore.indexes.json`, add the composite indexes the
dashboard queries need:

```json
{
  "collectionGroup": "featureUsageLog",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "date", "order": "DESCENDING" },
    { "fieldPath": "feature", "order": "ASCENDING" }
  ]
}
```

```json
{
  "collectionGroup": "featureUsageLog",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "date", "order": "DESCENDING" },
    { "fieldPath": "role", "order": "ASCENDING" }
  ]
}
```

```json
{
  "collectionGroup": "featureUsageLog",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "shopId", "order": "ASCENDING" },
    { "fieldPath": "date", "order": "DESCENDING" }
  ]
}
```

These three cover the dashboard's main queries: feature totals,
role breakdown, per-shop activity. If `npm run audit:indexes`
exists and flags missing indexes for the queries, regenerate
the file via whichever script the existing precedent uses.

### Part 5 — Wire analytics events into existing screens

This is the bulk of the work. For each event added in Part 1,
add the `Analytics.event_name(...)` call at the natural
moment in the existing screen.

**Shop side** (`src/screens/shop/`):
- `ShopMenuScreen` / `AddCustomMenuItemScreen` / `ShopMenuItemEditScreen`:
  - On successful `addCustomMenuItem` callable response:
    `Analytics.shop_menu_item_added({ shop_id, source: 'custom' })`
  - On successful `updateMenuItem`:
    `Analytics.shop_menu_item_edited({ shop_id, field_changed })`
  - On `removeMenuItem` (which the codebase does as soft-disable
    in some paths):
    `Analytics.shop_menu_item_disabled({ shop_id })`
  - On bulk toggle (PR 8):
    `Analytics.shop_menu_bulk_toggle({ shop_id, count, action })`
- `ShopOwnerDashboardScreen` / `ShopOrderDetailScreen`:
  - On Accept tap → server confirms: `Analytics.shop_order_accepted({ shop_id, order_id, minutes_to_accept })`
  - On status change (preparing → ready, ready → picked_up
    if shop initiates, etc.):
    `Analytics.shop_order_status_changed({ shop_id, order_id, from_status, to_status })`
  - On ETA set (PR 12):
    `Analytics.shop_eta_set({ shop_id, order_id, eta_minutes })`
- `ShopSettingsScreen`:
  - On Save:
    `Analytics.shop_settings_updated({ shop_id, field })`
- `AuthBootstrap` or wherever the role-detect fires post-sign-in:
  - When role resolves as shopOwner: `Analytics.shop_signed_in({ shop_id })`

**Delivery side** (`src/screens/delivery/`):
- `DeliveryDashboardScreen`:
  - Online toggle: `Analytics.delivery_online_toggled({ is_online })`
- `DeliveryOrderDetailScreen`:
  - On Accept Pickup → server confirms:
    `Analytics.delivery_pickup_accepted({ order_id, shop_id })`
  - On "Picked up" tap:
    `Analytics.delivery_picked_up({ order_id })`
  - On "Delivered" tap:
    `Analytics.delivery_delivered({ order_id, minutes_since_pickup })`
- Role-detect: `Analytics.delivery_signed_in()`

**Admin side** (`src/screens/admin/`):
- `ShopRegistrationDetailScreen`:
  - On Approve confirm + server success:
    `Analytics.admin_shop_approved({ shop_id })`
  - On Reject confirm + server success:
    `Analytics.admin_shop_rejected({ shop_id, reason_length })`
- `ShopDetailManagementScreen`:
  - On Suspend confirm:
    `Analytics.admin_shop_suspended({ shop_id })`
  - On Unsuspend:
    `Analytics.admin_shop_unsuspended({ shop_id })`
- `DeliveryRequestDetailScreen` (mirror pattern):
  - `admin_delivery_approved` / `admin_delivery_rejected`
- `UserDetailScreen` / role-set actions:
  - On role-set success:
    `Analytics.admin_user_role_set({ uid, role })`
- Role-detect: `Analytics.admin_signed_in()`

**Important:** each event call goes AFTER the server callable's
success response, not before the call. Don't log "user did X"
when X actually failed.

### Part 6 — The `AdminUsageScreen`

New file: `src/screens/admin/AdminUsageScreen.tsx`.

**UX:**
- Header: "Feature usage" + back button.
- Top: period selector ("Last 7 days" / "Last 30 days") —
  default 7.
- Loading state while query runs.
- Three sections, top to bottom:

**Section A — Summary tiles** (4 stat cards in a 2×2 grid):
- Total events (count of all `featureUsageLog/` docs in period)
- Unique users (distinct `uid` count in period)
- Unique shops (distinct `shopId` count in period)
- Top feature (the single feature name with highest count + its
  count)

**Section B — Breakdown by feature** (table or list):
- Each row: feature name, count, % of total, mini progress bar.
- Sorted by count descending.
- Defaults to top 20; "Show all" expands.

**Section C — Breakdown by role** (small pie or horizontal
bars):
- Customer / shop_owner / delivery / admin / anonymous —
  count per role.
- Useful sanity check: if shop_owner events are tiny relative to
  customer events, the merchant retention hooks aren't working.

**(Optional Section D — Per-shop activity)** — defer to follow-up
if the screen is getting long. The Firestore queries are
ready for it; the UI can come later.

**Queries:**
- One big query: `where('date', '>=', startDate)` — fetches all
  docs in period (capped at a `limit` of e.g. 10k for the v1;
  if pilot scale exceeds this, paginate or pre-aggregate in
  Cloud Functions — out of scope for PR 38).
- Aggregate client-side (sufficient at pilot scale).

**Implementation skeleton:**

```tsx
const [period, setPeriod] = useState<'7d' | '30d'>('7d');
const [events, setEvents] = useState<FeatureUsageEvent[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);

useEffect(() => {
  if (!isAdmin) {
    setLoading(false);
    return;
  }
  let cancelled = false;
  setLoading(true);
  setError(null);

  const days = period === '7d' ? 7 : 30;
  const startDate = new Date(Date.now() - days * 86_400_000)
    .toISOString().slice(0, 10);

  const q = query(
    collection(db, 'featureUsageLog'),
    where('date', '>=', startDate),
    orderBy('date', 'desc'),
    limit(10_000),
  );
  getDocs(q)
    .then(snap => {
      if (cancelled) return;
      const list: FeatureUsageEvent[] = snap.docs.map(d => d.data() as any);
      setEvents(list);
    })
    .catch(e => {
      if (cancelled) return;
      setError(e?.message ?? 'Failed to load usage data');
    })
    .finally(() => {
      if (!cancelled) setLoading(false);
    });

  return () => { cancelled = true; };
}, [isAdmin, period]);
```

Aggregation: pure functions over `events[]` — `topFeatures(events)`,
`byRole(events)`, `uniqueUsers(events)`, `uniqueShops(events)`.
Extract these to a sibling pure helper file
`src/screens/admin/adminUsageHelpers.ts` so they're unit-testable
without rendering React.

### Part 7 — Wire the new screen into navigation + the admin tile group

In `src/navigation/AppNavigator.tsx`, register the new
`AdminUsage` route alongside the other admin screens.

In `src/screens/HomeScreen.tsx`, add a new tile to the admin
section (alongside the existing `AdminOrders`, `PendingShops`,
`UserManagement`, `ShopManagement`, `AuditLog` tiles):

```tsx
<Pressable onPress={() => nav.navigate('AdminUsage')} style={styles.adminTile}>
  <Text style={styles.adminTileEmoji}>📊</Text>
  <Text style={styles.adminTileTitle}>Feature Usage</Text>
  <Text style={styles.adminTileSubtitle}>What's getting used</Text>
</Pressable>
```

Match the visual treatment of the existing tiles exactly —
same component shape, same styling.

### Part 8 — Tests

Create `tests/screens/admin/adminUsageHelpers.test.ts` (or
wherever the existing project convention puts screen-helper
tests). Mirror the pattern of PR 32's
`menuExtractionHelpers.test.ts`.

Tests to write (~6–8 cases):

1. `topFeatures` returns features sorted by count descending.
2. `topFeatures` respects the limit param (top 20 default,
   "show all" returns everything).
3. `byRole` returns counts per role with zero-counts omitted.
4. `uniqueUsers` deduplicates by uid.
5. `uniqueShops` deduplicates by shopId; events without
   shopId are excluded.
6. `topFeatures` handles empty event array (returns []).
7. Counts respect date boundaries (events with `date` before
   the cutoff are not included — assumes the query already
   filtered, but defensive coverage anyway).
8. A specific event shape doesn't crash the aggregator
   (defensive against future event-schema drift).

Plus update `tests/rules/` with a small test that:
- A non-admin user CAN create a `featureUsageLog/{eventId}` with their own uid.
- A non-admin user CANNOT create with a different uid (forgery).
- A non-admin user CANNOT update or delete.
- A non-admin user CANNOT read.
- An admin user CAN read.

(If the rules test surface in this repo is the
`tests/rules/firestore.test.ts` shape established by earlier
PRs, add the cases there. Otherwise mirror that pattern in a
new file.)

### Part 9 — PRELAUNCH_CHECKLIST update

In `PRELAUNCH_CHECKLIST.md`, find or add a section for
observability tools, append a PR 38 entry:

```
- [x] **Admin feature-usage dashboard** — [Shipped — PR 38].
      `featureUsageLog/` Firestore collection logs every
      analytics event in parallel with Firebase Analytics for
      queryable per-user / per-shop / per-feature counts.
      AdminUsageScreen reachable from HomeScreen admin tile
      group. 7-day / 30-day breakdowns. Pilot blocker resolved:
      Mission North Star Strategic Principle 7's metrics
      (time-to-first-menu-item, merchant weekly active,
      customer repeat-order) are now queryable from day 1 of
      pilot.
```

Follow-ups to log:

- **Per-shop activity drilldown** (deferred to PR 38.1 if
  pilot needs it) — Section D in the AdminUsageScreen design.
- **Aggregated counters via Cloud Function** — if pilot scale
  exceeds 10k events/day per period, move from client-side
  aggregation to a server-side scheduled function that
  pre-computes daily counters. Out of scope at pilot scale.
- **Funnel views** — e.g. "of N shops who started scan_menu,
  M completed scan_menu_committed." Useful for diagnosing
  drop-off. Future PR.
- **Export to CSV** — admin reports + exports is already on
  the roadmap as PR 56; this PR's data is one of the inputs
  there.
- **PII review** — `featureUsageLog/` deliberately stores
  only uid, shopId, feature name, role, date. Params like
  product_id are stored only if they're already non-PII
  identifiers. Worth a pre-launch audit to confirm no PII
  leaks via the params field.

## Scope (out)

- **Server-side aggregated counters / hourly rollups.** Client-
  side aggregation over 10k events/period is fine at pilot
  scale. Revisit at 50k+ events/day.
- **Funnel / conversion views.** PR 38 ships totals and
  breakdowns; funnel analysis comes later.
- **Export to CSV / external dashboards.** PR 56 (Admin
  reports + exports) is the right home for this.
- **Real-time updates** (live counter ticking up). The
  dashboard fetches on mount + period-change; no
  `onSnapshot` subscription. Refresh by re-navigating.
- **Per-shop drilldown UX.** Deferred to PR 38.1 if needed
  during pilot.
- **Cost dashboard rollup for `aiAuditLog/`.** Different
  collection, different purpose. Out of scope here; future
  PR can layer cost views on the same UI shell.
- **Audit-log-style "who did what when" individual event
  list.** That's what `AuditLogScreen` already does for
  admin-relevant actions. `AdminUsageScreen` is for
  aggregated patterns, not individual incidents.
- **Customer-facing usage stats.** Out of scope; this is
  internal observability only.

## Acceptance checklist

- [ ] `src/services/analytics.ts` — extended with the ~20
  new event signatures (shop / delivery / admin); the
  `track()` function does Firestore parallel-write via the
  new `writeFeatureUsageLog` helper.
- [ ] Firestore parallel-write is fire-and-forget; failure
  never throws to the caller (verified by reading the
  try/catch).
- [ ] `firestore.rules` has the new
  `featureUsageLog/{eventId}` block: create-only with
  uid-match, no update/delete, admin-only read.
- [ ] `firestore.indexes.json` has the 3 composite indexes
  documented in Part 4.
- [ ] Every event in Part 1 is wired into at least one call
  site per Part 5. The wiring uses the existing
  `Analytics.event_name(...)` shape — no inline
  `track('event_name', ...)` calls outside the wrapper.
- [ ] `src/screens/admin/AdminUsageScreen.tsx` exists with the
  4 stat cards + by-feature list + by-role chart.
- [ ] `src/screens/admin/adminUsageHelpers.ts` exists with
  pure aggregation helpers.
- [ ] `tests/screens/admin/adminUsageHelpers.test.ts` (or
  equivalent location) has 6–8 tests.
- [ ] `tests/rules/` has new tests for the
  `featureUsageLog/{eventId}` rule shape.
- [ ] `src/navigation/AppNavigator.tsx` registers the
  `AdminUsage` route.
- [ ] `src/screens/HomeScreen.tsx` has the new "📊 Feature
  Usage" tile in the admin section.
- [ ] `npx tsc --noEmit` (root): 0 errors.
- [ ] `npm test`: green (+6–8 from new helper tests).
- [ ] `npm run test:rules`: green (rules suite passes
  including the new featureUsageLog cases).
- [ ] PRELAUNCH_CHECKLIST: PR 38 entry appended.
- [ ] **Zero new `DO NOT REMOVE` markers** (PR 38 doesn't add
  long-lived imports at risk).

## Deliberate-break check (per `.windsurf/test-discipline.md`)

Before declaring done, temporarily change the
`featureUsageLog/{eventId}` rule's `allow create` to:

```
allow create: if false;
```

Run `npm run test:rules -- --testPathPattern="featureUsageLog"`.
The "non-admin user can create with own uid" test must fail.
Revert.

## Smoke tests (after server-first deploy + OTA)

Note: server-first here means rules + indexes go first, then
OTA. No Cloud Function changes.

1. **Rules + indexes deploy** — `firebase deploy --only
   firestore:rules`, then `firebase deploy --only
   firestore:indexes`. New composite indexes will take ~30s–
   2min to build in the background; the dashboard will return
   empty results until they're ready (Firebase console shows
   "Building" → "Enabled").
2. **Fire some events** — as a customer, add to cart + place
   an order. As a shop owner, accept the order + set an ETA.
   As an admin, navigate to a few screens. Check Firestore
   console → `featureUsageLog/` for the new docs.
3. **Open AdminUsageScreen** — sign in as admin, Home →
   "📊 Feature Usage". Expect the stat tiles to populate, the
   by-feature list to show the events you just fired, the
   by-role section to show a customer + shop_owner + admin
   distribution.
4. **Period switch** — toggle 7d → 30d. The numbers should
   change (or stay if no events older than 7d exist).
5. **Non-admin reject** — as a non-admin account, try to
   query `featureUsageLog/` via the Firestore console (or via
   a debug screen). Rules should reject with permission-denied.
6. **Anonymous events don't write** — without signing in, open
   the customer flow (browse shops, etc.). The events fire to
   Firebase Analytics but should NOT create
   `featureUsageLog/` docs (the `writeFeatureUsageLog` helper
   short-circuits when `uid` is null).
7. **Sentry quiet** — failed Firestore writes should
   console.warn but not Sentry-capture; Sentry dashboard
   should be flat during the test session.
8. **Existing analytics unchanged** — verify Firebase
   Analytics DebugView still shows the existing customer +
   PR 32 + PR 34 events firing alongside the new ones.
   PR 38 is additive; nothing should have been removed.

## Deploy plan

Rules + indexes first, then client OTA. No Cloud Functions
changes; no native rebuild needed.

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Full test suite (rules suite included because firestore.rules
#    changed).
npm run test:full

# 2. Deploy Firestore rules FIRST.
firebase deploy --only firestore:rules
firebase firestore:rules:get | Select-String -Pattern "featureUsageLog"

# 3. Deploy Firestore indexes.
firebase deploy --only firestore:indexes
# Indexes take 30s–2min to build; verify in Firebase Console
# under Firestore → Indexes.

# 4. Commit + push.
git add src/services/analytics.ts
git add src/screens/admin/AdminUsageScreen.tsx
git add src/screens/admin/adminUsageHelpers.ts
git add src/screens/HomeScreen.tsx
git add src/navigation/AppNavigator.tsx
git add firestore.rules firestore.indexes.json
git add tests/screens/admin/adminUsageHelpers.test.ts
git add tests/rules/<the-rules-test-file>.test.ts
git add PRELAUNCH_CHECKLIST.md
git add docs/pr-38-admin-feature-usage-dashboard-windsurf-prompt.md
# Plus every screen file that got an Analytics call wired in:
git add src/screens/shop/ src/screens/delivery/ src/screens/admin/
# (review with git status first to make sure no unrelated edits got
#  pulled in)
git commit -m "PR 38: admin feature-usage dashboard + analytics expansion (shop/delivery/admin events + featureUsageLog Firestore collection)"
git push origin main

# 5. Client OTA.
eas update --branch production --message "PR 38 - admin feature-usage dashboard"
```

OTA-eligible. No native build needed. No new EAS secrets.

## Estimated time

~2 days Windsurf work:

- Part 1 (analytics.ts new event signatures): 30 min
- Part 2 (Firestore parallel-write in track()): 30 min
- Part 3 (firestore.rules new block): 15 min
- Part 4 (composite indexes): 10 min
- Part 5 (wire events into all the screens — biggest chunk): 4–5 hr
- Part 6 (AdminUsageScreen + helpers): 2–3 hr
- Part 7 (HomeScreen tile + AppNavigator route): 20 min
- Part 8 (tests, ~8 helper + ~5 rules): 1 hr
- Part 9 (PRELAUNCH_CHECKLIST): 10 min
- Deliberate-break + final test run: 20 min

## Why this PR matters

You cannot run a pilot you can't measure. The pre-PR-38 state
gives Firebase Analytics events for the customer side, gives
nothing for the shop / delivery / admin sides, and gives
nothing queryable for "did THIS shop use feature X this week."
That state cannot answer the questions the pilot exists to
answer.

After PR 38:

- **Mission North Star Strategic Principle 7's three pilot
  metrics are computable from the dashboard.** Time-to-first-
  menu-item = time between `shop_signed_in` and the first
  `shop_menu_item_added` per shop. Merchant weekly active =
  count of distinct shopIds firing any shop_* event in the
  last 7 days. Customer repeat-order rate = count of distinct
  customer uids with ≥2 `place_order` events in 30 days.
  Every one of these is a query against the new collection.
- **Strategic Principle 8 (instrumentation discipline) is
  fully honored project-wide.** Customer side has been
  instrumented since pre-PR-32; PR 32 + PR 34 added their own;
  PR 38 closes the gap for everything else. From now on,
  every new feature PR's "wire Analytics.*" step is
  unambiguous — the events are there, the dashboard reads
  them, the discipline doc requires the wiring.
- **Pilot decisions get data-grounded.** If after 3 weeks of
  pilot, the dashboard shows merchant CRM (PR 36, post-PR-38)
  with 5% weekly active, you know to kill it or rework it.
  If it shows 65% weekly active, you double down on it. Same
  for Udhaar, scan_menu, voice_onboarding — every retention
  hypothesis becomes a query.

PR 38 also unlocks **AI-cost observability** as a free
secondary benefit. `aiAuditLog/` (from PR 32 + PR 34) already
records per-call cost; adding a small aggregation card to
AdminUsageScreen ("AI spend last 7 days: ₹X") is a future
follow-up that costs ~30 minutes of work because the data is
already there.

Most importantly: this is the last pilot-blocking observability
PR. After PR 38, the remaining pilot-critical PRs (36, 37) are
all retention features. PR 38 turns them from "we'll ship and
hope" into "we'll ship and measure."
