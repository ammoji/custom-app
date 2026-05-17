/**
 * PR 2 — payment hardening, Phase B. Pure helpers for the new
 * confirmPayment callable (item 4 of the May 17 review).
 *
 * Razorpay Checkout fires its `handler` callback with three pieces
 * the merchant can use to verify the payment server-side WITHOUT
 * waiting for the asynchronous payment.captured webhook:
 *
 *   - razorpay_order_id      (we already know this from placeOrder)
 *   - razorpay_payment_id    (new — minted at capture time)
 *   - razorpay_signature     (HMAC-SHA256 over `${order_id}|${payment_id}`
 *                             keyed with the Razorpay key SECRET)
 *
 * Verifying the signature with the same key secret used to create
 * the Razorpay order proves the payment id was minted by Razorpay
 * for this specific order. Without it the client could fabricate a
 * payment id and call confirmPayment to mark a free order as paid.
 *
 * The constant-time comparison via crypto.timingSafeEqual mirrors
 * the textbook posture the existing razorpayWebhook handler uses
 * for its x-razorpay-signature header check (see index.ts ~line 696).
 * `===` would leak signature bytes through timing variation; do NOT
 * change to `===`. The deliberate-break demo for this PR weakens
 * exactly that line — at least one helper test should fail by name.
 */

import * as crypto from 'node:crypto';

export type VerifySignatureResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'missing_field'
        | 'length_mismatch'
        | 'signature_mismatch'
        | 'crypto_error';
    };

/**
 * Verify a Razorpay Checkout signature.
 *
 * Algorithm (from Razorpay docs):
 *   expected = hmac_sha256(`${razorpay_order_id}|${razorpay_payment_id}`, key_secret).hex()
 *   ok = constantTimeEqual(expected, razorpay_signature)
 *
 * All inputs validated as non-empty strings before hashing — early
 * return on bad input avoids a hash over partial data and makes the
 * failure mode legible in logs.
 */
export function verifyRazorpaySignature(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  keySecret: string;
}): VerifySignatureResult {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, keySecret } =
    input;

  if (
    typeof razorpayOrderId !== 'string' ||
    razorpayOrderId.length === 0 ||
    typeof razorpayPaymentId !== 'string' ||
    razorpayPaymentId.length === 0 ||
    typeof razorpaySignature !== 'string' ||
    razorpaySignature.length === 0 ||
    typeof keySecret !== 'string' ||
    keySecret.length === 0
  ) {
    return { ok: false, reason: 'missing_field' };
  }

  let expected: string;
  try {
    expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');
  } catch {
    return { ok: false, reason: 'crypto_error' };
  }

  const sigBuf = Buffer.from(razorpaySignature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');

  // crypto.timingSafeEqual throws on length mismatch, so we have to
  // length-check first. A length mismatch is itself a signature
  // failure — emit it as its own reason for legibility in audit logs.
  if (sigBuf.length !== expBuf.length) {
    return { ok: false, reason: 'length_mismatch' };
  }

  // **DO NOT REPLACE WITH ===.** Constant-time comparison is what
  // makes this resistant to timing side-channel attacks. The
  // deliberate-break demo for PR 2 is exactly this line.
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  return { ok: true };
}
