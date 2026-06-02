/**
 * PR-NEXT-PARTNER-CARD.2 — pure-helper tests for the live partner
 * ETA gate. Mirrors the stubbed-`FirestoreLike` pattern from
 * `getDeliveryPartnerContactHelpers.test.ts`.
 *
 * 1 happy-path + 8 negative cases = 9 assertions. Numeric values
 * are checked to fixed precision so a future tweak to
 * AVG_URBAN_KMH lands in this test too.
 */
import {
  AVG_URBAN_KMH,
  getLivePartnerEtaPure,
  STALE_AFTER_MS,
  type LiveEtaDbLike,
} from '../../functions/src/livePartnerEtaHelpers';

type OrderDoc = {
  customerUid?: string;
  deliveryPersonId?: string | null;
  pickedUpAt?: number | null;
  shopLocation?: { lat: number; lng: number } | null;
  deliveryLocation?: { lat: number; lng: number } | null;
};

type PartnerDoc = {
  currentLocation?: { lat: number; lng: number } | null;
  currentLocationUpdatedAt?: number | { toMillis: () => number } | null;
} | null;

// Stub returns `order` for collection('orders') and `partner` for
// collection('users'). Order of `.collection().doc().get()` calls
// in `getLivePartnerEtaPure` is fixed (order first, partner
// second) so a queue-based stub is enough.
function makeDb(order: OrderDoc | null, partner: PartnerDoc): LiveEtaDbLike {
  const collections: Record<string, unknown> = {
    orders: order,
    users: partner ?? {},
  };
  return {
    collection: (name: string) => ({
      doc: () => ({
        get: async () => ({
          exists: collections[name] != null,
          data: () => collections[name] ?? {},
        }),
      }),
    }),
  };
}

const BLR = { lat: 12.97, lng: 77.59 };
// ~1.1 km north of BLR per haversine.
const NEAR_BLR = { lat: 12.98, lng: 77.59 };

describe('getLivePartnerEtaPure', () => {
  test('order not found → order_not_found', async () => {
    const result = await getLivePartnerEtaPure({
      orderId: 'missing',
      callerUid: 'customer_A',
      db: makeDb(null, null),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('order_not_found');
  });

  test('caller is not the order customer → not_customer', async () => {
    const result = await getLivePartnerEtaPure({
      orderId: 'o1',
      callerUid: 'someone_else',
      db: makeDb(
        {
          customerUid: 'customer_A',
          deliveryPersonId: 'p1',
          shopLocation: BLR,
        },
        { currentLocation: NEAR_BLR, currentLocationUpdatedAt: Date.now() },
      ),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_customer');
  });

  test('no deliveryPersonId → no_partner', async () => {
    const result = await getLivePartnerEtaPure({
      orderId: 'o1',
      callerUid: 'customer_A',
      db: makeDb(
        {
          customerUid: 'customer_A',
          deliveryPersonId: null,
          shopLocation: BLR,
        },
        null,
      ),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_partner');
  });

  test('empty deliveryPersonId → no_partner', async () => {
    const result = await getLivePartnerEtaPure({
      orderId: 'o1',
      callerUid: 'customer_A',
      db: makeDb(
        {
          customerUid: 'customer_A',
          deliveryPersonId: '',
          shopLocation: BLR,
        },
        null,
      ),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_partner');
  });

  test('partner has no currentLocation → no_partner_location', async () => {
    // Foreground-only `reportDeliveryLocation` may not have fired
    // yet (partner just claimed but hasn't opened the dashboard).
    // Client falls back to static order.deliveryDurationMin.
    const result = await getLivePartnerEtaPure({
      orderId: 'o1',
      callerUid: 'customer_A',
      db: makeDb(
        {
          customerUid: 'customer_A',
          deliveryPersonId: 'p1',
          shopLocation: BLR,
        },
        { currentLocation: null, currentLocationUpdatedAt: Date.now() },
      ),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_partner_location');
  });

  test('partner currentLocation has non-finite lat/lng → no_partner_location', async () => {
    // Defensive against NaN-poisoned writes.
    const result = await getLivePartnerEtaPure({
      orderId: 'o1',
      callerUid: 'customer_A',
      db: makeDb(
        {
          customerUid: 'customer_A',
          deliveryPersonId: 'p1',
          shopLocation: BLR,
        },
        {
          currentLocation: { lat: NaN, lng: 77.59 },
          currentLocationUpdatedAt: Date.now(),
        },
      ),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_partner_location');
  });

  test('pre-pickup with no shopLocation → no_target_location', async () => {
    // Legacy pre-PR-49 orders may omit `shopLocation`. Client
    // falls back to static.
    const result = await getLivePartnerEtaPure({
      orderId: 'o1',
      callerUid: 'customer_A',
      db: makeDb(
        {
          customerUid: 'customer_A',
          deliveryPersonId: 'p1',
          shopLocation: null,
          pickedUpAt: null,
        },
        { currentLocation: NEAR_BLR, currentLocationUpdatedAt: Date.now() },
      ),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_target_location');
  });

  test('post-pickup with no deliveryLocation → no_target_location', async () => {
    // Legacy pre-PR-46 orders may omit `deliveryLocation`.
    const result = await getLivePartnerEtaPure({
      orderId: 'o1',
      callerUid: 'customer_A',
      db: makeDb(
        {
          customerUid: 'customer_A',
          deliveryPersonId: 'p1',
          pickedUpAt: 1700000000000,
          deliveryLocation: null,
        },
        { currentLocation: NEAR_BLR, currentLocationUpdatedAt: Date.now() },
      ),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_target_location');
  });

  test('happy path pre-pickup: computes ~1.1km / ~3.3min, stale=false', async () => {
    const now = 1_700_000_000_000;
    const result = await getLivePartnerEtaPure({
      orderId: 'o1',
      callerUid: 'customer_A',
      nowMs: now,
      db: makeDb(
        {
          customerUid: 'customer_A',
          deliveryPersonId: 'p1',
          pickedUpAt: null,
          shopLocation: BLR,
        },
        {
          currentLocation: NEAR_BLR,
          currentLocationUpdatedAt: now - 30_000, // 30s ago — fresh
        },
      ),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.distanceKm).toBeGreaterThan(1.0);
    expect(result.value.distanceKm).toBeLessThan(1.2);
    // ETA = (distanceKm / 20 km/h) * 60min ≈ 3.3 min.
    const expectedEta = (result.value.distanceKm / AVG_URBAN_KMH) * 60;
    expect(result.value.etaMin).toBeCloseTo(expectedEta, 5);
    expect(result.value.stale).toBe(false);
    expect(result.value.lastUpdatedAtMs).toBe(now - 30_000);
  });

  test('stale partner location (>2 min old) → stale: true (values still returned)', async () => {
    // Static fallback path on the client kicks in via the
    // `estimatedSuffix` flag, NOT by suppressing the row.
    const now = 1_700_000_000_000;
    const result = await getLivePartnerEtaPure({
      orderId: 'o1',
      callerUid: 'customer_A',
      nowMs: now,
      db: makeDb(
        {
          customerUid: 'customer_A',
          deliveryPersonId: 'p1',
          pickedUpAt: now - 1000,
          deliveryLocation: BLR,
        },
        {
          currentLocation: NEAR_BLR,
          currentLocationUpdatedAt: now - STALE_AFTER_MS - 1_000,
        },
      ),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stale).toBe(true);
  });

  test('Timestamp-shape currentLocationUpdatedAt (toMillis) is narrowed', async () => {
    // Rule 12 — Admin-SDK reads return Timestamp objects, not
    // millis numbers. Helper must `.toMillis()`-narrow.
    const now = 1_700_000_000_000;
    const result = await getLivePartnerEtaPure({
      orderId: 'o1',
      callerUid: 'customer_A',
      nowMs: now,
      db: makeDb(
        {
          customerUid: 'customer_A',
          deliveryPersonId: 'p1',
          shopLocation: BLR,
        },
        {
          currentLocation: NEAR_BLR,
          currentLocationUpdatedAt: { toMillis: () => now - 10_000 },
        },
      ),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stale).toBe(false);
    expect(result.value.lastUpdatedAtMs).toBe(now - 10_000);
  });
});
