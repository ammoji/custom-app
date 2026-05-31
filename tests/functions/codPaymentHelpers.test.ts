/**
 * PR-NEXT-3 — COD payment helpers exhaustive matrix.
 *
 * Pins the precondition logic for all three new/extended callables
 * (payCodOrder, confirmCodPayment, markDelivered's COD gate) and
 * the confirmPayment COD-conversion-fanout decision.
 */

import {
  shouldFireCodConversionFanout,
  validateConfirmCodPaymentInput,
  validateConfirmCodPaymentPreconditions,
  validateMarkDeliveredCodGate,
  validatePayCodOrderPreconditions,
  type CodOrderLike,
} from '../../functions/src/codPaymentHelpers';

// ─────────────────────────────────────────────────────────────────
// payCodOrder
// ─────────────────────────────────────────────────────────────────

describe('PR-NEXT-3 — validatePayCodOrderPreconditions', () => {
  const baseOrder: CodOrderLike = {
    customerUid: 'cust_1',
    paymentMethod: 'cod',
    paymentStatus: 'not_required',
    status: 'preparing',
  };

  test('missing auth → unauthenticated', () => {
    const r = validatePayCodOrderPreconditions({
      authUid: undefined,
      order: baseOrder,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  test('empty-string uid → unauthenticated', () => {
    const r = validatePayCodOrderPreconditions({
      authUid: '',
      order: baseOrder,
    });
    expect(r.ok).toBe(false);
  });

  test('missing order → failed-precondition (not found)', () => {
    const r = validatePayCodOrderPreconditions({
      authUid: 'cust_1',
      order: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('failed-precondition');
      expect(r.message).toMatch(/not found/i);
    }
  });

  test('not your order → permission-denied', () => {
    const r = validatePayCodOrderPreconditions({
      authUid: 'cust_other',
      order: baseOrder,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('non-COD order (paymentMethod=online) → failed-precondition', () => {
    const r = validatePayCodOrderPreconditions({
      authUid: 'cust_1',
      order: { ...baseOrder, paymentMethod: 'online' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('failed-precondition');
      expect(r.message).toMatch(/not a cod order/i);
    }
  });

  test('already paid → failed-precondition (race-guard with Part B)', () => {
    const r = validatePayCodOrderPreconditions({
      authUid: 'cust_1',
      order: { ...baseOrder, paymentStatus: 'paid' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('failed-precondition');
      expect(r.message).toMatch(/already paid/i);
    }
  });

  test('delivered order → failed-precondition', () => {
    const r = validatePayCodOrderPreconditions({
      authUid: 'cust_1',
      order: { ...baseOrder, status: 'delivered' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/delivered/i);
  });

  test('cancelled order → failed-precondition', () => {
    const r = validatePayCodOrderPreconditions({
      authUid: 'cust_1',
      order: { ...baseOrder, status: 'cancelled' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/cancelled/i);
  });

  test('happy path: COD + pending + accepted → ok', () => {
    const r = validatePayCodOrderPreconditions({
      authUid: 'cust_1',
      order: { ...baseOrder, status: 'accepted' },
    });
    expect(r.ok).toBe(true);
  });

  test('happy path: COD + ready_for_pickup → ok (customer can still convert)', () => {
    const r = validatePayCodOrderPreconditions({
      authUid: 'cust_1',
      order: { ...baseOrder, status: 'ready_for_pickup' },
    });
    expect(r.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────
// confirmCodPayment — input validation
// ─────────────────────────────────────────────────────────────────

describe('PR-NEXT-3 — validateConfirmCodPaymentInput', () => {
  test('null data → invalid-argument', () => {
    const r = validateConfirmCodPaymentInput(null);
    expect(r.ok).toBe(false);
  });

  test('missing orderId → invalid-argument', () => {
    const r = validateConfirmCodPaymentInput({ paidMethod: 'cash' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/orderId/);
  });

  test('empty orderId → invalid-argument', () => {
    const r = validateConfirmCodPaymentInput({
      orderId: '',
      paidMethod: 'cash',
    });
    expect(r.ok).toBe(false);
  });

  test("rejects paidMethod='upi'", () => {
    const r = validateConfirmCodPaymentInput({
      orderId: 'ord_1',
      paidMethod: 'upi',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/cash.*online/i);
  });

  test('rejects empty paidMethod', () => {
    const r = validateConfirmCodPaymentInput({
      orderId: 'ord_1',
      paidMethod: '',
    });
    expect(r.ok).toBe(false);
  });

  test('rejects missing paidMethod', () => {
    const r = validateConfirmCodPaymentInput({ orderId: 'ord_1' });
    expect(r.ok).toBe(false);
  });

  test('rejects null paidMethod', () => {
    const r = validateConfirmCodPaymentInput({
      orderId: 'ord_1',
      paidMethod: null,
    });
    expect(r.ok).toBe(false);
  });

  test('rejects non-string paidMethod (number)', () => {
    const r = validateConfirmCodPaymentInput({
      orderId: 'ord_1',
      paidMethod: 123,
    });
    expect(r.ok).toBe(false);
  });

  test("accepts paidMethod='cash'", () => {
    const r = validateConfirmCodPaymentInput({
      orderId: 'ord_1',
      paidMethod: 'cash',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.orderId).toBe('ord_1');
      expect(r.paidMethod).toBe('cash');
    }
  });

  test("accepts paidMethod='online'", () => {
    const r = validateConfirmCodPaymentInput({
      orderId: 'ord_1',
      paidMethod: 'online',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.paidMethod).toBe('online');
  });
});

// ─────────────────────────────────────────────────────────────────
// confirmCodPayment — preconditions
// ─────────────────────────────────────────────────────────────────

describe('PR-NEXT-3 — validateConfirmCodPaymentPreconditions', () => {
  const baseOrder: CodOrderLike = {
    deliveryPersonId: 'partner_1',
    paymentMethod: 'cod',
    paymentStatus: 'not_required',
    status: 'ready_for_pickup',
  };

  test('missing order → failed-precondition (not found)', () => {
    const r = validateConfirmCodPaymentPreconditions({
      partnerUid: 'partner_1',
      order: null,
    });
    expect(r.ok).toBe(false);
  });

  test('not the assigned partner → permission-denied', () => {
    const r = validateConfirmCodPaymentPreconditions({
      partnerUid: 'other_partner',
      order: baseOrder,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('non-COD order → failed-precondition', () => {
    const r = validateConfirmCodPaymentPreconditions({
      partnerUid: 'partner_1',
      order: { ...baseOrder, paymentMethod: 'online' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/not a cod order/i);
  });

  test('idempotent / race-guard: already paid → ok with alreadyPaid=true', () => {
    const r = validateConfirmCodPaymentPreconditions({
      partnerUid: 'partner_1',
      order: { ...baseOrder, paymentStatus: 'paid' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.alreadyPaid).toBe(true);
  });

  test('order delivered → failed-precondition', () => {
    const r = validateConfirmCodPaymentPreconditions({
      partnerUid: 'partner_1',
      order: { ...baseOrder, status: 'delivered' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/delivered/i);
  });

  test('order cancelled → failed-precondition', () => {
    const r = validateConfirmCodPaymentPreconditions({
      partnerUid: 'partner_1',
      order: { ...baseOrder, status: 'cancelled' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/cancelled/i);
  });

  test('happy path: COD + ready_for_pickup → ok with alreadyPaid=false', () => {
    const r = validateConfirmCodPaymentPreconditions({
      partnerUid: 'partner_1',
      order: baseOrder,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.alreadyPaid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// markDelivered — COD gate
// ─────────────────────────────────────────────────────────────────

describe('PR-NEXT-3 — validateMarkDeliveredCodGate', () => {
  test('COD + unpaid → blocked', () => {
    const r = validateMarkDeliveredCodGate({
      paymentMethod: 'cod',
      paymentStatus: 'not_required',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('failed-precondition');
      expect(r.message).toMatch(/confirm payment/i);
    }
  });

  test('COD + paid (via confirmCodPayment) → ok', () => {
    const r = validateMarkDeliveredCodGate({
      paymentMethod: 'cod',
      paymentStatus: 'paid',
    });
    expect(r.ok).toBe(true);
  });

  test('COD + paid (via payCodOrder conversion; paymentMethod stays cod) → ok', () => {
    // Same shape as the previous case — the gate doesn't care WHICH
    // path set paymentStatus to 'paid'. Both Part A and Part B
    // converge here.
    const r = validateMarkDeliveredCodGate({
      paymentMethod: 'cod',
      paymentStatus: 'paid',
    });
    expect(r.ok).toBe(true);
  });

  test('online + paid → ok (unchanged behavior)', () => {
    const r = validateMarkDeliveredCodGate({
      paymentMethod: 'online',
      paymentStatus: 'paid',
    });
    expect(r.ok).toBe(true);
  });

  test('online + pending (unusual but possible) → ok (gate is COD-only)', () => {
    // An online order that's somehow at deliver-time without paid
    // status is an edge case markDelivered's other preconditions
    // will catch; the COD gate here deliberately passes so it
    // doesn't shadow the real diagnosis.
    const r = validateMarkDeliveredCodGate({
      paymentMethod: 'online',
      paymentStatus: 'pending',
    });
    expect(r.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────
// confirmPayment — COD-conversion fan-out decision
// ─────────────────────────────────────────────────────────────────

describe('PR-NEXT-3 — shouldFireCodConversionFanout', () => {
  test('alreadyPaid → never fires (webhook double-call guard)', () => {
    expect(
      shouldFireCodConversionFanout({
        order: { paymentMethod: 'cod' },
        alreadyPaid: true,
      }),
    ).toBe(false);
  });

  test('regular online order → never fires (would be a spurious push)', () => {
    expect(
      shouldFireCodConversionFanout({
        order: { paymentMethod: 'online' },
        alreadyPaid: false,
      }),
    ).toBe(false);
  });

  test('COD order paid through Razorpay → fires (the happy path)', () => {
    expect(
      shouldFireCodConversionFanout({
        order: { paymentMethod: 'cod', shopId: 'shop_1' },
        alreadyPaid: false,
      }),
    ).toBe(true);
  });

  test('missing order → does not fire (defensive)', () => {
    expect(
      shouldFireCodConversionFanout({ order: null, alreadyPaid: false }),
    ).toBe(false);
  });

  test('missing paymentMethod → does not fire', () => {
    expect(
      shouldFireCodConversionFanout({ order: {}, alreadyPaid: false }),
    ).toBe(false);
  });
});
