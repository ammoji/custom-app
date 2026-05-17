/**
 * Unit tests for `validateShopSettings`.
 *
 * Pins the PR 5 settings-callable rules:
 *   - shopOwner claim required (strict equality)
 *   - shopId in claims required
 *   - at least one updateable field
 *   - per-field type/range validation with sanity caps
 *
 * Deliberate-break demo target: weaken the shopOwner check to
 * `!== false` (truthy semantics) and the
 * "rejects when caller has no shopOwner claim" test goes red.
 */
import {
  ShopSettingsInput,
  validateShopSettings,
} from '../../functions/src/shopSettingsHelpers';

const ownerAuth = (shopId: string = 'shop_A') => ({
  uid: 'owner_001',
  token: { shopOwner: true, shopId },
});

const baseInput = (
  overrides: Partial<ShopSettingsInput> = {},
): ShopSettingsInput => ({
  auth: ownerAuth(),
  deliveryFee: 30,
  ...overrides,
});

describe('validateShopSettings — auth + role', () => {
  test('rejects unauthenticated caller', () => {
    const r = validateShopSettings({ auth: null, deliveryFee: 30 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  test('rejects when caller has no shopOwner claim', () => {
    const r = validateShopSettings({
      auth: { uid: 'u1', token: {} },
      deliveryFee: 30,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('rejects truthy-but-not-true shopOwner claim (strict equality)', () => {
    // Razorpay-token bug class: a malformed token could carry
    // `shopOwner: 1` or `shopOwner: 'yes'`. Both must be rejected.
    const r = validateShopSettings({
      auth: { uid: 'u1', token: { shopOwner: 1 as unknown as boolean, shopId: 'shop_A' } },
      deliveryFee: 30,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('rejects shopOwner without shopId in claims', () => {
    const r = validateShopSettings({
      auth: { uid: 'u1', token: { shopOwner: true } },
      deliveryFee: 30,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });
});

describe('validateShopSettings — payload', () => {
  test('rejects payload with neither field', () => {
    const r = validateShopSettings({ auth: ownerAuth() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid-argument');
      expect(r.message).toMatch(/at least one/i);
    }
  });

  test('accepts deliveryFee-only update', () => {
    const r = validateShopSettings(baseInput({ deliveryFee: 25 }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.updates).toEqual({ deliveryFee: 25 });
      expect(r.shopId).toBe('shop_A');
    }
  });

  test('accepts minOrder-only update', () => {
    const r = validateShopSettings({
      auth: ownerAuth(),
      minOrder: 150,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.updates).toEqual({ minOrder: 150 });
  });

  test('accepts both fields together', () => {
    const r = validateShopSettings({
      auth: ownerAuth(),
      deliveryFee: 0,
      minOrder: 0,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.updates).toEqual({ deliveryFee: 0, minOrder: 0 });
  });
});

describe('validateShopSettings — deliveryFee range', () => {
  test.each([
    ['negative', -1],
    ['above cap', 501],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['string', '30'],
    ['float (non-integer)', 29.5],
  ])('rejects deliveryFee=%s', (_label, bad) => {
    const r = validateShopSettings({
      auth: ownerAuth(),
      deliveryFee: bad as number,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('accepts boundary values (0 and 500)', () => {
    const lo = validateShopSettings({ auth: ownerAuth(), deliveryFee: 0 });
    const hi = validateShopSettings({ auth: ownerAuth(), deliveryFee: 500 });
    expect(lo.ok).toBe(true);
    expect(hi.ok).toBe(true);
  });
});

describe('validateShopSettings — minOrder range', () => {
  test.each([
    ['negative', -1],
    ['above cap', 10001],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['string', '100'],
    ['float (non-integer)', 99.99],
  ])('rejects minOrder=%s', (_label, bad) => {
    const r = validateShopSettings({
      auth: ownerAuth(),
      minOrder: bad as number,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('accepts boundary values (0 and 10000)', () => {
    const lo = validateShopSettings({ auth: ownerAuth(), minOrder: 0 });
    const hi = validateShopSettings({ auth: ownerAuth(), minOrder: 10000 });
    expect(lo.ok).toBe(true);
    expect(hi.ok).toBe(true);
  });
});
