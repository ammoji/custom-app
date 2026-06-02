/**
 * PR-NEXT-ADDRESS-UX.1 (Case 10 retest) — best-effort reverse-
 * geocode of a GPS pin to `(label, line1, city, pincode)`
 * suggestions for `SaveCurrentLocationModal`. Failure is non-fatal:
 * returns sensible empty defaults (label "Current location") so the
 * modal still opens with the live coords usable.
 *
 * Why a module-level wrapper: expo-location's `reverseGeocodeAsync`
 * is async + may throw on devices without Google Play Services
 * (Android emulator without play), with no network, etc. Keeping
 * the try/catch here means CheckoutScreen's call site stays linear
 * and a future test pin can stub a single import.
 */
import * as Location from 'expo-location';

export type GeocodeSuggestion = {
  label: string;
  line1: string;
  city: string;
  pincode: string;
};

const EMPTY: GeocodeSuggestion = {
  label: 'Current location',
  line1: '',
  city: '',
  pincode: '',
};

// Exported for tests so the EMPTY fallback shape stays pinned even
// if it's later tweaked (e.g. localized label).
export const EMPTY_GEOCODE_SUGGESTION: GeocodeSuggestion = EMPTY;

// Pure: the post-`reverseGeocodeAsync` projection. Split out so the
// failure paths can be unit-tested without mocking expo-location's
// async surface — `reverseGeocodeLabel` just glues this onto the
// Location call.
export function buildGeocodeSuggestion(
  result: Location.LocationGeocodedAddress | undefined,
): GeocodeSuggestion {
  if (!result) return EMPTY;
  const street = [result.name, result.street].filter(Boolean).join(', ');
  const cityPart = result.city ?? result.subregion ?? '';
  // `district` is "Sector 10" / "Block A" on Indian Google data;
  // `subregion` is typically the district/town containing the city
  // when the two diverge. Join when distinct so labels read like
  // "Sector 10, Ballabgarh" rather than "Sector 10, Sector 10".
  const district =
    result.subregion && result.subregion !== result.city ? result.subregion : '';
  const labelParts = [
    result.district || result.name,
    district || cityPart,
  ].filter(Boolean);
  const label = labelParts.join(', ').trim();
  return {
    label: label.length > 0 ? label : EMPTY.label,
    line1: street,
    city: cityPart,
    pincode: result.postalCode ?? '',
  };
}

export async function reverseGeocodeLabel(
  coords: { lat: number; lng: number },
): Promise<GeocodeSuggestion> {
  try {
    const results = await Location.reverseGeocodeAsync({
      latitude: coords.lat,
      longitude: coords.lng,
    });
    return buildGeocodeSuggestion(results[0]);
  } catch {
    // Network failure, no Google Play Services, permission revoke
    // mid-flow — all collapse to the empty fallback. Caller (the
    // modal) renders "Current location" + empty fields and lets
    // the user type whatever they want.
    return EMPTY;
  }
}
