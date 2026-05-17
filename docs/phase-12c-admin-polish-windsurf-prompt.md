# Phase 12c — Admin polish (Windsurf prompt)

## Why this PR exists

The original Phase 12 plan ended at 12c — admin polish. With 12a (shop
owner + multi-role foundation), 12a-v2-i through v2-iv (registration,
governance, menu mgmt, profile+addresses), 12b (delivery panel), and
the various hotfixes all shipped, 12c is the last functional phase
before testing-and-cleanup mode.

Three self-contained admin enhancements that make admin work less
tedious at real volume. None block family testing — admin screens
aren't on the customer/owner/delivery happy path. JS-only changes
ship as OTA; one optional small Cloud Function.

## Read first

- **`.windsurf/test-discipline.md`** — tests run **once at end** +
  deliberate-break demo. `npm test` is the runner.
- `src/screens/admin/AdminOrdersScreen.tsx` — stats card target
- `src/screens/admin/PendingShopsScreen.tsx` — registration review
  enhancements target
- `src/screens/admin/ShopRegistrationDetailScreen.tsx` — same
- `src/screens/admin/UserManagementScreen.tsx` — filter / search
  target
- `src/screens/shop/ShopOwnerDashboardScreen.tsx` — reference for
  stats card UI pattern (today count / revenue / pending)
- `src/services/orderService.ts` — `watchAllOrders`, `listAllUsers`
  already exist; we'll add one small callable

## Scope (in)

### A. AdminOrdersScreen — stats card

Add a stats card at the top of `AdminOrdersScreen` matching the
visual pattern of `ShopOwnerDashboardScreen`'s "Today" card. Three
stats:

1. **Today's GMV** — sum of `order.total` for orders where
   `isToday(order.createdAt) && order.status !== 'cancelled'`.
   Format with `formatRupees`.
2. **Active orders** — count of orders where `status` is in
   `['pending', 'accepted', 'preparing', 'out_for_delivery']`.
3. **Online delivery partners** — count from a new Cloud Function
   (see §D below).

All three computed from already-polled data + the new callable.
No new polling cadence — stats refresh whenever
`watchAllOrders` ticks (every 10s) and whenever the partner-count
callable polls (15s, separate hook).

Extract the stats computation into a testable pure helper
`computeAdminOrderStats(orders: Order[], now: number)` →
`{ gmvToday: number; activeCount: number }` in
`src/utils/adminStats.ts`. Pin with tests.

### B. PendingShopsScreen + ShopRegistrationDetailScreen —
review enhancements

**On `PendingShopsScreen`** (the list of pending shops):

- Show **days since registration** as a small chip on each row
  (e.g. "Submitted 3 days ago"). Computed from
  `shop.registrationData.submittedAt`.
- **Sort the list** by submission time, oldest first (so the most
  urgent reviews surface first).
- If a shop has been pending for **> 7 days**, render the days
  chip in a warning color (existing `colors.warning` or similar).

**On `ShopRegistrationDetailScreen`** (the detail of one pending
shop):

- Add a small **Owner section** showing:
  - Owner's phone number (from `shop.ownerUid` → look up via
    `listAllUsers` cache OR via a new `getUserById` callable — see
    §D)
  - When the owner's account was created
  - Whether the owner has any prior approved/rejected shops
    (informational — helps spot resubmissions)
- Days-since-registration prominently at the top.

Extract date-formatting and "days since" computation into a pure
helper `daysSince(timestampMs: number, now: number) => number` in
`src/utils/format.ts`. Pin with tests.

### C. UserManagementScreen — filter + search improvements

Current screen has phone/uid text filter. Add:

1. **Role filter chips** at the top of the list: `All / Admin /
   Shop Owner / Delivery / Customer`. Filter the user list
   client-side based on the flags already in `UserInfo`. Default:
   `All`.
2. **Sort by recency** — newest sign-ins first by default. Add a
   sort toggle: "Newest first" / "Oldest first".
3. **Search debouncing** — the existing text filter re-renders on
   every keystroke. Add 250ms debounce so a fast-typed phone
   doesn't lag the list.

Extract the filter+sort logic into a pure helper
`filterAndSortUsers(users, filters, sortDir, query)` →
`UserInfo[]` in `src/utils/userListFilters.ts`. Pin with tests.

### D. New Cloud Function: `getOnlineDeliveryCount`

Single small callable in `functions/src/index.ts`. Region
`asia-south1`. Admin-only.

```ts
export const getOnlineDeliveryCount = onCall(
  { region: 'asia-south1', cors: true },
  async (req) => {
    if (!req.auth?.token?.admin) {
      throw new HttpsError('permission-denied', 'Admin only');
    }
    const snap = await db.collection('users')
      .where('isDelivery', '==', true)
      .where('deliveryStatus', '==', 'online')
      .get();
    return { count: snap.size };
  },
);
```

Client-side: `orderService.getOnlineDeliveryCount()` callable wrapper
(native + web Plan-B dispatch). New screen polls every 15s via a
small custom hook `useOnlineDeliveryCount` extracted from
AdminOrdersScreen for testability.

**Index check:** the existing `users` collection composite index
covers `(isDelivery, deliveryStatus)` per
`sendNewPickupPushToDelivery` usage. Run `npm run audit:indexes`
and confirm no new index needed. If audit flags one, add to
`firestore.indexes.json`.

**Optional follow-up §D.2 — `getUserById` callable for §B**: if
implementing the Owner section in `ShopRegistrationDetailScreen`
needs per-user info that isn't in `listAllUsers`, add a simple
`getUserById({ uid })` admin-only callable. If `listAllUsers` is
sufficient, skip this — fewer endpoints is better.

### E. PRELAUNCH_CHECKLIST.md

Add a Phase 12c entry covering everything above. Mark the
original "Phase 12c" admin polish item as done. Note any
deferrables (e.g. admin audit log is still open).

## Scope (out — explicitly defer)

- Admin audit log (revoke / suspend / approve actions) — still
  tracked as separate follow-up
- Multi-admin invite flow — still CLI-only per project policy
- Refund flow for paid orders — admin-only, tracked separately
- Stats over time ranges (last 7d / 30d / custom) — MVP shows
  today only; charts come later
- Performance optimization for `listAllUsers` at scale —
  pagination is a separate concern
- Admin-side direct edit of orders — admin can only change
  status via existing buttons; field edits out of scope

## Tests (mandatory, per `.windsurf/test-discipline.md`)

Required test files. Target ≥12 new tests total.

1. `tests/utils/adminStats.test.ts` (≥4 tests):
   - Today's GMV sums non-cancelled orders from today only
   - Cancelled orders don't count toward GMV
   - Active orders count excludes delivered and cancelled
   - Empty orders array returns zeros (defensive)

2. `tests/utils/format.daysSince.test.ts` (≥3 tests):
   - 0 days for today
   - 1 day for yesterday (calendar-aware, not 24h-aware — like
     `formatRelativeDeliveryTime`)
   - 7 days for last week
   - Negative input → returns 0 (defensive)

3. `tests/utils/userListFilters.test.ts` (≥5 tests):
   - Filter by `admin` role returns only admins
   - Filter by `shopOwner` returns only shop owners
   - Filter by `customer` returns users with no extra role flags
   - Search query matches phone substring (case-insensitive)
   - Sort by `newest` puts highest `lastSignInAt` first
   - Sort by `oldest` reverses

4. `tests/functions/onlineDeliveryCount.test.ts` (≥2 tests):
   - Returns count of users matching both isDelivery + online
   - Rejects non-admin callers with permission-denied

Same pattern as previous PRs: extract pure logic into helpers,
test helpers directly. Don't add RNTL tests for the screens.

**Deliberate-break demo:** revert the `status === 'cancelled'`
exclusion in `computeAdminOrderStats`, confirm the GMV-cancelled
test fails by name, revert, confirm green.

## Deploy + OTA

One Cloud Function deploy (per deploy discipline, single
`--only` target):

```
firebase deploy --only functions:getOnlineDeliveryCount --project grocery-mvp-dev
firebase functions:list --project grocery-mvp-dev
```

(If §D.2 `getUserById` ends up being implemented, deploy that too
separately.)

Then OTA:

```
eas update --branch production --message "Phase 12c: admin polish"
```

**Note:** push to `production` branch this time, not `preview`.
The production TestFlight build is what family is using, so OTAs
need to land on that channel. Sudhir's current solo dev work still
uses dev client (Metro-served), so the preview channel can stay
empty.

## Acceptance checklist

- [ ] Stats card visible on AdminOrdersScreen with all 3 stats
      populating from real data within 15s of opening
- [ ] PendingShopsScreen shows days-since-registration on each
      row; warning color when > 7 days; sorted oldest-first
- [ ] ShopRegistrationDetailScreen shows owner phone + account
      created date + prior shops count
- [ ] UserManagementScreen has 5 role filter chips, sort toggle,
      debounced search
- [ ] `getOnlineDeliveryCount` deployed, returns numeric count,
      rejects non-admin
- [ ] `npm test` passes — total ≥ baseline + ≥12 new tests
- [ ] `npm run audit:indexes` passes (no new missing indexes)
- [ ] `npx tsc --noEmit` — 11 baseline errors, 0 new
- [ ] Deliberate-break demo executed; failing test name captured
- [ ] OTA published to **production** branch with group ID + iOS
      + Android update IDs in the report

## Reporting back

- Test count breakdown per file
- Deliberate-break output (which subject, which test failed by
  name)
- `firebase functions:list` excerpt showing the new function
- `eas update` output with platform IDs
- Files added/modified with line counts
- Anything noticed but NOT fixed (logged for follow-up)

## Important — do not

- Do not change watcher cadence or polling intervals
- Do not add new Order or User schema fields
- Do not modify firestore.rules
- Do not add admin-side write paths for orders / users (admin
  only changes status, not other fields, by design)
- Do not fix the 11 baseline TS errors
- Do not push OTA to the `preview` branch — production is what
  family is using
- Do not commit anything — leave staged for Sudhir's review
- Tests run **once at end** + deliberate-break demo only
