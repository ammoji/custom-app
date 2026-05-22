/**
 * Pure unit tests for functions/src/profileHelpers.ts.
 *
 * Validates the input-validation and patch-shaping logic that backs
 * updateMyProfile and saveAddress. The Cloud Function callable wiring
 * (auth gate, transaction, FieldValue.delete) is covered by the
 * dry-run + manual smoke tests, not unit tests — those would require
 * booting firebase-admin which is exactly what extracting these
 * helpers was meant to avoid.
 */
import {
  validateAddressInput,
  validateProfilePatch,
} from '../../functions/src/profileHelpers';

describe('validateProfilePatch', () => {
  test('accepts a valid name + email patch', () => {
    const result = validateProfilePatch({
      name: 'Sudhir Davim',
      email: 'sudhir@example.com',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      name: 'Sudhir Davim',
      email: 'sudhir@example.com',
    });
  });

  test('trims whitespace on name and email', () => {
    const result = validateProfilePatch({
      name: '  Sudhir  ',
      email: ' sudhir@example.com ',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('Sudhir');
    expect(result.value.email).toBe('sudhir@example.com');
  });

  test('rejects a name longer than 80 characters', () => {
    const long = 'a'.repeat(81);
    const result = validateProfilePatch({ name: long });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('name');
    expect(result.message).toMatch(/80/);
  });

  test('rejects a malformed email', () => {
    const result = validateProfilePatch({ email: 'not-an-email' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('email');
  });

  test('email-only: null and "" both clear email (collapsed to null)', () => {
    // PR 10 carve-out: name still REQUIRED when present, but email
    // keeps its "null/empty = clear" semantics so users can blank
    // out an optional email without re-entering their name.
    const r1 = validateProfilePatch({ email: null });
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.value.email).toBeNull();
    const r2 = validateProfilePatch({ email: '' });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value.email).toBeNull();
  });

  // PR 10 — Part 2 — name is REQUIRED when present in the patch.
  // Pins the behaviour change away from the previous "null collapses
  // to null" semantics. Patches that don't touch the `name` key are
  // still allowed (covered by the partial-patch test below).
  test('PR 10: rejects empty-string name with a "Full name is required" message', () => {
    const r = validateProfilePatch({ name: '' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe('name');
    expect(r.message).toBe('Full name is required');
  });

  test('PR 10: rejects null name (was previously a clear-the-field path)', () => {
    const r = validateProfilePatch({ name: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe('name');
    expect(r.message).toBe('Full name is required');
  });

  test('PR 10: rejects whitespace-only name (trim collapses to empty)', () => {
    const r = validateProfilePatch({ name: '   ' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe('name');
  });

  test('keeps untouched keys absent from the result (partial patch)', () => {
    // Caller passes only `name` → `email` must NOT appear in the
    // result, so the Cloud Function's "in patch" check reliably
    // distinguishes "clear" from "don't touch".
    const result = validateProfilePatch({ name: 'Sudhir' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('email' in result.value).toBe(false);
  });
});

describe('validateAddressInput', () => {
  const valid = {
    name: 'Sudhir',
    phone: '9876543210',
    line1: 'A-12',
    city: 'New Delhi',
    pincode: '110016',
  };

  test('accepts a fully-valid address and trims trailing whitespace', () => {
    const result = validateAddressInput({
      ...valid,
      name: ' Sudhir ',
      line1: ' A-12 ',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      label: null,
      name: 'Sudhir',
      phone: '9876543210',
      line1: 'A-12',
      line2: null,
      city: 'New Delhi',
      pincode: '110016',
      // PR 22 — validator now always emits this key; null = absent.
      deliveryInstructions: null,
    });
  });

  test('rejects bad pincode (5 digits)', () => {
    const result = validateAddressInput({ ...valid, pincode: '11001' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('pincode');
  });

  test('rejects bad pincode (alphabetic)', () => {
    const result = validateAddressInput({ ...valid, pincode: '11001A' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('pincode');
  });

  test('rejects bad phone (starts with 0)', () => {
    const result = validateAddressInput({ ...valid, phone: '0876543210' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('phone');
  });

  test('rejects bad phone (11 digits)', () => {
    const result = validateAddressInput({ ...valid, phone: '98765432101' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('phone');
  });

  test('rejects bad phone (alphabetic junk)', () => {
    const result = validateAddressInput({ ...valid, phone: 'abc1234567' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('phone');
  });

  test('rejects empty required fields', () => {
    const result = validateAddressInput({ ...valid, line1: '   ' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('line1');
  });

  test('rejects label longer than 32 chars', () => {
    const result = validateAddressInput({
      ...valid,
      label: 'a'.repeat(33),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('label');
  });
});
