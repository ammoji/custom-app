/**
 * PR-NEXT-SHOP-LOCATION-EDIT — pretty-print a `GeocodeSuggestion`
 * (from `reverseGeocodeLabel`) into a single human-readable line
 * suitable for the RegisterShop / ShopSettings success card and
 * the admin "Pin resolves to" comparison row.
 *
 * Shop-side affordance separate from the customer-side
 * `SaveCurrentLocationModal` label rendering: that surface uses
 * the multi-field shape (`label / line1 / city / pincode`) for
 * editable pre-fill. The shop-location capture flow only needs
 * a single string for visual confirmation that the resolved
 * address looks like the shop's actual address.
 *
 * Empty / missing parts skipped cleanly. Returns "Unknown
 * location" when nothing meaningful resolves (rural pin, mid-
 * Pacific Ocean, network failure that fell through to
 * `reverseGeocodeLabel`'s EMPTY default).
 *
 * Pure; pinned by `tests/utils/formatResolvedAddress.test.ts`.
 */
import type { GeocodeSuggestion } from './reverseGeocodeLabel';

export function formatResolvedAddress(g: GeocodeSuggestion): string {
  // Skip non-string + whitespace-only parts. The reverse-geocode
  // surface returns '' for missing components but a future expo-
  // location upgrade could surface stray spaces — defend against it.
  const parts = [g.line1, g.city, g.pincode].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(', ') : 'Unknown location';
}
