/**
 * PR-NEXT-1 — `displayOrderStatus` exhaustive matrix.
 *
 * Pins per-audience label strings + the `pickedUpAt`-aware
 * synthetic 'picked_up' state that fixes finding #10 (customer
 * seeing contradictory "Out for delivery" + "Pickup ready 5 min
 * ago" on the same screen).
 */

import type { Order } from '../../src/types';
import {
  ORDER_STATUS_LABELS,
  displayOrderStatus,
  resolveDisplayedState,
  type DisplayAudience,
} from '../../src/utils/orderStatusDisplay';

type OrderInput = Pick<Order, 'status'> & {
  pickedUpAt?: number | null;
  deliveredAt?: number | null;
  cancelledAt?: number | null;
};

const audiences: DisplayAudience[] = [
  'customer',
  'shopkeeper',
  'delivery',
  'admin',
];

describe('PR-NEXT-1 — resolveDisplayedState (decision matrix)', () => {
  test('status pending / accepted / preparing pass through unchanged', () => {
    expect(resolveDisplayedState({ status: 'pending' })).toBe('pending');
    expect(resolveDisplayedState({ status: 'accepted' })).toBe('accepted');
    expect(resolveDisplayedState({ status: 'preparing' })).toBe('preparing');
  });

  test('ready_for_pickup + pickedUpAt=null → ready_for_pickup', () => {
    expect(
      resolveDisplayedState({
        status: 'ready_for_pickup',
        pickedUpAt: null,
      }),
    ).toBe('ready_for_pickup');
    expect(
      resolveDisplayedState({ status: 'ready_for_pickup' }),
    ).toBe('ready_for_pickup');
  });

  test('ready_for_pickup + pickedUpAt set → synthetic picked_up state (finding #10 fix)', () => {
    expect(
      resolveDisplayedState({
        status: 'ready_for_pickup',
        pickedUpAt: 1700000000000,
      }),
    ).toBe('picked_up');
    // Even pickedUpAt: 0 is a valid timestamp signal; only `null` /
    // `undefined` should keep us in ready_for_pickup. Defensive
    // pin — server uses serverTimestamp() so 0 won't appear in
    // practice, but a downstream caller mocking a unit test
    // shouldn't accidentally fall into the wrong state.
    expect(
      resolveDisplayedState({
        status: 'ready_for_pickup',
        pickedUpAt: 1,
      }),
    ).toBe('picked_up');
  });

  test('status delivered → delivered (regardless of other fields)', () => {
    expect(resolveDisplayedState({ status: 'delivered' })).toBe('delivered');
    expect(
      resolveDisplayedState({
        status: 'delivered',
        pickedUpAt: 1700000000000,
        deliveredAt: 1700000300000,
      }),
    ).toBe('delivered');
  });

  test('status cancelled wins over a stale deliveredAt (data-inconsistency case)', () => {
    expect(
      resolveDisplayedState({
        status: 'cancelled',
        deliveredAt: 1700000300000,
      }),
    ).toBe('cancelled');
  });

  test('status cancelled wins over a stale pickedUpAt', () => {
    expect(
      resolveDisplayedState({
        status: 'cancelled',
        pickedUpAt: 1700000000000,
      }),
    ).toBe('cancelled');
  });
});

describe('PR-NEXT-1 — displayOrderStatus per-audience labels', () => {
  // 7 displayed states × 4 audiences = 28 cases. We assemble them
  // from a representative order shape per state.
  const fixturesByState = {
    pending: { status: 'pending' as const },
    accepted: { status: 'accepted' as const },
    preparing: { status: 'preparing' as const },
    ready_for_pickup: { status: 'ready_for_pickup' as const, pickedUpAt: null },
    picked_up: {
      status: 'ready_for_pickup' as const,
      pickedUpAt: 1700000000000,
    },
    delivered: { status: 'delivered' as const },
    cancelled: { status: 'cancelled' as const },
  };

  for (const audience of audiences) {
    for (const state of Object.keys(fixturesByState) as Array<
      keyof typeof fixturesByState
    >) {
      test(`${audience}/${state} → label matches ORDER_STATUS_LABELS table`, () => {
        const order = fixturesByState[state] as OrderInput;
        const out = displayOrderStatus(order, audience);
        expect(out.state).toBe(state);
        expect(out.label).toBe(ORDER_STATUS_LABELS[audience][state]);
      });
    }
  }
});

describe('PR-NEXT-1 — pinned customer-facing strings (regression net)', () => {
  // The labels below are what the customer actually sees. A
  // careless rename in one of the audience tables shouldn't
  // silently change customer copy without a test failure.
  test('customer copy stays stable across releases', () => {
    expect(ORDER_STATUS_LABELS.customer).toEqual({
      pending: 'Awaiting shop confirmation',
      accepted: 'Shop accepted',
      preparing: 'Being prepared',
      ready_for_pickup: 'Ready — partner picking up',
      picked_up: 'Out for delivery',
      delivered: 'Delivered',
      cancelled: 'Order cancelled',
    });
  });

  test('finding #10 contradictory-label scenario resolves to a single state', () => {
    // The order shape that triggered finding #10 in the May 30
    // Android pilot: status was still 'ready_for_pickup' (the
    // server intentionally doesn't change it on pickup — pickup
    // is signalled by `pickedUpAt`) but `pickedUpAt` had been set
    // by the partner's "I've picked it up" tap. Pre-fix the chip
    // showed "Out for delivery" while the ETA block independently
    // showed "Pickup ready 5 min ago". Post-fix both surfaces
    // resolve via this helper to the SAME state ('picked_up').
    const order: OrderInput = {
      status: 'ready_for_pickup',
      pickedUpAt: 1700000000000,
    };
    const customerView = displayOrderStatus(order, 'customer');
    expect(customerView.state).toBe('picked_up');
    expect(customerView.label).toBe('Out for delivery');

    const shopView = displayOrderStatus(order, 'shopkeeper');
    expect(shopView.state).toBe('picked_up');
    expect(shopView.label).toBe('Picked up — out for delivery');
  });
});
