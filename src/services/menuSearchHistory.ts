import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * PR-NEXT-9 (finding #6) — AsyncStorage I/O for the recent-query
 * chip row that appears below the in-shop search bar.
 *
 * Keyspace: `search-history:menu:{role}:{shopId}` — explicit
 * `search-history:menu:` prefix so future search surfaces (e.g.
 * cross-shop search history, support ticket history) don't collide.
 * `role` ∈ `'customer' | 'shopkeeper'`. The two surfaces (customer
 * ShopDetailScreen + shopkeeper ShopMenuScreen) maintain independent
 * histories per shopId so a customer's "atta" search at Shop A
 * doesn't appear on the shopkeeper's chip row at Shop A — different
 * intents.
 *
 * All methods are best-effort: AsyncStorage failures return [] /
 * silently no-op. The chip row is a nicety, not a critical path; we
 * NEVER want a storage failure to break the search input itself.
 */

const MAX_ENTRIES = 5;

export type MenuSearchRole = 'customer' | 'shopkeeper';

function storageKey(role: MenuSearchRole, shopId: string): string {
  return `search-history:menu:${role}:${shopId}`;
}

export async function loadMenuSearchHistory(
  role: MenuSearchRole,
  shopId: string,
): Promise<string[]> {
  if (!shopId) return [];
  try {
    const raw = await AsyncStorage.getItem(storageKey(role, shopId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: cap on read in case a future version increased the
    // cap and then rolled back. Drop non-strings silently.
    return parsed
      .filter((s): s is string => typeof s === 'string')
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export async function saveMenuSearchHistory(
  role: MenuSearchRole,
  shopId: string,
  history: string[],
): Promise<void> {
  if (!shopId) return;
  try {
    await AsyncStorage.setItem(
      storageKey(role, shopId),
      JSON.stringify(history.slice(0, MAX_ENTRIES)),
    );
  } catch {
    // Best-effort. UI keeps the in-memory history regardless.
  }
}

export async function clearMenuSearchHistory(
  role: MenuSearchRole,
  shopId: string,
): Promise<void> {
  if (!shopId) return;
  try {
    await AsyncStorage.removeItem(storageKey(role, shopId));
  } catch {
    /* best-effort */
  }
}
