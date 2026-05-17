/**
 * Wire-shape integration tests for orderService.placeOrder.
 *
 * Why this exists: the v2-iv-hotfix-1 root cause was a one-line
 * `.map({ productId, quantity })` inside placeOrder that silently
 * stripped `menuItemId` and `priceSnapshot` from every cart line.
 * The cart-store invariant tests pin the in-memory shape;
 * `buildPlaceOrderPayload.test.ts` pins the helper. NEITHER catches
 * a future "let's just inline this map again" refactor that
 * bypasses the helper. This file does — it captures the actual
 * argument the callable receives end-to-end.
 *
 * Pinned contracts:
 *   1. The native (RNFB) path forwards menuItemId on every line.
 *   2. The web (httpsCallable) path forwards menuItemId on every line.
 *   3. priceSnapshot is forwarded when set, omitted when not.
 *   4. shopId / address / paymentMethod survive untouched.
 */
import { Platform } from 'react-native';
import {
  __resetHttpsCallable,
  __setHttpsCallable,
} from '../__mocks__/rnfb-app';
import {
  __reset as __resetWebCallable,
  __setWebCallable,
} from '../__mocks__/firebase-functions';
import type { CartItem, Address } from '../../src/types';

const loadOrderService = () => {
  let svc: typeof import('../../src/services/orderService').orderService;
  jest.isolateModules(() => {
    svc = require('../../src/services/orderService').orderService;
  });
  // @ts-expect-error assigned inside isolateModules
  return svc;
};

const baseAddress: Address = {
  name: 'Test',
  line1: '1, Test Street',
  city: 'Delhi',
  pincode: '110001',
  phone: '+919999999999',
};

const cartLine = (
  overrides: Partial<CartItem> & Pick<CartItem, 'productId' | 'quantity'>,
): CartItem =>
  ({
    name: 'Atta',
    imageUrl: 'http://x/a.jpg',
    packLabel: '5 kg',
    price: 250,
    ...overrides,
  }) as unknown as CartItem;

beforeEach(() => {
  __resetHttpsCallable();
  __resetWebCallable();
});

describe('orderService.placeOrder wire shape — native (RNFB)', () => {
  beforeEach(() => {
    Platform.OS = 'ios';
  });

  test('forwards menuItemId AND priceSnapshot on every line (the v2-iv regression)', async () => {
    let captured: any = null;
    __setHttpsCallable(name => {
      if (name !== 'placeOrder') {
        return async () => {
          throw new Error(`unexpected callable ${name}`);
        };
      }
      return async (input: unknown) => {
        captured = input;
        return {
          data: {
            orderId: 'o_1',
            total: 270,
            etaMinutes: 30,
            paymentStatus: 'pending',
          },
        };
      };
    });

    const orderService = loadOrderService();
    const items: CartItem[] = [
      cartLine({
        productId: 'p_008_atta',
        menuItemId: 'p_008_atta',
        priceSnapshot: 250,
        quantity: 2,
      }),
      cartLine({
        productId: 'custom_1700_xyz',
        menuItemId: 'custom_1700_xyz',
        priceSnapshot: 99,
        quantity: 1,
        name: 'Custom item',
      }),
    ];

    await orderService.placeOrder({
      shopId: 'shop_008',
      items,
      address: baseAddress,
      paymentMethod: 'cod',
    });

    expect(captured).not.toBeNull();
    expect(captured.shopId).toBe('shop_008');
    expect(captured.address).toEqual(baseAddress);
    expect(captured.paymentMethod).toBe('cod');
    expect(captured.items).toHaveLength(2);
    // Every line MUST forward menuItemId. THE pinned contract.
    for (const line of captured.items) {
      expect(typeof line.menuItemId).toBe('string');
      expect(line.menuItemId.length).toBeGreaterThan(0);
    }
    expect(captured.items[0].menuItemId).toBe('p_008_atta');
    expect(captured.items[0].priceSnapshot).toBe(250);
    expect(captured.items[1].menuItemId).toBe('custom_1700_xyz');
    expect(captured.items[1].priceSnapshot).toBe(99);
  });

  test('omits menuItemId from the wire when the cart line lacks one (legacy path opt-in)', async () => {
    // A cart line rehydrated from a pre-hotfix persisted state
    // could lack menuItemId. The wire shape MUST NOT emit
    // `menuItemId: undefined` because the server distinguishes
    // "missing" from "empty". This test pins the predicate path.
    let captured: any = null;
    __setHttpsCallable(() => async (input: unknown) => {
      captured = input;
      return {
        data: {
          orderId: 'o_2',
          total: 250,
          etaMinutes: 30,
          paymentStatus: 'pending',
        },
      };
    });

    const orderService = loadOrderService();
    const items: CartItem[] = [
      cartLine({
        productId: 'p_legacy_atta',
        quantity: 1,
        // NO menuItemId, NO priceSnapshot
      }),
    ];

    await orderService.placeOrder({
      shopId: 'shop_legacy',
      items,
      address: baseAddress,
      paymentMethod: 'cod',
    });

    expect(captured.items).toHaveLength(1);
    expect('menuItemId' in captured.items[0]).toBe(false);
    expect('priceSnapshot' in captured.items[0]).toBe(false);
    expect(captured.items[0].productId).toBe('p_legacy_atta');
    expect(captured.items[0].quantity).toBe(1);
  });
});

describe('orderService.placeOrder wire shape — web', () => {
  beforeEach(() => {
    Platform.OS = 'web';
  });

  test('web path forwards menuItemId on every line (parity with native)', async () => {
    let captured: any = null;
    __setWebCallable(() => async (input: unknown) => {
      captured = input;
      return {
        data: {
          orderId: 'o_3',
          total: 270,
          etaMinutes: 30,
          paymentStatus: 'pending',
        },
      };
    });

    const orderService = loadOrderService();
    const items: CartItem[] = [
      cartLine({
        productId: 'p_a_atta',
        menuItemId: 'p_a_atta',
        priceSnapshot: 245,
        quantity: 2,
      }),
    ];

    await orderService.placeOrder({
      shopId: 'shop_a',
      items,
      address: baseAddress,
      paymentMethod: 'online',
    });

    expect(captured.items).toHaveLength(1);
    expect(captured.items[0].menuItemId).toBe('p_a_atta');
    expect(captured.items[0].priceSnapshot).toBe(245);
    expect(captured.paymentMethod).toBe('online');
  });
});
