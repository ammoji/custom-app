/**
 * PR 46 — Geo foundation: pure helpers for the delivery-distance
 * estimate.
 *
 * The `getDeliveryEstimate` callable in `index.ts` is intentionally
 * a thin shell: auth check → Firestore read of shop + kill-switch
 * → call `computeDeliveryEstimate` from this file. Everything below
 * is pure (no firebase-admin, no globals beyond an optional
 * `fetchImpl`) so tests can pin the entire decision surface
 * without spinning up the emulator.
 *
 * COST DECISION (Sudhir, May 27 2026): the paid Distance Matrix
 * API is BUILT BUT DORMANT during pilot. The kill-switch
 * `aiFeatures/distanceMatrix.enabled` defaults to `false` (missing
 * doc OR explicit false → disabled), and the `flagEnabled === false`
 * branch in `computeDeliveryEstimate` MUST NEVER call `fetchImpl`.
 * That guarantee is pinned by
 * `tests/functions/distanceMatrixHelpers.test.ts` — if a future edit
 * accidentally wires fetch into the disabled branch the test trips
 * before billing starts.
 *
 * India proration (the pilot path):
 *   - distance: haversine straight-line × ROAD_FACTOR (= 1.4)
 *   - duration: distanceKm / FALLBACK_SPEED_KMH (= 15) × 60 minutes
 *
 * These constants live here (not buried in the callable) so PR 47's
 * tier-based delivery-charge logic can import + sanity-check the
 * same proration without duplicating the magic numbers.
 */

/**
 * India urban road-network inflation over straight-line haversine.
 * 1.4 chosen to match the design doc's empirical observation across
 * Faridabad / NCR pilot routes: typical ratio of OSRM road distance
 * to haversine on 1–8 km customer→shop pairs is ~1.35–1.45. We
 * round to 1.4 for predictability — minor over-estimate is
 * acceptable (slight padding on the customer's ETA, no charge
 * impact in PR 46 since deliveryFee is still flat).
 */
export const ROAD_FACTOR = 1.4;

/**
 * Average urban two-wheeler delivery speed in India, accounting
 * for traffic + stop-and-go. 15 km/h is the design-doc constant —
 * matches Swiggy / Zomato published rider averages for tier-2
 * cities. NOT a function of distance (urban traffic dominates over
 * highway segments at pilot scale).
 */
export const FALLBACK_SPEED_KMH = 15;

export type LatLng = { lat: number; lng: number };

export type DistanceEstimate = {
  /** Road distance in km. Decimal — caller decides display rounding. */
  distanceKm: number;
  /** Estimated drive time in minutes. Decimal — caller rounds for display. */
  durationMin: number;
  /**
   * `'distance_matrix'` ⇒ Google Distance Matrix returned a valid
   * row. `'haversine_fallback'` ⇒ either the kill-switch is off,
   * the fetch failed, or the response was malformed/non-OK. The
   * source is stamped onto the order doc by the caller so admin
   * reports can later partition cost-vs-fallback.
   */
  source: 'distance_matrix' | 'haversine_fallback';
};

/**
 * Great-circle distance between two coordinates, in kilometres.
 *
 * Duplicated from `index.ts` (which has `haversineKm` exported for
 * `rankShopsByDistance`) so this helpers file has zero imports
 * from index.ts and stays trivially testable. The two
 * implementations are byte-identical; if the formula ever changes
 * grep for both call sites.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371; // Earth radius in km
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Parse a Google Distance Matrix API JSON response into a raw
 * (km, min) pair. Returns `null` on ANY shape deviation —
 * non-OK status, missing rows/elements, non-numeric values —
 * so the caller falls back to haversine instead of returning
 * a zero/NaN to the customer.
 *
 * Shape we care about (the rest is ignored):
 *   {
 *     rows: [{
 *       elements: [{
 *         status: 'OK',
 *         distance: { value: <meters> },
 *         duration: { value: <seconds> }
 *       }]
 *     }]
 *   }
 *
 * Top-level `status` is intentionally NOT checked here — even when
 * the API responds with overall `OK`, individual elements can fail
 * (e.g. `ZERO_RESULTS` for an island). Per-element `status === 'OK'`
 * is the only authoritative signal.
 */
export function parseDistanceMatrixResponse(
  json: unknown,
): { distanceKm: number; durationMin: number } | null {
  if (!json || typeof json !== 'object') return null;
  const rows = (json as { rows?: unknown }).rows;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const elements = (rows[0] as { elements?: unknown })?.elements;
  if (!Array.isArray(elements) || elements.length === 0) return null;

  const el = elements[0] as {
    status?: unknown;
    distance?: { value?: unknown };
    duration?: { value?: unknown };
  };
  if (el?.status !== 'OK') return null;

  const meters = el.distance?.value;
  const seconds = el.duration?.value;
  if (typeof meters !== 'number' || !Number.isFinite(meters)) return null;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;

  return {
    distanceKm: meters / 1000,
    durationMin: seconds / 60,
  };
}

/**
 * Free, no-network estimate: haversine × ROAD_FACTOR for distance,
 * speed-based for duration. Always returns a valid estimate, never
 * throws. This is the ONLY path that runs during pilot (kill-switch
 * defaults to disabled).
 */
export function haversineFallbackEstimate(
  shop: LatLng,
  dest: LatLng,
): DistanceEstimate {
  const distanceKm = haversineKm(shop, dest) * ROAD_FACTOR;
  const durationMin = (distanceKm / FALLBACK_SPEED_KMH) * 60;
  return { distanceKm, durationMin, source: 'haversine_fallback' };
}

/**
 * Build the Google Distance Matrix request URL. Extracted so the
 * test can assert URL shape without needing a regex over a string
 * concat. Origins/destinations encoded as `lat,lng` (DM accepts
 * decimal degrees directly; no rounding so we preserve full GPS
 * precision when the customer picks current-location).
 */
export function buildDistanceMatrixUrl(
  origin: LatLng,
  dest: LatLng,
  apiKey: string,
): string {
  const params = new URLSearchParams({
    origins: `${origin.lat},${origin.lng}`,
    destinations: `${dest.lat},${dest.lng}`,
    mode: 'driving',
    key: apiKey,
  });
  return `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`;
}

export type DeliveryEstimateInput = {
  shop: LatLng;
  dest: LatLng;
  /**
   * Resolved value of `aiFeatures/distanceMatrix.enabled`. Caller
   * is responsible for the Firestore read + the default-false
   * (mirrors the menuExtraction kill-switch pattern). When
   * `false`, the Google branch is unreachable — pinned by test.
   */
  flagEnabled: boolean;
  /**
   * Resolved Functions secret. May legitimately be null — e.g.
   * the secret hasn't been set yet on a fresh project, or the
   * secret-fetch threw at runtime. Treated identically to a
   * Google failure: silent haversine fallback.
   */
  apiKey: string | null;
  /**
   * Optional fetch override for tests. Production passes
   * `globalThis.fetch` (Node 22 has it built-in). Typed loosely
   * because we only need `.json()` and a status; saves the test
   * from constructing a full DOM `Response` instance.
   */
  fetchImpl?: (url: string) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }>;
  /**
   * Optional logger so tests can assert breadcrumb sequence
   * without spying on console. Production passes a Sentry-backed
   * implementation from the callable.
   */
  logger?: {
    breadcrumb?: (message: string, data?: Record<string, unknown>) => void;
    captureException?: (err: unknown) => void;
  };
};

/**
 * The whole decision surface for `getDeliveryEstimate`, expressed
 * as a pure async function. `null`-coalesces every external
 * failure into a haversine fallback — checkout MUST NEVER hard-block
 * on Google.
 *
 * Decision order (matters for the cost guarantee):
 *   1. flagEnabled === false → haversine, fetchImpl NOT called.
 *      ← THIS IS THE ONLY BRANCH THAT RUNS DURING PILOT.
 *   2. apiKey is null/empty → haversine, fetchImpl NOT called
 *      (no point in firing a request that will 403).
 *   3. fetchImpl throws → haversine, captureException so we see it.
 *   4. response.ok === false → haversine, breadcrumb.
 *   5. parseDistanceMatrixResponse returns null → haversine,
 *      breadcrumb (covers ZERO_RESULTS, OVER_QUERY_LIMIT, etc).
 *   6. otherwise → distance_matrix.
 */
export async function computeDeliveryEstimate(
  input: DeliveryEstimateInput,
): Promise<DistanceEstimate> {
  const { shop, dest, flagEnabled, apiKey, fetchImpl, logger } = input;

  if (!flagEnabled) {
    logger?.breadcrumb?.('distance_matrix: flag off, using haversine');
    return haversineFallbackEstimate(shop, dest);
  }

  if (!apiKey) {
    // Defence-in-depth — when the flag flips ON in production, a
    // missing secret should still fail closed (free fallback)
    // rather than 403-thrashing. Surfaces as a breadcrumb so
    // ops sees it, but no captureException because this is a
    // recoverable config drift, not a runtime bug.
    logger?.breadcrumb?.('distance_matrix: flag on but no apiKey, using haversine');
    return haversineFallbackEstimate(shop, dest);
  }

  const fetcher = fetchImpl ?? (globalThis.fetch as DeliveryEstimateInput['fetchImpl']);
  if (!fetcher) {
    // Theoretical — every supported runtime has fetch — but if a
    // future Node downgrade lands without polyfilling, fall back
    // rather than throw.
    logger?.breadcrumb?.('distance_matrix: no fetchImpl, using haversine');
    return haversineFallbackEstimate(shop, dest);
  }

  const url = buildDistanceMatrixUrl(shop, dest, apiKey);

  try {
    const response = await fetcher(url);
    if (!response.ok) {
      logger?.breadcrumb?.('distance_matrix: non-2xx response', {
        status: response.status,
      });
      return haversineFallbackEstimate(shop, dest);
    }
    const json = await response.json();
    const parsed = parseDistanceMatrixResponse(json);
    if (!parsed) {
      logger?.breadcrumb?.('distance_matrix: malformed/non-OK element');
      return haversineFallbackEstimate(shop, dest);
    }
    return {
      distanceKm: parsed.distanceKm,
      durationMin: parsed.durationMin,
      source: 'distance_matrix',
    };
  } catch (err) {
    // Network failure / DNS / timeout / aborted. captureException
    // because if the flag is ON and Google is dropping requests
    // we want to know — but still return a valid estimate so
    // checkout flows.
    logger?.captureException?.(err);
    return haversineFallbackEstimate(shop, dest);
  }
}
