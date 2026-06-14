/**
 * PR-NEXT-BUNDLE-M §D/§H — tests for the publish-gate filter applied
 * inside `listShopsPublic`.
 *
 * The non-trivial logic is the pure `filterPublishableShops` helper
 * (exported from `functions/src/shopPublishHelpers.ts`); testing it
 * directly avoids booting firebase-admin / the emulator, matching the
 * existing `listShopsPublic.test.ts` posture.
 */
import { filterPublishableShops } from '../../functions/src/shopPublishHelpers';

type Row = { id: string; isPublishable?: boolean | null };

const shops: Row[] = [
  { id: 'live', isPublishable: true },
  { id: 'not-live', isPublishable: false },
  { id: 'unknown' }, // no field at all
];

describe('filterPublishableShops (listShopsPublic gate)', () => {
  test('shop with isPublishable=true is in result', () => {
    const out = filterPublishableShops(shops, false);
    expect(out.map(s => s.id)).toContain('live');
  });

  test('shop with isPublishable=false is NOT in result', () => {
    const out = filterPublishableShops(shops, false);
    expect(out.map(s => s.id)).not.toContain('not-live');
  });

  test('shop with isPublishable=undefined is NOT in result (fail-closed)', () => {
    const out = filterPublishableShops(shops, false);
    expect(out.map(s => s.id)).not.toContain('unknown');
    expect(out.map(s => s.id)).toEqual(['live']);
  });

  test('showUnpublishedShops=true → all shops returned regardless', () => {
    const out = filterPublishableShops(shops, true);
    expect(out.map(s => s.id)).toEqual(['live', 'not-live', 'unknown']);
  });

  test('a force-published shop reads isPublishable=true → in result', () => {
    // forcePublishOverride is denormalized into isPublishable:true by
    // the gate, so it passes the customer filter exactly like any other
    // publishable shop.
    const forced: Row[] = [{ id: 'forced', isPublishable: true }];
    const out = filterPublishableShops(forced, false);
    expect(out.map(s => s.id)).toEqual(['forced']);
  });

  test('does not mutate the input array', () => {
    const copy = JSON.parse(JSON.stringify(shops));
    filterPublishableShops(shops, true);
    expect(shops).toEqual(copy);
  });
});
