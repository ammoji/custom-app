# PR 2 — Payment hardening (Windsurf prompt)

## Why this PR exists

PR 1 closed the security holes around delivery-partner self-grant and
role-mirror writes. PR 2 closes the **payment** holes from the May 17
code review. These are the highest-stakes items in the whole
prelaunch checklist because every bug here is real money — either
charged-but-not-acknowledged, paid-but-cancelled-without-refund, or
double-charged.

Seven items, grouped by item-number from the code review:

1. No refund flow exists — paid orders can be cancelled with no
   Razorpay refund call, no audit trail. Money stays with merchant.
2. Webhook flips `paid → failed` on out-of-order events.
3. Amount mismatch flags the order but still marks it `paid`.
4. No server-side payment confirmation — client trusts Razorpay
   Checkout's success callback; webhook is the only verification.
5. `cleanupAbandonedOrders` will cancel paid orders if webhook is
   delayed beyond 24h.
6. `retryPayment` orphans the previous Razorpay order — double-charge
   edge case.
7. `payment.authorized` events ignored — risk if Razorpay auto-capture
   toggles off.

The full review is in `PRELAUNCH_CHECKLIST.md` under "Code review
findings (May 17 2026) → PR 2 — Payment hardening (launch blocker)".

**Refund policy decision (already made):** auto-refund on cancel.
Admin/shop-owner clicks "Cancel and refund" on a paid order, types a
reason, confirms; server calls Razorpay refund API, writes audit doc,
flips order to `refunded`. No undo window in MVP.

## Staged deploy (split inside one PR)

This PR is intentionally split into two phases so the server-only
hardening can land first, get observed for a day, then the
client-facing changes ship after. **Same git PR, two deploy
windows.** Don't bundle the deploys.

- **Phase A (server-only, backward-compatible):** items 2, 3, 5, 6, 7
  + new PaymentStatus enum values. No client code changes. Existing
  client unaffected — webhook still works as today's primary path,
  just now with idempotency + amount-mismatch fix + cleanup
  safeguard.
- **Phase B (server + client, requires OTA):** items 1 + 4. New
  `confirmPayment` + `cancelPaidOrder` callables, CheckoutScreen
  integration, admin/shop cancel-button UX rework, `updateOrderStatus`
  rejects paid-cancellation.

Build both phases in the same git PR. Deploy Phase A, wait 24h,
deploy Phase B.

## Read first

- `.windsurf/test-discipline.md` — tests run **once at end** + the
  deliberate-break demo. `npm test` is the runner.
- `.windsurf/deploy-discipline.md` — one `--only` target per command,
  no pipes, no auto-deploy from Windsurf.
- `functions/src/index.ts` — current webhook handler (search for
  `razorpayWebhook` or `payment.captured`), current `placeOrder`,
  `retryPayment`, `cleanupAbandonedOrders`, `updateOrderStatus`.
  This is the file most affected.
- `functions/src/deliveryRequestHelpers.ts` — the helper-extraction
  pattern PR 1 set up. PR 2 should mirror it.
- `functions/src/onlineDeliveryCountHelpers.ts` — also a reference
  for discriminated `{ ok }` union helpers.
- `tests/contracts/orderReadAuth.parity.test.ts` — the parity test
  pattern. PR 2 extends it for the two new callables.
- `src/screens/CheckoutScreen.tsx` — Razorpay Checkout success
  callback is where `confirmPayment` needs to be wired in.
- `src/screens/admin/AdminOrdersScreen.tsx` + 
  `src/screens/shop/ShopOwnerDashboardScreen.tsx` — admin/shop
  cancel-button UI lives here.
- `src/types/index.ts` — `PaymentStatus` and `Order` types live here.

## Scope (in)

### Phase A — Server-only hardening

#### A.1 — Webhook event dedup (item 2)

1. **New collection** `razorpayWebhookEvents/{eventId}` with schema:
   ```ts
   {
     id: string,           // razorpay's x-razorpay-event-id header
     type: string,         // 'payment.captured', 'payment.failed', etc.
     orderId?: string,     // our order id if extractable from payload
     razorpayOrderId?: string,
     processedAt: number,  // epoch ms
   }
   ```
2. **Firestore rule** for the new collection:
   ```
   match /razorpayWebhookEvents/{eventId} {
     allow read, write: if false;  // server-only via Admin SDK
   }
   ```
3. **At the top of `razorpayWebhook` handler**, after HMAC
   verification:
   - Extract event ID from `req.body.payload.payment.entity.id`
     PLUS `req.headers['x-razorpay-event-id']` (Razorpay sends both;
     prefer header, fall back to body). Compose a stable dedup key:
     `${eventId}` if header exists, else `${eventType}:${paymentId}`.
   - Check `razorpayWebhookEvents/{dedupKey}` via Admin SDK.
   - If exists → `res.status(200).send('OK (already processed)')` and
     return. No further work.
   - If not exists → proceed with handler, then at the END (after
     the order doc update), write the dedup doc via
     `transaction.set` (so dedup write + order write are atomic).

#### A.2 — Webhook payment.failed must not downgrade paid (item 2 part 2)

In the existing `case 'payment.failed':` branch of the webhook
handler, **before** writing the failed status:
```ts
if (order.paymentStatus === 'paid') {
  console.warn('[webhook] ignoring payment.failed for already-paid order', orderId);
  return res.status(200).send('OK (already paid, ignoring late failed event)');
}
```
This is a belt-and-suspenders guard on top of A.1's dedup. Razorpay's
event ordering can be inverted under network partition; idempotency
+ this guard together close that path.

#### A.3 — Amount mismatch handling (item 3)

Add `'amount_mismatch'` to the `PaymentStatus` union in
`src/types/index.ts`.

In `functions/src/index.ts` webhook handler `case 'payment.captured':`,
where the current code checks amount and (incorrectly) marks paid
with `amountMismatch: true`:

```ts
const amountReceivedRupees = payment.amount / 100;
const expectedRupees = order.total;
if (Math.abs(amountReceivedRupees - expectedRupees) > 0.01) {
  // DO NOT mark paid. Write a separate status and alert admin.
  await orderRef.update({
    paymentStatus: 'amount_mismatch',
    razorpayPaymentId: payment.id,
    paidAt: tsFromSeconds(payment.created_at),
    amountReceived: amountReceivedRupees,
    amountExpected: expectedRupees,
    statusHistory: FieldValue.arrayUnion({
      status: 'amount_mismatch',
      at: Date.now(),
      by: 'razorpay-webhook',
      reason: `Received ₹${amountReceivedRupees}, expected ₹${expectedRupees}`,
    }),
  });
  await pushToAdmins({
    title: 'Payment amount mismatch',
    body: `Order #${orderId}: received ₹${amountReceivedRupees}, expected ₹${expectedRupees}. Review required.`,
    data: { orderId, kind: 'payment_amount_mismatch' },
  });
  return res.status(200).send('OK (amount mismatch flagged)');
}
```

The order is **NOT** flowing into the shop's dashboard as paid. Shop
won't dispatch. Admin must manually reconcile.

#### A.4 — cleanupAbandonedOrders safeguard (item 5)

In `cleanupAbandonedOrders` (the scheduled function), before
cancelling each abandoned order:

```ts
if (order.paymentMethod === 'online' && order.razorpayOrderId) {
  try {
    const payments = await razorpay.orders.fetchPayments(order.razorpayOrderId);
    const captured = payments.items?.find(p => p.status === 'captured');
    if (captured) {
      // Webhook was delayed. Mark paid instead of cancelling.
      await orderRef.update({
        paymentStatus: 'paid',
        razorpayPaymentId: captured.id,
        paidAt: tsFromSeconds(captured.created_at),
        statusHistory: FieldValue.arrayUnion({
          status: 'paid',
          at: Date.now(),
          by: 'cleanup-reconciliation',
          reason: 'Captured payment found during abandonment sweep — webhook was delayed',
        }),
      });
      console.log('[cleanup] reconciled paid order', order.id, '— skipping cancel');
      continue;
    }
    const authorized = payments.items?.find(p => p.status === 'authorized');
    if (authorized) {
      // Authorized-but-not-captured. Don't cancel; let admin review.
      console.warn('[cleanup] order', order.id, 'has authorized payment — skipping cancel for admin review');
      await pushToAdmins({
        title: 'Order with stuck authorization',
        body: `Order #${order.id} has an authorized but uncaptured Razorpay payment. Manual review required.`,
        data: { orderId: order.id, kind: 'stuck_authorization' },
      });
      continue;
    }
  } catch (e) {
    console.error('[cleanup] fetchPayments failed for', order.id, e);
    // Defensive: if we can't verify, DON'T cancel. Skip and let next sweep retry.
    continue;
  }
}
// No captured/authorized payment → proceed with existing cancel logic.
```

#### A.5 — retryPayment guard (item 6)

In `retryPayment`, BEFORE creating the new Razorpay order:

```ts
const oldPayments = await razorpay.orders.fetchPayments(order.razorpayOrderId);
const oldCaptured = oldPayments.items?.find(p => p.status === 'captured');
if (oldCaptured) {
  throw new HttpsError(
    'failed-precondition',
    'A previous payment for this order was captured. Refresh and check your order status.',
  );
}
const oldAuthorized = oldPayments.items?.find(p => p.status === 'authorized');
if (oldAuthorized) {
  throw new HttpsError(
    'failed-precondition',
    'A previous payment for this order is being processed. Please wait a minute and refresh.',
  );
}
// Otherwise OK to rotate.
```

#### A.6 — payment.authorized handler (item 7)

Add `'authorized'` to the `PaymentStatus` union.

In the webhook switch statement, add a new case BEFORE the
`payment.captured` case:

```ts
case 'payment.authorized': {
  const payment = event.payload.payment.entity;
  const orderRef = db.collection('orders').doc(orderIdFromPayment(payment));
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    console.warn('[webhook] payment.authorized for unknown order', payment.id);
    return res.status(200).send('OK (unknown order)');
  }
  const order = orderSnap.data()!;
  // Idempotency: if already paid (captured), skip.
  if (order.paymentStatus === 'paid') {
    return res.status(200).send('OK (already paid)');
  }
  await orderRef.update({
    paymentStatus: 'authorized',
    razorpayPaymentId: payment.id,
    authorizedAt: tsFromSeconds(payment.created_at),
    statusHistory: FieldValue.arrayUnion({
      status: 'authorized',
      at: Date.now(),
      by: 'razorpay-webhook',
      reason: 'Payment authorized but not yet captured',
    }),
  });
  await pushToAdmins({
    title: 'Payment authorized, not captured',
    body: `Order #${order.id} payment authorized. Manual capture or refund required (Razorpay dashboard).`,
    data: { orderId: order.id, kind: 'payment_authorized_uncaptured' },
  });
  return res.status(200).send('OK (authorized, pending capture)');
}
```

#### A.7 — PaymentStatus type additions

In `src/types/index.ts`, expand the union:
```ts
export type PaymentStatus =
  | 'pending'           // existing
  | 'paid'              // existing
  | 'failed'            // existing
  | 'expired'           // existing
  | 'not_required'      // existing (COD)
  | 'authorized'        // NEW (A.6)
  | 'amount_mismatch'   // NEW (A.3)
  | 'refunded'          // NEW (Phase B)
  | 'refund_pending'    // NEW (Phase B)
  | 'refund_failed';    // NEW (Phase B)
```

Add corresponding `Order` fields used by the new statuses:
```ts
amountReceived?: number;
amountExpected?: number;
authorizedAt?: number;
refundId?: string;
refundedAt?: number;
cancellationReason?: string;
```

### Phase B — confirmPayment + refund flow

#### B.1 — `confirmPayment` callable (item 4)

1. **New helper file** `functions/src/confirmPaymentHelpers.ts` with
   pure functions:
   ```ts
   export function verifyRazorpaySignature(input: {
     razorpayOrderId: string;
     razorpayPaymentId: string;
     razorpaySignature: string;
     keySecret: string;
   }): { ok: true } | { ok: false; reason: string };
   ```
   Use `crypto.createHmac('sha256', keySecret)`, concatenate
   `razorpayOrderId + '|' + razorpayPaymentId`, hex-encode, compare
   with `crypto.timingSafeEqual` on Buffer-converted values. **Do
   NOT** use `===` — timingSafeEqual is the textbook approach to
   prevent timing attacks. The webhook handler already uses it; same
   pattern here.

2. **New callable** `confirmPayment` in `functions/src/index.ts`:
   ```ts
   export const confirmPayment = onCall<{
     orderId: string;
     razorpayPaymentId: string;
     razorpaySignature: string;
   }>(
     { cors: true, enforceAppCheck: false },
     async (request) => {
       const auth = request.auth;
       if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
       const { orderId, razorpayPaymentId, razorpaySignature } = request.data;
       if (!orderId || !razorpayPaymentId || !razorpaySignature) {
         throw new HttpsError('invalid-argument', 'orderId, razorpayPaymentId, razorpaySignature required');
       }
       const orderRef = db.collection('orders').doc(orderId);
       const snap = await orderRef.get();
       if (!snap.exists) throw new HttpsError('not-found', 'Order not found');
       const order = snap.data()!;
       if (order.customerUid !== auth.uid) {
         throw new HttpsError('permission-denied', 'Not your order');
       }
       if (!order.razorpayOrderId) {
         throw new HttpsError('failed-precondition', 'Order has no Razorpay session');
       }
       // Idempotent: already paid → no-op success.
       if (order.paymentStatus === 'paid') {
         return { ok: true, alreadyPaid: true };
       }
       const verify = verifyRazorpaySignature({
         razorpayOrderId: order.razorpayOrderId,
         razorpayPaymentId,
         razorpaySignature,
         keySecret: RAZORPAY_KEY_SECRET.value(),
       });
       if (!verify.ok) {
         throw new HttpsError('permission-denied', `Signature verification failed: ${verify.reason}`);
       }
       // Idempotent paid write. Webhook will arrive later and find
       // already-paid → skip (per A.2 guard).
       await orderRef.update({
         paymentStatus: 'paid',
         razorpayPaymentId,
         paidAt: Date.now(),
         statusHistory: FieldValue.arrayUnion({
           status: 'paid',
           at: Date.now(),
           by: 'client-confirm',
           reason: 'Confirmed via confirmPayment callable',
         }),
       });
       return { ok: true, alreadyPaid: false };
     },
   );
   ```

3. **Client method** in `src/services/orderService.ts`:
   ```ts
   async confirmPayment(args: { orderId, razorpayPaymentId, razorpaySignature }):
     Promise<{ ok: boolean; alreadyPaid?: boolean }>;
   ```
   Dispatches to RNFB on native, web SDK on web. Same posture as the
   PR 1 delivery callables.

4. **CheckoutScreen integration** in `src/screens/CheckoutScreen.tsx`:
   - Find the Razorpay success callback (search for `handler:` or
     `razorpay_payment_id` in the file).
   - Before navigating to `OrderConfirmation`, call
     `orderService.confirmPayment({ orderId, razorpayPaymentId, razorpaySignature })`.
   - Show a brief "Confirming payment..." overlay/spinner during the
     call (Loader fullScreen is fine).
   - On success: navigate to OrderConfirmation as today.
   - On failure: show error toast/alert ("Couldn't confirm payment.
     We'll verify in the background — please check Orders in a few
     minutes."). Navigate to OrderConfirmation anyway. The webhook
     is the backup path and will mark the order paid when it
     arrives.

#### B.2 — `cancelPaidOrder` callable (refund flow — item 1)

1. **New collection** `refunds/{refundId}` with schema:
   ```ts
   {
     id: string,                    // Razorpay refund id (rfnd_XXX)
     orderId: string,                // our order id
     paymentId: string,              // Razorpay payment id (pay_XXX)
     amount: number,                 // rupees
     reason: string,                 // admin's typed reason
     status: 'pending' | 'processed' | 'failed',
     initiatedBy: string,            // admin uid
     initiatedAt: number,            // epoch ms
     processedAt?: number,           // epoch ms (when Razorpay confirmed)
     failedAt?: number,              // epoch ms (if status='failed')
     failureReason?: string,         // Razorpay's error message
   }
   ```
2. **Firestore rules**:
   ```
   match /refunds/{refundId} {
     allow read: if isAdmin()
       || (isSignedIn() && resource.data.initiatedBy == request.auth.uid);
     allow write: if false;  // Server-only
   }
   ```
3. **New helper file** `functions/src/cancelPaidOrderHelpers.ts`:
   ```ts
   export function validateCancelPaidOrder(input: {
     auth: { uid: string; token?: { admin?: unknown; shopOwner?: unknown; shopId?: unknown } } | null;
     order: { customerUid: string; shopId: string; paymentMethod: string; paymentStatus?: string; razorpayPaymentId?: string } | null;
     reason: unknown;
   }): { ok: true; uid: string; reason: string } | { ok: false; code: ErrorCode; message: string };
   ```
   Allow admin OR shopOwner-of-this-shop. Require:
   - order exists
   - paymentMethod === 'online'
   - paymentStatus === 'paid' (not 'refund_pending' / 'refunded' / 'refund_failed')
   - razorpayPaymentId present
   - reason is non-empty string, trimmed, capped 280 chars
4. **New callable** `cancelPaidOrder({ orderId, reason })`:
   - Validate via the helper
   - Transactionally:
     - Set order.paymentStatus = 'refund_pending', cancellationReason
     - Create refund doc with status='pending'
   - Call `razorpay.payments.refund(paymentId, { speed: 'normal', notes: { orderId, reason } })`
   - On Razorpay success:
     - Update refund doc: status='processed' (if razorpay returns processed) or keep 'pending' (Razorpay's response status). Set processedAt if processed.
     - Update order: paymentStatus='refunded', status='cancelled', refundId, refundedAt
     - Append statusHistory entry
     - Push customer notification: "Your order #X has been cancelled. ₹Y will be refunded to your original payment method in 5-7 business days."
   - On Razorpay failure:
     - Update refund doc: status='failed', failedAt, failureReason
     - Update order: paymentStatus='refund_failed' (NOT 'cancelled' — order is still active until refund succeeds)
     - Push admin alert: "Refund for order #X failed. Manual intervention required."
     - Throw HttpsError so the client knows it failed

#### B.3 — `updateOrderStatus` rejects paid-cancel (item 1 part 2)

In `updateOrderStatus`, add a guard:
```ts
if (newStatus === 'cancelled' && order.paymentStatus === 'paid') {
  throw new HttpsError(
    'failed-precondition',
    'Paid orders must be cancelled via the Cancel & Refund flow (cancelPaidOrder).',
  );
}
```

#### B.4 — Admin + shop cancel UI rework

In `src/screens/admin/AdminOrdersScreen.tsx` and 
`src/screens/shop/ShopOwnerDashboardScreen.tsx`:

- Existing cancel button on **unpaid** orders: unchanged (calls
  `updateOrderStatus({ newStatus: 'cancelled' })`).
- For **paid** orders: rename button to "Cancel & Refund". Tapping
  opens a confirm modal:
  - Title: "Cancel and refund ₹X?"
  - Body: "The customer will be refunded via Razorpay (5-7 days).
    This cannot be undone."
  - Required text input: "Reason for cancellation"
  - Confirm button (red): "Cancel and refund" → calls
    `orderService.cancelPaidOrder({ orderId, reason })`
  - Optimistic UI: while pending, button shows "Refunding..." and
    is disabled.
- New chip / banner styling:
  - `paymentStatus === 'refund_pending'` → orange "Refunding..." chip
  - `paymentStatus === 'refunded'` → green "Refunded" chip
  - `paymentStatus === 'refund_failed'` → red banner: "Refund failed
    — [Retry refund] / [Contact support]". Retry calls
    `cancelPaidOrder` again (idempotent via the order-status guard).
  - `paymentStatus === 'amount_mismatch'` → red banner: "Payment
    amount mismatch — admin must manually reconcile". No actions.
  - `paymentStatus === 'authorized'` → orange banner: "Payment
    authorized but not captured — review on Razorpay dashboard".

5. **New client method** in `orderService.ts`:
   ```ts
   async cancelPaidOrder(args: { orderId: string; reason: string }):
     Promise<{ ok: boolean }>;
   ```

### Tests (per `.windsurf/test-discipline.md`)

Add the following test files:

- `tests/functions/razorpayWebhookHelpers.test.ts` — extracted dedup
  helper, amount mismatch detection, idempotency-against-downgrade.
- `tests/functions/cleanupReconciliation.test.ts` — pure helper for
  the "is there a captured payment?" check (mock fetchPayments).
- `tests/functions/retryPaymentHelpers.test.ts` — pure helper for
  the old-order check.
- `tests/functions/confirmPaymentHelpers.test.ts` — HMAC verify
  (this is the deliberate-break demo target — weaken to `===` or
  delete verify entirely → "rejects forged signature" test should
  fail by name).
- `tests/functions/cancelPaidOrderHelpers.test.ts` — refund
  eligibility, status guard, reason validation, admin OR shopOwner
  auth.
- `tests/contracts/orderReadAuth.parity.test.ts` — extend with
  caller × role matrix for `confirmPayment` (auth + own-order) and
  `cancelPaidOrder` (admin OR shopOwner-of-shop).

Pure helpers go in their own files (mirroring PR 1's
`deliveryRequestHelpers.ts`):
- `functions/src/webhookDedupHelpers.ts`
- `functions/src/cleanupReconciliationHelpers.ts`
- `functions/src/retryPaymentHelpers.ts`
- `functions/src/confirmPaymentHelpers.ts`
- `functions/src/cancelPaidOrderHelpers.ts`

Each helper returns the discriminated `{ ok: true; ... } | { ok: false; code; message }`
union. Callable wraps with `HttpsError`.

Required test count: ≥ 30 new tests across these files (the spec
has 7 fixes and each needs 3-5 tests on average).

## Scope (out — explicitly defer)

- **Partial refunds** — MVP refunds the full order amount. Item-
  level refunds (customer cancelled 2 of 5 items) are a v2 feature.
- **Refund speed customization** — always use Razorpay 'normal'
  speed (5-7 days, no extra fee). 'optimum' (instant, fee applies)
  is v2.
- **Auto-capture of authorized payments** — `payment.authorized`
  handler just flags + alerts. Auto-capture logic is v2.
- **Refund reconciliation report** — admin dashboard view of all
  refunds is v2; for MVP they check `refunds/` collection in
  Firestore Console.
- **Customer-initiated refund request** — only admin/shop owner can
  initiate refunds in MVP. Customer self-serve refund is v2.
- **Webhook event retry queue** — if the webhook handler throws
  (rare), Razorpay retries automatically. We don't need our own
  queue.
- **60-second undo on cancel-and-refund** — decided against this in
  the design; auto-refund fires immediately on confirm.
- **App Check enforcement on the new callables** — same as existing
  callables (`enforceAppCheck: false`). Tracked separately.

## Acceptance checklist

### Phase A

- [ ] `razorpayWebhookEvents/{eventId}` collection created (rules
      deny all client access).
- [ ] Webhook handler does dedup check at the top, writes dedup doc
      atomically at the end.
- [ ] `payment.failed` early-returns if order is already paid.
- [ ] Amount mismatch path writes `'amount_mismatch'` status (NOT
      `'paid'`), pushes admin alert.
- [ ] `cleanupAbandonedOrders` calls `fetchPayments` before
      cancelling; reconciles paid orders, skips authorized ones with
      admin alert.
- [ ] `retryPayment` rejects if old order has captured or
      authorized payment.
- [ ] `payment.authorized` event handler added; writes `'authorized'`
      status, pushes admin alert.
- [ ] `PaymentStatus` type union includes 'authorized',
      'amount_mismatch', 'refunded', 'refund_pending', 'refund_failed'.
- [ ] `Order` type includes amountReceived, amountExpected,
      authorizedAt, refundId, refundedAt, cancellationReason.
- [ ] All Phase A pure helpers extracted; each has ≥3 tests.

### Phase B

- [ ] `confirmPayment` callable added + deployed. HMAC verify uses
      `crypto.timingSafeEqual`.
- [ ] `cancelPaidOrder` callable added + deployed. Refund doc written;
      Razorpay refund API called; rollback path writes
      `refund_failed`.
- [ ] `refunds/{refundId}` collection created; rules allow admin
      read + initiator read; deny write.
- [ ] `updateOrderStatus` rejects `cancelled` newStatus on paid
      orders.
- [ ] `CheckoutScreen` calls `confirmPayment` from Razorpay success
      callback BEFORE navigating; failure path navigates anyway and
      relies on webhook.
- [ ] AdminOrdersScreen + ShopOwnerDashboard cancel button shows
      "Cancel & Refund" with reason modal for paid orders.
- [ ] New banner styles for amount_mismatch, authorized,
      refund_pending, refund_failed, refunded.
- [ ] Parity test extended for confirmPayment + cancelPaidOrder.
- [ ] Deliberate-break demo on `confirmPaymentHelpers` HMAC verify.

### Both phases

- [ ] `npm test` passes. New test count ≥ 30.
- [ ] `npx tsc --noEmit` — 0 new errors (baseline preserved).
- [ ] `npm run audit:indexes` passes. The new `refunds` queries (if
      any — likely none) and `razorpayWebhookEvents` don't need
      composite indexes; verify.

## Deploy plan (hand to user; do NOT execute)

Per `.windsurf/deploy-discipline.md`, one target per command, no
pipes, hand off to PowerShell.

### Phase A deploy (server-only, no OTA)

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# Rules first (new razorpayWebhookEvents collection)
firebase deploy --only firestore:rules --project grocery-mvp-dev

# Updated functions (no new callables in Phase A — all are existing
# functions getting updated):
firebase deploy --only functions:razorpayWebhook,functions:cleanupAbandonedOrders,functions:retryPayment --project grocery-mvp-dev

# Verify
firebase functions:list --project grocery-mvp-dev
```

**Wait 24 hours** observing webhook events in logs (Cloud Console →
Functions → razorpayWebhook → Logs). Look for:
- Dedup messages: `OK (already processed)` on Razorpay retries
- No spurious `payment.failed` → `paid → failed` downgrade
- Amount mismatch path: nothing should hit it in normal flow
- cleanupAbandonedOrders reconciliation: log per-order outcome

### Phase B deploy (server + client)

```powershell
# Rules update for refunds collection
firebase deploy --only firestore:rules --project grocery-mvp-dev

# New callables
firebase deploy --only functions:confirmPayment,functions:cancelPaidOrder --project grocery-mvp-dev

# Updated callables (updateOrderStatus gets the paid-cancel guard)
firebase deploy --only functions:updateOrderStatus --project grocery-mvp-dev

# Verify
firebase functions:list --project grocery-mvp-dev

# OTA preview first (admin device gets it first so admin can refund)
eas update --branch preview --message "PR 2 Phase B: payment confirm + refund flow"
```

Test on preview with a real ₹1 order through Razorpay test mode.
Run the full happy path:
1. Place order → payment popup → success → confirmPayment fires →
   order shows paid.
2. Admin cancels paid order → reason modal → confirm → refund_pending
   → Razorpay refund webhook eventually fires → refunded.
3. Verify customer sees "Refunded ₹X" status.

Once confirmed clean: `eas update --branch production`.

## Reporting back

- Output of `npm test` (one final run per discipline).
- Output of `npx tsc --noEmit` (error count, baseline vs new).
- Deliberate-break demo: the test name that failed, the line you
  modified, confirmation of revert.
- List of new files + line counts, grouped by Phase A and Phase B.
- Any deviations from the spec (justified inline).
- The deploy commands you handed back to me, NOT executed.
- Suggested order if you think Phase A and Phase B should ship
  closer together than 24h or further apart.

## Design notes for Windsurf

- **The webhook handler is the most fragile code in the codebase.**
  Read it twice before touching. The HMAC verify at the top is correct
  — don't change that. Everything in this PR happens AFTER signature
  verify.
- **Idempotency is the watchword.** Every write should be safe to
  retry. Every read should tolerate stale data. Razorpay WILL send
  duplicate events; we WILL hit network blips mid-flight.
- **Transactions matter for refund flow.** The "set refund_pending +
  create refund doc" pair MUST be transactional. If Razorpay refund
  API succeeds but our follow-up write fails, we have a stuck order.
  Use `db.runTransaction` for that pair.
- **Don't try to handle every Razorpay error code.** Razorpay's
  error responses are documented but messy. For MVP, catch broadly,
  write status='refund_failed' with the raw error message stored,
  alert admin. They review in Razorpay dashboard.
- **The auto-formatter import-stripping tax** — same as PR 1. Watch
  for `validateXxx`, `canXxx` helper imports getting silently stripped
  on save. After every save run a quick grep against the function
  body usage.
- **Existing orders in flight at deploy time** — Phase B's
  `updateOrderStatus` guard means in-flight admin cancellation
  attempts on paid orders will now fail with a clearer error.
  This is correct behavior. Admin will retry via the new
  cancel-and-refund flow.
- **NOT in scope:** changing the customer-facing UX of the checkout
  screen beyond the new "Confirming payment..." overlay. Cart →
  checkout → Razorpay flow stays as today.
- **Razorpay test mode** is your friend during local development.
  The webhook secret + key id/secret are already in Functions Secret
  Manager (see `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`).
  Don't touch those values; just read them via `defineSecret`.
