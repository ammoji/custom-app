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

// PR 5 hotfix — admin can target ANY shop's settings via input.shopId
// (their claim has no shopId, so they MUST pass it). shopOwner callers
// still use their claim's shopId; any passed shopId is ignored so a
// malicious shop owner client can't target someone else's shop.
describe('validateShopSettings — admin path', () => {
  const adminAuth = { uid: 'admin_001', token: { admin: true } };

  test('admin with valid shopId is accepted', () => {
    const r = validateShopSettings({
      auth: adminAuth,
      shopId: 'shop_X',
      deliveryFee: 30,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.shopId).toBe('shop_X');
      expect(r.updates.deliveryFee).toBe(30);
    }
  });

  test('admin without shopId is rejected (invalid-argument)', () => {
    const r = validateShopSettings({
      auth: adminAuth,
      deliveryFee: 30,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid-argument');
      expect(r.message).toMatch(/shopId/i);
    }
  });

  test('admin with empty-string shopId is rejected (invalid-argument)', () => {
    const r = validateShopSettings({
      auth: adminAuth,
      shopId: '',
      deliveryFee: 30,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('admin with non-string shopId is rejected (invalid-argument)', () => {
    const r = validateShopSettings({
      auth: adminAuth,
      shopId: 42 as unknown as string,
      deliveryFee: 30,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('shopOwner ignores any passed shopId — uses claim shopId', () => {
    // Defense-in-depth: even if a shop owner client tries to target
    // shop_OTHER via input.shopId, the server uses the claim's
    // shopId (shop_A). This prevents lateral targeting attacks.
    const r = validateShopSettings({
      auth: ownerAuth('shop_A'),
      shopId: 'shop_OTHER',
      deliveryFee: 30,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.shopId).toBe('shop_A');
  });

  test('admin claim that is not literal true is rejected (strict equality)', () => {
    // Same posture as the shopOwner-strict-equality guard above. A
    // malformed token carrying `admin: 'yes'` or `admin: 1` must be
    // rejected, not treated as truthy.
    const r = validateShopSettings({
      auth: { uid: 'u1', token: { admin: 1 as unknown as boolean } },
      shopId: 'shop_X',
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
