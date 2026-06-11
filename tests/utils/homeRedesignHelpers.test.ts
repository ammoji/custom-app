/**
 * PR-NEXT-BUNDLE-F — tests for the home/shop-list redesign helpers.
 *
 * statusToLabel (5): the customer-facing status strings.
 * sortShopsForBrowse (3): distance / rating / reviews ordering.
 */
import { describe, expect, it } from '@jest/globals';
import {
  sortShopsForBrowse,
  statusToLabel,
} from '../../src/utils/homeRedesignHelpers';

describe('statusToLabel', () => {
  it('pending → Order placed', () => {
    expect(statusToLabel('pending')).toBe('Order placed');
  });
  it('accepted → Order accepted', () => {
    expect(statusToLabel('accepted')).toBe('Order accepted');
  });
  it('preparing → Being prepared', () => {
    expect(statusToLabel('preparing')).toBe('Being prepared');
  });
  it('ready_for_pickup → Out for delivery', () => {
    expect(statusToLabel('ready_for_pickup')).toBe('Out for delivery');
  });
  it('delivered → Delivered', () => {
    expect(statusToLabel('delivered')).toBe('Delivered');
  });
});

describe('sortShopsForBrowse', () => {
  const mk = (id: string, extra: Record<string, any> = {}) =>
    ({ id, distanceKm: undefined, ratingAvg: undefined, ratingCount: undefined, ...extra } as any);

  it('distance: nearest first, missing to bottom', () => {
    const out = sortShopsForBrowse(
      [mk('a', { distanceKm: 3 }), mk('b'), mk('c', { distanceKm: 1 })],
      'distance',
    );
    expect(out.map(s => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('rating: highest ratingAvg first', () => {
    const out = sortShopsForBrowse(
      [mk('a', { ratingAvg: 4.2 }), mk('b', { ratingAvg: 4.8 }), mk('c', { ratingAvg: 4.5 })],
      'rating',
    );
    expect(out.map(s => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('reviews: most ratingCount first (missing → 0)', () => {
    const out = sortShopsForBrowse(
      [mk('a', { ratingCount: 10 }), mk('b'), mk('c', { ratingCount: 50 })],
      'reviews',
    );
    expect(out.map(s => s.id)).toEqual(['c', 'a', 'b']);
  });
});
