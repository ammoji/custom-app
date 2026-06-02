/**
 * PR 48 — pure helper tests for `filterShopsByServiceRadius`.
 *
 * PR-NEXT-SHOP-LOCATION-REQUIRED — the helper now accepts a
 * `customerHasLocation` option that splits the missing-distance
 * branch (customer-side gap → keep; shop-side gap → drop). Every
 * test below carries `customerHasLocation: true` unless it is
 * specifically testing the customer-side-gap branch.
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
      { showAll: false, customerHasLocation: true },
    );
    expect(out.map(s => s.id)).toEqual(['a']);
  });

  test('beyond radius → dropped', () => {
    const out = filterShopsByServiceRadius<S>(
      [{ id: 'a', distanceKm: 6, serviceRadiusKm: 5 }],
      { showAll: false, customerHasLocation: true },
    );
    expect(out).toEqual([]);
  });

  test('exactly at radius → kept (inclusive boundary)', () => {
    const out = filterShopsByServiceRadius<S>(
      [{ id: 'a', distanceKm: 5, serviceRadiusKm: 5 }],
      { showAll: false, customerHasLocation: true },
    );
    expect(out.map(s => s.id)).toEqual(['a']);
  });

  test('a sliver beyond radius → dropped', () => {
    const out = filterShopsByServiceRadius<S>(
      [{ id: 'a', distanceKm: 5.0001, serviceRadiusKm: 5 }],
      { showAll: false, customerHasLocation: true },
    );
    expect(out).toEqual([]);
  });

  test('serviceRadiusKm missing → falls back to default (5)', () => {
    const out = filterShopsByServiceRadius<S>(
      [
        { id: 'near', distanceKm: 4 },
        { id: 'far', distanceKm: 6 },
      ],
      { showAll: false, customerHasLocation: true },
    );
    expect(out.map(s => s.id)).toEqual(['near']);
  });

  test('serviceRadiusKm zero → treated as missing → default', () => {
    const out = filterShopsByServiceRadius<S>(
      [
        { id: 'near', distanceKm: 4, serviceRadiusKm: 0 },
        { id: 'far', distanceKm: 6, serviceRadiusKm: 0 },
      ],
      { showAll: false, customerHasLocation: true },
    );
    expect(out.map(s => s.id)).toEqual(['near']);
  });

  test('serviceRadiusKm negative → treated as missing → default', () => {
    const out = filterShopsByServiceRadius<S>(
      [{ id: 'a', distanceKm: 4, serviceRadiusKm: -3 }],
      { showAll: false, customerHasLocation: true },
    );
    expect(out.map(s => s.id)).toEqual(['a']);
  });

  test('serviceRadiusKm NaN → treated as missing → default', () => {
    const out = filterShopsByServiceRadius<S>(
      [{ id: 'a', distanceKm: 4, serviceRadiusKm: Number.NaN }],
      { showAll: false, customerHasLocation: true },
    );
    expect(out.map(s => s.id)).toEqual(['a']);
  });

  // PR-NEXT-SHOP-LOCATION-REQUIRED — customer-side gap branch:
  // when the customer has not granted GPS, we keep all shops
  // uniformly (fail-OPEN) so we don't strand them.
  test('customer-side gap (no GPS): distanceKm undefined → KEPT', () => {
    const out = filterShopsByServiceRadius<S>(
      [{ id: 'a', serviceRadiusKm: 5 }],
      { showAll: false, customerHasLocation: false },
    );
    expect(out.map(s => s.id)).toEqual(['a']);
  });

  test('customer-side gap: distanceKm Infinity → KEPT', () => {
    const out = filterShopsByServiceRadius<S>(
      [
        {
          id: 'a',
          distanceKm: Number.POSITIVE_INFINITY,
          serviceRadiusKm: 5,
        },
      ],
      { showAll: false, customerHasLocation: false },
    );
    expect(out.map(s => s.id)).toEqual(['a']);
  });

  test('customer-side gap: distanceKm NaN → KEPT', () => {
    const out = filterShopsByServiceRadius<S>(
      [{ id: 'a', distanceKm: Number.NaN, serviceRadiusKm: 5 }],
      { showAll: false, customerHasLocation: false },
    );
    expect(out.map(s => s.id)).toEqual(['a']);
  });

  // PR-NEXT-SHOP-LOCATION-REQUIRED — shop-side gap branch:
  // customer DOES have GPS, so a missing distanceKm means the
  // SHOP has no location pin. Defense layer 3 of 3 — drop.
  test('shop-side gap: distanceKm undefined → DROPPED', () => {
    const out = filterShopsByServiceRadius<S>(
      [{ id: 'a', serviceRadiusKm: 5 }],
      { showAll: false, customerHasLocation: true },
    );
    expect(out).toEqual([]);
  });

  test('shop-side gap: distanceKm Infinity → DROPPED', () => {
    const out = filterShopsByServiceRadius<S>(
      [
        {
          id: 'a',
          distanceKm: Number.POSITIVE_INFINITY,
          serviceRadiusKm: 5,
        },
      ],
      { showAll: false, customerHasLocation: true },
    );
    expect(out).toEqual([]);
  });

  test('shop-side gap: distanceKm NaN → DROPPED', () => {
    const out = filterShopsByServiceRadius<S>(
      [{ id: 'a', distanceKm: Number.NaN, serviceRadiusKm: 5 }],
      { showAll: false, customerHasLocation: true },
    );
    expect(out).toEqual([]);
  });

  test('shop-side gap mixed: drops only the location-less shop', () => {
    const out = filterShopsByServiceRadius<S>(
      [
        { id: 'has-location', distanceKm: 2, serviceRadiusKm: 5 },
        { id: 'no-location', serviceRadiusKm: 5 },
      ],
      { showAll: false, customerHasLocation: true },
    );
    expect(out.map(s => s.id)).toEqual(['has-location']);
  });

  test('showAll: true → every shop kept regardless of distance/radius', () => {
    const input: S[] = [
      { id: 'near', distanceKm: 2, serviceRadiusKm: 5 },
      { id: 'far', distanceKm: 100, serviceRadiusKm: 5 },
      { id: 'nodistance' },
    ];
    // showAll bypasses BOTH branches — customerHasLocation is
    // irrelevant when the testing override is on.
    const out = filterShopsByServiceRadius<S>(input, {
      showAll: true,
      customerHasLocation: true,
    });
    expect(out.map(s => s.id)).toEqual(['near', 'far', 'nodistance']);
  });

  test('empty array → empty array', () => {
    expect(
      filterShopsByServiceRadius<S>([], {
        showAll: false,
        customerHasLocation: true,
      }),
    ).toEqual([]);
    expect(
      filterShopsByServiceRadius<S>([], {
        showAll: true,
        customerHasLocation: true,
      }),
    ).toEqual([]);
  });

  test('does NOT mutate the input array', () => {
    const input: S[] = [
      { id: 'a', distanceKm: 2, serviceRadiusKm: 5 },
      { id: 'b', distanceKm: 99, serviceRadiusKm: 5 },
    ];
    const before = JSON.stringify(input);
    filterShopsByServiceRadius<S>(input, {
      showAll: false,
      customerHasLocation: true,
    });
    filterShopsByServiceRadius<S>(input, {
      showAll: true,
      customerHasLocation: true,
    });
    expect(JSON.stringify(input)).toBe(before);
  });

  test('showAll path returns a NEW array (slice), not the same reference', () => {
    const input: S[] = [{ id: 'a', distanceKm: 1 }];
    const out = filterShopsByServiceRadius<S>(input, {
      showAll: true,
      customerHasLocation: true,
    });
    expect(out).not.toBe(input);
    expect(out).toEqual(input);
  });

  test('DEFAULT_SERVICE_RADIUS_KM is pinned to 5', () => {
    expect(DEFAULT_SERVICE_RADIUS_KM).toBe(5);
  });

  test('mixed table (customer with GPS) — only within-radius shops with location survive', () => {
    const input: S[] = [
      { id: 'a-near', distanceKm: 0.5, serviceRadiusKm: 1 },
      { id: 'a-edge', distanceKm: 1, serviceRadiusKm: 1 },
      { id: 'a-far', distanceKm: 1.0001, serviceRadiusKm: 1 },
      { id: 'b-default-near', distanceKm: 4 }, // default 5
      { id: 'b-default-far', distanceKm: 6 }, // default 5
      { id: 'c-no-distance' }, // shop-side gap → drop
    ];
    const out = filterShopsByServiceRadius<S>(input, {
      showAll: false,
      customerHasLocation: true,
    });
    expect(out.map(s => s.id)).toEqual([
      'a-near',
      'a-edge',
      'b-default-near',
    ]);
  });

  test('mixed table (customer without GPS) — ALL shops kept (fail-open uniform)', () => {
    const input: S[] = [
      { id: 'a-near', distanceKm: 0.5, serviceRadiusKm: 1 },
      { id: 'a-far', distanceKm: 1.0001, serviceRadiusKm: 1 },
      { id: 'c-no-distance' },
    ];
    // When the customer hasn't granted GPS, `rankShopsByDistance`
    // stamps `distanceKm` undefined UNIFORMLY across shops, which
    // is why the customer-side branch keeps all of them.
    const out = filterShopsByServiceRadius<S>(
      input.map(s => ({ ...s, distanceKm: undefined })),
      { showAll: false, customerHasLocation: false },
    );
    expect(out.map(s => s.id)).toEqual([
      'a-near',
      'a-far',
      'c-no-distance',
    ]);
  });
});
