/**
 * PR 5 — Shop owner self-service settings.
 *
 * Pure helper for the `updateShopSettings` callable. Returns a tagged
 * union so the callable wrapper does nothing but `throw HttpsError`
 * + `db.update` — all validation is here and unit-testable without
 * firebase-admin (same posture as deliveryRequestHelpers,
 * profileHelpers).
 *
 * Two whitelisted fields, both with sanity caps to keep a fat-fingered
 * shop owner from setting a ₹50,000 delivery fee or a ₹1cr minimum
 * order. The caps are intentionally generous — real shops won't hit
 * them — but tight enough that obviously-wrong values get caught
 * server-side before customers see them in the checkout summary.
 *
 * Sanity caps (deliberately permissive):
 *   - deliveryFee: 0..500 (real shops: 0..80). Includes 0 for free
 *     delivery promotions.
 *   - minOrder:    0..10000 (real shops: 0..500). Includes 0 for
 *     "any size order" shops.
 *
 * Integer-only because rupee fractions don't render cleanly in the
 * existing formatRupees helper and the order summary, and partial-
 * rupee fees aren't a thing in this market.
 */

export type ShopSettingsInput = {
  auth: {
    uid: string;
    token?: { admin?: unknown; shopOwner?: unknown; shopId?: unknown };
  } | null;
  // Optional target shop id. REQUIRED when the caller is admin (they
  // don't own a shop, so the claim doesn't tell us which shop to
  // target). IGNORED when the caller is a shop owner (we always use
  // their claim's shopId — clients can't target someone else's shop).
  shopId?: unknown;
  deliveryFee?: unknown;
  minOrder?: unknown;
  // PR 48 — service radius in km. Third whitelisted field. Same
  // integer-only / range-clamped posture as `deliveryFee` /
  // `minOrder`. Drives the visibility gate in `listShopsPublic`
  // (`filterShopsByServiceRadius`).
  serviceRadiusKm?: unknown;
};

export type ShopSettingsResult =
  | {
      ok: true;
      shopId: string;
      updates: {
        deliveryFee?: number;
        minOrder?: number;
        // PR 48 — service radius (1–50 km, integer-only).
        serviceRadiusKm?: number;
      };
    }
  | {
      ok: false;
      code: 'unauthenticated' | 'permission-denied' | 'invalid-argument';
      message: string;
    };

const DELIVERY_FEE_MAX = 500;
const MIN_ORDER_MAX = 10000;
// PR 48 — urban kirana realistic ceiling. Above 50 km the haversine
// fallback's accuracy degrades sharply and the road-distance estimate
// from Distance Matrix gets dominated by intercity routing nuances
// that aren't relevant to a same-day-delivery model.
const SERVICE_RADIUS_MAX_KM = 50;

function isFiniteInteger(v: unknown): v is number {
  return (
    typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)
  );
}

export function validateShopSettings(
  input: ShopSettingsInput,
): ShopSettingsResult {
  const { auth, deliveryFee, minOrder, serviceRadiusKm } = input;

  // 1. Auth gate.
  if (!auth) {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    };
  }
  // 2. Role gate — admin OR shopOwner. Strict equality on both claims
  //    (truthy checks have bitten us; see Design notes in the PR 5
  //    prompt).
  const isAdmin = auth.token?.admin === true;
  const isShopOwner = auth.token?.shopOwner === true;
  if (!isAdmin && !isShopOwner) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Shop owner or admin role required',
    };
  }

  // Resolve target shopId:
  //   - Admin: read from input.shopId (REQUIRED — claim doesn't carry one).
  //   - ShopOwner: read from auth.token.shopId (claim is the source of
  //     truth; any input.shopId is ignored so a malicious owner client
  //     can't target someone else's shop).
  let shopId: string;
  if (isAdmin) {
    if (typeof input.shopId !== 'string' || input.shopId.length === 0) {
      return {
        ok: false,
        code: 'invalid-argument',
        message: 'Admin callers must pass shopId',
      };
    }
    shopId = input.shopId;
  } else {
    // shopOwner branch
    const ownerShopId = auth.token?.shopId;
    if (typeof ownerShopId !== 'string' || ownerShopId.length === 0) {
      return {
        ok: false,
        code: 'permission-denied',
        message: 'No shopId on your account',
      };
    }
    shopId = ownerShopId;
  }

  // 3. At least one field must be present. We accept partial updates
  //    so a shop can change just `minOrder` without re-submitting
  //    deliveryFee (mirrors ShopMenuItemEdit's dirty-field pattern).
  const hasDelivery = deliveryFee !== undefined;
  const hasMinOrder = minOrder !== undefined;
  const hasRadius = serviceRadiusKm !== undefined;
  if (!hasDelivery && !hasMinOrder && !hasRadius) {
    return {
      ok: false,
      code: 'invalid-argument',
      message:
        'At least one of deliveryFee, minOrder, or serviceRadiusKm is required',
    };
  }

  const updates: {
    deliveryFee?: number;
    minOrder?: number;
    serviceRadiusKm?: number;
  } = {};

  if (hasDelivery) {
    if (!isFiniteInteger(deliveryFee)) {
      return {
        ok: false,
        code: 'invalid-argument',
        message: 'deliveryFee must be a finite integer',
      };
    }
    if (deliveryFee < 0 || deliveryFee > DELIVERY_FEE_MAX) {
      return {
        ok: false,
        code: 'invalid-argument',
        message: `deliveryFee must be between 0 and ${DELIVERY_FEE_MAX}`,
      };
    }
    updates.deliveryFee = deliveryFee;
  }

  if (hasMinOrder) {
    if (!isFiniteInteger(minOrder)) {
      return {
        ok: false,
        code: 'invalid-argument',
        message: 'minOrder must be a finite integer',
      };
    }
    if (minOrder < 0 || minOrder > MIN_ORDER_MAX) {
      return {
        ok: false,
        code: 'invalid-argument',
        message: `minOrder must be between 0 and ${MIN_ORDER_MAX}`,
      };
    }
    updates.minOrder = minOrder;
  }

  // PR 48 — service radius. Integer-only (sub-km service areas aren't
  // meaningful for kirana delivery) and 1–50 km. The 1-km floor
  // matches the cheapest `chargeForDistance` band so an owner can
  // never set a radius that would hide them from EVERY customer.
  if (hasRadius) {
    if (!isFiniteInteger(serviceRadiusKm)) {
      return {
        ok: false,
        code: 'invalid-argument',
        message: 'serviceRadiusKm must be a finite integer',
      };
    }
    if (serviceRadiusKm < 1 || serviceRadiusKm > SERVICE_RADIUS_MAX_KM) {
      return {
        ok: false,
        code: 'invalid-argument',
        message: `serviceRadiusKm must be between 1 and ${SERVICE_RADIUS_MAX_KM}`,
      };
    }
    updates.serviceRadiusKm = serviceRadiusKm;
  }

  return { ok: true, shopId, updates };
}
