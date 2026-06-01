/**
 * PR-NEXT-7 (finding #9) — pure helper for `getOnlinePartnersNearMyShop`.
 *
 * Surfaces the count of online delivery partners who would actually
 * receive a push for a new order at the caller's shop. Reuses the
 * exact same eligibility filter (`filterPartnersByNotificationRadius`)
 * that `sendNewPickupPushToDelivery` applies on push-fanout, so the
 * badge can never disagree with reality (e.g. "5 partners online" →
 * shop accepts the order → only 1 partner pings: the contradiction
 * that finding #9 is trying to prevent at its core).
 *
 * Auth + projection happen here. The Cloud Function callable does
 * the Firestore reads (shop doc + online-partners query) and passes
 * the raw inputs in. That split lets the test inject fakes for both
 * fetches without spinning up the emulator. Same posture as
 * `computeOnlineDeliveryCount` (Phase 12c) and `projectPendingCounts`
 * (PR 41).
 *
 * Privacy: count only. No partner UIDs, names, FCM tokens, or
 * locations leak through this callable. The pure helper enforces
 * that the only fields returned to the caller are `count` (+ a
 * `filtered` boolean indicating whether the haversine filter
 * actually ran).
 */

import {
    filterPartnersByNotificationRadius,
    type PartnerRow,
} from './notificationRadiusHelpers';
import type { LatLng } from './distanceMatrixHelpers';

export type ShopOwnerClaims = {
  shopOwner?: boolean;
  shopId?: string;
} & Record<string, unknown>;

export type NearbyOnlinePartnerCountResult =
  | {
      ok: true;
      /** Capped at NEARBY_PARTNER_HARD_CAP. Always a non-negative integer. */
      count: number;
      /**
       * `true` when the haversine filter actually ran. `false` when
       * the shop has no `location` set — in that case the count is
       * the unfiltered online total (mirrors the push fanout's
       * fail-open posture for legacy shops without a location), and
       * the UI can render a hint nudging the owner to set a location
       * for a more accurate number.
       */
      filtered: boolean;
    }
  | {
      ok: false;
      code: 'unauthenticated' | 'permission-denied' | 'not-found';
      message: string;
    };

/**
 * Defensive ceiling. Pilot will never approach this — a 999 cap
 * exists to bound payload size against a misbehaving caller and to
 * keep the badge UI from rendering "1247" if something has gone
 * wrong upstream.
 */
export const NEARBY_PARTNER_HARD_CAP = 999;

export async function computeNearbyOnlinePartnerCount(input: {
  auth: { token: ShopOwnerClaims } | null | undefined;
  /**
   * Reads `shops/{claims.shopId}` and returns `{ location }` or
   * `null` if the shop doc doesn't exist. The callable is
   * responsible for normalising any `GeoPoint` storage shape into
   * the plain `{lat,lng}` `LatLng` the helper + push fanout share.
   */
  fetchShop: (
    shopId: string,
  ) => Promise<{ location?: LatLng | null } | null>;
  /**
   * Reads all `users` where `isDelivery && deliveryStatus==='online'`
   * and returns the rows in the `PartnerRow` shape the filter
   * expects.
   */
  fetchOnlinePartners: () => Promise<PartnerRow[]>;
}): Promise<NearbyOnlinePartnerCountResult> {
  const { auth, fetchShop, fetchOnlinePartners } = input;

  if (!auth) {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    };
  }
  // Shop-owner-only. Admins do NOT get this surface — they have
  // the admin `getOnlineDeliveryCount` (total online count) on
  // AdminOrdersScreen. Mixing the two surfaces in one callable
  // would confuse the auth boundary; keep them separate.
  if (auth.token?.shopOwner !== true) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Shop owner only',
    };
  }
  const shopId = auth.token.shopId;
  if (typeof shopId !== 'string' || !shopId) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Shop owner without a shopId claim',
    };
  }

  const [shop, online] = await Promise.all([
    fetchShop(shopId),
    fetchOnlinePartners(),
  ]);

  if (!shop) {
    return {
      ok: false,
      code: 'not-found',
      message: 'Your shop is not yet registered',
    };
  }

  const shopLoc = shop.location ?? null;
  const inRange = filterPartnersByNotificationRadius(online, shopLoc);
  // The `filtered` flag mirrors the actual fail-open branch in
  // `filterPartnersByNotificationRadius`: it returns the unfiltered
  // partner list verbatim when shopLoc is missing or numerically
  // invalid. We compute `filtered` with the same predicate so the
  // callable's response matches what the helper actually did.
  const filtered =
    shopLoc !== null &&
    typeof shopLoc.lat === 'number' &&
    Number.isFinite(shopLoc.lat) &&
    typeof shopLoc.lng === 'number' &&
    Number.isFinite(shopLoc.lng);

  const raw = inRange.length;
  const count = Math.min(
    NEARBY_PARTNER_HARD_CAP,
    Math.max(0, Math.floor(raw)),
  );
  return { ok: true, count, filtered };
}
