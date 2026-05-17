# View-first dashboard cards + delivery history — Windsurf prompt

## Why this PR exists

Two dashboard UX issues surfaced in solo testing, both touching the
same files. Bundling them saves an OTA cycle.

### Issue 1 — Accidental accepts

A shop owner can tap "Accept" on a dashboard card without ever seeing
what's in the order (no item list visible there). Same for a delivery
partner tapping "Accept" on an available-pickup card without seeing
the items or exact drop address.

The fix is to **remove first-commitment action buttons from dashboard
cards** so engaging with an order requires opening the detail screen
first. Tap card → see items, customer, address, payment — then act.

This is a deliberate UX trade: one extra tap on the happy path, in
exchange for eliminating an entire class of "I accepted by mistake"
errors that produce real-world fulfilment problems (shop can't
deliver, partner can't carry, customer waits longer).

### Issue 2 — No delivery history visible

`DeliveryDashboardScreen` shows a "Completed today" stat but no list
of what was actually delivered. Partners want to see their day/week
of work — both for self-reassurance ("did that last drop actually
mark delivered?") and for future earnings tracking when payouts ship.

The data is already on the server — `listMyDeliveries` returns
delivered orders (that's how the "Completed today" stat is computed).
The dashboard just doesn't render them. This PR adds a collapsible
"Delivery History" section below "My Active Deliveries."

## Action button taxonomy (important — preserve this distinction)

Two categories of action buttons in the app today. They are treated
DIFFERENTLY by this PR:

**Category A — first commitments (move to detail screen):**
- Shop owner: Accept / Mark Preparing / Mark Out for Delivery
- Delivery partner: Accept this pickup (available pickup card)

**Category B — mid-flow status updates (keep inline on dashboard):**
- Delivery partner: I've picked it up
- Delivery partner: Delivered

Reasoning: Category A is about deciding to engage with an order.
Category B is about updating progress on an order you've already
committed to. Mid-flow inline buttons stay because real-world
delivery use is one-handed, fast, often under time pressure —
forcing a tap-to-detail-tap-button for "Picked up" / "Delivered"
creates real friction with zero risk reduction (the commitment was
already made).

**Do not move Category B actions to the detail screen.** They're
already on the detail screen too (for the case where a partner is
already looking at it), but the dashboard inline path must remain.

## Read first

- **`.windsurf/test-discipline.md`** — tests run once at end +
  deliberate-break demo. `npm test` is the runner.
- `src/screens/shop/ShopOwnerDashboardScreen.tsx` — order cards
  with inline Accept/Preparing/Out for Delivery action buttons
  (Category A — remove)
- `src/screens/shop/ShopOrderDetailScreen.tsx` — already has
  these action buttons; no changes needed there
- `src/screens/delivery/DeliveryDashboardScreen.tsx` — has TWO
  card components:
  - `AvailablePickupCard` (Category A — remove Accept)
  - `ActiveDeliveryCard` (Category B — leave inline buttons alone)
- `src/screens/delivery/DeliveryOrderDetailScreen.tsx` — already
  has the Accept button for the available-for-claim state (added
  in the previous PR); no changes needed there
- `tests/hooks/useShopOrderDetail.test.ts` and
  `tests/hooks/useDeliveryOrderDetail.test.ts` — existing
  pure-helper tests for the detail screens stay green

## Scope (in)

### A. `ShopOwnerDashboardScreen.tsx`

1. Remove the inline action buttons block from the order card
   (currently the `actions.length > 0 && <View style={styles.actions}>...`
   block at the bottom of each card's `renderItem`).
2. Card body stays as a `Pressable` that navigates to
   `ShopOrderDetail` — unchanged.
3. Replace the action-buttons region with a small "Tap to view
   details" hint or a more prominent chevron — visual signal that
   action happens elsewhere now.
4. Delete the imports + helpers no longer needed in this screen
   (`handleAction`, `nextActionsFor`, `ACTION_LABELS`,
   `SHOP_OWNER_ALLOWED_ACTIONS`, the `pending` state and its
   setter). All of that logic already lives on
   `ShopOrderDetailScreen` via the hook; deleting it here avoids
   two-copies-of-the-same-logic drift.
5. The `pending` Record state goes away. Confirm nothing else
   reads it.

### B. `DeliveryDashboardScreen.tsx` — `AvailablePickupCard` only

1. Remove the Accept button + `pending` / `anyPending` props from
   `AvailablePickupCard`. Card body stays tappable for navigation
   to `DeliveryOrderDetail`.
2. The dashboard's `handleClaim` function and its `pendingClaim`
   state are now unused on the available side. Remove them along
   with any other dead code that only the inline Accept was using.
3. **Keep `ActiveDeliveryCard` unchanged.** Its `onPickedUp` /
   `onDelivered` buttons remain inline per Category B above.
4. The "Disable other Accept buttons while one claim is in flight"
   logic goes away with the buttons — no longer relevant.

### C. `DeliveryDashboardScreen.tsx` — add Delivery History section

Add a new `Delivery History` section below `My Active Deliveries`,
following the same SectionHeader pattern (collapsible chevron, count
in parens). Default state: collapsed — history is reference data,
not action data; the partner shouldn't be forced to scroll past it.

When expanded, render delivered orders by this partner, sorted by
`deliveredAt` descending (newest first). The data source is already
in scope — the existing `mine` array from `watchMyDeliveries` contains
delivered orders alongside active ones (that's how the "Completed
today" stat is computed at the top of the screen).

Derive a `deliveredMine` memo alongside the existing `activeMine`:

```ts
const deliveredMine = useMemo(
  () =>
    mine
      .filter(o => o.status === 'delivered')
      .sort((a, b) => (b.deliveredAt ?? 0) - (a.deliveredAt ?? 0)),
  [mine],
);
```

Each row in the history list is a `DeliveryHistoryCard` (new
component, kept inside the same file like the other Card components):

- Shop name (h3 or bodyBold)
- Customer area: line1 + pincode trimmed to single line; do NOT
  show customer phone (privacy — same guard as
  DeliveryOrderDetailScreen's `isAssigned`-gated phone link)
- Total amount
- Delivered timestamp formatted by a new helper
  `formatRelativeDeliveryTime(ms)` in `src/utils/format.ts`:
  - Same day → "Today 3:45 PM"
  - Previous day → "Yesterday 11:20 AM"
  - Within last 7 days → "Mon 2:15 PM" (weekday abbrev)
  - Older → "May 14, 2:15 PM"
  - Use the user's local timezone (no UTC magic — `Date.toLocaleString`
    with explicit options is fine)
- Card body tappable → `DeliveryOrderDetail` with the orderId.
  The detail screen already renders the green "Delivered" card for
  this state — no detail-screen changes needed.

Empty state when expanded: `EmptyState` with title "No completed
deliveries yet" and subtitle "Your delivered orders will appear
here." Reuse the existing `EmptyState` component.

Pagination scope-out: just render whatever `listMyDeliveries`
returns. If it returns a giant list (over time), the FlatList /
ScrollView handles it. Server-side pagination is a separate concern
— log as a follow-up if not already tracked in PRELAUNCH_CHECKLIST.

### D. `src/utils/format.ts` — add `formatRelativeDeliveryTime`

Pure helper, no React, no React Native. Trivially testable.

```ts
export function formatRelativeDeliveryTime(
  ms: number,
  now: number = Date.now(),
): string {
  // ... rules above ...
}
```

The `now` parameter is injectable so tests can pin specific
"today"/"yesterday"/"week ago" boundaries without faking
Date.now globally.

### E. Detail screens — no changes needed

Both `ShopOrderDetailScreen` and `DeliveryOrderDetailScreen`
already render the appropriate action buttons. The Detail screens
become the SOLE place these commitments happen. Verify by reading
both files — do not modify them.

The detail screen also already renders correctly for the delivered
state (green "Delivered" card per existing code), so tapping a
history row works without any detail-screen changes.

## Scope (out — explicitly defer)

- No change to the action button labels or status transitions
- No change to optimistic update / revert behaviour on the detail
  screens
- No change to the watcher contract
- No new Cloud Function deploys — this is JS-only
- No change to push notifications
- No change to test-discipline norms

## Tests (mandatory, per discipline)

Three test files. Total ≥ 14 new tests.

1. **Dashboard "no action buttons" structural test** — file:
   `tests/screens/dashboardCardActions.test.ts`. Reads
   `ShopOwnerDashboardScreen.tsx` and
   `DeliveryDashboardScreen.tsx` as strings, asserts:
   - `ShopOwnerDashboardScreen.tsx` does NOT import `ACTION_LABELS`
   - `ShopOwnerDashboardScreen.tsx` does NOT import
     `nextActionsFor`
   - `ShopOwnerDashboardScreen.tsx` does NOT reference
     `handleAction` (the function definition was removed)
   - `DeliveryDashboardScreen.tsx` `AvailablePickupCard` component
     definition does NOT contain a `<Button` with title `Accept`
     (coarse string-search — pins design intent, not rendering)
   - `DeliveryDashboardScreen.tsx` still contains `ActiveDeliveryCard`
     with `onPickedUp` and `onDelivered` props (regression guard
     for Category B preservation)
   - `DeliveryDashboardScreen.tsx` contains a `DeliveryHistoryCard`
     component definition (regression guard for the new history
     section)

2. **Detail screens still have action buttons** — file:
   `tests/screens/detailScreenActions.test.ts`. Reads
   `ShopOrderDetailScreen.tsx` and `DeliveryOrderDetailScreen.tsx`
   as strings, asserts:
   - `ShopOrderDetailScreen.tsx` imports `ACTION_LABELS` and
     `nextActionsFor`
   - `ShopOrderDetailScreen.tsx` renders a `<Button` with action
     button shape
   - `DeliveryOrderDetailScreen.tsx` renders "Accept this pickup"
     button

3. **`formatRelativeDeliveryTime` pure helper** — file:
   `tests/utils/formatRelativeDeliveryTime.test.ts`. ≥ 6 tests:
   - Same calendar day → "Today HH:MM AM/PM"
   - Previous calendar day → "Yesterday HH:MM AM/PM"
   - 3 days ago → weekday abbrev format (e.g. "Mon 2:15 PM")
   - 8 days ago → full date format (e.g. "May 14, 2:15 PM")
   - DST / timezone boundary edge case (deliveredAt = 11:59pm
     yesterday vs 12:01am today both render correctly)
   - Customer privacy: the helper does NOT receive or emit any
     phone / address data — its signature is `(ms, now?) => string`
     only. Pin via type-level test (the function shape itself is
     the assertion; a runtime smoke test reading `Function.length
     === 1` or 2 is enough).

The string-search tests are intentionally coarse — they pin the
architectural decision ("dashboard has no first-commitment actions;
detail has all actions; dashboard has a history section") rather
than exact rendering, since RNTL is still out of scope. They'll
catch a future contributor who tries to "re-add a quick Accept
button to the dashboard for convenience" or "remove the history
section because nobody uses it" — the discussion happens at PR
review, not after a Sudhir-style repro.

**Deliberate-break demo required:** revert the deletion of one of
the action-button imports in `ShopOwnerDashboardScreen.tsx` (e.g.
re-add `import { ACTION_LABELS } from ...`), confirm the
corresponding string-search test fails by name, revert, confirm
green.

## Deploy + OTA

JS-only — no `firebase deploy` needed.

```
eas update --branch preview --message "view-first dashboard cards"
```

## Acceptance checklist

- [ ] `ShopOwnerDashboardScreen` — order card body tappable, no
      inline action buttons visible
- [ ] `DeliveryDashboardScreen` `AvailablePickupCard` — body
      tappable, no inline Accept button visible
- [ ] `DeliveryDashboardScreen` `ActiveDeliveryCard` — UNCHANGED,
      still has inline "I've picked it up" / "Delivered" buttons
- [ ] `DeliveryDashboardScreen` — new collapsible "Delivery History"
      section below "My Active Deliveries", default collapsed,
      tapping a history row navigates to `DeliveryOrderDetail`
- [ ] Customer phone is NOT visible on history cards (same privacy
      rule as the available-pickup view)
- [ ] `formatRelativeDeliveryTime` handles same-day / yesterday /
      this-week / older cases correctly
- [ ] `ShopOrderDetailScreen` — UNCHANGED, action buttons render
      as before
- [ ] `DeliveryOrderDetailScreen` — UNCHANGED, "Accept this
      pickup" button still renders for available-for-claim state
- [ ] `npm test` — total ≥ baseline + 14 new tests
- [ ] `npx tsc --noEmit` — 11 baseline errors, 0 new
- [ ] Deliberate-break demo executed and reverted; failing test
      name captured
- [ ] No dead code left behind — unused imports, helpers, state
      variables removed

## Reporting back

- Files modified (paths + line counts)
- Tests added (count + file names)
- Deliberate-break demo output
- OTA group + iOS + Android update IDs
- Confirmation that Category B inline buttons (pickup / delivered)
  are intact

## Important — do not

- Do not move Category B (mid-flow status updates) to detail
  screens — they stay inline on the dashboard
- Do not modify the detail screens' action button behaviour
- Do not change watcher / claim semantics
- Do not modify Cloud Functions
- Do not fix the 11 baseline TS errors
- Do not commit anything — staged for Sudhir's review
- Tests run **once at end** + deliberate-break demo. Two runs.
