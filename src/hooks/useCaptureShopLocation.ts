/**
 * PR-NEXT-SHOP-LOCATION-EDIT — shared shop-location capture hook.
 *
 * Single source of truth for the dual-mode capture flow used by
 * both `RegisterShopScreen` (initial registration) and
 * `ShopSettingsScreen` (post-approval edit). Encapsulates:
 *
 *   1. GPS path (`captureGps`) — `locationService.getCurrentLocation()`
 *      with HOTFIX-FALLBACK-LEAK posture: if `source === 'fallback'`
 *      the silent `MOCK_USER_LOCATION` is REJECTED with a clear
 *      error rather than silently used as the shop's pin.
 *   2. Geocode path (`captureFromAddress`) — `Location.geocodeAsync`
 *      against the owner-typed address. Free, no API key. Empty
 *      results → "address not found" error.
 *   3. Reverse-geocode the resolved coords for visual confirmation
 *      (the success card and the admin verification surface both
 *      render the resolved address alongside lat/lng).
 *
 * Why a hook (vs. two screen-local copies): the two surfaces MUST
 * stay in lockstep. Any divergence (e.g. one screen forgets the
 * fallback-leak check) re-opens the class of bug HOTFIX-FALLBACK-
 * LEAK closed. The hook is the structural lock.
 *
 * State shape (`CaptureState`) is intentionally flat — the success
 * card / error banner / loading spinner all read from the same
 * three fields (`captured / capturing / error`). A `reset()`
 * affordance returns to the empty state for the "↻ Re-capture"
 * button.
 */
import * as Location from 'expo-location';
import { useCallback, useState } from 'react';
import { locationService } from '../services/locationService';
import { formatResolvedAddress } from '../utils/formatResolvedAddress';
import { reverseGeocodeLabel } from '../utils/reverseGeocodeLabel';

export type CapturedShopLocation = {
  lat: number;
  lng: number;
  source: 'gps' | 'geocoded';
  // Reverse-geocoded label for the success card. Pretty-printed via
  // `formatResolvedAddress`; never throws — the reverse-geocode
  // helper falls back to "Unknown location" on failure.
  resolvedAddress: string;
};

export type CaptureState = {
  captured: CapturedShopLocation | null;
  capturing: boolean;
  error: string | null;
};

const INITIAL: CaptureState = {
  captured: null,
  capturing: false,
  error: null,
};

export type UseCaptureShopLocationReturn = CaptureState & {
  captureGps: () => Promise<void>;
  captureFromAddress: (address: string) => Promise<void>;
  reset: () => void;
  // Pre-seed the captured state from an already-stored location
  // (e.g. ShopSettings edit flow shows the live pin as the starting
  // point). The reverse-geocoded label is computed lazily on first
  // call to `captureGps`/`captureFromAddress` — `seedFromExisting`
  // accepts a pre-resolved label so the consumer can stamp the
  // current shop.location's reverse-geocode result without an
  // extra round-trip.
  seedFromExisting: (
    seed: { lat: number; lng: number; source: 'gps' | 'geocoded' },
    resolvedAddress: string,
  ) => void;
};

export function useCaptureShopLocation(): UseCaptureShopLocationReturn {
  const [state, setState] = useState<CaptureState>(INITIAL);

  const captureGps = useCallback(async () => {
    setState({ captured: null, capturing: true, error: null });
    try {
      const result = await locationService.getCurrentLocation();
      // HOTFIX-FALLBACK-LEAK posture (2026-06-02) — refuse the
      // silent MOCK_USER_LOCATION fallback. Without this check the
      // owner's pin would be Faridabad coords for a Ballwin MO
      // shop.
      if (result.source === 'fallback') {
        setState({
          captured: null,
          capturing: false,
          error:
            'Your phone returned a default location — location ' +
            'permission is OFF or GPS is disabled. Open Settings to ' +
            'grant location permission and try again, OR use ' +
            '"Find from address".',
        });
        return;
      }
      const resolved = await reverseGeocodeLabel({
        lat: result.location.lat,
        lng: result.location.lng,
      });
      setState({
        captured: {
          lat: result.location.lat,
          lng: result.location.lng,
          source: 'gps',
          resolvedAddress: formatResolvedAddress(resolved),
        },
        capturing: false,
        error: null,
      });
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : 'Could not capture location. Try again.';
      setState({ captured: null, capturing: false, error: message });
    }
  }, []);

  const captureFromAddress = useCallback(async (address: string) => {
    const trimmed = address.trim();
    if (!trimmed) {
      setState(s => ({
        ...s,
        captured: null,
        capturing: false,
        error:
          'Type your shop address first, then tap "Find from address".',
      }));
      return;
    }
    setState({ captured: null, capturing: true, error: null });
    try {
      const results = await Location.geocodeAsync(trimmed);
      if (results.length === 0) {
        setState({
          captured: null,
          capturing: false,
          error:
            'Address not found. Try a more specific address ' +
            '(include city + state/zip), or use "📍 Use my GPS" ' +
            "if you're at the shop.",
        });
        return;
      }
      const r = results[0];
      const resolved = await reverseGeocodeLabel({
        lat: r.latitude,
        lng: r.longitude,
      });
      setState({
        captured: {
          lat: r.latitude,
          lng: r.longitude,
          source: 'geocoded',
          resolvedAddress: formatResolvedAddress(resolved),
        },
        capturing: false,
        error: null,
      });
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : 'Geocode failed. Try again.';
      setState({ captured: null, capturing: false, error: message });
    }
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL);
  }, []);

  const seedFromExisting = useCallback(
    (
      seed: { lat: number; lng: number; source: 'gps' | 'geocoded' },
      resolvedAddress: string,
    ) => {
      setState({
        captured: {
          lat: seed.lat,
          lng: seed.lng,
          source: seed.source,
          resolvedAddress,
        },
        capturing: false,
        error: null,
      });
    },
    [],
  );

  return {
    ...state,
    captureGps,
    captureFromAddress,
    reset,
    seedFromExisting,
  };
}
