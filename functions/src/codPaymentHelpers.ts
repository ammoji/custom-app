/**
 * PR-NEXT-3 — Pure helpers for the COD payment conversion +
 * delivery-partner-confirmation pipeline (finding #12).
 *
 * Three callables share preconditions that are easy to get wrong:
 *
 *   - `payCodOrder` (Part A)         — customer mid-flow convert to online.
 *   - `confirmCodPayment` (Part B)   — partner stamps cash settlement.
 *   - `markDelivered` (gate)         — refuse to deliver unpaid COD.
 *
 * And `confirmPayment` needs to know whether the just-paid order was
 * originally COD so it can fan out the conversion push to shop /
 * admin / delivery (and stamp `paidMethod: 'online'`).
 *
 * Every meaningful decision below is a pure function so the test
 * matrix can pin it without firebase-admin / firebase-functions
 * mocks (mirrors the convention established by
 * `confirmPaymentHelpers.verifyRazorpaySignature`,
 * `retryPaymentHelpers.checkRetryPaymentGuard`,
 * `notificationRadiusHelpers.filterPartnersByNotificationRadius`,
 * `orderStatusTransitionHelpers.validateOrderStatusTransition`).
 *
 * The callables in `index.ts` are tiny IO wrappers: read the order
 * doc → call the helper → on `ok: false`, `throw new HttpsError(code,
 * message)` → on `ok: true`, do the write.
 *
 * Test suite: `tests/functions/codPaymentHelpers.test.ts`.
 */

// ─────────────────────────────────────────────────────────────────
// Common order shape. Loose to match the `as any` reads in
// `index.ts`; the helper does its own field-presence guards so a
// malformed doc surfaces as a clean precondition error rather than
// a TS-bypassed runtime crash.
// ─────────────────────────────────────────────────────────────────

export type CodOrderLike = {
  customerUid?: string;
  deliveryPersonId?: string | null;
  paymentMethod?: string;
  paymentStatus?: string;
  status?: string;
  shopId?: string;
  shopName?: string;
};

export type CodValidationResult =
  | { ok: true }
  | {
      ok: false;
      // Mirrors the HttpsError codes the callables throw. Keeping
      // the same vocabulary so the wrapper just maps 1:1 without
      // re-thinking which code to use.
      code:
        | 'unauthenticated'
        | 'permission-denied'
        | 'failed-precondition'
        | 'invalid-argument';
      message: string;
    };

// ─────────────────────────────────────────────────────────────────
// payCodOrder — customer-initiated COD → online conversion.
// ─────────────────────────────────────────────────────────────────

/**
 * Validates preconditions for the `payCodOrder` callable.
 *
 * Rejects (with the exact code + message the wrapper should throw):
 *   - missing auth → unauthenticated.
 *   - order belongs to someone else → permission-denied.
 *   - order is not COD (`paymentMethod !== 'cod'`) → failed-precondition.
 *   - order is already paid → failed-precondition (race-guard with
 *     `confirmCodPayment` and webhook).
 *   - order is delivered / cancelled → failed-precondition.
 *
 * Does NOT mint the Razorpay session (that's IO). Does NOT write
 * Firestore. Just decides whether the IO should happen.
 */
export function validatePayCodOrderPreconditions(opts: {
  authUid: string | null | undefined;
  order: CodOrderLike | null | undefined;
}): CodValidationResult {
  const { authUid, order } = opts;
  if (typeof authUid !== 'string' || authUid.length === 0) {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    };
  }
  if (!order) {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Order not found',
    };
  }
  if (order.customerUid !== authUid) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Not your order',
    };
  }
  if (order.paymentMethod !== 'cod') {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Not a COD order',
    };
  }
  if (order.paymentStatus === 'paid') {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Order already paid',
    };
  }
  if (order.status === 'delivered') {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Order already delivered',
    };
  }
  if (order.status === 'cancelled') {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Order cancelled',
    };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────
// confirmCodPayment — delivery-partner cash-confirmation gate.
// ─────────────────────────────────────────────────────────────────

export type PaidMethod = 'cash' | 'online';

export type ConfirmCodPaymentInputResult =
  | { ok: true; orderId: string; paidMethod: PaidMethod }
  | { ok: false; code: 'invalid-argument'; message: string };

/**
 * Input validation for `confirmCodPayment`. Accepts only the two
 * locked-design values (`'cash'` / `'online'`); anything else
 * (`'upi'`, `''`, `undefined`, `null`, numbers, mixed case) is
 * rejected so the server can't end up with a free-text
 * `paidMethod` field that downstream readers don't understand.
 */
export function validateConfirmCodPaymentInput(
  data: { orderId?: unknown; paidMethod?: unknown } | null | undefined,
): ConfirmCodPaymentInputResult {
  const orderId = data?.orderId;
  if (typeof orderId !== 'string' || orderId.length === 0) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'orderId required',
    };
  }
  const paidMethod = data?.paidMethod;
  if (paidMethod !== 'cash' && paidMethod !== 'online') {
    return {
      ok: false,
      code: 'invalid-argument',
      message: "paidMethod must be 'cash' or 'online'",
    };
  }
  return { ok: true, orderId, paidMethod };
}

export type ConfirmCodPaymentPreconditionResult =
  | { ok: true; alreadyPaid: false }
  // Idempotent / race-guard case. The wrapper should return
  // `{ ok: true, alreadyPaid: true }` to the client without
  // writing — the customer's mid-flow conversion (Part A) already
  // landed the paid stamp.
  | { ok: true; alreadyPaid: true }
  | {
      ok: false;
      code: 'permission-denied' | 'failed-precondition';
      message: string;
    };

/**
 * Validates preconditions for the `confirmCodPayment` callable's
 * pre-write phase. Returns `alreadyPaid: true` (NOT an error) when
 * the order is already paid — the wrapper short-circuits and the
 * client treats that as success so a stale tap doesn't pop a
 * scary alert.
 */
export function validateConfirmCodPaymentPreconditions(opts: {
  partnerUid: string;
  order: CodOrderLike | null | undefined;
}): ConfirmCodPaymentPreconditionResult {
  const { partnerUid, order } = opts;
  if (!order) {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Order not found',
    };
  }
  if (order.deliveryPersonId !== partnerUid) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Not the assigned delivery partner',
    };
  }
  if (order.paymentMethod !== 'cod') {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Not a COD order — confirmation not needed',
    };
  }
  // Idempotent / race-guard: customer paid online mid-flow.
  // Return ok with the alreadyPaid flag so the wrapper short-
  // circuits without writing.
  if (order.paymentStatus === 'paid') {
    return { ok: true, alreadyPaid: true };
  }
  if (order.status === 'cancelled' || order.status === 'delivered') {
    return {
      ok: false,
      code: 'failed-precondition',
      message: `Order is ${order.status}`,
    };
  }
  return { ok: true, alreadyPaid: false };
}

// ─────────────────────────────────────────────────────────────────
// markDelivered — COD-unpaid gate. Refuses the deliver action if
// the partner skipped the cash-confirmation step.
// ─────────────────────────────────────────────────────────────────

/**
 * Returns `ok: false` iff this order is COD and not yet paid. Used
 * as a precondition INSIDE `markDelivered` so a partner cannot
 * mark a cash-unpaid order delivered without first calling
 * `confirmCodPayment`. Online orders, COD-converted-to-online
 * orders (`paymentMethod === 'cod' && paymentStatus === 'paid'`),
 * and COD-confirmed-cash orders all pass.
 */
export function validateMarkDeliveredCodGate(
  order: CodOrderLike,
): CodValidationResult {
  if (order.paymentMethod === 'cod' && order.paymentStatus !== 'paid') {
    return {
      ok: false,
      code: 'failed-precondition',
      message:
        'COD order — please confirm payment received before marking delivered',
    };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────
// confirmPayment — decides whether to fire the COD-conversion fan-
// out push to shop / admin / delivery.
// ─────────────────────────────────────────────────────────────────

/**
 * Returns true iff this `confirmPayment` invocation just paid an
 * order that was originally COD (i.e. the customer used the
 * "Pay online now" affordance on `OrderDetailScreen` and the
 * Razorpay flow succeeded). Pure decision; the wrapper does the
 * actual `pushToOwner` / `pushToAdmins` / `pushToUser(delivery)`
 * IO.
 *
 * Importantly returns FALSE on the alreadyPaid early-return path,
 * so a webhook that lands second doesn't double-fire the push.
 */
export function shouldFireCodConversionFanout(opts: {
  order: CodOrderLike | null | undefined;
  alreadyPaid: boolean;
}): boolean {
  const { order, alreadyPaid } = opts;
  if (alreadyPaid) return false;
  if (!order) return false;
  return order.paymentMethod === 'cod';
}
