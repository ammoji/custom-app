/**
 * PR 38 — pure tests for adminUsageHelpers.
 *
 * Mirrors `tests/functions/menuExtractionHelpers.test.ts` shape.
 * No React, no Firestore — every helper is a data → data
 * transform so the dashboard's aggregation logic is fully
 * unit-testable. Coverage pins:
 *   - `topFeatures` sort descending + tie-break alphabetical
 *   - `topFeatures` respects the `limit` param
 *   - `topFeatures` handles empty input
 *   - `topFeatures` keeps `pct` against the FULL event list
 *     even when truncated by limit
 *   - `byRole` drops zero-count roles + sorts by count desc
 *   - `uniqueUsers` deduplicates by uid; falsy uids dropped
 *   - `uniqueShops` excludes events without a shopId
 *   - `filterAfter` is the date-cutoff belt-and-braces filter
 *   - Defensive: legacy/missing fields don't crash the aggregator
 */
import {
  byRole,
  filterAfter,
  topFeatures,
  uniqueShops,
  uniqueUsers,
  type FeatureUsageEvent,
} from '../../../src/screens/admin/adminUsageHelpers';

function ev(p: Partial<FeatureUsageEvent>): FeatureUsageEvent {
  return {
    uid: 'uid-x',
    role: 'customer',
    feature: 'view_shop_list',
    date: '2026-05-24',
    ...p,
  };
}

describe('PR 38 — adminUsageHelpers', () => {
  test('topFeatures returns features sorted by count descending, alphabetical tie-break', () => {
    const events: FeatureUsageEvent[] = [
      ev({ feature: 'add_to_cart' }),
      ev({ feature: 'add_to_cart' }),
      ev({ feature: 'view_shop_list' }),
      ev({ feature: 'view_shop_list' }),
      ev({ feature: 'view_shop_list' }),
      ev({ feature: 'place_order' }),
    ];
    const r = topFeatures(events);
    expect(r.map(x => x.feature)).toEqual([
      'view_shop_list', // 3
      'add_to_cart', // 2
      'place_order', // 1
    ]);
    expect(r[0].count).toBe(3);
    expect(r[0].pct).toBe(50);
  });

  test('topFeatures respects the limit param (defaults to 20, accepts Infinity)', () => {
    // 25 distinct features, one event each → default limit 20 truncates.
    const events: FeatureUsageEvent[] = [];
    for (let i = 0; i < 25; i++) {
      events.push(ev({ feature: `feat_${String(i).padStart(2, '0')}` }));
    }
    expect(topFeatures(events).length).toBe(20);
    expect(topFeatures(events, 5).length).toBe(5);
    // Infinity → return all.
    expect(topFeatures(events, Infinity).length).toBe(25);
  });

  test('topFeatures returns [] for empty input', () => {
    expect(topFeatures([])).toEqual([]);
    // Also handles limit=0 sanely.
    expect(topFeatures([ev({})], 0)).toEqual([]);
  });

  test('topFeatures pct is share of full event list, not truncated top-N', () => {
    // 100 events: 10 unique features, 10 each. limit=3 → returned
    // rows must show pct=10 (not 33.33 which would be share of top-3).
    const events: FeatureUsageEvent[] = [];
    for (let f = 0; f < 10; f++) {
      for (let i = 0; i < 10; i++) {
        events.push(ev({ feature: `feat_${f}` }));
      }
    }
    const r = topFeatures(events, 3);
    expect(r.length).toBe(3);
    expect(r[0].pct).toBe(10);
  });

  test('byRole drops zero-count roles and sorts by count descending', () => {
    const events: FeatureUsageEvent[] = [
      ev({ role: 'customer' }),
      ev({ role: 'customer' }),
      ev({ role: 'customer' }),
      ev({ role: 'admin' }),
      ev({ role: 'shop_owner' }),
      ev({ role: 'shop_owner' }),
    ];
    const r = byRole(events);
    // 'delivery' + 'anonymous' have zero count → must be omitted.
    expect(r.map(x => x.role)).toEqual(['customer', 'shop_owner', 'admin']);
    expect(r.find(x => x.role === 'delivery')).toBeUndefined();
    expect(r.find(x => x.role === 'anonymous')).toBeUndefined();
  });

  test('byRole silently drops unknown role values (defensive against schema drift)', () => {
    const events: FeatureUsageEvent[] = [
      ev({ role: 'customer' }),
      // Forge a future-schema role the current code doesn't know about.
      // Cast-as-any so the test compiles; the helper must defend at runtime.
      ev({ role: 'super_user' as unknown as FeatureUsageEvent['role'] }),
    ];
    const r = byRole(events);
    expect(r.length).toBe(1);
    expect(r[0].role).toBe('customer');
  });

  test('uniqueUsers deduplicates by uid + drops falsy uids', () => {
    const events: FeatureUsageEvent[] = [
      ev({ uid: 'alice' }),
      ev({ uid: 'alice' }),
      ev({ uid: 'bob' }),
      ev({ uid: '' }), // falsy uid — must not count
      ev({ uid: undefined as unknown as string }), // missing uid
    ];
    expect(uniqueUsers(events)).toBe(2);
  });

  test('uniqueShops excludes events without a shopId', () => {
    const events: FeatureUsageEvent[] = [
      ev({ shopId: 'shop_a' }),
      ev({ shopId: 'shop_a' }),
      ev({ shopId: 'shop_b' }),
      ev({}), // no shopId → excluded
      ev({ shopId: '' }), // empty shopId → excluded
    ];
    expect(uniqueShops(events)).toBe(2);
  });

  test('filterAfter keeps only events with date >= cutoff (defensive against cached / unfiltered arrays)', () => {
    const events: FeatureUsageEvent[] = [
      ev({ date: '2026-05-01' }), // before
      ev({ date: '2026-05-17' }), // boundary
      ev({ date: '2026-05-24' }), // after
    ];
    const r = filterAfter(events, '2026-05-17');
    expect(r.length).toBe(2);
    expect(r.map(e => e.date)).toEqual(['2026-05-17', '2026-05-24']);
  });

  test('defensive: missing/legacy `feature` field gets bucketed as __unknown__', () => {
    const events: FeatureUsageEvent[] = [
      ev({ feature: 'view_shop_list' }),
      // forge a schema-drift event missing `feature`
      ev({ feature: undefined as unknown as string }),
      ev({ feature: '' }),
    ];
    const r = topFeatures(events);
    expect(r.find(x => x.feature === '__unknown__')?.count).toBe(2);
    expect(r.find(x => x.feature === 'view_shop_list')?.count).toBe(1);
  });
});
