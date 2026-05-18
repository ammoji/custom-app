# PR 7 — Customer cancel window + ShopOwnerDashboard UX mirror (Windsurf prompt)

## Why this PR exists

Two unrelated-but-coherent items bundled because they're both
small client+server changes and they'd otherwise sit in the queue
waiting for one of them to grow.

**Part 1: Customer cancel window.** Currently customers can only
cancel UNPAID orders (`cancelMyPendingOrder`). Once they pay, only
admin/shop owner can cancel via the refund flow. Every "I changed
my mind right after paying" becomes a support request. Most
delivery apps (Swiggy / Zomato / Dunzo) give customers a short
self-service window — 1-2 minutes after payment — to cancel their
own order and auto-refund. After the window closes, it requires
admin escalation. We add a 2-minute window: customer taps "Cancel
order" within 2 min of paid timestamp → server validates +
triggers the same refund flow `cancelPaidOrder` uses.

**Part 2: ShopOwnerDashboard UX mirror.** During the PR 5 hotfix we
added pull-to-refresh and delivery-substate display to
AdminOrdersScreen. Shop owner dashboard has the same UX gaps:
10s polling lag and macro-status-only display (jumps from "Out
for Delivery" to "Delivered" with no intermediate visibility).
Mirror the same fixes here. Shop owners don't get the "Manual
override disclosure" treatment because the state machine doesn't
give them a "Mark Delivered" action — they only go up to "Out for
Delivery" in their flow.

JS-only client changes for Part 2; small server addition for Part
1. Single OTA at the end covers both.

## Read first

- `.windsurf/test-discipline.md` and `.windsurf/deploy-discipline.md`.
- `src/screens/admin/AdminOrdersScreen.tsx` — **reference pattern**
  for Part 2. Copy the `refreshing` state + RefreshControl wiring +
  delivery substate timeline + styles (`deliveryFlow`, `flowStepPending`,
  `flowStepDone`).
- `functions/src/index.ts` — `cancelPaidOrder` callable (recent PR
  2 hotfix) is the closest pattern for Part 1's new callable. It
  already has the Razorpay refund execution logic; we'll extract a
  shared helper.
- `functions/src/cancelPaidOrderHelpers.ts` — pure validation
  helper for cancelPaidOrder. Mirror the posture for the new helper.
- `src/screens/OrdersScreen.tsx` — customer's order list. Add
  cancel UI here for in-window paid orders.
- `src/screens/OrderDetailScreen.tsx` — customer's per-order
  detail. Add cancel UI here too (same flow).
- `src/services/orderService.ts` — `cancelMyPendingOrder` is the
  closest client-method pattern for the new
  `cancelMyRecentPaidOrder`.

## Scope (in)

### Part 1 — Customer cancel window

#### 1a. Pure helper for window check

New file `functions/src/customerCancelWindowHelpers.ts`:

```ts
/**
 * Pure helper for the customer self-service cancel-after-paid
 * window. Returns whether a paid order is still within the
 * cancellation window AND the caller is the order's customer.
 *
 * Window length is a constant (2 min) — kept here, not on the shop
 * doc, because varying it per-shop introduces operator complexity
 * and isn't a MVP requirement. Revisit if real shops push back.
 *
 * Pinned by tests/functions/customerCancelWindowHelpers.test.ts.
 */
export const CUSTOMER_CANCEL_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

export type CancelWindowInput = {
  auth: { uid: string } | null | undefined;
  order: {
    customerUid?: string;
    paymentMethod?: string;
    paymentStatus?: string;
    paidAt?: number | null;
    status?: string;
  } | null;
  now: number; // injected for deterministic tests
};

export type CancelWindowResult =
  | { ok: true }
  | {
      ok: false;
      code: 'unauthenticated' | 'permission-denied' | 'not-found' | 'failed-precondition';
      message: string;
    };

export function canCustomerCancelPaidOrder(
  input: CancelWindowInput,
): CancelWindowResult {
  const { auth, order, now } = input;
  if (!auth) {
    return { ok: false, code: 'unauthenticated', message: 'Sign in required' };
  }
  if (!order) {
    return { ok: false, code: 'not-found', message: 'Order not found' };
  }
  if (order.customerUid !== auth.uid) {
    return { ok: false, code: 'permission-denied', message: 'Not your order' };
  }
  if (order.paymentMethod !== 'online' || order.paymentStatus !== 'paid') {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Only paid online orders can be cancelled in-window',
    };
  }
  // Don't allow cancel once shop has progressed past pending (i.e.
  // they've started preparing). If status is already accepted /
  // preparing / out_for_delivery / delivered / cancelled, the window
  // doesn't apply — must escalate to admin.
  if (order.status !== 'pending') {
    return {
      ok: false,
      code: 'failed-precondition',
      message: `Order is already ${order.status}. Contact support to cancel.`,
    };
  }
  if (typeof order.paidAt !== 'number' || !Number.isFinite(order.paidAt)) {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Order has no paid timestamp',
    };
  }
  const elapsed = now - order.paidAt;
  if (elapsed > CUSTOMER_CANCEL_WINDOW_MS) {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Cancellation window has expired. Contact support if you need help.',
    };
  }
  if (elapsed < 0) {
    // Clock-skew defense. Future paidAt is suspect; reject defensively
    // and let admin handle.
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Order timestamps invalid',
    };
  }
  return { ok: true };
}
```

Tests in `tests/functions/customerCancelWindowHelpers.test.ts`
(≥10 cases):
- Unauthenticated → unauthenticated
- Order null → not-found
- Different customer → permission-denied
- COD order → failed-precondition (only paid online)
- Unpaid order → failed-precondition
- Status != pending (accepted, preparing, etc) → failed-precondition
  (one test per status — parameterize)
- paidAt missing → failed-precondition
- paidAt in future (clock skew) → failed-precondition
- Within window (1 min after paid) → ok
- Just past window (2:01 after paid) → failed-precondition
- Right at window boundary (exactly 2:00) → ok

#### 1b. Extract shared refund-execution helper

The existing `cancelPaidOrder` callable in `functions/src/index.ts`
contains the Razorpay refund execution + audit-doc write +
order-status update logic. The new `cancelMyRecentPaidOrder` needs
the same refund execution. Extract a shared helper:

New file `functions/src/refundExecutionHelpers.ts`:

```ts
/**
 * Pure-ish helper that wraps the Razorpay refund call + the
 * post-refund Firestore writes (refund audit doc + order status
 * flip). Pulled out of cancelPaidOrder so customer-cancel and
 * admin-cancel share the same execution path.
 *
 * NOT a pure function (does Firestore + Razorpay IO), but the IO
 * boundaries are injected so the helper itself is testable with
 * stubs. The actual cancelPaidOrder / cancelMyRecentPaidOrder
 * callables become thin auth-validate + executeRefund wrappers.
 */
export type RefundExecutionInput = {
  orderId: string;
  paymentId: string;
  amount: number; // rupees
  reason: string;
  initiatedBy: string; // admin uid OR customer uid
  initiatedByRole: 'admin' | 'shopOwner' | 'customer';
  // Injected IO so unit tests can stub:
  razorpayRefund: (paymentId: string, amount: number) => Promise<{ id: string; status: string }>;
  writeRefundDoc: (doc: unknown) => Promise<void>;
  updateOrder: (updates: unknown) => Promise<void>;
};

export async function executeRefund(input: RefundExecutionInput): Promise<{ refundId: string }>;
```

Refactor `cancelPaidOrder` to call this helper (existing tests
should still pass).

Tests in `tests/functions/refundExecutionHelpers.test.ts` (≥6
cases):
- Successful refund writes audit doc + updates order
- Razorpay returns 'processed' → order.paymentStatus = 'refunded'
- Razorpay returns 'pending' → order.paymentStatus = 'refund_pending'
- Razorpay throws → audit doc status = 'failed' + order
  paymentStatus = 'refund_failed' + throws upstream
- initiatedByRole = 'customer' is recorded in the audit doc
- amount mismatch (rounding) is rejected

#### 1c. New callable `cancelMyRecentPaidOrder`

In `functions/src/index.ts`, after `cancelPaidOrder`:

```ts
export const cancelMyRecentPaidOrder = onCall<{
  orderId: string;
  reason?: string;
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const { orderId } = request.data;
    if (!orderId || typeof orderId !== 'string') {
      throw new HttpsError('invalid-argument', 'orderId required');
    }
    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();
    const order = orderSnap.exists ? (orderSnap.data() as any) : null;

    const validated = canCustomerCancelPaidOrder({
      auth: request.auth ? { uid: request.auth.uid } : null,
      order,
      now: Date.now(),
    });
    if (!validated.ok) {
      throw new HttpsError(validated.code, validated.message);
    }

    // Reuse the shared executeRefund helper. Use the customer's own
    // reason if provided, else a default. initiatedBy = customer uid.
    const reason = (request.data?.reason ?? '').toString().trim().slice(0, 280)
      || 'Customer cancelled within window';
    const refund = await executeRefund({
      orderId,
      paymentId: order.razorpayPaymentId,
      amount: order.total,
      reason,
      initiatedBy: request.auth!.uid,
      initiatedByRole: 'customer',
      razorpayRefund: razorpayPaymentsRefund, // existing exported binding
      writeRefundDoc: doc => db.collection('refunds').doc((doc as any).id).set(doc),
      updateOrder: updates => orderRef.update(updates),
    });
    return { ok: true, refundId: refund.refundId };
  },
);
```

#### 1d. Client `orderService.cancelMyRecentPaidOrder`

Standard dual-dispatch method:

```ts
async cancelMyRecentPaidOrder(input: {
  orderId: string;
  reason?: string;
}): Promise<{ ok: boolean; refundId: string }> { ... }
```

#### 1e. Client UI on OrderDetailScreen + OrdersScreen

Add a "Cancel order" button on the customer's order screens when:
- `order.paymentMethod === 'online'`
- `order.paymentStatus === 'paid'`
- `order.status === 'pending'`
- `Date.now() - order.paidAt < CUSTOMER_CANCEL_WINDOW_MS` (2 min)

Show a live countdown next to the button: "Cancel order (1:23 left)".
Use a `setInterval` updated every second to drive the countdown.

When the window expires (live, while the user is on the screen),
the button disappears + a small note replaces it: "Cancellation
window expired. Contact support if you need to cancel."

Tap → confirm dialog ("Cancel this order? You'll be refunded
₹X.") → call `cancelMyRecentPaidOrder` → on success, refresh the
order doc (the watcher will pick up the new state within 5s; we
can also explicitly setState the local copy with paymentStatus =
'refund_pending' / status = 'cancelled' for optimistic UX).

**Where to put the button:**
- On `OrderDetailScreen`: full-width button at the bottom of the
  card, above the "Repeat order" / nav back affordance if any.
- On `OrdersScreen`: small inline button on each order row that
  matches the criteria. Less prominent (since users typically tap
  the row to drill into the detail).

For MVP: put it on `OrderDetailScreen` only. Saves UI complexity
on the list. Customer flow: open Orders → tap the new paid order →
see "Cancel order (1:42 left)" → tap → confirm.

### Part 2 — ShopOwnerDashboard UX mirror

Mirror the AdminOrdersScreen pull-to-refresh + delivery substate
timeline patterns from the recent hotfix. Reference file:
`src/screens/admin/AdminOrdersScreen.tsx`.

Specific changes to `src/screens/shop/ShopOwnerDashboardScreen.tsx`:

1. **Pull-to-refresh**: add `refreshing` state, `RefreshControl`
   wired into the FlatList, clear `refreshing` in the watcher
   callback. Same pattern as AdminOrders. Tap-to-retry on the error
   banner stays as today.

2. **Delivery substate timeline**: render below the status chip
   when `item.status === 'out_for_delivery' || item.status ===
   'delivered'`. Show:
   - `⏳ Awaiting delivery partner` when no `deliveryPersonId`
   - `🛵 Claimed by partner` when `deliveryPersonId` set
   - `📦 Picked up · TIME` when `pickedUpAt` set
   - `✅ Delivered · TIME` when `deliveredAt` set
   
   Copy the styles (`deliveryFlow`, `flowStepPending`, `flowStepDone`)
   verbatim from AdminOrdersScreen.

3. **No override disclosure.** The shop owner's
   `nextActionsFor(status)` for `out_for_delivery` returns
   `['delivered']` — but conceptually they shouldn't mark
   delivered. Hide that button entirely from the shop owner
   dashboard:
   
   ```ts
   const actions = nextActionsFor(item.status).filter(next =>
     next !== 'delivered'  // 'Mark Delivered' is delivery partner's job
   );
   ```
   
   Result: shop owner sees Accept → Start Preparing → Out for
   Delivery → (nothing). After out_for_delivery, the timeline
   shows substates as the delivery partner progresses. If
   something goes wrong (delivery partner ghosted, etc), admin can
   override via AdminOrders.

No new tests for Part 2 — UI-only mirror of an already-tested
pattern.

## Scope (out — explicitly defer)

- **Per-shop configurable cancel window.** MVP uses a fixed 2 min.
  Real shops varying it (some 30s, some 5min) is post-launch.
- **Customer cancel for unpaid online orders** — already covered
  by `cancelMyPendingOrder` if status is pending and paymentStatus
  is undefined. No new path needed.
- **Customer cancel for COD orders** — also covered by
  `cancelMyPendingOrder`. The new window is specifically for the
  paid-online edge case.
- **Push notification to shop owner when customer cancels in
  window.** Useful but adds complexity; the existing watcher
  picks up the state change within 10s.
- **Refund "in-flight to bank" status display.** Razorpay's
  `processed` vs `pending` already drives our paymentStatus; UI
  surfacing the bank-side delay (5-7 days) is good UX but
  deferred.
- **Cancel button on OrdersScreen list rows.** MVP only adds it
  to OrderDetailScreen. List clutter isn't worth it.

## Acceptance checklist

- [ ] `customerCancelWindowHelpers.ts` exists with
      `canCustomerCancelPaidOrder` + `CUSTOMER_CANCEL_WINDOW_MS`
      export + ≥10 tests covering each rejection branch + the
      window boundary.
- [ ] `refundExecutionHelpers.ts` extracted; `cancelPaidOrder`
      refactored to use it; existing PR 2 tests still pass.
- [ ] `cancelMyRecentPaidOrder` callable added in
      `functions/src/index.ts`.
- [ ] `orderService.cancelMyRecentPaidOrder` dual-dispatch client
      method added.
- [ ] OrderDetailScreen renders the cancel button + live countdown
      when criteria met; button disappears when window expires.
- [ ] ShopOwnerDashboardScreen has pull-to-refresh +
      delivery-substate timeline; "Mark Delivered" button filtered
      out of the actions.
- [ ] `tests/contracts/orderReadAuth.parity.test.ts` extended
      with `cancelMyRecentPaidOrder` (customer-only, scoped to
      their own order).
- [ ] `npm test` passes — total ≥ baseline + ~16 new tests
      (10 cancel-window + 6 refund-execution).
- [ ] Deliberate-break demo: weaken
      `canCustomerCancelPaidOrder` to skip the window check
      (allow at any time). Confirm a specific test fails by name
      (suggest "Just past window — failed-precondition" since
      it's the central guard).
- [ ] `npx tsc --noEmit` — 0 new errors (baseline unchanged).
- [ ] `npm run audit:indexes` passes (no new queries).

## Deploy plan (hand to user — NOT executed)

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Functions: new callable + refactored cancelPaidOrder
firebase deploy --only functions:cancelMyRecentPaidOrder --project grocery-mvp-dev
firebase deploy --only functions:cancelPaidOrder --project grocery-mvp-dev
firebase functions:list --project grocery-mvp-dev

# 2. OTA — straight to production per the pattern
eas update --branch production --message "PR 7: customer cancel window + shop dashboard UX"
```

Smoke tests on production phone:

1. **Customer cancel within window**: place a ₹1 paid test order →
   immediately open Order Detail → see "Cancel order (1:XX left)"
   countdown → tap → confirm → status flips to "Refunding…" then
   "Refunded".
2. **Customer cancel after window**: place a paid order → wait 2.5
   min → open Order Detail → "Cancellation window expired" message,
   no button.
3. **Customer cancel on COD order**: place a COD order → open
   Order Detail → no in-window cancel button (existing pending-cancel
   flow still works).
4. **Shop owner pull-to-refresh**: open ShopOwnerDashboard → swipe
   down → spinner → orders refresh.
5. **Shop owner delivery substates**: find an out_for_delivery
   order → confirm timeline shows "Awaiting partner / Claimed /
   Picked up · TIME" as the delivery partner progresses.
6. **Shop owner no "Mark Delivered"**: out_for_delivery card on
   shop dashboard should NOT have a "Mark Delivered" action button
   (that's the delivery partner's job).

## Reporting back

- Output of `npm test` (single final run).
- Output of `npx tsc --noEmit` (error count, baseline vs new).
- Deliberate-break demo: test name that failed, file/line you
  weakened, confirmation of revert.
- New files + line counts.
- Per-affected-file notes on the `cancelPaidOrder` refactor (did
  any existing tests need updating? Should be no — the public
  surface is unchanged).
- The deploy commands handed back — NOT executed.

## Design notes for Windsurf

- `CUSTOMER_CANCEL_WINDOW_MS = 2 * 60 * 1000` is a single source
  of truth. Don't hardcode `120000` anywhere else. Client reads it
  from the helper (or hardcodes the same constant — fine since
  client-side it's just a UX hint; server is the actual gate).
- The live countdown on OrderDetailScreen needs a `useEffect`
  that sets `setInterval(updateCountdown, 1000)` and cleans up on
  unmount. Update a state value the render branch reads
  (`remainingMs` or similar). When `remainingMs <= 0`, swap the
  button for the "Window expired" message in the same render.
- Auto-formatter import-stripping (PRs 1, 2, 4, 5, 6): the new
  imports (`canCustomerCancelPaidOrder`, `executeRefund`,
  `CUSTOMER_CANCEL_WINDOW_MS`) are likely targets. Grep after
  each save.
- The shop-owner "Mark Delivered" filter is a one-line `.filter()`
  call on the `actions` array — don't be tempted to change the
  state machine itself (it's still legal for admin to mark
  delivered via their override). The filter is presentation-only.
- The refactor of `cancelPaidOrder` should be behavior-preserving.
  If you find yourself changing the public API or the response
  shape, stop and ask — that's scope creep.
