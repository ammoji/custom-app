/**
 * Unit tests for `canCustomerCancelPaidOrder`.
 *
 * Pins the customer-cancel window policy. Deliberate-break demo
 * target: weaken `canCustomerCancelPaidOrder` to skip the window
 * check (return ok regardless of elapsed) — the test
 * "rejects orders past the 2-minute window" goes red; that's the
 * central guard the helper exists to enforce.
 */
import {
  CUSTOMER_CANCEL_WINDOW_MS,
  canCustomerCancelPaidOrder,
} from '../../functions/src/customerCancelWindowHelpers';

const baseAuth = { uid: 'cust_001' };

// Helper: minimal "happy path" order shape, with overridable fields.
const makeOrder = (overrides: Record<string, unknown> = {}) => ({
  customerUid: 'cust_001',
  paymentMethod: 'online',
  paymentStatus: 'paid',
  status: 'pending',
  paidAt: 1_000_000,
  ...overrides,
});

describe('CUSTOMER_CANCEL_WINDOW_MS constant', () => {
  test('is exactly 2 minutes (single source of truth)', () => {
    // Pinning the constant value protects against an accidental
    // change (e.g. someone "tightening" it to 30s without realising
    // the UI countdown reads the same constant).
    expect(CUSTOMER_CANCEL_WINDOW_MS).toBe(120_000);
  });
});

describe('canCustomerCancelPaidOrder — auth + ownership', () => {
  test('rejects unauthenticated callers', () => {
    const r = canCustomerCancelPaidOrder({
      auth: null,
      order: makeOrder(),
      now: 1_000_500,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  test('rejects auth with empty uid', () => {
    const r = canCustomerCancelPaidOrder({
      auth: { uid: '' },
      order: makeOrder(),
      now: 1_000_500,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  test('rejects null order with not-found', () => {
    const r = canCustomerCancelPaidOrder({
      auth: baseAuth,
      order: null,
      now: 1_000_500,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not-found');
  });

  test('rejects orders owned by a different customer', () => {
    const r = canCustomerCancelPaidOrder({
      auth: baseAuth,
      order: makeOrder({ customerUid: 'cust_OTHER' }),
      now: 1_000_500,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });
});

describe('canCustomerCancelPaidOrder — payment + status gates', () => {
  test('rejects COD orders (failed-precondition)', () => {
    const r = canCustomerCancelPaidOrder({
      auth: baseAuth,
      order: makeOrder({ paymentMethod: 'cod', paymentStatus: undefined }),
      now: 1_000_500,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('failed-precondition');
      expect(r.message).toMatch(/online/i);
    }
  });

  test('rejects unpaid online orders (paymentStatus=pending)', () => {
    const r = canCustomerCancelPaidOrder({
      auth: baseAuth,
      order: makeOrder({ paymentStatus: 'pending' }),
      now: 1_000_500,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('failed-precondition');
  });

  test('rejects already-refunded orders (defense in depth)', () => {
    // Even though the UI shouldn't surface the cancel button for
    // refunded orders, the server still rejects the call.
    const r = canCustomerCancelPaidOrder({
      auth: baseAuth,
      order: makeOrder({ paymentStatus: 'refunded' }),
      now: 1_000_500,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('failed-precondition');
  });

  // One test per non-pending status — parameterised. Catches the
  // "shop already accepted, must escalate" path.
  test.each(['accepted', 'preparing', 'ready_for_pickup', 'delivered', 'cancelled'])(
    'rejects status=%s (must escalate to admin)',
    statusValue => {
      const r = canCustomerCancelPaidOrder({
        auth: baseAuth,
        order: makeOrder({ status: statusValue }),
        now: 1_000_500,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('failed-precondition');
        expect(r.message).toMatch(new RegExp(statusValue, 'i'));
      }
    },
  );
});

describe('canCustomerCancelPaidOrder — paidAt + window math', () => {
  test('rejects when paidAt is missing', () => {
    const r = canCustomerCancelPaidOrder({
      auth: baseAuth,
      order: makeOrder({ paidAt: undefined }),
      now: 1_000_500,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('failed-precondition');
      expect(r.message).toMatch(/timestamp/i);
    }
  });

  test('rejects when paidAt is non-numeric (NaN)', () => {
    const r = canCustomerCancelPaidOrder({
      auth: baseAuth,
      order: makeOrder({ paidAt: NaN }),
      now: 1_000_500,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('failed-precondition');
  });

  test('rejects when paidAt is in the future (clock skew)', () => {
    // paidAt > now → elapsed < 0 → reject defensively.
    const r = canCustomerCancelPaidOrder({
      auth: baseAuth,
      order: makeOrder({ paidAt: 2_000_000 }),
      now: 1_000_000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('failed-precondition');
      expect(r.message).toMatch(/invalid/i);
    }
  });

  test('accepts within window (1 min after paid)', () => {
    const paidAt = 1_000_000;
    const r = canCustomerCancelPaidOrder({
      auth: baseAuth,
      order: makeOrder({ paidAt }),
      now: paidAt + 60_000, // 1 min in
    });
    expect(r.ok).toBe(true);
  });

  test('accepts at exactly the boundary (2:00 — inclusive)', () => {
    // The window is "<=", so 120_000 ms (exactly 2:00) is in.
    const paidAt = 1_000_000;
    const r = canCustomerCancelPaidOrder({
      auth: baseAuth,
      order: makeOrder({ paidAt }),
      now: paidAt + CUSTOMER_CANCEL_WINDOW_MS,
    });
    expect(r.ok).toBe(true);
  });

  test('rejects orders past the 2-minute window (canonical guard)', () => {
    // Deliberate-break demo target: this is the test that goes red
    // when the window check is removed.
    const paidAt = 1_000_000;
    const r = canCustomerCancelPaidOrder({
      auth: baseAuth,
      order: makeOrder({ paidAt }),
      now: paidAt + CUSTOMER_CANCEL_WINDOW_MS + 1_000, // 2:01 in
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('failed-precondition');
      expect(r.message).toMatch(/expired/i);
    }
  });

  test('accepts at exactly paidAt (now === paidAt; elapsed=0)', () => {
    // Sanity: the lower bound. Tapping the button on the exact
    // millisecond paid should obviously work.
    const paidAt = 1_000_000;
    const r = canCustomerCancelPaidOrder({
      auth: baseAuth,
      order: makeOrder({ paidAt }),
      now: paidAt,
    });
    expect(r.ok).toBe(true);
  });

  // PR-NEXT-HOTFIX-2 — the bug-class repetition this hotfix closes.
  // Production webhook writes `paidAt: FieldValue.serverTimestamp()`
  // (see `functions/src/index.ts:1383` + `:3930`); the Admin SDK
  // hands the field back as a Firestore `Timestamp` object on read,
  // not as millis. Pre-hotfix the validator's `typeof !== 'number'`
  // check rejected every real production cancel attempt with
  // "Order has no paid timestamp" — fully blocking the customer
  // self-service cancel window for paid online orders. Razorpay's
  // suspension during the May 30 pilot kept this bug latent; the
  // moment Razorpay restores, this is a pilot-blocker.
  //
  // Mirrors HOTFIX-1's `validateDeliveryProofUploadAuth` widening.

  test('PR-NEXT-HOTFIX-2 — accepts Firestore Timestamp-like (the actual production shape)', () => {
    const paidAtMillis = 1_000_000;
    const timestampLike = { toMillis: () => paidAtMillis };
    const r = canCustomerCancelPaidOrder({
      auth: baseAuth,
      order: makeOrder({ paidAt: timestampLike }),
      now: paidAtMillis + 60_000, // 1 min in — well inside the window
    });
    expect(r.ok).toBe(true);
  });

  test('PR-NEXT-HOTFIX-2 — Timestamp-like at epoch 0 → failed-precondition', () => {
    // Defensive: a Timestamp at Unix epoch 0 cannot represent a real
    // payment event. Reject the same way a missing paidAt does.
    const zeroTs = { toMillis: () => 0 };
    const r = canCustomerCancelPaidOrder({
      auth: baseAuth,
      order: makeOrder({ paidAt: zeroTs }),
      now: 60_000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('failed-precondition');
      expect(r.message).toMatch(/timestamp/i);
    }
  });

  test('PR-NEXT-HOTFIX-2 — Timestamp-like with non-finite millis → failed-precondition', () => {
    // Hostile / malformed Timestamp returning NaN or Infinity must
    // not pass the gate.
    const badTs = { toMillis: () => NaN };
    const r = canCustomerCancelPaidOrder({
      auth: baseAuth,
      order: makeOrder({ paidAt: badTs }),
      now: 60_000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('failed-precondition');
  });

  test('PR-NEXT-HOTFIX-2 — object without toMillis → failed-precondition (defensive)', () => {
    // An object that's NOT Timestamp-shaped (no `.toMillis` method)
    // must not silently pass. Falls through to the null branch.
    const r = canCustomerCancelPaidOrder({
      auth: baseAuth,
      order: makeOrder({ paidAt: { foo: 'bar' } }),
      now: 60_000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('failed-precondition');
  });

  test('PR-NEXT-HOTFIX-2 — Timestamp-like + window boundary still respects elapsed math', () => {
    // Compose the Timestamp-like fix with the existing
    // window-boundary semantics: at exactly CUSTOMER_CANCEL_WINDOW_MS
    // elapsed, the answer is still ok (inclusive boundary — matches
    // the `accepts at exactly the boundary` test above).
    const paidAtMillis = 1_000_000;
    const timestampLike = { toMillis: () => paidAtMillis };
    const r = canCustomerCancelPaidOrder({
      auth: baseAuth,
      order: makeOrder({ paidAt: timestampLike }),
      now: paidAtMillis + CUSTOMER_CANCEL_WINDOW_MS,
    });
    expect(r.ok).toBe(true);
  });

  test('PR-NEXT-HOTFIX-2 — Timestamp-like past the window expires the same as numeric', () => {
    const paidAtMillis = 1_000_000;
    const timestampLike = { toMillis: () => paidAtMillis };
    const r = canCustomerCancelPaidOrder({
      auth: baseAuth,
      order: makeOrder({ paidAt: timestampLike }),
      now: paidAtMillis + CUSTOMER_CANCEL_WINDOW_MS + 1_000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('failed-precondition');
      expect(r.message).toMatch(/expired/i);
    }
  });
});
