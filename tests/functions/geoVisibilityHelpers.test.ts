/**
 * PR 48 — pure helper tests for `filterShopsByServiceRadius`.
 *
 * The helper is firebase-admin-free; no emulator or test-double
 * setup required.
 */

import {
  DEFAULT_SERVICE_RADIUS_KM,
  filterShopsByServiceRadius,
} from '../../functions/src/geoVisibilityHelpers';

type S = { id: string; distanceKm?: number; serviceRadiusKm?: number };

describe('PR 48 — filterShopsByServiceRadius', () => {
  test('within radius → kept', () => {
    const out = filterShopsByServiceRadius<S>(
      [{ id: 'a', distanceKm: 2, serviceRadiusKm: 5 }],
      { showAll: false },
    );
    expect(out.map(s => s.id)).toEqual(['a']);
  });

  test('beyond radius → dropped', () => {
    const out = filterShopsByServiceRadius<S>(
      [{ id: 'a', distanceKm: 6, serviceRadiusKm: 5 }],
      { showAll: false },
    );
    expect(out).toEqual([]);
  });

  test('exactly at radius → kept (inclusive boundary)', () => {
    const out = filterShopsByServiceRadius<S>(
      [{ id: 'a', distanceKm: 5, serviceRadiusKm: 5 }],
      { showAll: false },
    );
    expect(out.map(s => s.id)).toEqual(['a']);
  });

  test('a sliver beyond radius → dropped', () => {
    const out = filterShopsByServiceRadius<S>(
      [{ id: 'a', distanceKm: 5.0001, serviceRadiusKm: 5 }],
      { showAll: false },
    );
    expect(out).toEqual([]);
  });

  test('serviceRadiusKm missing → falls back to default (5)', () => {
    const out = filterShopsByServiceRadius<S>(
      [
        { id: 'near', distanceKm: 4 },
        { id: 'far', distanceKm: 6 },
      ],
      { showAll: false },
    );
    expect(out.map(s => s.id)).toEqual(['near']);
  });

  test('serviceRadiusKm zero → treated as missing → default', () => {
    const out = filterShopsByServiceRadius<S>(
      [
        { id: 'near', distanceKm: 4, serviceRadiusKm: 0 },
        { id: 'far', distanceKm: 6, serviceRadiusKm: 0 },
      ],
      { showAll: false },
    );
    expect(out.map(s => s.id)).toEqual(['near']);
  });

  test('serviceRadiusKm negative → treated as missing → default', () => {
    const out = filterShopsByServiceRadius<S>(
      [{ id: 'a', distanceKm: 4, serviceRadiusKm: -3 }],
      { showAll: false },
    );
    expect(out.map(s => s.id)).toEqual(['a']);
  });

  test('serviceRadiusKm NaN → treated as missing → default', () => {
    const out = filterShopsByServiceRadius<S>(
      [{ id: 'a', distanceKm: 4, serviceRadiusKm: Number.NaN }],
      { showAll: false },
    );
    expect(out.map(s => s.id)).toEqual(['a']);
  });

  test('distanceKm undefined → kept (fail-open)', () => {
    const out = filterShopsByServiceRadius<S>(
      [{ id: 'a', serviceRadiusKm: 5 }],
      { showAll: false },
    );
    expect(out.map(s => s.id)).toEqual(['a']);
  });

  test('distanceKm Infinity → kept (fail-open; non-finite)', () => {
    const out = filterShopsByServiceRadius<S>(
      [
        {
          id: 'a',
          distanceKm: Number.POSITIVE_INFINITY,
          serviceRadiusKm: 5,
        },
      ],
      { showAll: false },
    );
    expect(out.map(s => s.id)).toEqual(['a']);
  });

  test('distanceKm NaN → kept (fail-open; non-finite)', () => {
    const out = filterShopsByServiceRadius<S>(
      [{ id: 'a', distanceKm: Number.NaN, serviceRadiusKm: 5 }],
      { showAll: false },
    );
    expect(out.map(s => s.id)).toEqual(['a']);
  });

  test('showAll: true → every shop kept regardless of distance/radius', () => {
    const input: S[] = [
      { id: 'near', distanceKm: 2, serviceRadiusKm: 5 },
      { id: 'far', distanceKm: 100, serviceRadiusKm: 5 },
      { id: 'nodistance' },
    ];
    const out = filterShopsByServiceRadius<S>(input, { showAll: true });
    expect(out.map(s => s.id)).toEqual(['near', 'far', 'nodistance']);
  });

  test('empty array → empty array', () => {
    expect(filterShopsByServiceRadius<S>([], { showAll: false })).toEqual(
      [],
    );
    expect(filterShopsByServiceRadius<S>([], { showAll: true })).toEqual(
      [],
    );
  });

  test('does NOT mutate the input array', () => {
    const input: S[] = [
      { id: 'a', distanceKm: 2, serviceRadiusKm: 5 },
      { id: 'b', distanceKm: 99, serviceRadiusKm: 5 },
    ];
    const before = JSON.stringify(input);
    filterShopsByServiceRadius<S>(input, { showAll: false });
    filterShopsByServiceRadius<S>(input, { showAll: true });
    expect(JSON.stringify(input)).toBe(before);
  });

  test('showAll path returns a NEW array (slice), not the same reference', () => {
    const input: S[] = [{ id: 'a', distanceKm: 1 }];
    const out = filterShopsByServiceRadius<S>(input, { showAll: true });
    expect(out).not.toBe(input);
    expect(out).toEqual(input);
  });

  test('DEFAULT_SERVICE_RADIUS_KM is pinned to 5', () => {
    expect(DEFAULT_SERVICE_RADIUS_KM).toBe(5);
  });

  test('mixed table — only the ones within their own radius survive', () => {
    const input: S[] = [
      { id: 'a-near', distanceKm: 0.5, serviceRadiusKm: 1 },
      { id: 'a-edge', distanceKm: 1, serviceRadiusKm: 1 },
      { id: 'a-far', distanceKm: 1.0001, serviceRadiusKm: 1 },
      { id: 'b-default-near', distanceKm: 4 }, // default 5
      { id: 'b-default-far', distanceKm: 6 }, // default 5
      { id: 'c-no-distance' }, // fail-open
    ];
    const out = filterShopsByServiceRadius<S>(input, { showAll: false });
    expect(out.map(s => s.id)).toEqual([
      'a-near',
      'a-edge',
      'b-default-near',
      'c-no-distance',
    ]);
  });
});
