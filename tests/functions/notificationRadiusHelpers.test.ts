/**
 * PR 50 — `filterPartnersByNotificationRadius` exhaustive matrix.
 *
 * Pure helper, server-only (no client mirror — the filter runs
 * inside the push-fanout trigger and partners never see it). Same
 * test-style as `geoVisibilityHelpers.test.ts` (PR 48) and
 * `deliveryChargeHelpers.test.ts` (PR 47).
 */

import { haversineKm, type LatLng } from '../../functions/src/distanceMatrixHelpers';
import {
  DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM,
  filterPartnersByNotificationRadius,
  type PartnerRow,
} from '../../functions/src/notificationRadiusHelpers';

// Anchor coords. Distances chosen so the haversine results are
// well inside / well outside the 3 km default without needing to
// hand-compute decimals.
const SHOP: LatLng = { lat: 28.5, lng: 77.2 };
const VERY_NEAR: LatLng = { lat: 28.505, lng: 77.205 }; // ~0.7 km
const NEAR: LatLng = { lat: 28.52, lng: 77.22 }; // ~2.9 km
const FAR: LatLng = { lat: 28.6, lng: 77.3 }; // ~14 km

describe('PR 50 — DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM', () => {
  test('pinned at 3 km (synced with dashboard local fallback + design doc)', () => {
    // If this assertion ever needs to change, the dashboard's
    // hard-coded `DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM` mirror in
    // DeliveryDashboardScreen.tsx must change too. Grep for the
    // constant name before bumping.
    expect(DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM).toBe(3);
  });
});

describe('PR 50 — filterPartnersByNotificationRadius', () => {
  test('within radius → kept; beyond radius → dropped', () => {
    const partners: PartnerRow[] = [
      { uid: 'in', currentLocation: VERY_NEAR, notificationRadiusKm: 5 },
      { uid: 'out', currentLocation: FAR, notificationRadiusKm: 5 },
    ];
    const out = filterPartnersByNotificationRadius(partners, SHOP);
    expect(out.map(p => p.uid)).toEqual(['in']);
  });

  test('exactly at the radius boundary is INCLUSIVE (distance === radius → kept)', () => {
    const partner: PartnerRow = {
      uid: 'edge',
      currentLocation: NEAR,
    };
    // Read the actual haversine distance and use it AS the radius
    // — the boundary point must be retained.
    const distance = haversineKm(NEAR, SHOP);
    const out = filterPartnersByNotificationRadius(
      [{ ...partner, notificationRadiusKm: distance }],
      SHOP,
    );
    expect(out.map(p => p.uid)).toEqual(['edge']);
  });

  test('partner missing currentLocation → kept (fail-open)', () => {
    const partners: PartnerRow[] = [
      { uid: 'no-loc', notificationRadiusKm: 5 },
      { uid: 'no-loc-null', currentLocation: null, notificationRadiusKm: 5 },
    ];
    const out = filterPartnersByNotificationRadius(partners, SHOP);
    expect(out.map(p => p.uid).sort()).toEqual(['no-loc', 'no-loc-null']);
  });

  test('shop.shopLocation missing → ALL partners kept (fail-open for legacy orders)', () => {
    const partners: PartnerRow[] = [
      { uid: 'in', currentLocation: VERY_NEAR, notificationRadiusKm: 5 },
      { uid: 'out', currentLocation: FAR, notificationRadiusKm: 5 },
    ];
    expect(
      filterPartnersByNotificationRadius(partners, undefined).map(p => p.uid),
    ).toEqual(['in', 'out']);
    expect(
      filterPartnersByNotificationRadius(partners, null).map(p => p.uid),
    ).toEqual(['in', 'out']);
  });

  test('partner notificationRadiusKm absent → falls back to default (3 km)', () => {
    // VERY_NEAR (~0.7 km) is inside 3 km; FAR (~14 km) is outside.
    const partners: PartnerRow[] = [
      { uid: 'in', currentLocation: VERY_NEAR }, // no radius → default 3
      { uid: 'out', currentLocation: FAR }, // no radius → default 3
    ];
    const out = filterPartnersByNotificationRadius(partners, SHOP);
    expect(out.map(p => p.uid)).toEqual(['in']);
  });

  test('partner notificationRadiusKm: 0 / negative / NaN / Infinity → treated as missing → default', () => {
    const partners: PartnerRow[] = [
      { uid: 'zero', currentLocation: FAR, notificationRadiusKm: 0 },
      { uid: 'neg', currentLocation: FAR, notificationRadiusKm: -5 },
      { uid: 'nan', currentLocation: FAR, notificationRadiusKm: Number.NaN },
      {
        uid: 'inf',
        currentLocation: FAR,
        notificationRadiusKm: Number.POSITIVE_INFINITY,
      },
    ];
    // All four fall back to the 3 km default → all four are >3 km
    // from SHOP → all four dropped.
    const out = filterPartnersByNotificationRadius(partners, SHOP);
    expect(out).toEqual([]);
  });

  test('shopLocation with non-finite coords (NaN / Infinity) → fail-open', () => {
    const partners: PartnerRow[] = [
      { uid: 'out', currentLocation: FAR, notificationRadiusKm: 1 },
    ];
    expect(
      filterPartnersByNotificationRadius(partners, {
        lat: Number.NaN,
        lng: 77.2,
      }).map(p => p.uid),
    ).toEqual(['out']);
    expect(
      filterPartnersByNotificationRadius(partners, {
        lat: 28.5,
        lng: Number.POSITIVE_INFINITY,
      }).map(p => p.uid),
    ).toEqual(['out']);
  });

  test('partner currentLocation with non-finite coords → fail-open (keep)', () => {
    const partners: PartnerRow[] = [
      {
        uid: 'bad-loc',
        currentLocation: { lat: Number.NaN, lng: 77.2 },
        notificationRadiusKm: 1,
      },
    ];
    const out = filterPartnersByNotificationRadius(partners, SHOP);
    expect(out.map(p => p.uid)).toEqual(['bad-loc']);
  });

  test('mixed list: located partners filtered by radius; locationless partners always kept', () => {
    const partners: PartnerRow[] = [
      { uid: 'in', currentLocation: VERY_NEAR, notificationRadiusKm: 5 },
      { uid: 'out', currentLocation: FAR, notificationRadiusKm: 5 },
      { uid: 'no-loc-a' },
      { uid: 'no-loc-b', currentLocation: null },
    ];
    const out = filterPartnersByNotificationRadius(partners, SHOP);
    // `in` stays; `out` dropped; `no-loc-*` both kept.
    expect(out.map(p => p.uid).sort()).toEqual([
      'in',
      'no-loc-a',
      'no-loc-b',
    ]);
  });

  test('empty input → empty output', () => {
    expect(filterPartnersByNotificationRadius([], SHOP)).toEqual([]);
    expect(filterPartnersByNotificationRadius([], undefined)).toEqual([]);
  });

  test('does NOT mutate the input array (or its rows)', () => {
    const partners: PartnerRow[] = [
      { uid: 'in', currentLocation: VERY_NEAR, notificationRadiusKm: 5 },
      { uid: 'out', currentLocation: FAR, notificationRadiusKm: 5 },
    ];
    const beforeIds = partners.map(p => p.uid);
    const beforeJson = JSON.stringify(partners);
    filterPartnersByNotificationRadius(partners, SHOP);
    expect(partners.map(p => p.uid)).toEqual(beforeIds);
    expect(JSON.stringify(partners)).toBe(beforeJson);
  });

  test('per-partner radius override is honored independently of the default', () => {
    // Same partner located at NEAR (~2.9 km from SHOP). With the 3
    // km default they're IN; with a 1 km override they're OUT.
    const located: PartnerRow = { uid: 'near', currentLocation: NEAR };
    expect(
      filterPartnersByNotificationRadius([located], SHOP).map(p => p.uid),
    ).toEqual(['near']);
    expect(
      filterPartnersByNotificationRadius(
        [{ ...located, notificationRadiusKm: 1 }],
        SHOP,
      ),
    ).toEqual([]);
    // …and a 50 km override at FAR (~14 km) keeps them.
    expect(
      filterPartnersByNotificationRadius(
        [{ uid: 'far', currentLocation: FAR, notificationRadiusKm: 50 }],
        SHOP,
      ).map(p => p.uid),
    ).toEqual(['far']);
  });
});
