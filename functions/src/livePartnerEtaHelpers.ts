/**
 * PR-NEXT-PARTNER-CARD.2 — server gate for revealing the partner's
 * live distance + ETA to the order's customer. Same posture as
 * `getDeliveryPartnerContact`: caller MUST be the order's
 * `customerUid`, the order MUST have a `deliveryPersonId`, AND the
 * target leg (shop pre-pickup, drop post-pickup) MUST have a usable
 * `lat/lng`. Failure modes are surfaced via the Result discriminated
 * union — the callable wrapper maps each `code` to an HttpsError.
 *
 * Pre-pickup: distance = partner → shop. ETA = haversine / urban
 * speed.
 * Post-pickup: distance = partner → drop. Same formula.
 *
 * "Stale" flag is set when `currentLocationUpdatedAt` is older than
 * `STALE_AFTER_MS` (2 minutes). The client treats stale data as
 * estimated-only and renders the muted "~ estimated" suffix via
 * `formatLivePartnerEta`. We do NOT fall back to the static
 * `order.deliveryDurationMin` here — that's the client's job (which
 * keeps the gate logic stateless / pure).
 *
 * Why haversine + a single urban-speed constant (vs the Distance
 * Matrix API call we already wire on placeOrder):
 *   - the live ETA polls every 30s while the sheet is open. A
 *     Distance Matrix call per poll would burn API budget on a
 *     metric most useful at "is the partner 6 minutes away or 12?"
 *     resolution. Haversine + 20 km/h average gets us within ±20%
 *     for pilot, which is well inside the customer's mental model.
 *   - Distance Matrix at the at-order time stamps the authoritative
 *     `deliveryDistanceKm` / `deliveryDurationMin` once. The sheet
 *     falls back to those fields when the live gate rejects, so the
 *     accurate value is still visible.
 *
 * Pinned by `tests/functions/getLivePartnerEtaHelpers.test.ts`.
 */
import { haversineKm, type LatLng } from './distanceMatrixHelpers';

// Pilot constants. Centralized so a future PR can wire them to
// remote config / shop-level overrides without grepping multiple
// files.
export const AVG_URBAN_KMH = 20;
export const STALE_AFTER_MS = 2 * 60 * 1000;

export type LivePartnerEtaSuccess = {
  distanceKm: number;
  etaMin: number;
  stale: boolean;
  lastUpdatedAtMs: number;
};

export type GetLivePartnerEtaResult =
  | { ok: true; value: LivePartnerEtaSuccess }
  | {
      ok: false;
      code:
        | 'order_not_found'
        // PR-NEXT-BUNDLE-B §A (Finding #9) — DO NOT REMOVE. Renamed
        // from 'not_customer' → 'not_authorized' to reflect that the
        // gate now also allows shop owners of the order's shop.
        // index.ts switch updated in the same PR.
        | 'not_authorized'
        | 'no_partner'
        | 'no_partner_location'
        | 'no_target_location';
    };

// Narrow adapter shape — same posture as `partnerContactHelpers`'s
// `FirestoreLike`. Lets the unit tests stub `db` without booting
// firebase-admin while the prod caller passes `getFirestore()`
// directly (structurally satisfies the type).
export type LiveEtaDbLike = {
  collection(path: string): {
    doc(id: string): {
      get(): Promise<{
        exists: boolean;
        data(): unknown;
      }>;
    };
  };
};

// `currentLocationUpdatedAt` is stamped server-side via
// `FieldValue.serverTimestamp()` (a Firestore Timestamp at read
// time) but test fixtures + RNFB serializations can flatten it to
// a numeric millis epoch. Normalize both — this is the same
// `.toMillis()`-narrowing pattern Rule 12 mandates.
function readTimestampMs(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (
    raw !== null &&
    typeof raw === 'object' &&
    'toMillis' in raw &&
    typeof (raw as { toMillis: unknown }).toMillis === 'function'
  ) {
    const ms = (raw as { toMillis: () => number }).toMillis();
    if (typeof ms === 'number' && Number.isFinite(ms)) return ms;
  }
  return 0;
}

function isLatLng(v: unknown): v is LatLng {
  if (v == null || typeof v !== 'object') return false;
  const o = v as { lat?: unknown; lng?: unknown };
  return (
    typeof o.lat === 'number' &&
    Number.isFinite(o.lat) &&
    typeof o.lng === 'number' &&
    Number.isFinite(o.lng)
  );
}

export async function getLivePartnerEtaPure(args: {
  orderId: string;
  callerUid: string;
  // PR-NEXT-BUNDLE-B §A (Finding #9) — DO NOT REMOVE. Shop owners
  // of the order's shop may also poll live ETA so their dashboard
  // shows the same minute count the customer sees. Passed from the
  // callable via `request.auth.token.shopOwner` + `shopId` claims.
  callerShopId?: string | null;
  isCallerShopOwner?: boolean;
  db: LiveEtaDbLike;
  // Injectable for tests so the staleness threshold can be exercised
  // deterministically without `jest.useFakeTimers`.
  nowMs?: number;
}): Promise<GetLivePartnerEtaResult> {
  const now = args.nowMs ?? Date.now();

  const orderSnap = await args.db
    .collection('orders')
    .doc(args.orderId)
    .get();
  if (!orderSnap.exists) {
    return { ok: false, code: 'order_not_found' };
  }
  const order = (orderSnap.data() ?? {}) as {
    customerUid?: unknown;
    shopId?: unknown;
    deliveryPersonId?: unknown;
    pickedUpAt?: unknown;
    shopLocation?: unknown;
    deliveryLocation?: unknown;
  };

  // PR-NEXT-BUNDLE-B §A — gate: caller must be the order's customer
  // OR the shop owner of the order's shop.
  // SCHEMA: `customerUid` (not `customerId` — see the partner-
  // contact bug fixed in PARTNER-CARD.2).
  const isCustomer = order.customerUid === args.callerUid;
  const isShopOwner =
    args.isCallerShopOwner === true &&
    typeof args.callerShopId === 'string' &&
    args.callerShopId.length > 0 &&
    order.shopId === args.callerShopId;
  if (!isCustomer && !isShopOwner) {
    return { ok: false, code: 'not_authorized' };
  }
  if (
    typeof order.deliveryPersonId !== 'string' ||
    order.deliveryPersonId.length === 0
  ) {
    return { ok: false, code: 'no_partner' };
  }

  const partnerSnap = await args.db
    .collection('users')
    .doc(order.deliveryPersonId)
    .get();
  const partner = (partnerSnap.exists ? partnerSnap.data() : {}) as {
    currentLocation?: unknown;
    currentLocationUpdatedAt?: unknown;
  };
  if (!isLatLng(partner.currentLocation)) {
    return { ok: false, code: 'no_partner_location' };
  }

  const isPickedUp = order.pickedUpAt != null;
  // Post-pickup: partner is heading to the drop pin
  // (`order.deliveryLocation`). Pre-pickup: partner is heading to
  // the shop (`order.shopLocation`). Both fields are
  // back-compat-optional on legacy orders; if missing we surface
  // `no_target_location` and the client falls back to the at-
  // order static estimate.
  const target = isPickedUp ? order.deliveryLocation : order.shopLocation;
  if (!isLatLng(target)) {
    return { ok: false, code: 'no_target_location' };
  }

  const distanceKm = haversineKm(partner.currentLocation, target);
  const etaMin = (distanceKm / AVG_URBAN_KMH) * 60;
  const updatedMs = readTimestampMs(partner.currentLocationUpdatedAt);
  const stale = now - updatedMs > STALE_AFTER_MS;

  return {
    ok: true,
    value: {
      distanceKm,
      etaMin,
      stale,
      lastUpdatedAtMs: updatedMs,
    },
  };
}
