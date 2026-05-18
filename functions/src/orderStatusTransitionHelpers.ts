/**
 * PR 12 — Pure validation for the `updateOrderStatus` callable.
 *
 * The callable accepts:
 *   { orderId, status, readyByEstimate? }
 *
 * `readyByEstimate` rules:
 *   - status === 'accepted'  : REQUIRED. Must be a finite number and
 *                              strictly in the future (>= now).
 *   - status === 'preparing' : OPTIONAL. If present, same future-
 *                              timestamp validation. Used to update
 *                              the ETA mid-prep when the shop is
 *                              running late.
 *   - any other status       : IGNORED. The transition doesn't carry
 *                              an ETA semantically (ready_for_pickup,
 *                              delivered, cancelled).
 *
 * Returns a discriminated union — same posture as
 * `customerCancelWindowHelpers.ts`, `validateBulkMenuRequest`, etc.
 * The Cloud Function maps `{ ok: false, code, message }` directly
 * onto an HttpsError.
 *
 * Kept import-free of firebase-admin / firebase-functions so it
 * runs in plain Node tests.
 */

export type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'ready_for_pickup'
  | 'delivered'
  | 'cancelled';

export type ValidateOrderStatusTransitionInput = {
  status: OrderStatus;
  readyByEstimate?: unknown;
  now: number;
};

export type ValidateOrderStatusTransitionResult =
  | {
      ok: true;
      // The validated, normalised ETA — number when applicable to
      // the transition, undefined otherwise. Callable writes it to
      // the order doc only when defined; this prevents accidentally
      // clearing an existing ETA on a `ready_for_pickup` transition.
      readyByEstimate: number | undefined;
    }
  | {
      ok: false;
      code: 'invalid-argument';
      field: 'readyByEstimate';
      message: string;
    };

export function validateOrderStatusTransition(
  input: ValidateOrderStatusTransitionInput,
): ValidateOrderStatusTransitionResult {
  const { status, readyByEstimate, now } = input;

  // 1. Statuses that don't carry an ETA: drop whatever the client
  //    sent. We don't error here because a v(N+1) client may start
  //    sending readyByEstimate on transitions we don't yet know
  //    about; ignoring is forwards-compatible.
  if (status !== 'accepted' && status !== 'preparing') {
    return { ok: true, readyByEstimate: undefined };
  }

  // 2. `accepted` requires the ETA. `preparing` allows it as an
  //    optional update. Everything else funnelled into branch 1
  //    above already.
  const isAccept = status === 'accepted';
  if (readyByEstimate === undefined || readyByEstimate === null) {
    if (isAccept) {
      return {
        ok: false,
        code: 'invalid-argument',
        field: 'readyByEstimate',
        message: 'readyByEstimate is required when accepting an order',
      };
    }
    // status === 'preparing' with no ETA: legal — caller is just
    // marking the order as preparing without updating the ETA.
    return { ok: true, readyByEstimate: undefined };
  }

  // 3. Type + finiteness check. Reject NaN / Infinity / strings /
  //    objects upfront so the comparison below is unambiguous.
  if (typeof readyByEstimate !== 'number' || !Number.isFinite(readyByEstimate)) {
    return {
      ok: false,
      code: 'invalid-argument',
      field: 'readyByEstimate',
      message: 'readyByEstimate must be a finite number (epoch milliseconds)',
    };
  }

  // 4. Future-timestamp check. We use `>= now` rather than `> now`
  //    so a value computed exactly at the same wall-clock tick as
  //    `now` is accepted; in practice the server adds a non-zero
  //    minute count so this is just defensive.
  if (readyByEstimate < now) {
    return {
      ok: false,
      code: 'invalid-argument',
      field: 'readyByEstimate',
      message: 'readyByEstimate must be in the future',
    };
  }

  return { ok: true, readyByEstimate };
}
