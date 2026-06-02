/**
 * PR-NEXT-PARTNER-CARD.2 — pinning the WHEN + Distance copy edges.
 * The partner sheet renders these strings verbatim; any future
 * tweak to the thresholds (50m hide, 60min hr-switch, <1min copy)
 * has to land in these tests too.
 */
import { formatLivePartnerEta } from '../../src/utils/formatLivePartnerEta';

describe('formatLivePartnerEta', () => {
  test('live + post-pickup: shows "Arriving in" + km label', () => {
    const result = formatLivePartnerEta({
      distanceKm: 1.234,
      etaMin: 6.4,
      stale: false,
      isPickedUp: true,
    });
    expect(result).toEqual({
      whenLabel: 'Arriving in',
      whenValue: '~6 min',
      distanceValue: '1.2 km',
      estimatedSuffix: false,
    });
  });

  test('live + pre-pickup: WHEN label flips to "Picks up in"', () => {
    const result = formatLivePartnerEta({
      distanceKm: 0.7,
      etaMin: 3.2,
      stale: false,
      isPickedUp: false,
    });
    expect(result.whenLabel).toBe('Picks up in');
    expect(result.whenValue).toBe('~3 min');
    expect(result.distanceValue).toBe('700 m');
  });

  test('stale → estimatedSuffix true (values unchanged)', () => {
    const result = formatLivePartnerEta({
      distanceKm: 2.0,
      etaMin: 8,
      stale: true,
      isPickedUp: true,
    });
    expect(result.estimatedSuffix).toBe(true);
    expect(result.whenValue).toBe('~8 min');
    expect(result.distanceValue).toBe('2.0 km');
  });

  test('ETA <1 min post-pickup → "Arriving now"', () => {
    const result = formatLivePartnerEta({
      distanceKm: 0.2,
      etaMin: 0.3,
      stale: false,
      isPickedUp: true,
    });
    expect(result.whenValue).toBe('Arriving now');
  });

  test('ETA <1 min pre-pickup → "Almost there"', () => {
    const result = formatLivePartnerEta({
      distanceKm: 0.2,
      etaMin: 0.3,
      stale: false,
      isPickedUp: false,
    });
    expect(result.whenValue).toBe('Almost there');
  });

  test('distance <50 m hides the row (returns null)', () => {
    const result = formatLivePartnerEta({
      distanceKm: 0.03, // 30 m
      etaMin: 0.5,
      stale: false,
      isPickedUp: true,
    });
    expect(result.distanceValue).toBeNull();
    expect(result.whenValue).toBe('Arriving now');
  });

  test('distance <1 km formats as "X m" (rounded)', () => {
    const result = formatLivePartnerEta({
      distanceKm: 0.456,
      etaMin: 2,
      stale: false,
      isPickedUp: true,
    });
    expect(result.distanceValue).toBe('456 m');
  });

  test('distance >=1 km formats as "X.X km"', () => {
    const result = formatLivePartnerEta({
      distanceKm: 3.78,
      etaMin: 12,
      stale: false,
      isPickedUp: true,
    });
    expect(result.distanceValue).toBe('3.8 km');
  });

  test('ETA >=60 min switches to "X.X hr" so numbers stay <3 digits', () => {
    const result = formatLivePartnerEta({
      distanceKm: 25,
      etaMin: 75,
      stale: false,
      isPickedUp: true,
    });
    expect(result.whenValue).toBe('~1.3 hr');
  });

  test('null/invalid ETA falls back to em-dash placeholder', () => {
    // Defensive — the callable returns numeric `etaMin`, but the
    // static fallback (`order.deliveryDurationMin`) may be missing
    // on pre-PR-46 orders. Sheet still renders the row gracefully
    // with the "~ estimated" suffix (driven by `stale: true`).
    expect(
      formatLivePartnerEta({
        distanceKm: 2,
        etaMin: null,
        stale: true,
        isPickedUp: true,
      }).whenValue,
    ).toBe('—');
    expect(
      formatLivePartnerEta({
        distanceKm: 2,
        etaMin: NaN,
        stale: true,
        isPickedUp: true,
      }).whenValue,
    ).toBe('—');
    expect(
      formatLivePartnerEta({
        distanceKm: 2,
        etaMin: -5,
        stale: true,
        isPickedUp: true,
      }).whenValue,
    ).toBe('—');
  });
});
