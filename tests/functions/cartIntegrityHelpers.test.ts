/**
 * Unit tests for `validateAllItemsInSameShop`.
 *
 * Pins the PR 4 collective same-shop invariant: a malicious or buggy
 * client must NOT be able to submit a cart whose lines span shops,
 * even if each individual line passes the per-item lookup. The
 * helper is the explicit gate; the per-item lookup is the implicit
 * one. We test the explicit one here.
 */
import {
  ResolvedItem,
  validateAllItemsInSameShop,
} from '../../functions/src/cartIntegrityHelpers';

const SHOP_A = 'shop_A';
const SHOP_B = 'shop_B';

const item = (
  id: string,
  shopId: string,
  isCustom = false,
): ResolvedItem => ({
  menuItemId: id,
  productId: isCustom ? undefined : id,
  shopId,
});

describe('validateAllItemsInSameShop', () => {
  test('all items match expected shopId → ok', () => {
    const r = validateAllItemsInSameShop(
      [item('m1', SHOP_A), item('m2', SHOP_A), item('m3', SHOP_A)],
      SHOP_A,
    );
    expect(r.ok).toBe(true);
  });

  test('single item mismatches → returns offendingMenuItemId', () => {
    const r = validateAllItemsInSameShop(
      [item('m1', SHOP_A), item('rogue', SHOP_B), item('m3', SHOP_A)],
      SHOP_A,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.offendingMenuItemId).toBe('rogue');
  });

  test('empty items array → ok (out of scope for this helper)', () => {
    // The "must have ≥1 item" rule is enforced at the placeOrder
    // input-validation layer, not here. Keeping this helper laser-
    // focused on the same-shop invariant.
    const r = validateAllItemsInSameShop([], SHOP_A);
    expect(r.ok).toBe(true);
  });

  test('all items mismatch → returns the FIRST offender (deterministic order)', () => {
    // Determinism matters for repro: a flaky "sometimes m1, sometimes
    // m2" error message would make customer-support tickets useless.
    const r = validateAllItemsInSameShop(
      [item('first-rogue', SHOP_B), item('second-rogue', SHOP_B)],
      SHOP_A,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.offendingMenuItemId).toBe('first-rogue');
  });

  test('falls back to productId when menuItemId absent (legacy cart line)', () => {
    // Pre-v2-iii carts persisted in AsyncStorage carry only
    // productId. The error payload should still be useful.
    const r = validateAllItemsInSameShop(
      [{ productId: 'legacy-product-1', shopId: SHOP_B }],
      SHOP_A,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.offendingMenuItemId).toBe('legacy-product-1');
  });

  test('returns sentinel "<unknown>" when neither id is present (defensive)', () => {
    // Shouldn't happen in practice (placeOrder always attaches at
    // least one id) but the helper shouldn't throw on malformed
    // input — just produce a greppable sentinel.
    const r = validateAllItemsInSameShop(
      [{ shopId: SHOP_B } as ResolvedItem],
      SHOP_A,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.offendingMenuItemId).toBe('<unknown>');
  });
});
