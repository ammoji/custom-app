/**
 * PR-NEXT-BUNDLE-D §E — tests for the delivery dashboard sort helpers.
 *
 * sortPickups (8): distance asc + missing-bottom + tie; pay desc +
 *   missing-zero + tie; age desc + tie.
 * sortComingUpByPriority (4): preparing-before-accepted; secondary
 *   readyByEstimate; mixed list with unknown status; empty.
 */
import { describe, expect, it } from '@jest/globals';
import {
  sortComingUpByPriority,
  sortPickups,
} from '../../src/utils/deliverySortHelpers';

const mk = (id: string, extra: Record<string, any> = {}) =>
  ({ id, deliveryFee: 0, createdAt: 0, status: 'ready_for_pickup', ...extra } as any);

describe('sortPickups — distance', () => {
  it('sorts nearest first', () => {
    const out = sortPickups(
      [mk('a', { distanceKm: 3 }), mk('b', { distanceKm: 1 }), mk('c', { distanceKm: 2 })],
      'distance',
    );
    expect(out.map(o => o.id)).toEqual(['b', 'c', 'a']);
  });

  it('pushes missing distance to the bottom', () => {
    const out = sortPickups(
      [mk('a'), mk('b', { distanceKm: 1 })],
      'distance',
    );
    expect(out.map(o => o.id)).toEqual(['b', 'a']);
  });

  it('preserves original order on distance ties', () => {
    const out = sortPickups(
      [mk('a', { distanceKm: 2 }), mk('b', { distanceKm: 2 })],
      'distance',
    );
    expect(out.map(o => o.id)).toEqual(['a', 'b']);
  });
});

describe('sortPickups — pay', () => {
  it('sorts highest fee first', () => {
    const out = sortPickups(
      [mk('a', { deliveryFee: 40 }), mk('b', { deliveryFee: 80 }), mk('c', { deliveryFee: 60 })],
      'pay',
    );
    expect(out.map(o => o.id)).toEqual(['b', 'c', 'a']);
  });

  it('treats missing fee as 0 (bottom)', () => {
    const out = sortPickups(
      [mk('a', { deliveryFee: undefined }), mk('b', { deliveryFee: 10 })],
      'pay',
    );
    expect(out.map(o => o.id)).toEqual(['b', 'a']);
  });

  it('preserves original order on pay ties', () => {
    const out = sortPickups(
      [mk('a', { deliveryFee: 50 }), mk('b', { deliveryFee: 50 })],
      'pay',
    );
    expect(out.map(o => o.id)).toEqual(['a', 'b']);
  });
});

describe('sortPickups — age', () => {
  it('sorts newest first', () => {
    const out = sortPickups(
      [mk('a', { createdAt: 100 }), mk('b', { createdAt: 300 }), mk('c', { createdAt: 200 })],
      'age',
    );
    expect(out.map(o => o.id)).toEqual(['b', 'c', 'a']);
  });

  it('preserves original order on createdAt ties', () => {
    const out = sortPickups(
      [mk('a', { createdAt: 5 }), mk('b', { createdAt: 5 })],
      'age',
    );
    expect(out.map(o => o.id)).toEqual(['a', 'b']);
  });
});

describe('sortComingUpByPriority', () => {
  it('puts preparing before accepted', () => {
    const out = sortComingUpByPriority([
      mk('a', { status: 'accepted', readyByEstimate: 10 }),
      mk('b', { status: 'preparing', readyByEstimate: 20 }),
    ]);
    expect(out.map(o => o.id)).toEqual(['b', 'a']);
  });

  it('sorts by readyByEstimate within same status', () => {
    const out = sortComingUpByPriority([
      mk('a', { status: 'preparing', readyByEstimate: 30 }),
      mk('b', { status: 'preparing', readyByEstimate: 10 }),
      mk('c', { status: 'preparing', readyByEstimate: 20 }),
    ]);
    expect(out.map(o => o.id)).toEqual(['b', 'c', 'a']);
  });

  it('clusters unknown status at the bottom', () => {
    const out = sortComingUpByPriority([
      mk('a', { status: 'ready_for_pickup', readyByEstimate: 5 }),
      mk('b', { status: 'preparing', readyByEstimate: 50 }),
    ]);
    expect(out.map(o => o.id)).toEqual(['b', 'a']);
  });

  it('handles empty list', () => {
    expect(sortComingUpByPriority([])).toEqual([]);
  });
});
