import { reconcileAbandonedOrder } from '../../functions/src/cleanupReconciliationHelpers';

describe('reconcileAbandonedOrder', () => {
  test('captured payment → mark_paid (this is the May-17 launch-blocker fix)', () => {
    const v = reconcileAbandonedOrder({
      payments: [{ id: 'pay_1', status: 'captured', created_at: 1700000000 }],
    });
    expect(v.kind).toBe('mark_paid');
    if (v.kind === 'mark_paid') {
      expect(v.paymentId).toBe('pay_1');
      expect(v.createdAt).toBe(1700000000);
    }
  });

  test('captured payment beats authorized when both exist', () => {
    const v = reconcileAbandonedOrder({
      payments: [
        { id: 'pay_auth', status: 'authorized' },
        { id: 'pay_cap', status: 'captured', created_at: 1700000000 },
      ],
    });
    expect(v.kind).toBe('mark_paid');
    if (v.kind === 'mark_paid') expect(v.paymentId).toBe('pay_cap');
  });

  test('authorized only → authorized_review (admin must intervene)', () => {
    const v = reconcileAbandonedOrder({
      payments: [{ id: 'pay_auth', status: 'authorized' }],
    });
    expect(v.kind).toBe('authorized_review');
    if (v.kind === 'authorized_review') expect(v.paymentId).toBe('pay_auth');
  });

  test('empty payments list → cancel_ok (sweep proceeds as normal)', () => {
    expect(reconcileAbandonedOrder({ payments: [] }).kind).toBe('cancel_ok');
  });

  test('only failed/created payments → cancel_ok', () => {
    const v = reconcileAbandonedOrder({
      payments: [
        { id: 'pay_f', status: 'failed' },
        { id: 'pay_c', status: 'created' },
      ],
    });
    expect(v.kind).toBe('cancel_ok');
  });

  test('null payments (fetchPayments threw) → defer_unverifiable, do NOT cancel', () => {
    expect(reconcileAbandonedOrder({ payments: null }).kind).toBe(
      'defer_unverifiable',
    );
  });

  test('captured payment without id is skipped (defensive against malformed Razorpay payloads)', () => {
    const v = reconcileAbandonedOrder({
      payments: [{ status: 'captured', created_at: 1700000000 } as any],
    });
    expect(v.kind).toBe('cancel_ok');
  });
});
