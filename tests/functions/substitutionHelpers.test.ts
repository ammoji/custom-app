/**
 * PR 21 — tests for substitution preference normalization.
 *
 * Covers every branch of `normalizeSubstitutionPreference`:
 *   - undefined / null  → default to 'call_me' (handles old clients).
 *   - each allowlist value round-trips.
 *   - non-string and unknown-string both reject as invalid-argument.
 *   - empty string explicitly rejects (not coerced to default).
 *   - VALID_PREFERENCES is the canonical exported allowlist.
 */
import { describe, expect, it } from '@jest/globals';
import {
    VALID_PREFERENCES,
    normalizeSubstitutionPreference,
} from '../../functions/src/substitutionHelpers';

describe('normalizeSubstitutionPreference', () => {
  it('defaults to call_me when input is undefined', () => {
    const r = normalizeSubstitutionPreference(undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('call_me');
  });

  it('defaults to call_me when input is null', () => {
    const r = normalizeSubstitutionPreference(null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('call_me');
  });

  it('accepts call_me', () => {
    const r = normalizeSubstitutionPreference('call_me');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('call_me');
  });

  it('accepts auto', () => {
    const r = normalizeSubstitutionPreference('auto');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('auto');
  });

  it('accepts refund', () => {
    const r = normalizeSubstitutionPreference('refund');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('refund');
  });

  it('rejects non-string input (number)', () => {
    const r = normalizeSubstitutionPreference(42);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('rejects non-string input (object)', () => {
    const r = normalizeSubstitutionPreference({ value: 'call_me' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('rejects unknown string values', () => {
    const r = normalizeSubstitutionPreference('cancel');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('rejects empty string (not coerced to default)', () => {
    const r = normalizeSubstitutionPreference('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('VALID_PREFERENCES is the canonical allowlist', () => {
    expect(VALID_PREFERENCES).toEqual(['call_me', 'auto', 'refund']);
  });
});
