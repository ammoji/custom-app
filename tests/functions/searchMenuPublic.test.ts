/**
 * Unit tests for the `searchMenuPublic` callable's core filter/join
 * logic.
 *
 * The Firestore reads are I/O — we don't test those here (same
 * posture as listShopsPublic.test.ts which tests `rankShopsByDistance`
 * directly). The interesting behaviour is the post-query filtering:
 *
 *   - candidate-shop gate (defensive even after server filter)
 *   - available + stock gates (defense-in-depth vs server filter)
 *   - case-insensitive name/tag substring
 *   - exact category match
 *   - 50-result cap
 *   - shop-info join with distance passthrough
 *
 * `pickCandidateShopIds` is also pinned because the 30-cap relates
 * directly to Firestore's `in` query limit; an off-by-one regression
 * here would surface as silent under-search (not an error).
 */
import {
  CandidateShop,
  RawMenuItem,
  filterAndJoinSearchResults,
  pickCandidateShopIds,
} from '../../functions/src/searchMenuPublicHelpers';

const SHOP_A: CandidateShop = {
  id: 'shop_A',
  name: 'Sharma Kirana Store',
  address: '123 MG Road',
  status: 'active',
  location: { lat: 28.6, lng: 77.2 },
  distanceKm: 0.4,
};
const SHOP_B: CandidateShop = {
  id: 'shop_B',
  name: 'Verma Provisions',
  address: '99 Park Street',
  status: 'active',
};

const item = (
  overrides: Partial<RawMenuItem> & Pick<RawMenuItem, 'id' | 'shopId' | 'name'>,
): RawMenuItem => ({
  category: 'atta_rice_dal',
  available: true,
  stock: null,
  ...overrides,
} as RawMenuItem);

describe('filterAndJoinSearchResults', () => {
  test('no query, no category → returns all available items in candidate shops', () => {
    const r = filterAndJoinSearchResults({
      rawItems: [
        item({ id: 'm1', shopId: 'shop_A', name: 'Atta 5kg' }),
        item({ id: 'm2', shopId: 'shop_B', name: 'Toor Dal 1kg' }),
      ],
      candidateShops: [SHOP_A, SHOP_B],
    });
    expect(r.items).toHaveLength(2);
    expect(r.items.map(i => i.menuItem.id)).toEqual(['m1', 'm2']);
    // Shop info correctly joined on every result.
    expect(r.items[0].shop.name).toBe('Sharma Kirana Store');
    expect(r.items[0].shop.distanceKm).toBe(0.4);
    // SHOP_B has no distance; the join must NOT inject undefined.
    expect(r.items[1].shop).not.toHaveProperty('distanceKm');
  });

  test('query matches case-insensitively against name', () => {
    const r = filterAndJoinSearchResults({
      rawItems: [
        item({ id: 'm1', shopId: 'shop_A', name: 'Aashirvaad ATTA 5kg' }),
        item({ id: 'm2', shopId: 'shop_A', name: 'Toor Dal 1kg' }),
      ],
      candidateShops: [SHOP_A],
      query: 'aTTa',
    });
    expect(r.items.map(i => i.menuItem.id)).toEqual(['m1']);
  });

  test('query matches against tags too', () => {
    const r = filterAndJoinSearchResults({
      rawItems: [
        item({
          id: 'm1',
          shopId: 'shop_A',
          name: 'Best Brand Wheat Flour',
          tags: ['atta', 'wholewheat'],
        }),
      ],
      candidateShops: [SHOP_A],
      query: 'atta',
    });
    expect(r.items).toHaveLength(1);
  });

  test('category filter is exact-match (no substring)', () => {
    const r = filterAndJoinSearchResults({
      rawItems: [
        item({ id: 'm1', shopId: 'shop_A', name: 'Soap', category: 'personal_care' }),
        item({ id: 'm2', shopId: 'shop_A', name: 'Lotion', category: 'personal_care' }),
        item({ id: 'm3', shopId: 'shop_A', name: 'Brush', category: 'household' }),
      ],
      candidateShops: [SHOP_A],
      category: 'personal_care',
    });
    expect(r.items.map(i => i.menuItem.id)).toEqual(['m1', 'm2']);
    // "personal" must NOT match "personal_care" — strict equality.
    const r2 = filterAndJoinSearchResults({
      rawItems: [
        item({ id: 'm1', shopId: 'shop_A', name: 'Soap', category: 'personal_care' }),
      ],
      candidateShops: [SHOP_A],
      category: 'personal',
    });
    expect(r2.items).toHaveLength(0);
  });

  test('excludes available === false', () => {
    const r = filterAndJoinSearchResults({
      rawItems: [
        item({ id: 'm1', shopId: 'shop_A', name: 'Atta 5kg', available: false }),
        item({ id: 'm2', shopId: 'shop_A', name: 'Atta 10kg', available: true }),
      ],
      candidateShops: [SHOP_A],
    });
    expect(r.items.map(i => i.menuItem.id)).toEqual(['m2']);
  });

  test('excludes stock === 0; allows null and positive', () => {
    const r = filterAndJoinSearchResults({
      rawItems: [
        item({ id: 'zero', shopId: 'shop_A', name: 'Out', stock: 0 }),
        item({ id: 'untracked', shopId: 'shop_A', name: 'Untracked', stock: null }),
        item({ id: 'inStock', shopId: 'shop_A', name: 'Some', stock: 7 }),
      ],
      candidateShops: [SHOP_A],
    });
    expect(r.items.map(i => i.menuItem.id)).toEqual(['untracked', 'inStock']);
  });

  test('excludes items from non-active shops even if collection-group query returned them', () => {
    // Defensive: between the candidate query and the menu query a
    // shop could transition to `suspended`. The server-side filter
    // is `where shopId in [...active candidates]`, which already
    // excludes that shop, but if a future refactor weakens that
    // filter the helper STILL drops the item.
    const suspended: CandidateShop = {
      ...SHOP_B,
      id: 'shop_C',
      status: 'suspended',
    };
    const r = filterAndJoinSearchResults({
      rawItems: [
        item({ id: 'm1', shopId: 'shop_A', name: 'A' }),
        item({ id: 'm2', shopId: 'shop_C', name: 'B' }),
      ],
      candidateShops: [SHOP_A, suspended],
    });
    expect(r.items.map(i => i.menuItem.id)).toEqual(['m1']);
  });

  test('caps at 50 results', () => {
    const many: RawMenuItem[] = [];
    for (let i = 0; i < 75; i++) {
      many.push(item({ id: `m${i}`, shopId: 'shop_A', name: `Item ${i}` }));
    }
    const r = filterAndJoinSearchResults({
      rawItems: many,
      candidateShops: [SHOP_A],
    });
    expect(r.items).toHaveLength(50);
    // Order preserved (first 50 by input order).
    expect(r.items[0].menuItem.id).toBe('m0');
    expect(r.items[49].menuItem.id).toBe('m49');
  });

  test('whitespace-only query and category are treated as no-filter', () => {
    const r = filterAndJoinSearchResults({
      rawItems: [
        item({ id: 'm1', shopId: 'shop_A', name: 'Atta' }),
      ],
      candidateShops: [SHOP_A],
      query: '   ',
      category: '   ',
    });
    expect(r.items).toHaveLength(1);
  });
});

describe('pickCandidateShopIds', () => {
  test('caps at 30 (Firestore `in` query limit)', () => {
    const shops: CandidateShop[] = [];
    for (let i = 0; i < 50; i++) {
      shops.push({ id: `s${i}`, name: `s${i}`, address: '', status: 'active' });
    }
    expect(pickCandidateShopIds(shops)).toHaveLength(30);
  });

  test('drops explicit non-active shops', () => {
    const shops: CandidateShop[] = [
      { id: 's1', name: 's1', address: '', status: 'active' },
      { id: 's2', name: 's2', address: '', status: 'pending' },
      { id: 's3', name: 's3', address: '', status: 'suspended' },
      { id: 's4', name: 's4', address: '', status: 'active' },
    ];
    expect(pickCandidateShopIds(shops)).toEqual(['s1', 's4']);
  });

  test('preserves input order (caller controls ranking)', () => {
    const shops: CandidateShop[] = [
      { id: 'far', name: '', address: '', status: 'active' },
      { id: 'near', name: '', address: '', status: 'active' },
    ];
    expect(pickCandidateShopIds(shops)).toEqual(['far', 'near']);
  });

  test('legacy no-status shops are kept (treated as active)', () => {
    const shops: CandidateShop[] = [
      { id: 'legacy', name: '', address: '' /* no status */ },
      { id: 's2', name: '', address: '', status: 'active' },
    ];
    expect(pickCandidateShopIds(shops)).toEqual(['legacy', 's2']);
  });
});
