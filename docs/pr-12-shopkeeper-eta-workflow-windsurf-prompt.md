# PR 12 — Shopkeeper ETA + early delivery visibility + status rename (Windsurf prompt)

## Why this PR exists

The biggest piece of family-testing feedback. Today's flow:

1. Customer places order
2. Shopkeeper accepts
3. Shopkeeper starts preparing (no time estimate communicated)
4. Shopkeeper marks "out for delivery"
5. **Only then** does the order become visible to delivery partners
6. Delivery partner sees, claims, comes to shop, picks up, delivers

This slows the supply chain because the delivery partner has no
heads-up — they only learn about the pickup at the moment it's ready,
so they can't plan routes or batch deliveries efficiently.

**New flow:**

1. Customer places order
2. **Shopkeeper accepts AND enters "Ready in X minutes" ETA**
3. **Delivery partner dashboard immediately shows the order** with
   "Ready by 6:45 PM" badge so partner can plan
4. Shopkeeper marks "preparing" (can update ETA if running late)
5. Shopkeeper marks "Ready for Pickup" — the clear "come now" signal
6. Delivery partner picks up + delivers

Also: rename `out_for_delivery` → `ready_for_pickup` to remove
confusion. In Indian usage, "out for delivery" can imply the shop
itself is delivering. The actual semantic is "shop is done, awaiting
pickup."

Important architectural note in `src/types/index.ts` (line 285-295):

> "We don't add new statuses to the state machine; the combination
> of (status, deliveryPersonId, pickedUpAt) encodes the substate."

This PR preserves that posture. The status enum value renames from
`out_for_delivery` to `ready_for_pickup`. The substate encoding
(deliveryPersonId, pickedUpAt) stays exactly the same. Picked-up and
en-route-to-customer remain substates of `ready_for_pickup`, not
new top-level statuses.

Single coordinated change touching ~12 files. Schema-additive (one
new field, one renamed string literal). Server + client both need to
deploy together — deploy server first, then OTA.

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md`.
- `src/types/index.ts` line 285-295 — the `Order.status` union and the
  substate-encoding comment.
- `src/screens/shop/ShopOrderDetailScreen.useShopOrderDetail.ts` and
  the screen component — the place where shop accepts / progresses
  orders.
- `src/screens/admin/AdminOrdersScreen.tsx` — uses `out_for_delivery`
  in render mapping (PR 7's delivery-substate strip).
- `src/screens/delivery/DeliveryDashboardScreen.tsx` — the query that
  decides which orders are visible to delivery partners.
- `functions/src/index.ts` — `updateOrderStatus` callable governs the
  state transitions. Any guard that checks `'out_for_delivery'`
  string literal needs updating.
- All `.ts/.tsx` files containing the literal `'out_for_delivery'` —
  grep first to enumerate the blast radius:
  ```powershell
  Select-String -Path "src\**\*.ts","src\**\*.tsx","functions\src\**\*.ts" -Pattern "out_for_delivery"
  ```
  Expect ~15–25 hits across types, screens, helpers, tests.

## Scope (in)

### Part 1 — Schema: new field on order doc

Add to `Order` type in `src/types/index.ts`:

```ts
// Shopkeeper-provided ETA for when the order will be ready for
// pickup. Set when the shopkeeper accepts (mandatory in PR 12).
// May be updated during the preparing phase if the shop is running
// late. Null only on legacy orders placed before PR 12 — handle
// gracefully in rendering.
readyByEstimate: number | null;
```

No Firestore rule change needed — the existing `/orders/{orderId}`
rule already allows shop owners to update their own shop's orders.

### Part 2 — Rename status: `out_for_delivery` → `ready_for_pickup`

In `src/types/index.ts`, change the `Order.status` union:

```ts
// Before
status: 'pending' | 'accepted' | 'preparing' | 'out_for_delivery' | 'delivered' | 'cancelled';

// After
status: 'pending' | 'accepted' | 'preparing' | 'ready_for_pickup' | 'delivered' | 'cancelled';
```

Update the substate comment block (lines 289-295) to use the new name.

Then grep every literal `'out_for_delivery'` in the codebase and
replace with `'ready_for_pickup'`. This is the bulk of the mechanical
work. **Don't use `replace_all` blindly** — read each hit to confirm
context. Hits to update include:

- `functions/src/index.ts` — `updateOrderStatus` callable's valid
  transitions map; webhook handlers; delivery-related callables.
- `tests/functions/*.test.ts` — any test asserting on the literal.
- `src/screens/admin/AdminOrdersScreen.tsx` — render mapping +
  delivery-substate strip.
- `src/screens/shop/ShopOrderDetailScreen*.tsx` — action button
  labels + status filters.
- `src/screens/delivery/DeliveryDashboardScreen.tsx` — query filter.
- `src/components/order/OrderStatusChip.tsx` — label mapping. The
  human-readable label here should be **"Ready for Pickup"** (with
  the title case the user explicitly requested).
- `src/services/orderService.ts` — any helper functions filtering by
  status.

### Part 3 — Server-side `updateOrderStatus` accepts `readyByEstimate`

In `functions/src/index.ts`, the `updateOrderStatus` callable takes
`{ orderId, status }`. Extend the input to optionally include
`readyByEstimate: number`:

```ts
type UpdateOrderStatusInput = {
  orderId: string;
  status: OrderStatus;
  readyByEstimate?: number; // PR 12 — required when transitioning to 'accepted'
};
```

Validation:

- If `status === 'accepted'`, `readyByEstimate` MUST be present and
  must be a future timestamp (>= now). Reject with
  `invalid-argument` otherwise.
- If `status === 'preparing'`, `readyByEstimate` MAY be present (used
  to update the ETA mid-prep). Same future-timestamp validation if
  present.
- For other transitions (`ready_for_pickup`, `delivered`, etc.),
  `readyByEstimate` is ignored.

Write the new value to the order doc as part of the same atomic
update. Append to `statusHistory` as today, with the new ETA in the
entry's `reason` field for audit purposes (e.g.
`reason: "ETA: 6:45 PM"`).

**Pure helper extraction**: create
`functions/src/orderStatusTransitionHelpers.ts` with a
`validateOrderStatusTransition(input)` function returning the
discriminated `{ok}` union you've used elsewhere (mirror
`cancelPaidOrderHelpers` posture). Cover the ETA-required logic in
unit tests. Adds ~6-8 tests to the suite.

### Part 4 — Delivery dashboard query loosens

In `src/screens/delivery/DeliveryDashboardScreen.tsx`, the current
query likely filters orders by `status === 'out_for_delivery' AND
deliveryPersonId == null`. After this PR, partners should also see
orders in `accepted` and `preparing` states that don't yet have a
delivery partner claimed.

Two display sections:

1. **"Heads up — coming soon"**: orders where status is `accepted` or
   `preparing` AND no `deliveryPersonId`. Shown with the `readyByEstimate`
   badge ("Ready by 6:45 PM"). Tapping does NOT claim — claim is only
   allowed when status reaches `ready_for_pickup` (to avoid partners
   committing too early and blocking the order).
2. **"Available now"**: orders where status is `ready_for_pickup` AND
   no `deliveryPersonId`. Tapping claims.

Update the server-side delivery-query helper if there is one (likely
in `functions/src/index.ts` — find via grep for a query that filters
`'out_for_delivery'` + `deliveryPersonId`).

### Part 5 — Shopkeeper accept screen: ETA picker

In the shop order detail screen, the Accept button needs to gather
the ETA. Two UI options — pick whichever fits the existing pattern:

**Option A (recommended):** A simple numeric input next to the Accept
button. "Ready in [____] minutes" then Accept. Validates: integer
between 1 and 240 (4 hours). On submit, calls `updateOrderStatus`
with `status: 'accepted'` and `readyByEstimate: Date.now() + minutes
* 60_000`.

**Option B:** A modal that opens on Accept tap, with quick-pick chips
(15 min, 30 min, 45 min, 60 min) plus a custom input. More polished
but more code.

For PR 12, ship Option A. Track Option B as a follow-up if shops ask.

The same ETA input should appear on the "Start Preparing" button if
the shop wants to update the estimate, with the current ETA
prefilled.

### Part 6 — Admin dashboard: ETA in summary line

In `AdminOrdersScreen.tsx`, the at-a-glance summary line should
include the ETA when relevant:

```
Order #abc123 · Accepted · Ready by 6:45 PM
Order #def456 · Preparing · Ready by 7:00 PM (updated from 6:45 PM)
Order #ghi789 · Ready for Pickup · Awaiting delivery partner
Order #jkl012 · Ready for Pickup · Claimed by Ramesh, picked up 7:02 PM
```

The "updated from" trail comes from the statusHistory — if the most
recent ETA differs from the original `accepted`-time ETA, surface
the change.

### Part 7 — Customer screen: ETA in OrderDetail

Customer's `OrderDetailScreen.tsx` already shows "Arriving in ~X
min". Hide that placeholder when status is `accepted` / `preparing`
and instead show "Ready by 6:45 PM at the shop. Delivery partner
will pick up and bring to your door."

When status reaches `ready_for_pickup`, switch to "Out for delivery"
(yes — customer-facing language can keep the familiar phrase; only
the internal status name + admin/shop UI gets renamed).

### Part 8 — Backwards compatibility for legacy orders

Orders placed before this PR ships have no `readyByEstimate` field.
Render gracefully:

- Admin/shop dashboards: omit the "Ready by X PM" line if missing.
- Customer screen: keep the existing "Arriving in ~X min" estimate
  based on `estimatedDeliveryAt`.
- Don't write `null` into legacy docs; just check `if
  (order.readyByEstimate)` everywhere.

No migration needed.

## Scope (out)

- **Delivery partner notifications.** Push notifications are a
  separate piece of infrastructure. For now partners just need to
  refresh the dashboard. Track as a follow-up.
- **Per-shop default ETAs.** Shops may want to remember their typical
  prep time. Out of scope.
- **Customer-visible ETA updates.** If shop updates the ETA mid-prep,
  customer doesn't get a notification. The OrderDetailScreen will
  show the latest ETA on next poll/refresh. Don't ship a push for
  this in PR 12.
- **Renaming on the customer-facing side.** Customer keeps seeing
  "Out for delivery" because that's what they expect from familiar
  delivery apps. Only admin/shop/delivery internal UIs use the new
  "Ready for Pickup" name.

## Acceptance checklist

- [ ] `Order` type has `readyByEstimate: number | null`.
- [ ] `Order.status` union uses `'ready_for_pickup'` (not
  `'out_for_delivery'`).
- [ ] Zero remaining grep hits for `'out_for_delivery'` outside of
  the customer-facing label mapping (which intentionally still says
  "Out for delivery" on the customer side per Part 7).
- [ ] `functions/src/orderStatusTransitionHelpers.ts` created with
  pure validation helper.
- [ ] `tests/functions/orderStatusTransitionHelpers.test.ts` covers:
  accept without ETA rejected, accept with past ETA rejected, accept
  with future ETA accepted, preparing with ETA accepted, other
  transitions ignore ETA.
- [ ] Server-side `updateOrderStatus` callable validates ETA per
  Part 3 rules.
- [ ] Shopkeeper accept UI prompts for ETA + sends it in the call.
- [ ] Delivery dashboard shows "Heads up" section for accepted/
  preparing orders.
- [ ] Delivery dashboard "Available now" section only shows
  `ready_for_pickup` orders.
- [ ] Admin dashboard summary line includes ETA when present.
- [ ] Customer OrderDetail shows ETA messaging when status is
  accepted/preparing.
- [ ] Legacy orders (no readyByEstimate) render gracefully on every
  screen.
- [ ] `npx tsc --noEmit`: 0 errors.
- [ ] `npm test`: 476 + new tests pass.
- [ ] `npm run audit` passes.
- [ ] Zero new `DO NOT REMOVE` markers.
- [ ] Deliberate-break demo: change validation to accept past
  timestamps, confirm a test goes red, revert.

## Smoke tests (manual, after staged deploy)

These must run on **dev project** first. Don't skip to prod.

1. **End-to-end happy path with new ETA.** Customer places order.
   Shop accepts with "Ready in 20 minutes" — order doc now has
   `readyByEstimate` set. Delivery partner dashboard's "Heads up"
   section shows the order with "Ready by [time]". Shop marks
   preparing → still visible to partner in heads-up. Shop marks
   "Ready for Pickup" — moves to partner's "Available now"
   section. Partner claims → comes to shop → picks up → delivers.
2. **ETA update during preparing.** Shop accepts with 20 min ETA,
   then a few minutes later updates to 30 min ETA. Admin dashboard
   reflects the new value with "updated from" indicator.
3. **ETA validation rejects past times.** Shop tries to accept with
   ETA of 0 min or a past time. Server returns invalid-argument,
   client shows alert.
4. **Legacy order (placed before deploy) still renders.** Find an
   order doc that pre-dates this PR. All screens (customer/shop/
   admin/delivery) render without errors. No "undefined" or "NaN"
   leaks into the UI.
5. **Status filter regressions.** Run the existing PR 7 cancel-within-
   2-min flow, the PR 8 bulk-menu-availability flow, the PR 11
   admin-timeline expansion. All should still work — this PR
   shouldn't have touched their code paths.

## Deploy plan

Order matters here — server before client. Per
`.windsurf/deploy-discipline.md`: one `--only` target per command.

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Functions first — the new validation must be live before
#    clients start sending readyByEstimate
cd functions
npm run build
cd ..
firebase deploy --only functions --project grocery-mvp-dev
firebase functions:list --project grocery-mvp-dev   # verify

# 2. Smoke test the dev project via TestFlight pointed at dev
#    (run the 5 smoke tests above)

# 3. Client OTA — only after dev smoke fully green
eas update --branch preview --message "PR 12 shopkeeper ETA workflow"

# 4. Preview smoke on phone (force-close + reopen TestFlight)
# 5. Promote
eas update --branch production --message "PR 12 shopkeeper ETA workflow"

# 6. Prod functions deploy (only after prod OTA is verified)
firebase deploy --only functions --project grocery-mvp-prod
```

**Rollback plan:**

- If the server validation breaks something unexpected:
  redeploy `functions` from the previous commit
  (`git revert <pr-12-commit> && firebase deploy --only functions`).
- If the client OTA has UI bugs:
  `eas update --branch production --republish [previous-update-id]`.
- The server + client are loosely coupled: a v(N-1) client + vN
  server works (server happily accepts the old payload without ETA
  for non-`accepted` transitions). vN client + v(N-1) server would
  fail (client sends `readyByEstimate`, old server rejects unknown
  field). So **always deploy server before client** and **always
  roll back client before server** if needed.

## Estimated time

~4–6 hours Windsurf work:

- Part 1 (schema): 5 min.
- Part 2 (rename): 60–90 min mechanical, careful per-hit replacement.
- Part 3 (server callable + helper + tests): 60 min.
- Part 4 (delivery dashboard): 45 min.
- Part 5 (shopkeeper UI): 45 min.
- Part 6 (admin summary): 30 min.
- Part 7 (customer copy): 15 min.
- Part 8 (backwards compat): 15 min — mostly defensive checks.
- Smoke testing: 30–60 min (staged across dev and prod).

Stage 2 of testing (real shops + delivery partners using the new
flow) is where the actual value lands. If anything in the workflow
feels off in practice — e.g. shops want quick-pick chips instead of
typing minutes — queue Option B (Part 5) as a fast follow-up PR.
