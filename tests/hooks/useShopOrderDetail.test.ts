/**
 * Pure-helper tests for the ShopOrderDetail state machine
 * (src/screens/shop/ShopOrderDetailScreen.useShopOrderDetail.ts).
 *
 * Per the test discipline doc and matching the precedent from
 * useShopListData.test.ts, we don't mount the hook itself — RNTL
 * is still out of scope. The hook is a thin useState/useEffect
 * shell over the pure helpers below; this file pins those helpers.
 *
 * The watcher contract regression we keep solving:
 *   - First callback (success or error) MUST clear loading.
 *   - Errors don't blank existing data on screen.
 *   - Action failure reverts the optimistic status flip.
 */
import type { Order } from '../../src/types';
import {
  applyOptimisticStatus,
  INITIAL_STATE,
  reduceWatcherUpdate,
  runOrderActionOnce,
} from '../../src/screens/shop/ShopOrderDetailScreen.useShopOrderDetail';

const mkOrder = (overrides: Partial<Order> = {}): Order =>
  ({
    id: 'o_001',
    shopId: 'shop_001',
    shopName: 'Test Shop',
    customerUid: 'u_1',
    customerName: 'Test',
    customerPhone: '+919999999999',
    items: [],
    subtotal: 100,
    deliveryFee: 20,
    total: 120,
    deliveryAddress: {
      name: 'A',
      line1: '1',
      city: 'X',
      pincode: '110001',
      phone: '+919999999999',
    },
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    status: 'pending',
    createdAt: 1_700_000_000_000,
    estimatedDeliveryAt: 1_700_000_000_000 + 30 * 60_000,
    // PR 12 — readyByEstimate. Defaults to null (legacy semantic).
    readyByEstimate: null,
    ...overrides,
  }) as Order;

describe('reduceWatcherUpdate', () => {
  test('first success populates order, clears loading, clears error', () => {
    const order = mkOrder();
    const next = reduceWatcherUpdate(INITIAL_STATE, { order });
    expect(next.order).toBe(order);
    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();
  });

  test('watcher error clears loading (the regression we keep solving)', () => {
    // Pinning this exact transition because the loader-stuck-forever
    // bug class lives here. If a future refactor flips the order of
    // operations and forgets to set loading: false on the error
    // branch, this test fails by name.
    const next = reduceWatcherUpdate(INITIAL_STATE, {
      order: null,
      error: new Error('PERMISSION_DENIED'),
    });
    expect(next.loading).toBe(false);
    expect(next.error).toBe('PERMISSION_DENIED');
  });

  test('error AFTER an initial successful render preserves the prior order', () => {
    // Important UX guarantee: when the watcher's polling loop hits a
    // transient failure, we do NOT blank the screen. The owner can
    // keep reading the order while the banner shows above.
    const order = mkOrder({ status: 'preparing' });
    const afterSuccess = reduceWatcherUpdate(INITIAL_STATE, { order });
    const afterError = reduceWatcherUpdate(afterSuccess, {
      order: null,
      error: new Error('rate-limited'),
    });
    expect(afterError.order).toBe(order);
    expect(afterError.error).toBe('rate-limited');
    expect(afterError.loading).toBe(false);
  });

  test('falls back to a generic message when error has no .message', () => {
    const next = reduceWatcherUpdate(INITIAL_STATE, {
      order: null,
      error: new Error(''),
    });
    expect(next.error).toBe('Could not load order. Try again later.');
  });
});

describe('applyOptimisticStatus', () => {
  test('returns a NEW order object with the new status (does not mutate)', () => {
    const order = mkOrder({ status: 'pending' });
    const next = applyOptimisticStatus(order, 'accepted');
    expect(next).not.toBe(order);
    expect(next?.status).toBe('accepted');
    // Original untouched — pinned because Zustand-style mutations
    // could leak across the watcher tick if we weren't careful.
    expect(order.status).toBe('pending');
  });

  test('returns the same null when there is no order', () => {
    expect(applyOptimisticStatus(null, 'accepted')).toBeNull();
  });
});

describe('runOrderActionOnce', () => {
  test('returns { ok: true } when updateOrderStatus resolves', async () => {
    const calls: any[] = [];
    const result = await runOrderActionOnce(
      async input => {
        calls.push(input);
      },
      'o_001',
      'accepted',
    );
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ orderId: 'o_001', newStatus: 'accepted' }]);
  });

  test('returns { ok: false, error } when updateOrderStatus throws (revert path)', async () => {
    // The hook's caller uses this branch to revert the optimistic
    // status flip. If runOrderActionOnce ever started re-throwing,
    // the screen would crash with an unhandled promise rejection
    // and the chip would stay flipped to the wrong status.
    const result = await runOrderActionOnce(
      async () => {
        throw new Error('cannot transition from delivered to preparing');
      },
      'o_001',
      'preparing',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(
      'cannot transition from delivered to preparing',
    );
  });

  test('falls back to a generic error message when the thrown error has no message', async () => {
    const result = await runOrderActionOnce(
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      async () => {
        throw 'string-thrown-no-message-prop';
      },
      'o_001',
      'accepted',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Failed to update order status.');
  });
});
