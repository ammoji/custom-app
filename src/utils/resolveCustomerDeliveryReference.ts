/**
 * PR-NEXT-BUNDLE-A §A (Finding #2) — Single canonical delivery-
 * reference resolver. Ensures ShopCard, ShopDetail, CartScreen all
 * use the same geographic reference point for `displayDeliveryCharge`
 * haversine, so the numbers the customer sees on browse + cart +
 * checkout agree.
 *
 * Priority order:
 *   1. Customer's default saved address pin (lat/lng stored at
 *      address-save time via AddressEditScreen's "Use my current
 *      location" flow, PR 46). This is the most stable, closest-to-
 *      checkout reference — it's the same coords CheckoutScreen uses
 *      when the customer picks their default address.
 *   2. Customer's live GPS (`useLocationStore`). Used when:
 *        - No default address is set yet.
 *        - Default address exists but has no saved pin (legacy address
 *          saved before PR 46 stamped coords).
 *   3. null — both sources absent (no location permission, cold launch
 *      before GPS resolves, new account with no saved addresses).
 *      `displayDeliveryCharge` falls through to `shop.distanceKm`
 *      → flat `deliveryFee`, which is the same legacy behaviour as
 *      before this fix.
 *
 * Pure; no firebase-admin, no side effects. Pinned by
 * tests/utils/resolveCustomerDeliveryReference.test.ts.
 */
// PR-NEXT-BUNDLE-A — DO NOT REMOVE. Types used by the helper below.
import type { GeoPoint, UserProfile } from '../types';

/**
 * Resolve the canonical geographic reference for delivery-charge
 * computation.
 *
 * @param profile  Current `useProfileStore.profile` (or null if not
 *                 loaded / signed out).
 * @param liveLocation  Current `useLocationStore.location` (or null).
 * @returns `{ lat, lng }` from the highest-priority available source,
 *          or `null` if none are available.
 */
export function resolveCustomerDeliveryReference(
  profile: UserProfile | null | undefined,
  liveLocation: GeoPoint | null | undefined,
): GeoPoint | null {
  // Branch 1 — default saved address with coords.
  if (profile?.defaultAddressId) {
    const defaultAddr = profile.addresses.find(
      a => a.id === profile.defaultAddressId,
    );
    if (
      defaultAddr &&
      typeof defaultAddr.lat === 'number' &&
      Number.isFinite(defaultAddr.lat) &&
      typeof defaultAddr.lng === 'number' &&
      Number.isFinite(defaultAddr.lng)
    ) {
      return { lat: defaultAddr.lat, lng: defaultAddr.lng };
    }
    // Default address exists but no pin (saved pre-PR-46) — fall
    // through to live GPS.
  }

  // Branch 2 — live GPS.
  if (
    liveLocation &&
    typeof liveLocation.lat === 'number' &&
    Number.isFinite(liveLocation.lat) &&
    typeof liveLocation.lng === 'number' &&
    Number.isFinite(liveLocation.lng)
  ) {
    return { lat: liveLocation.lat, lng: liveLocation.lng };
  }

  // Branch 3 — nothing available.
  return null;
}
