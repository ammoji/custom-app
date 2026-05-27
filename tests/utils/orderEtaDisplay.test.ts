/**
 * PR 43 — Tests for the customer-facing ETA display state machine.
 * Pins every branch of the helper so a regression in any surface
 * (OrderConfirmationScreen, OrderDetailScreen, ActiveOrdersRail)
 * is caught here instead of relying on smoke testing each screen.
 */
import {
  orderEtaDisplay,
  type EtaInput,
} from '../../src/utils/orderEtaDisplay';

// Fixed clock — every test reasons against this so minute arithmetic
// stays deterministic. May 26 2026 22:00 UTC chosen arbitrarily.
const NOW = 1748296800000;
const MIN = 60_000;

describe('PR 43 — orderEtaDisplay', () => {
  test('pending order returns awaiting_confirmation (no minute count)', () => {
    const order: EtaInput = {
      status: 'pending',
      estimatedDeliveryAt: NOW + 29 * MIN,
    };
    expect(orderEtaDisplay(order, NOW)).toEqual({
      kind: 'awaiting_confirmation',
    });
  });

  test('pending order ignores readyByEstimate too (shop cannot set ETA pre-acceptance)', () => {
    // Defensive — even if a buggy server stamped readyByEstimate on
    // a pending order, the customer surface should still hide it.
    // Acceptance is the trust boundary.
    const order: EtaInput = {
      status: 'pending',
      readyByEstimate: NOW + 25 * MIN,
      estimatedDeliveryAt: NOW + 29 * MIN,
    };
    expect(orderEtaDisplay(order, NOW)).toEqual({
      kind: 'awaiting_confirmation',
    });
  });

  test('accepted order with readyByEstimate returns ready_by', () => {
    const order: EtaInput = {
      status: 'accepted',
      readyByEstimate: NOW + 22 * MIN,
      estimatedDeliveryAt: NOW + 29 * MIN,
    };
    expect(orderEtaDisplay(order, NOW)).toEqual({
      kind: 'ready_by',
      readyByEstimate: NOW + 22 * MIN,
    });
  });

  test('preparing order with readyByEstimate returns ready_by', () => {
    const order: EtaInput = {
      status: 'preparing',
      readyByEstimate: NOW + 15 * MIN,
    };
    expect(orderEtaDisplay(order, NOW)).toEqual({
      kind: 'ready_by',
      readyByEstimate: NOW + 15 * MIN,
    });
  });

  test('ready_for_pickup order with readyByEstimate returns ready_by', () => {
    const order: EtaInput = {
      status: 'ready_for_pickup',
      readyByEstimate: NOW + 5 * MIN,
    };
    expect(orderEtaDisplay(order, NOW)).toEqual({
      kind: 'ready_by',
      readyByEstimate: NOW + 5 * MIN,
    });
  });

  test('accepted order WITHOUT readyByEstimate falls back to creation-time estimate', () => {
    const order: EtaInput = {
      status: 'accepted',
      estimatedDeliveryAt: NOW + 18 * MIN,
    };
    expect(orderEtaDisplay(order, NOW)).toEqual({
      kind: 'eta_fallback',
      minutesLeft: 18,
    });
  });

  test('eta_fallback with minutesLeft <= 0 returns arriving_soon', () => {
    const order: EtaInput = {
      status: 'preparing',
      estimatedDeliveryAt: NOW - 2 * MIN, // already past
    };
    expect(orderEtaDisplay(order, NOW)).toEqual({ kind: 'arriving_soon' });
  });

  test('delivered order returns hidden regardless of estimates', () => {
    const order: EtaInput = {
      status: 'delivered',
      readyByEstimate: NOW + 5 * MIN,
      estimatedDeliveryAt: NOW + 29 * MIN,
    };
    expect(orderEtaDisplay(order, NOW)).toEqual({ kind: 'hidden' });
  });

  test('cancelled order returns hidden', () => {
    const order: EtaInput = {
      status: 'cancelled',
      estimatedDeliveryAt: NOW + 29 * MIN,
    };
    expect(orderEtaDisplay(order, NOW)).toEqual({ kind: 'hidden' });
  });

  test('accepted order with both estimates missing returns hidden', () => {
    // Pathological — shouldn't happen, but the helper must not
    // produce a "~NaN min" copy if it ever does.
    const order: EtaInput = { status: 'accepted' };
    expect(orderEtaDisplay(order, NOW)).toEqual({ kind: 'hidden' });
  });

  test('defensive: non-finite estimatedDeliveryAt is treated as missing', () => {
    const order: EtaInput = {
      status: 'preparing',
      estimatedDeliveryAt: Number.NaN,
    };
    expect(orderEtaDisplay(order, NOW)).toEqual({ kind: 'hidden' });
  });

  test('defensive: zero estimatedDeliveryAt is treated as missing', () => {
    const order: EtaInput = {
      status: 'preparing',
      estimatedDeliveryAt: 0,
    };
    expect(orderEtaDisplay(order, NOW)).toEqual({ kind: 'hidden' });
  });

  test('defensive: zero readyByEstimate falls through to estimatedDeliveryAt', () => {
    // Zero is treated as missing rather than valid (since
    // `Math.round(...) <= 0` would also fire arriving_soon).
    // Verifies the readyByEstimate gate uses `> 0` not just
    // `>= 0`.
    const order: EtaInput = {
      status: 'accepted',
      readyByEstimate: 0,
      estimatedDeliveryAt: NOW + 10 * MIN,
    };
    expect(orderEtaDisplay(order, NOW)).toEqual({
      kind: 'eta_fallback',
      minutesLeft: 10,
    });
  });
});
