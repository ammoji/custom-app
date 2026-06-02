/**
 * PR-NEXT-PARTNER-CARD.2 — pin the WHO-line + vehicle-glyph copy.
 * Edge cases that the sheet relies on: "new partner" fallback when
 * any rating field is missing, vehicle default for unknown / null
 * vehicleType, and singular "1 delivery" pluralization.
 */
import { formatPartnerTrust } from '../../src/utils/formatPartnerTrust';

describe('formatPartnerTrust', () => {
  test('full data: rating + count + vehicle → formatted trust line', () => {
    expect(
      formatPartnerTrust({
        ratingAvg: 4.8,
        ratingCount: 142,
        vehicleType: 'motorbike',
      }),
    ).toEqual({
      trustLine: '⭐ 4.8 · 142 deliveries',
      vehicleIcon: '🛵',
      vehicleLabel: 'motorbike',
    });
  });

  test('missing ratingAvg → "New partner" fallback (still preserves vehicle)', () => {
    const result = formatPartnerTrust({
      ratingAvg: null,
      ratingCount: 5,
      vehicleType: 'bicycle',
    });
    expect(result.trustLine).toBe('⭐ New partner · welcome them!');
    expect(result.vehicleIcon).toBe('🚲');
    expect(result.vehicleLabel).toBe('bicycle');
  });

  test('zero ratingCount → "New partner" fallback even with avg set', () => {
    // Defensive — pre-PR partners may have `deliveryRatingAvg: 0`
    // from a stub write; we don't want "⭐ 0.0 · 0 deliveries".
    expect(
      formatPartnerTrust({
        ratingAvg: 0,
        ratingCount: 0,
        vehicleType: 'motorbike',
      }).trustLine,
    ).toBe('⭐ New partner · welcome them!');
  });

  test('vehicleType null → default to motorbike (icon + label)', () => {
    const result = formatPartnerTrust({
      ratingAvg: 4.5,
      ratingCount: 20,
      vehicleType: null,
    });
    expect(result.vehicleIcon).toBe('🛵');
    expect(result.vehicleLabel).toBe('motorbike');
    expect(result.trustLine).toBe('⭐ 4.5 · 20 deliveries');
  });

  test('vehicleType unknown string → falls back to motorbike default', () => {
    // Defensive — if a future onboarding form ships a value
    // ("truck"?) before the icon map is extended, we silently
    // default rather than render an empty glyph.
    const result = formatPartnerTrust({
      ratingAvg: 4.0,
      ratingCount: 1,
      vehicleType: 'truck' as any,
    });
    expect(result.vehicleIcon).toBe('🛵');
    expect(result.vehicleLabel).toBe('motorbike');
  });

  test('ratingCount === 1 → singular "1 delivery"', () => {
    expect(
      formatPartnerTrust({
        ratingAvg: 5.0,
        ratingCount: 1,
        vehicleType: 'on_foot',
      }),
    ).toEqual({
      trustLine: '⭐ 5.0 · 1 delivery',
      vehicleIcon: '🚶',
      vehicleLabel: 'on foot',
    });
  });

  test('all four vehicle types map correctly', () => {
    // Lightweight enum-coverage sanity check.
    expect(
      formatPartnerTrust({ ratingAvg: 4, ratingCount: 1, vehicleType: 'car' })
        .vehicleIcon,
    ).toBe('🚗');
    expect(
      formatPartnerTrust({
        ratingAvg: 4,
        ratingCount: 1,
        vehicleType: 'on_foot',
      }).vehicleLabel,
    ).toBe('on foot');
  });
});
