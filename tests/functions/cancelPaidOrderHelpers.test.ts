import { validateCancelPaidOrder } from '../../functions/src/cancelPaidOrderHelpers';

const PAID_ORDER = {
  customerUid: 'cust1',
  shopId: 'shop1',
  paymentMethod: 'online',
  paymentStatus: 'paid',
  razorpayPaymentId: 'pay_xyz',
};

describe('validateCancelPaidOrder — auth', () => {
  test('admin can refund any paid order', () => {
    const r = validateCancelPaidOrder({
      auth: { uid: 'admin1', token: { admin: true } },
      order: PAID_ORDER,
      reason: 'customer requested',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.role).toBe('admin');
  });

  test('shop owner of THIS shop can refund', () => {
    const r = validateCancelPaidOrder({
      auth: {
        uid: 'owner1',
        token: { shopOwner: true, shopId: 'shop1' },
      },
      order: PAID_ORDER,
      reason: 'out of stock',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.role).toBe('shopOwner');
  });

  test('shop owner of a DIFFERENT shop is rejected (multi-tenant breach guard)', () => {
    const r = validateCancelPaidOrder({
      auth: {
        uid: 'owner2',
        token: { shopOwner: true, shopId: 'shop2' },
      },
      order: PAID_ORDER,
      reason: 'whatever',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('plain customer / delivery / unsigned cannot refund', () => {
    const cases: Array<
      Parameters<typeof validateCancelPaidOrder>[0]['auth']
    > = [
      null,
      { uid: 'c1', token: {} },
      { uid: 'c1', token: { admin: false } },
    ];
    for (const auth of cases) {
      const r = validateCancelPaidOrder({
        auth,
        order: PAID_ORDER,
        reason: 'r',
      });
      expect(r.ok).toBe(false);
    }
  });

  test('shopOwner claim without shopId is rejected', () => {
    const r = validateCancelPaidOrder({
      auth: { uid: 'o', token: { shopOwner: true } },
      order: PAID_ORDER,
      reason: 'r',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });
});

describe('validateCancelPaidOrder — state machine', () => {
  test('rejects unpaid order (use cancelMyPendingOrder for those)', () => {
    const r = validateCancelPaidOrder({
      auth: { uid: 'a', token: { admin: true } },
      order: { ...PAID_ORDER, paymentStatus: 'pending' },
      reason: 'r',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('failed-precondition');
  });

  test('rejects already-refunded order (idempotency at the server)', () => {
    const r = validateCancelPaidOrder({
      auth: { uid: 'a', token: { admin: true } },
      order: { ...PAID_ORDER, paymentStatus: 'refunded' },
      reason: 'r',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('failed-precondition');
  });

  test('rejects refund_pending (in-flight already)', () => {
    const r = validateCancelPaidOrder({
      auth: { uid: 'a', token: { admin: true } },
      order: { ...PAID_ORDER, paymentStatus: 'refund_pending' },
      reason: 'r',
    });
    expect(r.ok).toBe(false);
  });

  test('rejects amount_mismatch (those need manual reconciliation)', () => {
    const r = validateCancelPaidOrder({
      auth: { uid: 'a', token: { admin: true } },
      order: { ...PAID_ORDER, paymentStatus: 'amount_mismatch' },
      reason: 'r',
    });
    expect(r.ok).toBe(false);
  });

  test('rejects COD orders (no Razorpay payment to refund)', () => {
    const r = validateCancelPaidOrder({
      auth: { uid: 'a', token: { admin: true } },
      order: { ...PAID_ORDER, paymentMethod: 'cod', paymentStatus: 'paid' },
      reason: 'r',
    });
    expect(r.ok).toBe(false);
  });

  test('rejects order with missing razorpayPaymentId', () => {
    const r = validateCancelPaidOrder({
      auth: { uid: 'a', token: { admin: true } },
      order: { ...PAID_ORDER, razorpayPaymentId: undefined },
      reason: 'r',
    });
    expect(r.ok).toBe(false);
  });
});

describe('validateCancelPaidOrder — reason validation', () => {
  test('empty reason rejected', () => {
    const r = validateCancelPaidOrder({
      auth: { uid: 'a', token: { admin: true } },
      order: PAID_ORDER,
      reason: '   ',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('non-string reason rejected', () => {
    const r = validateCancelPaidOrder({
      auth: { uid: 'a', token: { admin: true } },
      order: PAID_ORDER,
      reason: 42,
    });
    expect(r.ok).toBe(false);
  });

  test('reason longer than 280 chars is truncated, not rejected', () => {
    const long = 'a'.repeat(500);
    const r = validateCancelPaidOrder({
      auth: { uid: 'a', token: { admin: true } },
      order: PAID_ORDER,
      reason: long,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reason.length).toBe(280);
  });

  test('reason is trimmed', () => {
    const r = validateCancelPaidOrder({
      auth: { uid: 'a', token: { admin: true } },
      order: PAID_ORDER,
      reason: '   real reason   ',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reason).toBe('real reason');
  });
});

describe('validateCancelPaidOrder — order not found', () => {
  test('null order → not-found', () => {
    const r = validateCancelPaidOrder({
      auth: { uid: 'a', token: { admin: true } },
      order: null,
      reason: 'r',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not-found');
  });
});
