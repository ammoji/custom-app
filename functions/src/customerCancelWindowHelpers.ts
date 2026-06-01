/**
 * PR 7 — Pure helper for the customer self-service cancel window.
 *
 * Allows a customer to cancel their own paid online order within a
 * fixed window after payment captured. After the window expires they
 * must escalate to admin (cancelPaidOrder). The window is a single
 * source of truth — `CUSTOMER_CANCEL_WINDOW_MS` — referenced by both
 * the server callable and the OrderDetailScreen countdown UI.
 *
 * Why 2 minutes (not 5, not 1)? Pre-launch review:
 *   - Long enough for "I just paid and immediately changed my mind"
 *     (typical mistake-tap window is <30s).
 *   - Short enough that shop owners aren't blindsided — they
 *     usually accept within a minute on weekday lunch traffic.
 *   - Aligned with Swiggy / Zomato's de-facto window for
 *     "instant cancel" before the kitchen-acks the order.
 *
 * Strict-equality checks on order fields (paymentMethod === 'online',
 * paymentStatus === 'paid', status === 'pending') match the rest of
 * the codebase's posture — truthy checks have bitten us in the
 * shopOwner / admin claim space (see PRs 5, 6) and we don't want a
 * stringified 'true' or similar accident here either.
 *
 * Rejects when:
 *   - Caller is unauthenticated.
 *   - Order is null (treat as not-found; the callable wraps this).
 *   - Caller is not the order's customer.
 *   - paymentMethod is COD (cancel-pending flow handles those).
 *   - paymentStatus is anything but 'paid' (refunds, failed, etc.
 *     must go through cancelPaidOrder or stay in their current state).
 *   - status has progressed past 'pending' (shop has acknowledged;
 *     escalate to admin).
 *   - paidAt missing/non-numeric.
 *   - paidAt is in the future (clock skew defense).
 *   - Now - paidAt > CUSTOMER_CANCEL_WINDOW_MS (window expired).
 *
 * Inputs are kept narrow / `unknown`-typed so callers don't have to
 * reach into firebase-admin's DecodedIdToken type — pure-helper
 * posture, same as cancelPaidOrderHelpers + shopSettingsHelpers.
 *
 * Pinned by tests/functions/customerCancelWindowHelpers.test.ts.
 */

export const CUSTOMER_CANCEL_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

export type CancelWindowInput = {
  auth: { uid: string } | null | undefined;
  order:
    | {
        customerUid?: unknown;
        paymentMethod?: unknown;
        paymentStatus?: unknown;
        paidAt?: unknown;
        status?: unknown;
      }
    | null
    | undefined;
  // Injected (not Date.now() inside) so day/window boundaries are
  // deterministic in tests — same posture as formatRelativeDeliveryTime
  // and adminStats.
  now: number;
};

export type CancelWindowResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'unauthenticated'
        | 'permission-denied'
        | 'not-found'
        | 'failed-precondition';
      message: string;
    };

export function canCustomerCancelPaidOrder(
  input: CancelWindowInput,
): CancelWindowResult {
  const { auth, order, now } = input;

  // 1. Auth gate.
  if (!auth || typeof auth.uid !== 'string' || auth.uid.length === 0) {
    return { ok: false, code: 'unauthenticated', message: 'Sign in required' };
  }

  // 2. Existence.
  if (!order) {
    return { ok: false, code: 'not-found', message: 'Order not found' };
  }

  // 3. Ownership — only the customer who placed the order can use
  //    this self-service window. Admin uses cancelPaidOrder instead.
  if (order.customerUid !== auth.uid) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Not your order',
    };
  }

  // 4. Method gate. COD orders are handled by cancelMyPendingOrder
  //    (no money to refund). Strict equality — see file-level note.
  if (order.paymentMethod !== 'online') {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Only paid online orders can be cancelled in-window',
    };
  }

  // 5. Payment-state gate.
  if (order.paymentStatus !== 'paid') {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Only paid orders can be cancelled in-window',
    };
  }

  // 6. Order-state gate. Once a shop accepts (status flips past
  //    'pending'), cancelling becomes a refund-with-context decision
  //    that needs admin involvement.
  if (order.status !== 'pending') {
    return {
      ok: false,
      code: 'failed-precondition',
      message: `Order is already ${String(
        order.status,
      )}. Contact support to cancel.`,
    };
  }

  // 7. paidAt sanity. The webhook always sets this when flipping
  //    paymentStatus to 'paid', so missing == data corruption.
  //
  // PR-NEXT-HOTFIX-2 — Firestore `serverTimestamp()` is stored as a
  // `Timestamp` object on read (not millis). The original
  // `typeof order.paidAt !== 'number'` check always failed in
  // production because the Admin SDK hands the raw `Timestamp` back
  // to us — the webhook at `functions/src/index.ts:1383` + `:3930`
  // writes `paidAt: FieldValue.serverTimestamp()`. Accept BOTH
  // shapes: plain millis numbers (test fixtures + any caller that
  // pre-normalizes) AND Timestamp-likes (everything from a real
  // Firestore read). The `paidAtMillis <= 0` clause rejects a
  // Timestamp at the Unix epoch (cannot represent a real payment).
  //
  // Same pattern as HOTFIX-1 applied to
  // `validateDeliveryProofUploadAuth`. See
  // `.windsurf/code-discipline.md` Rule 12 — Firestore `Timestamp`
  // reads are NOT plain millis numbers.
  const rawPaidAt: unknown = order.paidAt;
  const paidAtMillis: number | null =
    typeof rawPaidAt === 'number'
      ? rawPaidAt
      : typeof (rawPaidAt as { toMillis?: unknown })?.toMillis === 'function'
        ? (rawPaidAt as { toMillis: () => number }).toMillis()
        : null;
  if (
    paidAtMillis === null ||
    !Number.isFinite(paidAtMillis) ||
    paidAtMillis <= 0
  ) {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Order has no paid timestamp',
    };
  }

  const elapsed = now - paidAtMillis;

  // 8. Clock-skew defense. A future paidAt could mean a malicious
  //    client wrote a synthetic doc OR a clock-skew between regions.
  //    Either way, reject defensively — the customer can re-try
  //    immediately or escalate to admin.
  if (elapsed < 0) {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Order timestamps invalid',
    };
  }

  // 9. Window expiry. `>` not `>=` so the boundary moment counts as
  //    in-window — the customer who taps at exactly 2:00 still gets
  //    through. Pinned by the boundary test.
  if (elapsed > CUSTOMER_CANCEL_WINDOW_MS) {
    return {
      ok: false,
      code: 'failed-precondition',
      message:
        'Cancellation window has expired. Contact support if you need help.',
    };
  }

  return { ok: true };
}
