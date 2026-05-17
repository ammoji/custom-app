/**
 * Regression test for the Phase 12a-v2-iv-hotfix-1 ROOT-CAUSE FIX
 * to orderService.placeOrder.
 *
 * Before the fix, the inline `.map({ productId, quantity })` in
 * orderService.placeOrder silently stripped `menuItemId` and
 * `priceSnapshot` from every cart line, forcing the server into
 * the legacy products-collection validation path and producing
 * "Product X not in this shop" rejections for every order.
 *
 * Pinning the helper here so a future "let's tighten the wire
 * shape" refactor can't silently drop these fields again.
 */
import type { CartItem } from '../../src/types';
import { buildPlaceOrderPayload } from '../../src/services/placeOrderPayload';

const baseLine = {
  name: 'Aashirvaad atta',
  imageUrl: 'https://example.com/atta.jpg',
  packLabel: '5 kg',
  price: 250,
};

describe('buildPlaceOrderPayload', () => {
  test('forwards menuItemId on every line (the regression case)', () => {
    const items: CartItem[] = [
      {
        ...baseLine,
        productId: 'p_008_atta',
        menuItemId: 'p_008_atta',
        priceSnapshot: 250,
        quantity: 2,
      },
    ];
    const wire = buildPlaceOrderPayload(items);
    expect(wire).toHaveLength(1);
    expect(wire[0].menuItemId).toBe('p_008_atta');
    expect(wire[0].priceSnapshot).toBe(250);
    expect(wire[0].productId).toBe('p_008_atta');
    expect(wire[0].quantity).toBe(2);
  });

  test('omits menuItemId when the cart line does not carry one (legacy path opt-in)', () => {
    // A pre-hotfix persisted cart could rehydrate without
    // menuItemId. The wire shape must NOT emit `menuItemId:
    // undefined` because the server's validation path picker
    // distinguishes "missing" from "empty string" / "undefined-but-
    // present". Use `'menuItemId' in wire[0]` as a strict check.
    const items: CartItem[] = [
      {
        ...baseLine,
        productId: 'p_008_atta',
        quantity: 1,
      },
    ];
    const wire = buildPlaceOrderPayload(items);
    expect('menuItemId' in wire[0]).toBe(false);
    expect('priceSnapshot' in wire[0]).toBe(false);
  });

  test('omits menuItemId when it is an empty string', () => {
    const items: CartItem[] = [
      {
        ...baseLine,
        productId: 'p_008_atta',
        menuItemId: '',
        quantity: 1,
      },
    ];
    const wire = buildPlaceOrderPayload(items);
    expect('menuItemId' in wire[0]).toBe(false);
  });

  test('omits priceSnapshot when it is NaN or non-finite', () => {
    const items: CartItem[] = [
      {
        ...baseLine,
        productId: 'p_008_atta',
        menuItemId: 'p_008_atta',
        priceSnapshot: NaN,
        quantity: 1,
      },
    ];
    const wire = buildPlaceOrderPayload(items);
    expect('priceSnapshot' in wire[0]).toBe(false);
    // menuItemId still flows through.
    expect(wire[0].menuItemId).toBe('p_008_atta');
  });

  test('forwards menuItemId for every line in a multi-line cart', () => {
    // Sanity: regressions sometimes only happen on the first or
    // last element in an array. Pin all of them.
    const items: CartItem[] = [
      {
        ...baseLine,
        productId: 'p_008_atta',
        menuItemId: 'p_008_atta',
        priceSnapshot: 250,
        quantity: 1,
      },
      {
        ...baseLine,
        name: 'Custom item',
        productId: 'custom_1700000000_abcdef',
        menuItemId: 'custom_1700000000_abcdef',
        priceSnapshot: 99,
        quantity: 3,
      },
      {
        ...baseLine,
        name: 'Tata Salt',
        productId: 'p_008_salt',
        menuItemId: 'p_008_salt',
        priceSnapshot: 25,
        quantity: 2,
      },
    ];
    const wire = buildPlaceOrderPayload(items);
    expect(wire).toHaveLength(3);
    expect(wire.every(w => typeof w.menuItemId === 'string' && w.menuItemId.length > 0)).toBe(
      true,
    );
    expect(wire.map(w => w.menuItemId)).toEqual([
      'p_008_atta',
      'custom_1700000000_abcdef',
      'p_008_salt',
    ]);
  });

  test('returns plain objects (no class instances, no methods, no extra keys)', () => {
    // Server-side, the payload goes through Cloud Functions JSON
    // serialisation. Pin the exact key set so a refactor can't
    // accidentally include a getter / non-enumerable / extra field
    // that the server's input validator rejects.
    const items: CartItem[] = [
      {
        ...baseLine,
        productId: 'p_008_atta',
        menuItemId: 'p_008_atta',
        priceSnapshot: 250,
        quantity: 1,
      },
    ];
    const [wire] = buildPlaceOrderPayload(items);
    expect(Object.keys(wire).sort()).toEqual(
      ['menuItemId', 'priceSnapshot', 'productId', 'quantity'].sort(),
    );
  });
});
