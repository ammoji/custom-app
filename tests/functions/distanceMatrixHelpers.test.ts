/**
 * PR 46 — tests for the pure delivery-estimate helpers.
 *
 * The cost-guarantee pin (Sudhir, May 27 2026) lives in this file:
 * with `flagEnabled: false`, `computeDeliveryEstimate` MUST NEVER
 * invoke `fetchImpl`. If that test fails, a future edit has wired
 * fetch into the disabled branch and pilot is at risk of billing.
 */
import {
  buildDistanceMatrixUrl,
  computeDeliveryEstimate,
  FALLBACK_SPEED_KMH,
  haversineFallbackEstimate,
  haversineKm,
  parseDistanceMatrixResponse,
  ROAD_FACTOR,
  type DeliveryEstimateInput,
} from '../../functions/src/distanceMatrixHelpers';

const SHOP = { lat: 28.6139, lng: 77.209 }; // Connaught Place
const DEST = { lat: 28.65, lng: 77.23 }; // ~5 km north-east

describe('PR 46 — distanceMatrixHelpers (pure)', () => {
  // ────────────────────────────────────────────────────────────
  // Constants — pinned so accidental edits trip CI. The tier-based
  // delivery charge in PR 47 imports these and would silently
  // re-tier its slabs if anyone bumped them mid-pilot.
  // ────────────────────────────────────────────────────────────

  test('proration constants are 1.4 / 15 (matches design doc + cost decision)', () => {
    expect(ROAD_FACTOR).toBe(1.4);
    expect(FALLBACK_SPEED_KMH).toBe(15);
  });

  // ────────────────────────────────────────────────────────────
  // haversineKm — sanity. Detailed pinning lives in
  // listShopsPublic.test.ts (the original site).
  // ────────────────────────────────────────────────────────────

  test('haversineKm: zero distance for identical points', () => {
    expect(haversineKm(SHOP, SHOP)).toBeCloseTo(0, 6);
  });

  test('haversineKm: 5 km north-east is roughly 4–5 km', () => {
    const km = haversineKm(SHOP, DEST);
    expect(km).toBeGreaterThan(3);
    expect(km).toBeLessThan(6);
  });

  // ────────────────────────────────────────────────────────────
  // haversineFallbackEstimate — math.
  // ────────────────────────────────────────────────────────────

  test('haversineFallbackEstimate: applies ROAD_FACTOR and uses speed-based duration', () => {
    const out = haversineFallbackEstimate(SHOP, DEST);
    const straight = haversineKm(SHOP, DEST);
    expect(out.source).toBe('haversine_fallback');
    expect(out.distanceKm).toBeCloseTo(straight * ROAD_FACTOR, 6);
    expect(out.durationMin).toBeCloseTo(
      (out.distanceKm / FALLBACK_SPEED_KMH) * 60,
      6,
    );
  });

  test('haversineFallbackEstimate: zero-distance still returns finite, zero estimate', () => {
    // Defensive — same shop and dest shouldn't NaN out the duration
    // (would happen if we divided 0 / 0 anywhere).
    const out = haversineFallbackEstimate(SHOP, SHOP);
    expect(out.distanceKm).toBe(0);
    expect(out.durationMin).toBe(0);
    expect(Number.isFinite(out.durationMin)).toBe(true);
  });

  // ────────────────────────────────────────────────────────────
  // parseDistanceMatrixResponse — branches.
  // ────────────────────────────────────────────────────────────

  test('parseDistanceMatrixResponse: happy path (status OK)', () => {
    const json = {
      rows: [
        {
          elements: [
            {
              status: 'OK',
              distance: { value: 6500, text: '6.5 km' },
              duration: { value: 1200, text: '20 min' },
            },
          ],
        },
      ],
    };
    expect(parseDistanceMatrixResponse(json)).toEqual({
      distanceKm: 6.5,
      durationMin: 20,
    });
  });

  test('parseDistanceMatrixResponse: per-element non-OK status → null', () => {
    // Top-level can be 'OK' while the row failed (e.g.
    // ZERO_RESULTS for an unreachable destination). The element
    // status is the authoritative signal.
    const json = {
      status: 'OK',
      rows: [
        {
          elements: [
            {
              status: 'ZERO_RESULTS',
            },
          ],
        },
      ],
    };
    expect(parseDistanceMatrixResponse(json)).toBeNull();
  });

  test('parseDistanceMatrixResponse: missing rows → null', () => {
    expect(parseDistanceMatrixResponse({ status: 'OK' })).toBeNull();
  });

  test('parseDistanceMatrixResponse: empty rows array → null', () => {
    expect(parseDistanceMatrixResponse({ rows: [] })).toBeNull();
  });

  test('parseDistanceMatrixResponse: missing elements → null', () => {
    expect(parseDistanceMatrixResponse({ rows: [{}] })).toBeNull();
  });

  test('parseDistanceMatrixResponse: non-numeric distance.value → null', () => {
    const json = {
      rows: [
        {
          elements: [
            {
              status: 'OK',
              distance: { value: 'lots' },
              duration: { value: 1200 },
            },
          ],
        },
      ],
    };
    expect(parseDistanceMatrixResponse(json)).toBeNull();
  });

  test('parseDistanceMatrixResponse: missing duration.value → null', () => {
    const json = {
      rows: [
        {
          elements: [
            {
              status: 'OK',
              distance: { value: 6500 },
            },
          ],
        },
      ],
    };
    expect(parseDistanceMatrixResponse(json)).toBeNull();
  });

  test('parseDistanceMatrixResponse: non-object input → null', () => {
    expect(parseDistanceMatrixResponse(null)).toBeNull();
    expect(parseDistanceMatrixResponse(undefined)).toBeNull();
    expect(parseDistanceMatrixResponse('OK')).toBeNull();
    expect(parseDistanceMatrixResponse(42)).toBeNull();
  });

  // ────────────────────────────────────────────────────────────
  // buildDistanceMatrixUrl — shape.
  // ────────────────────────────────────────────────────────────

  test('buildDistanceMatrixUrl: encodes coords + mode + key', () => {
    const url = buildDistanceMatrixUrl(SHOP, DEST, 'TEST_KEY');
    expect(url).toMatch(/^https:\/\/maps\.googleapis\.com\/maps\/api\/distancematrix\/json\?/);
    expect(url).toContain(`origins=${encodeURIComponent('28.6139,77.209')}`);
    expect(url).toContain(`destinations=${encodeURIComponent('28.65,77.23')}`);
    expect(url).toContain('mode=driving');
    expect(url).toContain('key=TEST_KEY');
  });

  // ────────────────────────────────────────────────────────────
  // computeDeliveryEstimate — the orchestrator + COST GUARANTEE.
  // ────────────────────────────────────────────────────────────

  const callOrch = (
    overrides: Partial<DeliveryEstimateInput> = {},
  ): Promise<ReturnType<typeof haversineFallbackEstimate>> =>
    computeDeliveryEstimate({
      shop: overrides.shop ?? SHOP,
      dest: overrides.dest ?? DEST,
      flagEnabled: overrides.flagEnabled ?? true,
      // Explicit `'apiKey' in overrides` so callers can pass `null`
      // to assert the missing-key branch — `?? 'TEST_KEY'` would
      // collapse `null` back to the default and silently break the
      // test (regression: it did, mid-development).
      apiKey: 'apiKey' in overrides ? overrides.apiKey! : 'TEST_KEY',
      fetchImpl: overrides.fetchImpl,
      logger: overrides.logger,
    });

  test('CRITICAL: flagEnabled=false → fetchImpl NEVER called (cost guarantee)', async () => {
    // The pilot-cost guarantee. If this fails a future edit has
    // wired fetch into the disabled branch and pilot is at risk
    // of unintentional Distance Matrix billing.
    const fetchImpl = jest.fn();
    const out = await callOrch({ flagEnabled: false, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out.source).toBe('haversine_fallback');
    expect(out.distanceKm).toBeCloseTo(haversineKm(SHOP, DEST) * ROAD_FACTOR, 6);
  });

  test('flagEnabled=false: breadcrumb fires, no captureException', async () => {
    const breadcrumb = jest.fn();
    const captureException = jest.fn();
    await callOrch({
      flagEnabled: false,
      logger: { breadcrumb, captureException },
    });
    expect(breadcrumb).toHaveBeenCalledWith(
      'distance_matrix: flag off, using haversine',
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  test('flagEnabled=true + null apiKey → fallback, fetch NOT called', async () => {
    // Defence-in-depth — if the flag flips on in prod but the
    // secret hasn't been set, we must NOT 403-thrash Google. Fall
    // back silently and let ops see the breadcrumb.
    const fetchImpl = jest.fn();
    const out = await callOrch({
      flagEnabled: true,
      apiKey: null,
      fetchImpl,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out.source).toBe('haversine_fallback');
  });

  test('flagEnabled=true + empty apiKey → fallback', async () => {
    // `''` is truthy-falsy in TS but a real "missing" — pin it.
    const fetchImpl = jest.fn();
    const out = await callOrch({
      flagEnabled: true,
      apiKey: '',
      fetchImpl,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out.source).toBe('haversine_fallback');
  });

  test('happy path: valid Distance Matrix response → distance_matrix source', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        rows: [
          {
            elements: [
              {
                status: 'OK',
                distance: { value: 6500 },
                duration: { value: 1200 },
              },
            ],
          },
        ],
      }),
    }));
    const out = await callOrch({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out).toEqual({
      distanceKm: 6.5,
      durationMin: 20,
      source: 'distance_matrix',
    });
  });

  test('non-2xx response → fallback, breadcrumb, no captureException', async () => {
    // 403 / 429 / 500 — Google rejected. We don't capture as an
    // exception (these are operational, not bugs); breadcrumb
    // gives ops visibility without spamming Sentry issues.
    const breadcrumb = jest.fn();
    const captureException = jest.fn();
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
    }));
    const out = await callOrch({
      fetchImpl,
      logger: { breadcrumb, captureException },
    });
    expect(out.source).toBe('haversine_fallback');
    expect(breadcrumb).toHaveBeenCalledWith(
      'distance_matrix: non-2xx response',
      { status: 429 },
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  test('malformed / non-OK element response → fallback', async () => {
    // Top-level 200 OK, but rows[0].elements[0].status !== 'OK'.
    // Common in production: ZERO_RESULTS (unreachable),
    // OVER_QUERY_LIMIT (rate limited mid-billing-period).
    const breadcrumb = jest.fn();
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        rows: [{ elements: [{ status: 'ZERO_RESULTS' }] }],
      }),
    }));
    const out = await callOrch({ fetchImpl, logger: { breadcrumb } });
    expect(out.source).toBe('haversine_fallback');
    expect(breadcrumb).toHaveBeenCalledWith(
      'distance_matrix: malformed/non-OK element',
    );
  });

  test('fetch throws (network / timeout) → fallback + captureException', async () => {
    // Network-layer failure IS a real bug signal when the flag is
    // on — captureException so it surfaces in Sentry. Estimate
    // still returns valid (haversine) so checkout doesn't block.
    const captureException = jest.fn();
    const err = new Error('ETIMEDOUT');
    const fetchImpl = jest.fn(async () => {
      throw err;
    });
    const out = await callOrch({
      fetchImpl,
      logger: { captureException },
    });
    expect(out.source).toBe('haversine_fallback');
    expect(out.distanceKm).toBeGreaterThan(0);
    expect(captureException).toHaveBeenCalledWith(err);
  });

  test('response.json() throws → fallback (treated as fetch failure)', async () => {
    const captureException = jest.fn();
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json');
      },
    }));
    const out = await callOrch({ fetchImpl, logger: { captureException } });
    expect(out.source).toBe('haversine_fallback');
    expect(captureException).toHaveBeenCalled();
  });

  test('fetchImpl is called with a properly-shaped DM URL when enabled', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        rows: [
          {
            elements: [
              {
                status: 'OK',
                distance: { value: 1000 },
                duration: { value: 240 },
              },
            ],
          },
        ],
      }),
    }));
    let capturedUrl = '';
    const fetchImplWithCapture = jest.fn(async (url: string) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          rows: [
            {
              elements: [
                {
                  status: 'OK',
                  distance: { value: 1000 },
                  duration: { value: 240 },
                },
              ],
            },
          ],
        }),
      };
    });
    void fetchImpl;
    await callOrch({ fetchImpl: fetchImplWithCapture, apiKey: 'KEY_X' });
    expect(fetchImplWithCapture).toHaveBeenCalledTimes(1);
    const url = capturedUrl;
    expect(url).toContain('maps.googleapis.com/maps/api/distancematrix');
    expect(url).toContain('mode=driving');
    expect(url).toContain('key=KEY_X');
  });

  test('orchestrator never throws — checkout cannot hard-block', async () => {
    // Invariant. Every failure mode above resolves with a valid
    // DistanceEstimate. Pin it so a future contributor can't make
    // checkout brittle by re-throwing inside the catch.
    await expect(
      callOrch({
        fetchImpl: () => {
          throw new Error('sync throw — even pre-await');
        },
      }),
    ).resolves.toMatchObject({ source: 'haversine_fallback' });
  });
});
