/**
 * PR-NEXT-BUNDLE-B §C (Finding #13) — 6 unit tests for the
 * `validateMarkDeliveredProofGate` pure helper.
 *
 * Contract: partner must upload a proof photo (`proofPhotoUrl` is a
 * non-empty, non-whitespace string) before `markDelivered` accepts
 * the delivered transition. All other cases return `no_proof`.
 *
 * Cases:
 *   1. Valid URL                         → ok
 *   2. Empty string ''                   → no_proof
 *   3. undefined (field absent)          → no_proof
 *   4. null                              → no_proof
 *   5. Whitespace-only '   '             → no_proof
 *   6. Legacy order without field (same shape as undefined) → no_proof
 */
import { validateMarkDeliveredProofGate } from '../../functions/src/markDeliveredHelpers';

describe('validateMarkDeliveredProofGate', () => {
  test('order with valid deliveryProofStoragePath → ok', () => {
    const result = validateMarkDeliveredProofGate({
      deliveryProofStoragePath: 'delivery-proofs/order_abc.jpg',
    });
    expect(result.ok).toBe(true);
  });

  test('order with empty deliveryProofStoragePath → no_proof', () => {
    const result = validateMarkDeliveredProofGate({ deliveryProofStoragePath: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('no_proof');
      expect(result.message).toMatch(/upload/i);
    }
  });

  test('order with deliveryProofStoragePath: undefined → no_proof', () => {
    const result = validateMarkDeliveredProofGate({ deliveryProofStoragePath: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_proof');
  });

  test('order with deliveryProofStoragePath: null → no_proof', () => {
    const result = validateMarkDeliveredProofGate({ deliveryProofStoragePath: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_proof');
  });

  test('order with whitespace-only deliveryProofStoragePath → no_proof', () => {
    const result = validateMarkDeliveredProofGate({ deliveryProofStoragePath: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_proof');
  });

  test('legacy order pre-PR without proofPhotoUrl field → no_proof (graceful)', () => {
    // Pre-PR-NEXT-BUNDLE-B orders have no `proofPhotoUrl` on the doc.
    // Cast via `as any` to simulate the raw Firestore read shape where
    // the field is simply absent (not even undefined).
    const result = validateMarkDeliveredProofGate({} as any);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_proof');
  });
});
