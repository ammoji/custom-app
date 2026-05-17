import * as crypto from 'node:crypto';
import { verifyRazorpaySignature } from '../../functions/src/confirmPaymentHelpers';

const KEY_SECRET = 'rzp_test_secret_key_xyz_abc_123';

function sign(orderId: string, paymentId: string, secret = KEY_SECRET): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

describe('verifyRazorpaySignature', () => {
  const ORDER_ID = 'order_QcDeFGhIjKLmNo';
  const PAYMENT_ID = 'pay_QcDeFGhIjKLmNo';

  test('accepts a correctly-signed payload', () => {
    const sig = sign(ORDER_ID, PAYMENT_ID);
    const r = verifyRazorpaySignature({
      razorpayOrderId: ORDER_ID,
      razorpayPaymentId: PAYMENT_ID,
      razorpaySignature: sig,
      keySecret: KEY_SECRET,
    });
    expect(r.ok).toBe(true);
  });

  test('rejects forged signature (different secret)', () => {
    // This is the deliberate-break demo target. If verifyRazorpaySignature
    // is weakened to use `===` instead of timingSafeEqual, this test still
    // passes — but the demo will weaken the function further (e.g. to
    // `return { ok: true }` unconditionally) and THIS TEST should be the
    // one that fails by name.
    const forged = sign(ORDER_ID, PAYMENT_ID, 'attacker_guessed_secret');
    const r = verifyRazorpaySignature({
      razorpayOrderId: ORDER_ID,
      razorpayPaymentId: PAYMENT_ID,
      razorpaySignature: forged,
      keySecret: KEY_SECRET,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('signature_mismatch');
  });

  test('rejects tampered payment id (signature was computed over different ids)', () => {
    const sig = sign(ORDER_ID, PAYMENT_ID);
    const r = verifyRazorpaySignature({
      razorpayOrderId: ORDER_ID,
      razorpayPaymentId: 'pay_TAMPERED', // attacker swaps payment id
      razorpaySignature: sig,
      keySecret: KEY_SECRET,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('signature_mismatch');
  });

  test('rejects tampered order id (cross-order signature replay)', () => {
    const sig = sign(ORDER_ID, PAYMENT_ID);
    const r = verifyRazorpaySignature({
      razorpayOrderId: 'order_DIFFERENT',
      razorpayPaymentId: PAYMENT_ID,
      razorpaySignature: sig,
      keySecret: KEY_SECRET,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('signature_mismatch');
  });

  test('rejects truncated signature (length mismatch surfaces distinctly)', () => {
    const sig = sign(ORDER_ID, PAYMENT_ID).slice(0, 10);
    const r = verifyRazorpaySignature({
      razorpayOrderId: ORDER_ID,
      razorpayPaymentId: PAYMENT_ID,
      razorpaySignature: sig,
      keySecret: KEY_SECRET,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('length_mismatch');
  });

  test('rejects empty / missing fields', () => {
    const r1 = verifyRazorpaySignature({
      razorpayOrderId: '',
      razorpayPaymentId: PAYMENT_ID,
      razorpaySignature: 'x',
      keySecret: KEY_SECRET,
    });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe('missing_field');
    const r2 = verifyRazorpaySignature({
      razorpayOrderId: ORDER_ID,
      razorpayPaymentId: PAYMENT_ID,
      razorpaySignature: 'x',
      keySecret: '',
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe('missing_field');
  });

  test('signature is hex-lowercase (Razorpay produces lowercase hex; uppercase is a different bytestring)', () => {
    const sig = sign(ORDER_ID, PAYMENT_ID).toUpperCase();
    const r = verifyRazorpaySignature({
      razorpayOrderId: ORDER_ID,
      razorpayPaymentId: PAYMENT_ID,
      razorpaySignature: sig,
      keySecret: KEY_SECRET,
    });
    expect(r.ok).toBe(false);
  });
});
