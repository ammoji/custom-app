/**
 * PR 4 — searchMenuPublic core (Phase A).
 *
 * Pure helpers for the customer-facing search/category browse path.
 * Extracted so the filter/join logic can be unit-tested without
 * spinning up firebase-admin or the emulator — same posture as
 * `rankShopsByDistance` in index.ts.
 *
 * The callable wrapper in index.ts is responsible for:
 *   - Reading active shops (with optional location-based 1km filter)
 *   - Issuing the collection-group query on `menu`
 *
 * Everything else (substring match, category filter, stock filter,
 * shop-active gate, 50-cap, shop-info join) lives here so it's
 * unit-testable.
 */

export type LatLng = { lat: number; lng: number };

export type CandidateShop = {
  id: string;
  name: string;
  address: string;
  status?: string;
  location?: LatLng;
  distanceKm?: number;
};

export type RawMenuItem = {
  id: string;
  shopId: string;
  name: string;
  category: string;
  available: boolean;
  stock: number | null;
  tags?: string[];
} & Record<string, unknown>;

export type SearchResultItem = {
  menuItem: RawMenuItem;
  shop: {
    id: string;
    name: string;
    address: string;
    distanceKm?: number;
  };
};

const RESULT_CAP = 50;

/**
 * Caller passes the candidate shop set (already filtered to
 * status=='active' and optionally distance-ranked) and the raw
 * collection-group menu rows. Returns the post-filter, post-join,
 * post-cap results.
 *
 * Filter rules (all AND-combined):
 *   1. Item's shopId must be in the active candidate shop set.
 *      Defensive: even if the collection-group query somehow
 *      returns a row from a non-active shop (e.g. the shop
 *      transitioned to suspended after the candidate query but
 *      before the menu query), we drop it.
 *   2. `available === true`. Server query already filters this; the
 *      check is repeated here so the helper is self-contained for
 *      testing and resilient to an upstream regression.
 *   3. `stock !== 0`. Out-of-stock items shouldn't surface in
 *      search results — same posture as listShopMenuPublic.
 *      `stock === null` (not tracked) is treated as in-stock.
 *   4. If `query` is set: case-insensitive substring match on
 *      `name` OR any tag in `tags`. Empty/whitespace query == no
 *      filter.
 *   5. If `category` is set: exact match on `category` (these are
 *      stable enum IDs — `===`, not `includes`).
 *
 * Cap at 50 to keep payloads small. Server returns insertion order
 * from the collection-group query; the client decides display sort.
 */
export function filterAndJoinSearchResults(input: {
  rawItems: RawMenuItem[];
  candidateShops: CandidateShop[];
  query?: string;
  category?: string;
}): { items: SearchResultItem[] } {
  const { rawItems, candidateShops, query, category } = input;

  // Build shopId → shop-info map once. O(N) candidate, O(M) items,
  // O(1) per-item lookup. Drop non-active candidates here so the
  // map itself enforces the gate.
  const shopMap = new Map<string, CandidateShop>();
  for (const s of candidateShops) {
    if (s.status === 'active' || s.status === undefined) {
      // Legacy shops without a `status` field default to active —
      // same posture as listShopsPublic / listShopMenuPublic.
      shopMap.set(s.id, s);
    }
  }

  const trimmedQuery = (query ?? '').trim().toLowerCase();
  const trimmedCategory = (category ?? '').trim();

  const matches: SearchResultItem[] = [];
  for (const item of rawItems) {
    if (!shopMap.has(item.shopId)) continue;
    if (item.available !== true) continue;
    if (item.stock === 0) continue;

    if (trimmedQuery.length > 0) {
      const nameHit = (item.name ?? '').toLowerCase().includes(trimmedQuery);
      const tagHit = Array.isArray(item.tags)
        ? item.tags.some(t => typeof t === 'string'
            && t.toLowerCase().includes(trimmedQuery))
        : false;
      if (!nameHit && !tagHit) continue;
    }

    if (trimmedCategory.length > 0) {
      // Strict equality: category IDs are stable enums (CategoryId
      // union in src/constants/categories.ts). Substring match here
      // would surface unexpected cross-category results — e.g. a
      // free-text "personal" filter would also match
      // "personal_care".
      if (item.category !== trimmedCategory) continue;
    }

    const shop = shopMap.get(item.shopId)!;
    matches.push({
      menuItem: item,
      shop: {
        id: shop.id,
        name: shop.name,
        address: shop.address,
        ...(typeof shop.distanceKm === 'number'
          ? { distanceKm: shop.distanceKm }
          : {}),
      },
    });

    if (matches.length >= RESULT_CAP) break;
  }

  return { items: matches };
}

/**
 * Cap candidate shop set at 30 IDs (Firestore `in` query limit).
 * Already-ranked-by-distance input means the closest 30 win when
 * the user has location; otherwise alphabetical / insertion order.
 *
 * Filters out non-active shops up-front so callers don't have to.
 */
export function pickCandidateShopIds(
  shops: CandidateShop[],
  cap = 30,
): string[] {
  const out: string[] = [];
  for (const s of shops) {
    if (s.status !== undefined && s.status !== 'active') continue;
    out.push(s.id);
    if (out.length >= cap) break;
  }
  return out;
}
