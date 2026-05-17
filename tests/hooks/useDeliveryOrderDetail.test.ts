/**
 * Pure-helper tests for the DeliveryOrderDetailScreen state machine
 * (src/screens/delivery/DeliveryOrderDetailScreen.useDeliveryOrderDetail.ts).
 *
 * Same precedent as `useShopOrderDetail.test.ts` — we don't mount
 * the hook itself (RNTL still out of scope). The hook is a thin
 * useState/useEffect shell over the pure helpers below; this file
 * pins those helpers.
 *
 * Three regression-prone behaviours pinned here:
 *   1. The watcher contract: first error callback MUST clear loading.
 *   2. The derived flags: `isAvailableForClaim` opens ONLY when the
 *      order is unassigned + out_for_delivery + viewer is delivery
 *      role + not the assignee. Anything else closes it.
 *   3. The claim race: a failed `claimDelivery` returns a discriminated
 *      error result instead of throwing. The screen depends on this
 *      to surface an Alert without an unhandled rejection.
 */
import {
    applyOptimisticDelivered,
    applyOptimisticPickedUp,
    deriveDeliveryFlags,
    FLAGS_NULL_ORDER,
    INITIAL_STATE,
    reduceWatcherUpdate,
    runClaimOnce,
    runStatusActionOnce,
} from '../../src/screens/delivery/DeliveryOrderDetailScreen.useDeliveryOrderDetail';
import type { Order } from '../../src/types';

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
    status: 'out_for_delivery',
    createdAt: 1_700_000_000_000,
    estimatedDeliveryAt: 1_700_000_000_000 + 30 * 60_000,
    deliveryPersonId: null,
    pickedUpAt: null,
    deliveredAt: null,
    ...overrides,
  }) as unknown as Order;

describe('reduceWatcherUpdate', () => {
  test('first success populates order, clears loading, clears error', () => {
    const order = mkOrder();
    const next = reduceWatcherUpdate(INITIAL_STATE, { order });
    expect(next.order).toBe(order);
    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();
  });

  test('watcher error clears loading (the regression we keep solving)', () => {
    // The deliberate-break demo target. If a future refactor forgets
    // to set loading: false on the error branch, this test fails by
    // name and the failing test name pinpoints the regression.
    const next = reduceWatcherUpdate(INITIAL_STATE, {
      order: null,
      error: new Error('PERMISSION_DENIED'),
    });
    expect(next.loading).toBe(false);
    expect(next.error).toBe('PERMISSION_DENIED');
  });

  test('error after a successful render preserves the prior order', () => {
    const order = mkOrder({ status: 'out_for_delivery' });
    const afterSuccess = reduceWatcherUpdate(INITIAL_STATE, { order });
    const afterError = reduceWatcherUpdate(afterSuccess, {
      order: null,
      error: new Error('rate-limited'),
    });
    expect(afterError.order).toBe(order);
    expect(afterError.error).toBe('rate-limited');
    expect(afterError.loading).toBe(false);
  });
});

describe('deriveDeliveryFlags', () => {
  test('null order → all flags false', () => {
    expect(deriveDeliveryFlags(null, 'me', true)).toEqual(FLAGS_NULL_ORDER);
  });

  test('available-for-claim: unassigned + out_for_delivery + delivery role', () => {
    const flags = deriveDeliveryFlags(mkOrder(), 'me', true);
    expect(flags.isAvailableForClaim).toBe(true);
    expect(flags.isAssigned).toBe(false);
    expect(flags.isTerminalForOthers).toBe(false);
  });

  test('NOT available-for-claim when viewer is not a delivery person', () => {
    const flags = deriveDeliveryFlags(mkOrder(), 'me', false);
    expect(flags.isAvailableForClaim).toBe(false);
    // Non-delivery viewer also can't be assigned (server enforces).
    expect(flags.isAssigned).toBe(false);
  });

  test('claimed by ANOTHER delivery person → terminal for me', () => {
    // The "Already taken" UI branch the screen renders as an
    // EmptyState. Pinning the flag combo because the screen
    // distinguishes claimed-by-other from delivered using these
    // flags.
    const flags = deriveDeliveryFlags(
      mkOrder({ deliveryPersonId: 'someone_else' }),
      'me',
      true,
    );
    expect(flags.isAvailableForClaim).toBe(false);
    expect(flags.isAssigned).toBe(false);
    expect(flags.isTerminalForOthers).toBe(true);
    expect(flags.isDelivered).toBe(false);
  });

  test('assigned to me + not delivered → assigned, not available-for-claim', () => {
    const flags = deriveDeliveryFlags(
      mkOrder({ deliveryPersonId: 'me' }),
      'me',
      true,
    );
    expect(flags.isAssigned).toBe(true);
    expect(flags.isAvailableForClaim).toBe(false);
    expect(flags.isTerminalForOthers).toBe(false);
  });

  test('assigned to me + pickedUp → isPickedUp true, still assigned', () => {
    const flags = deriveDeliveryFlags(
      mkOrder({ deliveryPersonId: 'me', pickedUpAt: 1_700_000_001_000 }),
      'me',
      true,
    );
    expect(flags.isAssigned).toBe(true);
    expect(flags.isPickedUp).toBe(true);
    expect(flags.isDelivered).toBe(false);
  });

  test('assigned to me + delivered → isDelivered true, still assigned (NOT terminal)', () => {
    // When *I* delivered the order, it's not "terminal for others" —
    // it's the success state for me. Pinning so the screen branch
    // for the green "Delivered" card stays correct.
    const flags = deriveDeliveryFlags(
      mkOrder({ deliveryPersonId: 'me', status: 'delivered' }),
      'me',
      true,
    );
    expect(flags.isDelivered).toBe(true);
    expect(flags.isAssigned).toBe(true);
    expect(flags.isTerminalForOthers).toBe(false);
  });

  test('order not yet out_for_delivery (e.g. preparing) → not available, terminal for others', () => {
    const flags = deriveDeliveryFlags(
      mkOrder({ status: 'preparing' }),
      'me',
      true,
    );
    expect(flags.isAvailableForClaim).toBe(false);
    expect(flags.isAssigned).toBe(false);
    expect(flags.isTerminalForOthers).toBe(true);
  });

  test('empty-string deliveryPersonId is treated as unassigned', () => {
    // Defensive: legacy data may have '' instead of null.
    const flags = deriveDeliveryFlags(
      mkOrder({ deliveryPersonId: '' as any }),
      'me',
      true,
    );
    expect(flags.isAvailableForClaim).toBe(true);
  });
});

describe('runClaimOnce', () => {
  test('returns { ok: true } when claimDelivery resolves', async () => {
    const calls: any[] = [];
    const result = await runClaimOnce(async input => {
      calls.push(input);
    }, 'o_001');
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ orderId: 'o_001' }]);
  });

  test('returns { ok: false, error } when the race is lost (the deliberate-break demo target)', async () => {
    // The screen depends on this branch to render an Alert without
    // an unhandled promise rejection. If anyone changes runClaimOnce
    // to re-throw, the screen would crash mid-claim.
    const result = await runClaimOnce(async () => {
      throw new Error('Already taken');
    }, 'o_001');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Already taken');
  });

  test('falls back to a generic error when the thrown error has no message', async () => {
    const result = await runClaimOnce(
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      async () => {
        throw 'string-thrown';
      },
      'o_001',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(
      'Could not claim this pickup. It may be taken.',
    );
  });
});

describe('runStatusActionOnce', () => {
  test('returns { ok: true } on success', async () => {
    const calls: any[] = [];
    const result = await runStatusActionOnce(async input => {
      calls.push(input);
    }, 'o_001');
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ orderId: 'o_001' }]);
  });

  test('returns { ok: false, error } on failure (the revert path)', async () => {
    const result = await runStatusActionOnce(async () => {
      throw new Error('cannot transition');
    }, 'o_001');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('cannot transition');
  });
});

describe('applyOptimisticPickedUp / applyOptimisticDelivered', () => {
  test('applyOptimisticPickedUp stamps pickedUpAt on a copy (no mutation)', () => {
    const order = mkOrder();
    const next = applyOptimisticPickedUp(order, 1_700_000_010_000);
    expect(next).not.toBe(order);
    expect(next?.pickedUpAt).toBe(1_700_000_010_000);
    expect(order.pickedUpAt).toBeNull();
  });

  test('applyOptimisticDelivered flips status + stamps deliveredAt on a copy', () => {
    const order = mkOrder({
      status: 'out_for_delivery',
      pickedUpAt: 1_700_000_005_000,
    });
    const next = applyOptimisticDelivered(order, 1_700_000_010_000);
    expect(next).not.toBe(order);
    expect(next?.status).toBe('delivered');
    expect(next?.deliveredAt).toBe(1_700_000_010_000);
    expect(next?.pickedUpAt).toBe(1_700_000_005_000); // preserved
    expect(order.status).toBe('out_for_delivery'); // not mutated
  });

  test('null order passthrough on both helpers', () => {
    expect(applyOptimisticPickedUp(null, 1)).toBeNull();
    expect(applyOptimisticDelivered(null, 1)).toBeNull();
  });
});
