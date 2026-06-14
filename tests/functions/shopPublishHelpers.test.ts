/**
 * PR-NEXT-BUNDLE-M §A/§H — tests for the pure publish-gate evaluator.
 *
 * Covers every gate branch from the §A spec list, including the
 * fail-closed defaults and the forcePublishOverride escape hatch.
 */
import {
  evaluateShopPublishStatus,
  type PublishGateInput,
} from '../../functions/src/shopPublishHelpers';

const VALID_LOCATION = { lat: 28.5, lng: 77.3 }; // Faridabad-ish
const NOW = 1_700_000_000_000;

function baseInput(overrides: Partial<PublishGateInput> = {}): PublishGateInput {
  return {
    shopStatus: 'active',
    menuItemCount: 5,
    hoursOpen: '09:00',
    hoursClose: '21:00',
    location: VALID_LOCATION,
    locationVerifiedAt: NOW,
    forcePublishOverride: false,
    minMenuItems: 5,
    ...overrides,
  };
}

describe('evaluateShopPublishStatus', () => {
  test('all gates passing → publishable, missing=[]', () => {
    const r = evaluateShopPublishStatus(baseInput());
    expect(r.isPublishable).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.signal).toBe('all_met');
  });

  test('forcePublishOverride:true with all gates failing → publishable', () => {
    const r = evaluateShopPublishStatus(
      baseInput({
        forcePublishOverride: true,
        shopStatus: 'pending',
        menuItemCount: 0,
        hoursOpen: null,
        hoursClose: null,
        location: null,
        locationVerifiedAt: null,
      }),
    );
    expect(r.isPublishable).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.signal).toBe('force_override');
  });

  test('below minimum menu → missing includes menu_items_below_minimum', () => {
    const r = evaluateShopPublishStatus(baseInput({ menuItemCount: 4 }));
    expect(r.isPublishable).toBe(false);
    expect(r.missing).toContain('menu_items_below_minimum');
  });

  test('status pending → missing includes shop_status_not_active', () => {
    const r = evaluateShopPublishStatus(baseInput({ shopStatus: 'pending' }));
    expect(r.missing).toContain('shop_status_not_active');
  });

  test('hours blank → missing includes hours_not_set', () => {
    const r = evaluateShopPublishStatus(
      baseInput({ hoursOpen: '', hoursClose: '21:00' }),
    );
    expect(r.missing).toContain('hours_not_set');
  });

  test('location null → missing includes location_not_verified', () => {
    const r = evaluateShopPublishStatus(baseInput({ location: null }));
    expect(r.missing).toContain('location_not_verified');
  });

  test('lat out of range → location_not_verified', () => {
    const r = evaluateShopPublishStatus(
      baseInput({ location: { lat: 95, lng: 77.3 } }),
    );
    expect(r.missing).toContain('location_not_verified');
  });

  test('swapped lat/lng (Faridabad 77.2/28.5, never verified) → location_not_verified', () => {
    // A quietly-swapped same-hemisphere pin lands both values in range,
    // so the coordinate check alone passes — the locationVerifiedAt
    // backstop (a swapped pin was never admin-verified) catches it.
    const r = evaluateShopPublishStatus(
      baseInput({ location: { lat: 77.2, lng: 28.5 }, locationVerifiedAt: null }),
    );
    expect(r.missing).toContain('location_not_verified');
  });

  test('locationVerifiedAt null → location_not_verified', () => {
    const r = evaluateShopPublishStatus(baseInput({ locationVerifiedAt: null }));
    expect(r.missing).toContain('location_not_verified');
  });

  test('all 4 failing simultaneously → missing has 4 entries', () => {
    const r = evaluateShopPublishStatus(
      baseInput({
        shopStatus: 'suspended',
        menuItemCount: 0,
        hoursOpen: null,
        hoursClose: null,
        location: null,
        locationVerifiedAt: null,
      }),
    );
    expect(r.isPublishable).toBe(false);
    expect(r.missing).toHaveLength(4);
    expect(new Set(r.missing)).toEqual(
      new Set([
        'shop_status_not_active',
        'menu_items_below_minimum',
        'hours_not_set',
        'location_not_verified',
      ]),
    );
    expect(r.signal).toBe('missing_requirements');
  });
});
