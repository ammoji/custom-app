# PR-NEXT-1 — Order status propagation + cancellation/delivered pushes + deep-link (Windsurf prompt)

> Pilot-blocker cluster surfaced by the May 30 Android validation
> pass. Five findings from
> `docs/TESTING-FINDINGS-2026-05-30.md` consolidated into one PR
> because they all touch the same plumbing (order-status writes →
> push trigger fan-out → client display + deep-link):
>
> - **#2** Cancel order — no push to shopkeeper
> - **#3** Push tap → goes to Home, not the relevant order
> - **#10** "Picked up" status not propagating; conflicting customer labels
> - **#11** "Delivered" status not propagating to shopkeeper; no push to shop/admin
> - **#16** Deliver → notify shop + customer + admin
>
> Pure JS/TS + Cloud Functions edits — **OTA-safe**, ships with
> `eas update --branch production` after `firebase deploy --only
> functions`.

## Why this PR exists

Sudhir ran the first end-to-end Android pilot rehearsal and found
the order-status pipeline is silently broken in multiple places:

- Customers can cancel orders and shopkeepers never know — they
  keep preparing food while inventory walks out the door.
- When a delivery partner taps "I've picked up," the customer
  sees contradictory text on the same screen ("Out for delivery"
  AND "Pickup ready 5 min ago") because the UI surfaces read two
  different signals that disagree.
- When a partner taps "Delivered," only the customer gets a
  push — the shopkeeper still sees "Ready for pickup" on their
  dashboard until they manually refresh.
- Every push notification, when tapped, lands the user on Home
  instead of the specific order — fine with 2 orders, painful
  with 20.

The user trust impact of any of these on a real pilot order is
significant. All five are linked through the same code paths
(updateOrderStatus / markPickedUp / markDelivered → push trigger →
client status display + tap handler), so they fix as one PR.

## Read first

- `docs/TESTING-FINDINGS-2026-05-30.md` — findings #2, #3, #10, #11, #16
  (each has my root-cause analysis already).
- `functions/src/index.ts`:
  - `updateOrderStatus` ~line 838 (handles cancellation transitions)
  - `markPickedUp` ~line 3248 — **the status bug for #10 is here**
  - `markDelivered` ~line 3291 (correctly updates status; missing
    shopkeeper push)
  - `sendOrderStatusPush` trigger — the push fan-out for status
    transitions. Find it via `grep "onDocumentUpdated.*orders"`.
- `src/components/AuthBootstrap.tsx` — PR 45.2 added the
  push-tap deep-link handler for `shop_pending_approval` and
  `delivery_request_pending`. Extend it for new-order + delivered
  pushes.
- `src/types/index.ts` — `Order` type (`status`, `pickedUpAt`,
  `deliveredAt`, `cancelledAt`, `statusHistory`).
- `src/utils/format.ts` — likely current home for any order-status
  formatting helpers (verify; if there's a separate
  `orderEtaDisplay` or similar, that's the home).
- Customer / shopkeeper / delivery / admin screens that render
  order status text. Audit before fixing — grep for
  `order.status`, `ready_for_pickup`, `'Out for delivery'`,
  `pickedUpAt`, etc.
- `.windsurf/code-discipline.md` Rules 1 (import-strip), 2 (hooks
  above early returns), 10 (Firestore reads-before-writes —
  applies if any callable adds new pre-write reads).
- `.windsurf/deploy-discipline.md` — Cloud Run IAM verify on
  every redeployed callable.

## Scope of changes

### A. Pure helper — `displayOrderStatus`

**Goal:** one source of truth for "what status label does this
order show right now" across customer, shopkeeper, delivery, and
admin surfaces. Eliminates the #10 inconsistency where top text
and bottom text read different fields.

**Location:** `src/utils/orderStatusDisplay.ts` (new). Pure module,
no firebase-admin / no React imports.

**Shape:**

```ts
import type { Order, OrderStatus } from '../types';

export type DisplayedStatus = {
  // The single, authoritative state for UI: derived from
  // (status, pickedUpAt, deliveredAt, cancelledAt) so it cannot
  // disagree with itself.
  state:
    | 'pending'
    | 'accepted'
    | 'preparing'
    | 'ready_for_pickup'
    | 'picked_up'        // synthetic; not in OrderStatus enum
    | 'delivered'
    | 'cancelled';
  // The primary label shown to the user. Short, present-tense.
  label: string;
  // Optional secondary line (e.g., "5 minutes ago").
  sublabel?: string;
};

/**
 * Compute the *displayed* status from the order document. Reads
 * status + pickedUpAt + deliveredAt + cancelledAt together so the
 * UI can never show contradictory labels.
 *
 * Decision matrix:
 *   status === 'cancelled'              → 'cancelled'
 *   status === 'delivered'              → 'delivered'
 *   status === 'ready_for_pickup'
 *     && pickedUpAt != null             → 'picked_up' (synthetic)
 *   status === 'ready_for_pickup'       → 'ready_for_pickup'
 *   else                                → status (as-is)
 */
export function displayOrderStatus(
  order: Pick<Order, 'status' | 'pickedUpAt' | 'deliveredAt' | 'cancelledAt'>,
  audience: 'customer' | 'shopkeeper' | 'delivery' | 'admin',
): DisplayedStatus {
  // ... implementation
}
```

**Per-audience labels** (suggested; tweak if existing UI strings
read better):

| state | customer | shopkeeper | delivery | admin |
| --- | --- | --- | --- | --- |
| pending | Awaiting shop confirmation | New order — review | New order at shop | Order placed |
| accepted | Shop accepted | Order accepted | Coming soon | Accepted |
| preparing | Being prepared | Preparing | Coming soon | Preparing |
| ready_for_pickup | Ready — partner picking up | Ready for partner | Ready to pick up | Ready for pickup |
| picked_up | Out for delivery | Picked up — out for delivery | Out for delivery | Out for delivery |
| delivered | Delivered | Delivered | Delivered | Delivered |
| cancelled | Order cancelled | Order cancelled | Order cancelled | Order cancelled |

Don't introduce `'picked_up'` to the `OrderStatus` enum in this
PR — keep `pickedUpAt` as the signal. The synthetic state lives
inside the helper. Adding the real enum value would be a
larger, server-touching change deferred to a future PR.

### B. `markPickedUp` — fix the statusHistory mislabel

`functions/src/index.ts` ~line 3280-3286. Change:

```ts
statusHistory: FieldValue.arrayUnion({
  status: 'ready_for_pickup',   // ❌ wrong
  ...
}),
```

to:

```ts
statusHistory: FieldValue.arrayUnion({
  status: 'picked_up',          // ✅ matches the new displayed state
  at: now,
  by: `delivery:${uid}`,
  reason: 'Picked up from shop',
}),
```

This is a label-only change — it doesn't affect the top-level
`order.status` field (which deliberately stays
`'ready_for_pickup'`; the signal for picked-up is `pickedUpAt`).
The fix is so that audit-log readers and any future code that
introspects statusHistory can see the actual transition that
happened.

### C. Audit + replace all order-status display sites

Grep the client codebase for every place that renders an order's
status:

```
grep -rn "order.status" src/
grep -rn "ready_for_pickup" src/
grep -rn "'Out for delivery'" src/
grep -rn "'Pickup ready'" src/
grep -rn "pickedUpAt" src/
```

For each render site, replace the ad-hoc status mapping with:

```ts
const display = displayOrderStatus(order, '<audience>');
// Render display.label, display.sublabel
```

Audience is determined by which screen: customer screens pass
`'customer'`, shopkeeper screens pass `'shopkeeper'`, etc.

**Common surfaces to update (incomplete list — find all):**
- `src/screens/OrderDetailScreen.tsx` (customer order detail)
- `src/screens/OrdersScreen.tsx` (customer order list)
- `src/screens/shop/ShopOrderDetailScreen.tsx`
- `src/screens/shop/ShopOwnerDashboardScreen.tsx`
- `src/screens/delivery/DeliveryDashboardScreen.tsx`
  (the ActiveDeliveryCard subStatus + similar)
- `src/screens/delivery/DeliveryOrderDetailScreen.tsx`
- `src/screens/admin/AdminOrdersScreen.tsx`
- Any order-card components under `src/components/order/`

Aim: **zero direct reads of `order.status` for display purposes
remain.** Direct reads for branching (e.g., "show Cancel button
only if status === 'pending'") are fine; only the *displayed text*
goes through `displayOrderStatus`.

### D. Push fan-out — extend `sendOrderStatusPush` (or equivalent trigger)

Find the order-status push trigger in `functions/src/index.ts`
(grep `onDocumentUpdated.*orders`). Currently it likely pushes only
to the customer on status changes. Extend it so:

| Transition | Push to |
| --- | --- |
| pending → accepted | Customer |
| accepted/preparing → ready_for_pickup | (already covered by sendNewPickupPushToDelivery for partners; also: customer) |
| ready_for_pickup → delivered | **Customer + Shopkeeper + Admin** *(currently only customer — #11 fix)* |
| any → cancelled | **Customer + Shopkeeper + Admin** *(currently shopkeeper missing — #2 fix)* |
| markPickedUp (no status change, but pickedUpAt set) | **Customer** ("Your order is out for delivery") *(currently silent — part of #10 fix)* |

The last one is special: `markPickedUp` doesn't change the
top-level `status` field (by design), so the existing
`onDocumentUpdated` trigger won't fire if it only watches `status`
diffs. Two options:

1. Expand the trigger's diff check to also fire on `pickedUpAt`
   transitions (null → non-null).
2. Emit the push directly from inside `markPickedUp` after the
   write, mirroring how `sendNewPickupPushToDelivery` already
   handles immediate fan-out.

Option 2 is cleaner (avoids loading the trigger with multiple
concerns) and matches the pattern already in use. Prefer it.

**Push payload shape** for the new pushes:

```jsonc
// Cancelled → shopkeeper
{ type: 'order_cancelled', orderId: '...', shopId: '...' }
// Cancelled → customer (already exists?)
{ type: 'order_cancelled', orderId: '...' }
// Cancelled → admin
{ type: 'order_cancelled', orderId: '...', shopId: '...' }
// Picked up → customer
{ type: 'order_picked_up', orderId: '...', shopId: '...' }
// Delivered → shopkeeper
{ type: 'order_delivered', orderId: '...', shopId: '...' }
// Delivered → admin
{ type: 'order_delivered', orderId: '...', shopId: '...' }
```

Add unit tests for the trigger's audience-resolution logic (pure
helper if possible: `(beforeStatus, afterStatus, pickedUpAt?,
auth?) → audiences[]`).

### E. Push-tap deep-link — extend the AuthBootstrap handler (PR 45.2 surface)

`src/components/AuthBootstrap.tsx`. PR 45.2 added a tap handler for
push types `shop_pending_approval` and `delivery_request_pending`.
Extend the same handler for the order-related push types:

| Push type | Audience | Navigate to |
| --- | --- | --- |
| `order_placed` *(new-order to shopkeeper)* | shopkeeper | `ShopOrderDetail` `{ orderId }` |
| `order_status_changed` *(generic — accepted/preparing/ready)* | customer | `OrderDetail` `{ orderId }` |
| `order_cancelled` | customer | `OrderDetail` `{ orderId }` |
| `order_cancelled` | shopkeeper | `ShopOrderDetail` `{ orderId }` |
| `order_picked_up` | customer | `OrderDetail` `{ orderId }` |
| `order_delivered` | customer | `OrderDetail` `{ orderId }` |
| `order_delivered` | shopkeeper | `ShopOrderDetail` `{ orderId }` |
| `pickup_available` *(new-pickup to delivery)* | delivery | `DeliveryOrderDetail` `{ orderId }` |

Read the existing push types in the codebase before adding new
ones — there may already be names in use (e.g., the new-order push
to shopkeeper might already be called something different). Match
the existing naming convention; don't invent new names that
collide.

The audience is derivable from the user's claims (admin / shopOwner /
delivery / else=customer) at the moment the push is tapped.

### F. Tests

**New: `tests/utils/orderStatusDisplay.test.ts`** — exhaustive
matrix over (status, pickedUpAt, deliveredAt, cancelledAt) × audience.
At minimum:
- Every state in the table (§A) for every audience (4 audiences ×
  7 states = 28 cases).
- Mixed-signal edge cases:
  - status=`ready_for_pickup` + pickedUpAt set → `picked_up`
  - status=`delivered` + cancelledAt set (data inconsistency) →
    `delivered` wins (deliberate rule)
  - status=`cancelled` + deliveredAt set → `cancelled` wins
- Pin per-audience label strings (so a careless edit can't silently
  change customer-visible text).

**New: server tests for push fan-out audiences** — pure helper
that maps (before, after, ...) → audiences[]. Test every transition
in the §D table.

**Extend existing tests** for `markPickedUp` and `markDelivered`
to assert the new push side-effects (mock the fan-out helper and
check it's called with the right audiences).

`npm test` target after this PR: green. Suite count expected to
grow by ~40–60 tests.

## Deploy

Server-first (deploy-discipline):

```
firebase deploy --only functions:markPickedUp,functions:markDelivered,functions:updateOrderStatus,functions:sendOrderStatusPush
```

(Add any other callable name that changed. If you added a new
callable, include it.)

Then verify Cloud Run IAM on every redeployed public callable:

```
gcloud run services get-iam-policy markpickedup --region=asia-south1
gcloud run services get-iam-policy markdelivered --region=asia-south1
gcloud run services get-iam-policy updateorderstatus --region=asia-south1
```

Add `allUsers` / `roles/run.invoker` to any missing.

Then OTA the client:

```
eas update --branch production --message "PR-NEXT-1 order status propagation + push fan-out"
```

## Smoke acceptance (do these in order, on a two-device pair)

1. **Cancel push to shopkeeper (#2):** Customer places order on
   device A. Shopkeeper sees it (push or list refresh). Customer
   cancels within the 2-min window. Shopkeeper device receives a
   push within ~5s. Tapping the push opens **ShopOrderDetail** for
   that exact order (#3).

2. **Picked-up consistency (#10):** Customer places order →
   shopkeeper accepts + marks ready → delivery partner taps "I've
   picked up." Customer's OrderDetail shows EXACTLY ONE consistent
   label: "Out for delivery." No "Pickup ready 5 min ago" text
   anywhere on the screen. Repeat 3× to confirm the propagation
   isn't intermittent.

3. **Delivered fan-out (#11, #16):** Partner taps "Delivered."
   Customer receives "Order delivered" push (already worked).
   Shopkeeper receives a push too. Admin receives a push too.
   Each push, when tapped, opens the right order detail for the
   respective audience.

4. **Status text consistency across surfaces:** Open the same order
   on customer / shopkeeper / delivery / admin screens. The state
   label is appropriately worded for each audience but they all
   describe the same underlying state coherently. No contradictions.

5. **Mid-cycle race resilience:** Place 3 orders back-to-back, run
   each through the full lifecycle in parallel. No status display
   ghosting on any of them.

## Out of scope (do not pull in)

- COD payment confirmation flow (#12) → PR-NEXT-3
- Delivery proof photo (#13) → PR-NEXT-6
- Menu management bugs (#4, #5) → PR-NEXT-4
- Delivery dashboard reliability (#7, #8) → PR-NEXT-5
- Reorder UX (#14, #15) → PR-NEXT-8
- In-shop search (#6) → PR-NEXT-9
- Online partners count for shopkeeper (#9) → PR-NEXT-7
- Adding `'picked_up'` to the OrderStatus enum (bigger refactor;
  this PR handles it as a *synthetic* display-only state via the
  helper, which is the cheap defensive fix).

## Update doc trail after shipping

1. Mark findings #2, #3, #10, #11, #16 as **Shipped** in
   `docs/TESTING-FINDINGS-2026-05-30.md`.
2. Append SESSION_LOG entry covering the displayOrderStatus
   helper pattern as a new convention.
3. Bump test suite count in `CLAUDE.md` Current state.
