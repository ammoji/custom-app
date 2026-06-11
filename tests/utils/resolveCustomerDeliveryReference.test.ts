/**
 * PR-NEXT-BUNDLE-A §A — 6 unit tests for
 * `resolveCustomerDeliveryReference`.
 *
 * Cases:
 *   1. Default address present with valid coords → returns pin.
 *   2. Default address present but coords absent (pre-PR-46) → falls
 *      through to live GPS.
 *   3. No default address → falls through to live GPS.
 *   4. No default address AND no live GPS → returns null.
 *   5. Profile null (loading / signed out) → live GPS used.
 *   6. Malformed pin (non-finite numbers) → falls through to live GPS.
 */
import { resolveCustomerDeliveryReference } from '../../src/utils/resolveCustomerDeliveryReference';
import type { GeoPoint, UserProfile } from '../../src/types';

// Minimal UserProfile factory — only the fields the helper reads.
function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'u1',
    phone: null,
    name: null,
    email: null,
    addresses: [],
    defaultAddressId: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

const HOME_PIN: GeoPoint = { lat: 12.9716, lng: 77.5946 };
const LIVE_GPS: GeoPoint = { lat: 13.0827, lng: 80.2707 };

describe('resolveCustomerDeliveryReference', () => {
  test('case 1: default address with valid coords → returns pin', () => {
    const profile = makeProfile({
      defaultAddressId: 'addr-1',
      addresses: [
        {
          id: 'addr-1',
          name: 'Home',
          phone: '9999999999',
          line1: '1 Main St',
          city: 'Bengaluru',
          pincode: '560001',
          createdAt: 0,
          updatedAt: 0,
          lat: HOME_PIN.lat,
          lng: HOME_PIN.lng,
        },
      ],
    });
    expect(resolveCustomerDeliveryReference(profile, LIVE_GPS)).toEqual(HOME_PIN);
  });

  test('case 2: default address present but no coords → falls through to live GPS', () => {
    const profile = makeProfile({
      defaultAddressId: 'addr-1',
      addresses: [
        {
          id: 'addr-1',
          name: 'Home',
          phone: '9999999999',
          line1: '1 Main St',
          city: 'Bengaluru',
          pincode: '560001',
          createdAt: 0,
          updatedAt: 0,
          // no lat/lng — pre-PR-46 address
        },
      ],
    });
    expect(resolveCustomerDeliveryReference(profile, LIVE_GPS)).toEqual(LIVE_GPS);
  });

  test('case 3: no default address → falls through to live GPS', () => {
    const profile = makeProfile({ defaultAddressId: null, addresses: [] });
    expect(resolveCustomerDeliveryReference(profile, LIVE_GPS)).toEqual(LIVE_GPS);
  });

  test('case 4: no default address AND no live GPS → null', () => {
    const profile = makeProfile({ defaultAddressId: null, addresses: [] });
    expect(resolveCustomerDeliveryReference(profile, null)).toBeNull();
  });

  test('case 5: profile null (loading / signed out) → live GPS used', () => {
    expect(resolveCustomerDeliveryReference(null, LIVE_GPS)).toEqual(LIVE_GPS);
  });

  test('case 6: malformed pin (NaN values) → falls through to live GPS', () => {
    const profile = makeProfile({
      defaultAddressId: 'addr-1',
      addresses: [
        {
          id: 'addr-1',
          name: 'Home',
          phone: '9999999999',
          line1: '1 Main St',
          city: 'Bengaluru',
          pincode: '560001',
          createdAt: 0,
          updatedAt: 0,
          lat: NaN,
          lng: NaN,
        },
      ],
    });
    expect(resolveCustomerDeliveryReference(profile, LIVE_GPS)).toEqual(LIVE_GPS);
  });
});
