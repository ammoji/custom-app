/**
 * PR 2 — payment hardening, Phase B. Pure helpers for the
 * cancelPaidOrder callable (item 1 of the May 17 review — refund
 * flow for paid online orders).
 *
 * Authorization model: caller is admin OR shop-owner-of-this-order.
 * Mirrors updateOrderStatus's posture (functions/src/index.ts ~line
 * 374) — both roles can act on the order, so both can also cancel +
 * refund it. Customer self-serve refund is out of MVP scope.
 *
 * State-machine guard: only a 'paid' order is refundable. 'pending'
 * goes through cancelMyPendingOrder (no Razorpay call). 'refunded' /
 * 'refund_pending' / 'refund_failed' are idempotent or in-flight
 * states; the helper rejects them with a precondition error so the
 * UI can surface "already refunded" / "retry" appropriately.
 *
 * 'amount_mismatch' is also rejected — those orders need manual
 * Razorpay-dashboard reconciliation, not the auto-refund flow.
 */

const REASON_MAX_LEN = 280;

export type CancelPaidOrderInput = {
  auth:
    | {
        uid: string;
        token?: {
          admin?: unknown;
          shopOwner?: unknown;
          shopId?: unknown;
        };
      }
    | null
    | undefined;
  order:
    | {
        customerUid?: unknown;
        shopId?: unknown;
        paymentMethod?: unknown;
        paymentStatus?: unknown;
        razorpayPaymentId?: unknown;
      }
    | null
    | undefined;
  reason: unknown;
};

export type CancelPaidOrderResult =
  | {
      ok: true;
      uid: string;
      role: 'admin' | 'shopOwner';
      reason: string;
    }
  | {
      ok: false;
      code:
        | 'unauthenticated'
        | 'permission-denied'
        | 'not-found'
        | 'failed-precondition'
        | 'invalid-argument';
      message: string;
    };

export function validateCancelPaidOrder(
  input: CancelPaidOrderInput,
): CancelPaidOrderResult {
  const { auth, order, reason } = input;

  if (!auth || typeof auth.uid !== 'string') {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    };
  }

  if (!order) {
    return { ok: false, code: 'not-found', message: 'Order not found' };
  }

  // Reason must be a non-empty trimmed string. Trim + cap at
  // REASON_MAX_LEN so admin can't paste a 5MB blob into the doc.
  if (typeof reason !== 'string') {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'reason is required',
    };
  }
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'reason cannot be empty',
    };
  }
  const cappedReason = trimmed.slice(0, REASON_MAX_LEN);

  // Authorization. Admin OR shop-owner of THIS order's shop. Shop
  // owner with claims.shopId pointing at a different shop is
  // explicitly rejected — keeps a multi-tenant breach impossible.
  const claims = auth.token ?? {};
  const isAdmin = claims.admin === true;
  const isShopOwnerOfThisShop =
    claims.shopOwner === true &&
    typeof claims.shopId === 'string' &&
    claims.shopId === order.shopId;

  if (!isAdmin && !isShopOwnerOfThisShop) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Admin or shop owner of this shop required',
    };
  }

  // State guards.
  if (order.paymentMethod !== 'online') {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Only online-paid orders can be refunded',
    };
  }
  if (order.paymentStatus !== 'paid') {
    return {
      ok: false,
      code: 'failed-precondition',
      message: `Cannot refund order with paymentStatus='${order.paymentStatus}'`,
    };
  }
  if (
    typeof order.razorpayPaymentId !== 'string' ||
    order.razorpayPaymentId.length === 0
  ) {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Order has no razorpayPaymentId — cannot refund',
    };
  }

  return {
    ok: true,
    uid: auth.uid,
    role: isAdmin ? 'admin' : 'shopOwner',
    reason: cappedReason,
  };
}
