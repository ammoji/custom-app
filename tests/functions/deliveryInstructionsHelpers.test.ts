/**
 * PR 22 — tests for delivery-instructions normalization.
 *
 * Covers every branch of `normalizeDeliveryInstructions`:
 *   - undefined / null / '' / whitespace-only → undefined (absorbs
 *     old clients + UIs that send empty-string-as-cleared).
 *   - surrounding whitespace trimmed on valid input.
 *   - happy path with a realistic instruction string.
 *   - exact MAX_INSTRUCTIONS_LEN boundary accepted.
 *   - over-boundary rejected.
 *   - non-string (number + object) rejected.
 *   - MAX_INSTRUCTIONS_LEN pinned at the documented 280.
 */
import { describe, expect, it } from '@jest/globals';
import {
    MAX_INSTRUCTIONS_LEN,
    normalizeDeliveryInstructions,
} from '../../functions/src/deliveryInstructionsHelpers';

describe('normalizeDeliveryInstructions', () => {
  it('returns undefined for undefined input', () => {
    const r = normalizeDeliveryInstructions(undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeUndefined();
  });

  it('returns undefined for null input', () => {
    const r = normalizeDeliveryInstructions(null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    const r = normalizeDeliveryInstructions('');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeUndefined();
  });

  it('returns undefined for whitespace-only string', () => {
    const r = normalizeDeliveryInstructions('   ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeUndefined();
  });

  it('trims surrounding whitespace and returns', () => {
    const r = normalizeDeliveryInstructions('  Ring twice  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('Ring twice');
  });

  it('accepts a typical short instruction', () => {
    const r = normalizeDeliveryInstructions('Leave at door, dog inside');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('Leave at door, dog inside');
  });

  it('accepts exactly MAX_INSTRUCTIONS_LEN chars', () => {
    const max = 'x'.repeat(MAX_INSTRUCTIONS_LEN);
    const r = normalizeDeliveryInstructions(max);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(max);
  });

  it('rejects over MAX_INSTRUCTIONS_LEN chars', () => {
    const tooLong = 'x'.repeat(MAX_INSTRUCTIONS_LEN + 1);
    const r = normalizeDeliveryInstructions(tooLong);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('rejects non-string input (number)', () => {
    const r = normalizeDeliveryInstructions(42);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('rejects non-string input (object)', () => {
    const r = normalizeDeliveryInstructions({ note: 'ring twice' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('MAX_INSTRUCTIONS_LEN is the documented Twitter-classic 280', () => {
    expect(MAX_INSTRUCTIONS_LEN).toBe(280);
  });
});
