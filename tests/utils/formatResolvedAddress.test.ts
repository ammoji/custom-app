/**
 * PR-NEXT-SHOP-LOCATION-EDIT — pure-helper tests for the
 * shop-side resolved-address pretty-printer.
 */
import { formatResolvedAddress } from '../../src/utils/formatResolvedAddress';
import type { GeocodeSuggestion } from '../../src/utils/reverseGeocodeLabel';

const make = (over: Partial<GeocodeSuggestion>): GeocodeSuggestion => ({
  label: 'Current location',
  line1: '',
  city: '',
  pincode: '',
  ...over,
});

describe('PR-NEXT-SHOP-LOCATION-EDIT — formatResolvedAddress', () => {
  test('full address — all three parts joined by comma+space', () => {
    expect(
      formatResolvedAddress(
        make({
          line1: '16663 Chesterfield Farms Drive',
          city: 'Ballwin',
          pincode: '63005',
        }),
      ),
    ).toBe('16663 Chesterfield Farms Drive, Ballwin, 63005');
  });

  test('only city present — returns just the city', () => {
    expect(formatResolvedAddress(make({ city: 'Faridabad' }))).toBe(
      'Faridabad',
    );
  });

  test('only pincode present — returns just the pincode', () => {
    expect(formatResolvedAddress(make({ pincode: '110001' }))).toBe('110001');
  });

  test('all parts empty — returns "Unknown location" sentinel', () => {
    expect(formatResolvedAddress(make({}))).toBe('Unknown location');
  });

  test('whitespace-only parts skipped (defends against future expo-location stray spaces)', () => {
    expect(
      formatResolvedAddress(
        make({ line1: '   ', city: 'Delhi', pincode: '\t  ' }),
      ),
    ).toBe('Delhi');
  });
});
