/**
 * PR-NEXT-BUNDLE-D §F — tests for validateDeliveryProfilePatch.
 *
 * 5 cases: success-all-fields, success-partial, no-op-empty,
 * invalid-vehicle, invalid-photo-type.
 */
import { describe, expect, it } from '@jest/globals';
import { validateDeliveryProfilePatch } from '../../functions/src/deliveryProfileHelpers';

describe('validateDeliveryProfilePatch', () => {
  it('success — all fields, trims + caps displayName', () => {
    const r = validateDeliveryProfilePatch({
      displayName: '  Rahul Bhat  ',
      vehicleType: 'bicycle',
      profilePhotoUrl: 'https://x/p.jpg',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch).toEqual({
        displayName: 'Rahul Bhat',
        vehicleType: 'bicycle',
        profilePhotoUrl: 'https://x/p.jpg',
      });
    }
  });

  it('success — partial (vehicle only)', () => {
    const r = validateDeliveryProfilePatch({ vehicleType: 'car' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch).toEqual({ vehicleType: 'car' });
  });

  it('no-op — empty input yields empty patch', () => {
    const r = validateDeliveryProfilePatch({});
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.patch)).toHaveLength(0);
  });

  it('rejects invalid vehicleType', () => {
    const r = validateDeliveryProfilePatch({ vehicleType: 'rocket' as any });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/vehicleType/i);
  });

  it('rejects non-string profilePhotoUrl', () => {
    const r = validateDeliveryProfilePatch({ profilePhotoUrl: 123 as any });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/profilePhotoUrl/i);
  });
});
