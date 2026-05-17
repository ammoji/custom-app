import {
  detectAmountMismatch,
  extractDedupKey,
  shouldIgnoreLatePaymentFailed,
} from '../../functions/src/webhookDedupHelpers';

describe('extractDedupKey', () => {
  test('prefers x-razorpay-event-id header when present', () => {
    expect(
      extractDedupKey({
        headers: { 'x-razorpay-event-id': 'evt_ABC123' },
        body: {
          event: 'payment.captured',
          payload: { payment: { entity: { id: 'pay_xyz' } } },
        },
      }),
    ).toBe('evt_ABC123');
  });

  test('handles header arriving as an array (raw http style)', () => {
    expect(
      extractDedupKey({
        headers: { 'x-razorpay-event-id': ['evt_FROM_ARRAY'] },
        body: null,
      }),
    ).toBe('evt_FROM_ARRAY');
  });

  test('falls back to ${event}:${paymentId} when header missing', () => {
    expect(
      extractDedupKey({
        headers: {},
        body: {
          event: 'payment.captured',
          payload: { payment: { entity: { id: 'pay_xyz' } } },
        },
      }),
    ).toBe('payment.captured:pay_xyz');
  });

  test('returns null when neither header nor payload yields a key', () => {
    expect(extractDedupKey({ headers: undefined, body: undefined })).toBeNull();
    expect(extractDedupKey({ headers: {}, body: { event: 'x' } })).toBeNull();
  });
});

describe('detectAmountMismatch', () => {
  test('exact match returns false', () => {
    expect(
      detectAmountMismatch({ expectedRupees: 123.45, receivedPaise: 12345 }),
    ).toBe(false);
  });

  test('off-by-1-paisa returns true (no float fudge factor)', () => {
    expect(
      detectAmountMismatch({ expectedRupees: 123.45, receivedPaise: 12346 }),
    ).toBe(true);
  });

  test('order with no expected total skips the check (returns false)', () => {
    expect(
      detectAmountMismatch({ expectedRupees: null, receivedPaise: 12345 }),
    ).toBe(false);
    expect(
      detectAmountMismatch({ expectedRupees: undefined, receivedPaise: 12345 }),
    ).toBe(false);
  });

  test('non-numeric received amount skips the check (returns false)', () => {
    expect(
      detectAmountMismatch({
        expectedRupees: 100,
        receivedPaise: undefined,
      }),
    ).toBe(false);
  });

  test('comparison is exact in paise space — float drift cannot trigger false positive', () => {
    // 0.1 + 0.2 in JS is 0.30000000000000004; Math.round(0.3 * 100) = 30 either way.
    expect(
      detectAmountMismatch({
        expectedRupees: 0.1 + 0.2,
        receivedPaise: 30,
      }),
    ).toBe(false);
  });
});

describe('shouldIgnoreLatePaymentFailed', () => {
  test('ignores when order is already paid (the May 17 review case)', () => {
    expect(
      shouldIgnoreLatePaymentFailed({ currentPaymentStatus: 'paid' }),
    ).toBe(true);
  });

  test('ignores authorized + amount_mismatch + refund states', () => {
    for (const s of [
      'authorized',
      'amount_mismatch',
      'refunded',
      'refund_pending',
      'refund_failed',
    ]) {
      expect(
        shouldIgnoreLatePaymentFailed({ currentPaymentStatus: s }),
      ).toBe(true);
    }
  });

  test('does not ignore for fresh / pending / failed (legit failed event)', () => {
    expect(
      shouldIgnoreLatePaymentFailed({ currentPaymentStatus: 'pending' }),
    ).toBe(false);
    expect(
      shouldIgnoreLatePaymentFailed({ currentPaymentStatus: 'failed' }),
    ).toBe(false);
    expect(
      shouldIgnoreLatePaymentFailed({ currentPaymentStatus: undefined }),
    ).toBe(false);
  });
});
