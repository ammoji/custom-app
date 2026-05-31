# PR-NEXT-3 — COD payment conversion + delivery-partner confirmation (Windsurf prompt)

> Two-part pilot-blocker for COD orders, ship together. See
> `docs/TESTING-FINDINGS-2026-05-30.md` finding #12 for full scope
> and the locked design decisions (Sudhir, May 31).
>
> - **Part A — Customer-initiated COD → online conversion.** Customer
>   placed a COD order but wants to pay online any time before
>   delivery. Adds a "Pay online now" affordance on the customer's
>   OrderDetailScreen → mints a Razorpay session for the existing
>   order → reuses the existing `confirmPayment` callable to flip
>   `paymentStatus` to `paid`.
> - **Part B — Delivery-partner COD confirmation.** When the partner
>   arrives at a customer with a still-COD order, the "Delivered"
>   CTA is gated behind a mandatory "Mark paid: Cash / UPI" step
>   that stamps `paymentStatus: 'paid'` + new `paidMethod` field +
>   `paidAt` before the order can be marked delivered.
>
> Pure JS/TS + Cloud Functions edits — **OTA-safe** for the client
> half. Server half ships via `firebase deploy --only
> functions:payCodOrder,functions:confirmCodPayment,functions:confirmPayment,functions:markDelivered`.

## Why this PR exists

Most pilot orders will be COD (the testing team's habit; cash is the
default for first-time kirana customers). Two gaps in that flow:

1. A customer who places COD and later realizes they don't have
   cash (or just prefers UPI) has no way to convert mid-flow. Their
   only options today are "cancel + re-place" (loses the partner's
   in-flight work) or "wait for partner and find cash somehow."
   Swiggy/Zomato both offer mid-flow conversion; matching that is
   table-stakes.
2. A delivery partner currently taps "Delivered" with no record of
   whether they actually received the cash. Zero accountability →
   the first "I paid but he didn't deliver" or "I delivered but
   never got paid" dispute has no evidence on either side.

Part A fixes #1, Part B fixes #2. They interact cleanly: Part A
fixing converts a COD order to `paid` mid-flow, which lets Part B's
partner UI skip the cash-collection step entirely for that order.

## Locked design decisions (don't re-litigate)

From finding #12 (Sudhir, May 31):

- **`paymentMethod` stays `'cod'`** on conversion. Original intent is
  preserved as an analytics signal. New field `paidMethod: 'cash' |
  'online'` captures the actual settlement.
- **No reverse path** (online → COD not supported).
- **Fan-out push** on COD → online conversion to shop owner + admin +
  delivery partner (if `deliveryPersonId` already set). Fired directly
  from inside `confirmPayment` when the order was originally COD (NOT
  via the `sendOrderStatusPush` trigger — that watches `status`
  diffs, not `paymentStatus` diffs, and would double-fire for regular
  online orders).
- **Strict race-guard:** both `payCodOrder` and `confirmCodPayment`
  refuse if `paymentStatus === 'paid'` already (customer-vs-partner
  race).

## Read first

- `docs/TESTING-FINDINGS-2026-05-30.md` → finding #12.
- `functions/src/index.ts`:
  - **~line 996 — `retryPayment` callable.** The template for
    `payCodOrder` (mints a fresh Razorpay session). Different
    precondition checks (COD orders, not failed-online), same
    Razorpay flow.
  - **~line 1172 — `confirmPayment` callable.** Already verifies the
    Razorpay signature and flips `paymentStatus` to `'paid'`. Extend
    its post-write block to fan out the COD-conversion notification
    when the order was originally COD.
  - **~line 3248 — `markPickedUp`** and **~line 3387 — `markDelivered`**
    callables. `markDelivered` needs a new precondition: refuse if
    `paymentMethod === 'cod' && paymentStatus !== 'paid'` (partner
    must confirm the cash first via the new callable below).
- `src/types/index.ts` — `PaymentStatus` enum (line ~400) and
  `PaymentMethod` (line 390). Add the new optional `paidMethod`
  field to `Order` (line 412).
- `src/screens/OrderDetailScreen.tsx` — already has the
  `retryPayment` + Razorpay integration pattern (`orderService
  .retryPayment(order.id)` at ~line 782). Mirror that for the new
  "Pay online now" button.
- `src/screens/CheckoutScreen.tsx` — the source of truth for how
  Razorpay Checkout is opened on the client (look for
  `RazorpayCheckout.open(...)` or similar). Same pattern reused
  on OrderDetailScreen.
- `src/utils/razorpay.ts` — helper used by both screens.
- `src/screens/delivery/DeliveryDashboardScreen.tsx` —
  `ActiveDeliveryCard` (~line 999) renders the "I've picked it up"
  / "Delivered" button based on `pickedUpAt`. Part B inserts the
  COD-confirmation step here, in front of the "Delivered" branch.
- `src/services/orderService.ts` — model new client wrappers after
  the existing `retryPayment` / `confirmPayment` ones.
- `.windsurf/code-discipline.md` Rules 1 (import-strip), 2 (hooks
  above early returns), 10 (Firestore reads-before-writes — this
  PR has several reads-then-writes).
- `.windsurf/deploy-discipline.md` — Cloud Run IAM verify for the
  two new public callables.

## Scope of changes

### A. `Order.paidMethod` — new optional field

`src/types/index.ts`, on the `Order` type:

```ts
// PR-NEXT-3 — actual settlement method, set when paymentStatus
// flips to 'paid'. For COD orders that the customer converts to
// online mid-flow → 'online'. For COD orders the delivery partner
// confirms cash for → 'cash' (or 'online' if the partner accepts
// UPI directly outside the app). For regular online-from-checkout
// orders → 'online' (confirmPayment stamps it). MISSING for legacy
// orders predating this PR. paymentMethod stays the customer's
// ORIGINAL choice; paidMethod is the actual.
paidMethod?: 'cash' | 'online';
```

OPTIONAL. Do NOT add to any required-field list — legacy orders
must keep deserializing cleanly.

### B. `payCodOrder` callable (server) — new, ~70 lines

`functions/src/index.ts`, near `retryPayment` (~line 996).

**Auth + preconditions** (transaction-guarded):
- `auth.uid !== order.customerUid` → permission-denied.
- `order.paymentMethod !== 'cod'` → failed-precondition: "Not a COD order."
- `order.paymentStatus === 'paid'` → failed-precondition: "Order already paid." *(Race-guard against partner Part B.)*
- `order.status === 'delivered'` → failed-precondition: "Order already delivered."
- `order.status === 'cancelled'` → failed-precondition: "Order cancelled."

**Logic:**
1. Read the order doc (transaction-guarded so the partner's Part B
   write can't slip in between).
2. Mint a fresh Razorpay session (`razorpay.orders.create({amount:
   order.total * 100, currency: 'INR', receipt: orderId, notes:
   {orderId, customerUid, shopId, codConversion: 'true'}})`).
3. Inside the transaction: write
   `razorpayOrderId: rzpOrder.id`, `paymentStatus: 'pending'`,
   `updatedAt: serverTimestamp()`. **Do not touch `paymentMethod`**
   (locked design: stays `'cod'`).
4. Return `{orderId, total, razorpayOrderId: rzpOrder.id,
   razorpayKeyId}` — same shape as `retryPayment` returns, so the
   client can drop into the existing Razorpay Checkout flow.

**Secrets:** declare `secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET]`
on the `onCall` options, same as `retryPayment`.

**Tests:** new file `tests/functions/payCodOrder.test.ts` (or
extend the existing payment test suite if there's a natural home).
At minimum:
- Auth check (no auth → unauthenticated).
- Not-your-order check.
- Refuses non-COD orders.
- Refuses already-paid orders (race-guard with Part B).
- Refuses delivered/cancelled orders.
- Happy path: returns the right shape; Firestore write sets
  `paymentStatus: 'pending'` + `razorpayOrderId` but leaves
  `paymentMethod` as `'cod'`.

### C. `confirmPayment` — extend with COD-conversion fan-out push

`functions/src/index.ts` ~line 1237 (the "Idempotent paid write"
block). After the existing `ref.update({paymentStatus: 'paid', ...})`
write, check if this was a COD conversion and fan out:

```ts
// After the existing paid write:
const wasCodConversion = order.paymentMethod === 'cod';
if (wasCodConversion) {
  // PR-NEXT-3 — fan-out push on COD → online conversion. Locked
  // design: shop owner + admin + delivery partner (if assigned).
  // Fired here rather than from the `sendOrderStatusPush` trigger
  // because that trigger watches `status` diffs, not paymentStatus
  // diffs; it would either miss this event or double-fire for
  // regular online orders. All three pushes are best-effort with
  // `.catch()` so a push failure cannot fail the paid write.
  try {
    if (order.shopId) {
      const shopSnap = await db.doc(`shops/${order.shopId}`).get();
      const ownerUid = shopSnap.data()?.ownerUid as string | undefined;
      if (ownerUid) {
        pushToOwner(
          ownerUid,
          '💳 Customer paid online',
          `Order #${orderId.slice(0, 6)} — ${order.shopName ?? 'order'} (was COD, now paid)`,
          { orderId, shopId: order.shopId, type: 'order_cod_converted' },
        ).catch(e => console.warn('[confirmPayment] pushToOwner failed:', e));
      }
    }
    pushToAdmins(
      '💳 COD order paid online',
      `Order #${orderId.slice(0, 6)} converted COD → online`,
      { orderId, shopId: order.shopId ?? '', type: 'order_cod_converted' },
    ).catch(e => console.warn('[confirmPayment] pushToAdmins failed:', e));
    if (order.deliveryPersonId) {
      pushToUser(
        order.deliveryPersonId,
        '💳 Payment received — no cash to collect',
        `Order #${orderId.slice(0, 6)} customer paid online`,
        { orderId, type: 'order_cod_converted' },
      ).catch(e => console.warn('[confirmPayment] pushToUser(delivery) failed:', e));
    }
  } catch (e) {
    // Outer catch is defensive — the individual .catch's above
    // should swallow per-push errors, but a defensive net prevents
    // a single misshapen field from blocking the return.
    console.warn('[confirmPayment] COD-conversion fan-out wrapper:', e);
  }
}

// Also set paidMethod = 'online' on the paid write itself.
```

**Important:** stamp `paidMethod: 'online'` in the **same** `ref.update`
call that flips `paymentStatus`. Don't fire a second update — keeps
the doc atomically consistent.

Also add `order_cod_converted` to AuthBootstrap's deep-link router
(see Section H below).

### D. `confirmCodPayment` callable (server) — new, ~50 lines

`functions/src/index.ts`, near `markDelivered` (~line 3387).

```ts
export const confirmCodPayment = onCall<{
  orderId: string;
  paidMethod: 'cash' | 'online';
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const { uid } = requireDeliveryRole(request);
    const { orderId, paidMethod } = request.data ?? {};
    if (!orderId) throw new HttpsError('invalid-argument', 'orderId required');
    if (paidMethod !== 'cash' && paidMethod !== 'online') {
      throw new HttpsError('invalid-argument', "paidMethod must be 'cash' or 'online'");
    }
    const ref = db.doc(`orders/${orderId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', `Order ${orderId} not found`);
    const order = snap.data() as {
      deliveryPersonId: string | null;
      paymentMethod: string;
      paymentStatus?: string;
      status: string;
    };
    if (order.deliveryPersonId !== uid) {
      throw new HttpsError('permission-denied', 'Not the assigned delivery partner');
    }
    if (order.paymentMethod !== 'cod') {
      throw new HttpsError('failed-precondition', 'Not a COD order — confirmation not needed');
    }
    if (order.paymentStatus === 'paid') {
      // Idempotent / race-guard: customer paid online mid-flow.
      return { ok: true as const, alreadyPaid: true as const };
    }
    if (order.status === 'cancelled' || order.status === 'delivered') {
      throw new HttpsError('failed-precondition', `Order is ${order.status}`);
    }
    await ref.update({
      paymentStatus: 'paid',
      paidMethod,
      paidAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      statusHistory: FieldValue.arrayUnion({
        status: 'paid',
        at: Date.now(),
        by: `delivery:${uid}`,
        reason: `Cash payment confirmed by delivery partner (${paidMethod})`,
      }),
    });
    return { ok: true as const, alreadyPaid: false as const };
  },
);
```

**Tests:** new file `tests/functions/confirmCodPayment.test.ts`:
- Auth (no auth, wrong role).
- Not-assigned-partner check.
- Refuses non-COD orders.
- Idempotent on already-paid (returns `alreadyPaid: true`,
  doesn't double-stamp paidMethod).
- Refuses delivered / cancelled.
- Happy path: `paidMethod: 'cash'` and `paidMethod: 'online'`
  both stamp correctly.
- Rejects invalid `paidMethod` ('upi', '', undefined, null).

### E. `markDelivered` — add COD payment precondition

`functions/src/index.ts` ~line 3387. Add a new precondition after
the existing checks:

```ts
// PR-NEXT-3 — refuse to deliver an unpaid COD order. The partner
// must call `confirmCodPayment` first (Part B). Online orders are
// untouched (paymentStatus was set to 'paid' at confirmPayment
// time during the original Razorpay flow, OR via the customer's
// mid-flow COD→online conversion). The customer-flow conversion
// path also lands here as paid, so this gate fires only for true
// "cash on doorstep" deliveries.
if (
  order.paymentMethod === 'cod' &&
  order.paymentStatus !== 'paid'
) {
  throw new HttpsError(
    'failed-precondition',
    'COD order — please confirm payment received before marking delivered',
  );
}
```

Place it after the `status === 'delivered'` idempotent-check (so
re-taps of "Delivered" still short-circuit) and after the
`status !== 'ready_for_pickup'` precondition.

**Tests:** extend the existing `markDelivered` test file:
- COD-unpaid → rejected.
- COD-paid (via confirmCodPayment) → accepted.
- COD-converted-to-online (paymentStatus='paid', paymentMethod still 'cod') → accepted.
- Online order (paymentStatus='paid') → accepted.

### F. Client — orderService wrappers

`src/services/orderService.ts`. Mirror the existing `retryPayment` /
`confirmPayment` shape.

```ts
async payCodOrder(orderId: string): Promise<{
  orderId: string;
  total: number;
  razorpayOrderId: string;
  razorpayKeyId: string;
}> {
  // native + web branches mirroring retryPayment exactly
},

async confirmCodPayment(input: {
  orderId: string;
  paidMethod: 'cash' | 'online';
}): Promise<{ ok: true; alreadyPaid: boolean }> {
  // native + web branches mirroring setDeliveryStatus exactly
},
```

### G. Customer OrderDetailScreen — "Pay online now" button

`src/screens/OrderDetailScreen.tsx`.

**Gating logic** — show the button when ALL true:
- `order.paymentMethod === 'cod'`
- `order.paymentStatus !== 'paid'`
- `order.status` not in `['delivered', 'cancelled']`

**Placement:** inside the existing payment-method section (near the
"Pay on delivery" / "Paid online" labels). Visual treatment: a
medium-prominence primary button under the COD label, e.g.:

```
Payment: Cash on Delivery
[💳 Pay online now]
```

**On tap:**
1. Call `orderService.payCodOrder(order.id)` → get
   `{razorpayOrderId, razorpayKeyId, total}`.
2. Open Razorpay Checkout using the same helper / pattern that
   `CheckoutScreen` and the existing `retryPayment` flow already
   use. Read those files for the exact import + invocation.
3. On Razorpay success → call
   `orderService.confirmPayment({orderId, razorpayPaymentId,
   razorpaySignature})`.
4. On confirm success → show "Paid ✓" toast/Alert, the watcher
   will refresh the order and the button self-hides on the next
   render (paymentStatus is now `'paid'`).
5. On failure at any step → friendly error Alert, button stays
   tappable for retry. Server-side race-guard prevents double-pay.

**Loading state:** disable the button + show "Opening…" spinner
between tap and Razorpay Checkout opening.

**Hooks discipline (Rule 2):** any new `useState` (e.g. `payingOnline`)
sits with the existing OrderDetailScreen state hooks at the top,
above any conditional early returns.

### H. Delivery dashboard — COD confirmation step in ActiveDeliveryCard

`src/screens/delivery/DeliveryDashboardScreen.tsx`,
`ActiveDeliveryCard` component (~line 999).

**Current flow** (already in code):
- `pickedUp === false` → "I've picked it up" button → calls `markPickedUp`.
- `pickedUp === true` → "Delivered" button → calls `markDelivered`.

**New flow for COD orders** when `pickedUp === true`:

```
if (order.paymentMethod === 'cod' && order.paymentStatus !== 'paid') {
  // Render the COD payment selector INSTEAD of the Delivered button.
  // Two pills: [Cash received] [UPI received]
  // Tapping either calls confirmCodPayment({orderId, paidMethod}).
  // On success, the watcher refreshes; paymentStatus becomes 'paid';
  // next render falls through to the existing 'Delivered' button branch.
} else {
  // Existing 'Delivered' button (online orders + COD-converted-online +
  // COD-confirmed-cash). Calls markDelivered.
}
```

**UI sketch:**

```
Payment: Cash on Delivery — ₹240
Confirm payment received:
[💵 Cash received]  [📱 UPI received]
```

`UPI received` covers the case where the partner accepts a UPI
transfer directly outside the app (still records as "paid online"
from the platform's perspective, even though Razorpay didn't
process it). Both result in `confirmCodPayment({orderId,
paidMethod: 'cash' | 'online'})`.

**Loading + race:** disable both pills while a confirm is in
flight. If the server returns `alreadyPaid: true` (customer paid
online concurrently), show a brief "Customer paid online — no
cash needed" toast and fall through to the Delivered button on
the next watcher tick.

**Hooks discipline (Rule 2):** the new state (`confirmingPayment`,
the in-flight method) sits at the top of `DeliveryDashboardScreen`
with the other state hoists, NOT inside ActiveDeliveryCard (Card is
a functional sub-component; lifting state up is consistent with the
existing `pendingAction` pattern in the screen).

### I. AuthBootstrap — deep-link the new push type

`src/components/AuthBootstrap.tsx`. The COD-conversion fan-out
(Section C) emits `type: 'order_cod_converted'`. Add it to the
push-tap routing table:

```ts
if (type === 'order_cod_converted') {
  // Same audience-aware routing as 'order_delivered' / 'order_cancelled'.
  if (auth.isShopOwner && pushShopId && pushShopId === auth.shopId) {
    safeNavigate('ShopOrderDetail', { orderId });
    return;
  }
  if (auth.isAdmin) {
    safeNavigate('AdminOrders');
    return;
  }
  // Delivery partner audience: their push lands them on the order
  // they were going to deliver-with-cash; no cash to collect now.
  safeNavigate('DeliveryOrderDetail', { orderId });
  return;
}
```

Audience precedence matches the existing block for
`order_delivered` / `order_cancelled` (shopOwner with matching
shopId > admin > delivery > customer). The customer never gets
this push — they're the one who initiated it — so no customer
branch needed.

## Tests

Counts after this PR: target ~1000-1010 (was 979 after PR-NEXT-2).

New / extended:
- `tests/functions/payCodOrder.test.ts` — ~10 cases.
- `tests/functions/confirmCodPayment.test.ts` — ~8 cases.
- Extend `tests/functions/confirmPayment.test.ts` — COD-conversion
  fan-out branch (assert the three push calls fire when
  `paymentMethod === 'cod'`, and NOT when `paymentMethod ===
  'online'`).
- Extend `tests/functions/markDelivered.test.ts` (or wherever its
  tests live) — the new COD-unpaid precondition (4 cases).

`npm test` must stay green.

## Deploy plan (server-first — deploy-discipline)

1. Deploy the changed/new functions:
   ```
   firebase deploy --only functions:payCodOrder,functions:confirmCodPayment,functions:confirmPayment,functions:markDelivered
   ```

2. **Verify Cloud Run IAM** on the two NEW public callables (the
   recurring gotcha — fresh callables sometimes deploy without the
   `allUsers` binding):
   ```
   gcloud run services get-iam-policy paycodorder --region=asia-south1
   gcloud run services get-iam-policy confirmcodpayment --region=asia-south1
   ```
   Add `allUsers` / `roles/run.invoker` to either if missing:
   ```
   gcloud run services add-iam-policy-binding <svc> --region=asia-south1 --member=allUsers --role=roles/run.invoker
   ```
   `confirmPayment` and `markDelivered` already exist with bindings —
   they don't need re-verification.

3. Ship the client:
   ```
   eas update --branch production --message "PR-NEXT-3 COD payment conversion + partner confirmation"
   ```
   OTA-safe — no native module / no permission change (react-native-razorpay
   already shipped; permission is "internet" which is global).

## Smoke acceptance (two-device pair)

1. **Part A happy path:** Customer places COD order on device A;
   shopkeeper accepts on device B. Customer opens OrderDetail →
   sees "Pay online now" button → taps → Razorpay opens → completes
   payment → button replaced with "✓ Paid online" line within
   ~2 seconds. Order doc now has
   `paymentMethod: 'cod'`, `paymentStatus: 'paid'`,
   `paidMethod: 'online'`, `razorpayPaymentId: ...`.
2. **Part A fan-out:** Same flow as #1. Within ~5s of the
   confirmPayment success, the shopkeeper device gets a push
   "💳 Customer paid online — was COD, now paid"; admin device
   gets the same; if a delivery partner was already assigned,
   they get "💳 Payment received — no cash to collect." Tapping
   any of those pushes deep-links to the respective order detail
   for that audience.
3. **Part A race-guard:** With the order in your hand mid-payment
   (Razorpay Checkout open but not yet submitted), have the
   delivery partner ALSO try to confirm cash via Part B. Whichever
   call lands second should get a clean rejection ("Order already
   paid" or similar), the order's final state should be consistent
   with whichever call won. No double-write, no doc corruption.
4. **Part B happy path:** Place a COD order, let it run through
   to ready_for_pickup, delivery partner taps "I've picked it
   up." After pickup, the "Delivered" button is NOT shown — the
   COD payment selector is shown instead. Partner taps "Cash
   received" → backend stamps
   `paymentStatus: 'paid'`, `paidMethod: 'cash'`, `paidAt: <ts>`
   → "Delivered" button appears → partner taps it → order
   completes normally. The existing PR-NEXT-1 delivered fan-out
   fires (customer, shop, admin).
5. **Part B refusal:** With a COD-unpaid order in the pickedUp
   state, simulate the partner skipping the confirmation (e.g.,
   via a direct API call from a console). `markDelivered` rejects
   with the new precondition message.
6. **Online order unchanged:** Place a regular online-paid order;
   the partner's flow shows the existing "Delivered" button
   directly (no COD selector). markDelivered accepts immediately.

## Out of scope (do not pull in)

- COD-fee surcharges or differential pricing. (Order total stays
  identical whether paid by cash or online.)
- Receipt generation. Settlement records are on the order doc;
  formal receipt PDF is a later feature.
- Push to customer on Part B confirmation. (Customer either tapped
  Pay-online-now themselves OR is handing the partner cash in
  person — no notification needed for either.)
- Adding `'pending_cod_conversion'` as a new `PaymentStatus` enum
  value. Decision: reuse `'pending'` after `payCodOrder` mints the
  Razorpay session; the COD-vs-original-online distinction is read
  from `paymentMethod === 'cod'`, not from a special status.
- Reverse path (online → COD). Locked design says no.
- Partner-side audit log of which payments they collected. Available
  via existing audit log queries; no dedicated screen in this PR.

## Update doc trail after shipping

1. Mark finding #12 SHIPPED in
   `docs/TESTING-FINDINGS-2026-05-30.md` (both Parts A and B done).
2. Mark sub-(b) of #16 SHIPPED (the COD payment confirmation
   piece — leaves only sub-(c) delivery proof photo and sub-(d)
   evidence-view-in-order-detail for PR-NEXT-6).
3. Append SESSION_LOG entry covering the COD-conversion pattern
   and the direct-push-from-confirmPayment design choice (so a
   future PR adding another `paymentStatus` transition doesn't
   accidentally re-add this logic to the `sendOrderStatusPush`
   trigger).
4. Bump test suite count in `CLAUDE.md` Current state.
