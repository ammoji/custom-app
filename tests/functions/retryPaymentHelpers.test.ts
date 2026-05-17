import { checkRetryPaymentGuard } from '../../functions/src/retryPaymentHelpers';

describe('checkRetryPaymentGuard', () => {
  test('captured old payment → blocks rotation (the May-17 double-charge fix)', () => {
    const r = checkRetryPaymentGuard({
      payments: [{ id: 'pay_old', status: 'captured' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('failed-precondition');
      expect(r.message).toMatch(/captured/i);
    }
  });

  test('authorized old payment → blocks rotation (would risk double-auth)', () => {
    const r = checkRetryPaymentGuard({
      payments: [{ id: 'pay_old', status: 'authorized' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('failed-precondition');
      expect(r.message).toMatch(/processing|wait/i);
    }
  });

  test('failed-only old payments → ok to rotate (legitimate retry)', () => {
    const r = checkRetryPaymentGuard({
      payments: [{ id: 'pay_old', status: 'failed' }],
    });
    expect(r.ok).toBe(true);
  });

  test('empty payments → ok to rotate', () => {
    expect(checkRetryPaymentGuard({ payments: [] }).ok).toBe(true);
  });

  test('null payments (fetchPayments threw) → unverifiable; callable should error rather than rotate blindly', () => {
    const r = checkRetryPaymentGuard({ payments: null });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('unverifiable');
    }
  });

  test('captured beats authorized when both exist (most-restrictive wins)', () => {
    const r = checkRetryPaymentGuard({
      payments: [
        { id: 'pay_a', status: 'authorized' },
        { id: 'pay_c', status: 'captured' },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/captured/i);
  });
});
