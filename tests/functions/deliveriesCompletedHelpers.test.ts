/**
 * PR-NEXT-BUNDLE-G §A — DO NOT REMOVE. Tests for computeDeliveriesCompleted.
 * +5 tests covering all branches. Deliberate-break: change status check to
 * !== 'delivered' inside the helper; multi-partner test must fail.
 */

import { computeDeliveriesCompleted } from '../../functions/src/deliveriesCompletedHelpers';

describe('computeDeliveriesCompleted', () => {
  it('returns empty map for empty input', () => {
    expect(computeDeliveriesCompleted([])).toEqual(new Map());
  });

  it('counts delivered orders per partner', () => {
    const result = computeDeliveriesCompleted([
      { deliveryPersonId: 'uid-1', status: 'delivered' },
      { deliveryPersonId: 'uid-1', status: 'delivered' },
      { deliveryPersonId: 'uid-2', status: 'delivered' },
    ]);
    expect(result.get('uid-1')).toBe(2);
    expect(result.get('uid-2')).toBe(1);
  });

  it('ignores non-delivered orders', () => {
    const result = computeDeliveriesCompleted([
      { deliveryPersonId: 'uid-1', status: 'cancelled' },
      { deliveryPersonId: 'uid-1', status: 'preparing' },
      { deliveryPersonId: 'uid-1', status: 'delivered' },
    ]);
    expect(result.get('uid-1')).toBe(1);
  });

  it('ignores orders with null deliveryPersonId', () => {
    const result = computeDeliveriesCompleted([
      { deliveryPersonId: null, status: 'delivered' },
      { deliveryPersonId: undefined, status: 'delivered' },
    ]);
    expect(result.size).toBe(0);
  });

  it('handles multi-partner aggregation correctly', () => {
    const orders = [
      { deliveryPersonId: 'uid-A', status: 'delivered' },
      { deliveryPersonId: 'uid-B', status: 'delivered' },
      { deliveryPersonId: 'uid-A', status: 'delivered' },
      { deliveryPersonId: 'uid-C', status: 'cancelled' },
      { deliveryPersonId: 'uid-B', status: 'delivered' },
      { deliveryPersonId: 'uid-B', status: 'delivered' },
    ];
    const result = computeDeliveriesCompleted(orders);
    expect(result.get('uid-A')).toBe(2);
    expect(result.get('uid-B')).toBe(3);
    expect(result.has('uid-C')).toBe(false);
  });
});
