/**
 * PR 47 — pure helper tests for distance-based delivery charges.
 *
 * Covers:
 *   - `chargeForDistance` band selection (boundary inclusivity,
 *     catch-all, sort-on-read, negative/non-finite distance,
 *     legacy fallback).
 *   - `validateDeliveryChargeTiers` rules (catch-all required,
 *     ascending bands, well-formed entries).
 *
 * The helper is firebase-admin-free; no emulator or test-double
 * setup required.
 */

import {
  chargeForDistance,
  DEFAULT_DELIVERY_CHARGE_TIERS,
  validateDeliveryChargeTiers,
  type DeliveryChargeTier,
} from '../../functions/src/deliveryChargeHelpers';

describe('PR 47 — chargeForDistance', () => {
  // Reusable canonical tier table identical to the admin default
  // so the boundary tests pin the testing-team baseline.
  const TIERS: DeliveryChargeTier[] = [
    { maxKm: 1, charge: 20 },
    { maxKm: 3, charge: 40 },
    { maxKm: 5, charge: 60 },
    { maxKm: null, charge: 100 },
  ];

  test('0.5km → tier 1 (≤1km band)', () => {
    expect(chargeForDistance(TIERS, 0.5, 0)).toBe(20);
  });

  test('exactly 1.0km → tier 1 (inclusive boundary)', () => {
    expect(chargeForDistance(TIERS, 1.0, 0)).toBe(20);
  });

  test('1.0001km → tier 2 (just past inclusive boundary)', () => {
    expect(chargeForDistance(TIERS, 1.0001, 0)).toBe(40);
  });

  test('4km → tier 3', () => {
    expect(chargeForDistance(TIERS, 4, 0)).toBe(60);
  });

  test('10km → catch-all', () => {
    expect(chargeForDistance(TIERS, 10, 0)).toBe(100);
  });

  test('exactly at last numbered band boundary → that band, not catch-all', () => {
    // 5.0 is INCLUSIVE on the 3-5 km band, not the catch-all.
    expect(chargeForDistance(TIERS, 5, 0)).toBe(60);
    // 5.0001 falls through to the catch-all.
    expect(chargeForDistance(TIERS, 5.0001, 0)).toBe(100);
  });

  test('empty tiers → fallbackFlat', () => {
    expect(chargeForDistance([], 2, 99)).toBe(99);
  });

  test('undefined tiers → fallbackFlat', () => {
    expect(chargeForDistance(undefined, 2, 99)).toBe(99);
  });

  test('null tiers → fallbackFlat', () => {
    expect(chargeForDistance(null, 2, 99)).toBe(99);
  });

  test('malformed tier entries → fallbackFlat (legacy posture)', () => {
    // None of the entries are well-formed; the helper rejects the
    // whole array rather than partial-cherry-picking.
    expect(
      chargeForDistance(
        [{ maxKm: 'oops', charge: 'nope' } as unknown as DeliveryChargeTier],
        2,
        99,
      ),
    ).toBe(99);
  });

  test('partially malformed → keeps only well-formed entries', () => {
    // The well-formed catch-all wins. The malformed entry is
    // silently dropped (defensive — corrupt Firestore data
    // shouldn't crash placeOrder).
    const partiallyBad: DeliveryChargeTier[] = [
      { maxKm: 'oops' as unknown as number, charge: 5 },
      { maxKm: null, charge: 80 },
    ];
    expect(chargeForDistance(partiallyBad, 2, 99)).toBe(80);
  });

  test('negative distance → clamped to 0 → cheapest tier', () => {
    expect(chargeForDistance(TIERS, -3, 0)).toBe(20);
  });

  test('NaN distance → treated as 0 → cheapest tier', () => {
    expect(chargeForDistance(TIERS, Number.NaN, 0)).toBe(20);
  });

  test('Infinity distance → treated as 0 → cheapest tier', () => {
    // Non-finite coerces to 0 by the same defensive rule. Real
    // distances are always finite; this is anti-tamper.
    expect(chargeForDistance(TIERS, Number.POSITIVE_INFINITY, 0)).toBe(20);
  });

  test('unsorted input tiers → sorted internally; correct band wins', () => {
    const shuffled: DeliveryChargeTier[] = [
      { maxKm: null, charge: 100 },
      { maxKm: 5, charge: 60 },
      { maxKm: 1, charge: 20 },
      { maxKm: 3, charge: 40 },
    ];
    expect(chargeForDistance(shuffled, 2, 0)).toBe(40);
    expect(chargeForDistance(shuffled, 0.5, 0)).toBe(20);
    expect(chargeForDistance(shuffled, 50, 0)).toBe(100);
  });

  test('unsorted input is NOT mutated (pure function)', () => {
    const shuffled: DeliveryChargeTier[] = [
      { maxKm: null, charge: 100 },
      { maxKm: 1, charge: 20 },
    ];
    const before = JSON.stringify(shuffled);
    chargeForDistance(shuffled, 0.5, 0);
    expect(JSON.stringify(shuffled)).toBe(before);
  });

  test('no catch-all + distance beyond every numbered band → last tier', () => {
    // Hand-edited Firestore doc could reach this; we don't
    // under-charge ₹0. validateDeliveryChargeTiers rejects this
    // shape on save so it shouldn't happen via the editor.
    const noCatchAll: DeliveryChargeTier[] = [
      { maxKm: 1, charge: 20 },
      { maxKm: 3, charge: 40 },
    ];
    expect(chargeForDistance(noCatchAll, 100, 0)).toBe(40);
  });

  test('admin default table matches the design-doc baseline', () => {
    // Pin the constant so a careless edit can't silently change
    // the seed every approveShop emits.
    expect(DEFAULT_DELIVERY_CHARGE_TIERS).toEqual([
      { maxKm: 1, charge: 20 },
      { maxKm: 3, charge: 40 },
      { maxKm: 5, charge: 60 },
      { maxKm: null, charge: 100 },
    ]);
  });
});

describe('PR 47 — validateDeliveryChargeTiers', () => {
  test('valid table with catch-all → ok', () => {
    const result = validateDeliveryChargeTiers([
      { maxKm: 1, charge: 20 },
      { maxKm: 3, charge: 40 },
      { maxKm: null, charge: 100 },
    ]);
    expect(result.ok).toBe(true);
  });

  test('non-array → reject', () => {
    expect(validateDeliveryChargeTiers('nope').ok).toBe(false);
    expect(validateDeliveryChargeTiers(null).ok).toBe(false);
    expect(validateDeliveryChargeTiers({}).ok).toBe(false);
  });

  test('empty array → reject', () => {
    const result = validateDeliveryChargeTiers([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/at least one/i);
  });

  test('missing catch-all → reject with helpful message', () => {
    const result = validateDeliveryChargeTiers([
      { maxKm: 1, charge: 20 },
      { maxKm: 3, charge: 40 },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/catch-all/i);
  });

  test('two catch-alls → reject', () => {
    const result = validateDeliveryChargeTiers([
      { maxKm: 1, charge: 20 },
      { maxKm: null, charge: 60 },
      { maxKm: null, charge: 100 },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/only one catch-all/i);
  });

  test('non-ascending numbered bands → reject', () => {
    const result = validateDeliveryChargeTiers([
      { maxKm: 3, charge: 40 },
      { maxKm: 1, charge: 20 }, // out of order with respect to itself
      { maxKm: null, charge: 100 },
    ]);
    // Validator sorts then checks strict ascent; 1 and 3 are
    // strictly ascending so this is OK. Make a real overlap.
    expect(result.ok).toBe(true);

    const overlap = validateDeliveryChargeTiers([
      { maxKm: 3, charge: 40 },
      { maxKm: 3, charge: 60 }, // duplicate maxKm
      { maxKm: null, charge: 100 },
    ]);
    expect(overlap.ok).toBe(false);
    if (overlap.ok) return;
    expect(overlap.message).toMatch(/strictly ascending/i);
  });

  test('negative charge → reject', () => {
    const result = validateDeliveryChargeTiers([
      { maxKm: 1, charge: -5 },
      { maxKm: null, charge: 100 },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/tier 1/i);
  });

  test('non-numeric maxKm → reject', () => {
    const result = validateDeliveryChargeTiers([
      { maxKm: 'one' as unknown as number, charge: 20 },
      { maxKm: null, charge: 100 },
    ]);
    expect(result.ok).toBe(false);
  });

  test('NaN charge → reject', () => {
    const result = validateDeliveryChargeTiers([
      { maxKm: 1, charge: Number.NaN },
      { maxKm: null, charge: 100 },
    ]);
    expect(result.ok).toBe(false);
  });

  test('zero charge is OK (free delivery for the cheapest band)', () => {
    const result = validateDeliveryChargeTiers([
      { maxKm: 1, charge: 0 },
      { maxKm: null, charge: 100 },
    ]);
    expect(result.ok).toBe(true);
  });

  test('zero or negative maxKm → reject', () => {
    const zero = validateDeliveryChargeTiers([
      { maxKm: 0, charge: 20 },
      { maxKm: null, charge: 100 },
    ]);
    expect(zero.ok).toBe(false);

    const negative = validateDeliveryChargeTiers([
      { maxKm: -1, charge: 20 },
      { maxKm: null, charge: 100 },
    ]);
    expect(negative.ok).toBe(false);
  });

  test('cleaned output preserves entries (no dedup, no reorder)', () => {
    // Owners may submit unsorted; the editor renders in input
    // order. We accept any order and let chargeForDistance sort
    // at read time — so cleaned output should be input order.
    const input: DeliveryChargeTier[] = [
      { maxKm: null, charge: 100 },
      { maxKm: 1, charge: 20 },
      { maxKm: 3, charge: 40 },
    ];
    const result = validateDeliveryChargeTiers(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tiers).toEqual(input);
  });
});
