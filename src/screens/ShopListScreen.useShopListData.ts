import { useCallback, useEffect, useState } from 'react';
import { shopService } from '../services/shopService';
import type { GeoPoint, Shop } from '../types';

/**
 * State machine for ShopListScreen's load flow. Extracted from the
 * screen so the (loader-stuck-forever) regression class can be unit
 * tested without React Native rendering.
 *
 * Contract:
 *   - On mount with `location == null`, loading flips to false
 *     immediately. AuthBootstrap always falls back to MOCK_USER_LOCATION
 *     so this branch should be transient anyway, but if it isn't, we
 *     refuse to sit on the spinner.
 *   - On mount with a location, the load promise is awaited inside
 *     try/finally. `loading` is reset in `finally`, so a thrown
 *     promise can never leave the loader spinning.
 *   - Errors set `error` to a human-readable string; `shops` is
 *     cleared so stale data doesn't render alongside the error.
 *   - `reload()` re-runs the load with the same finally guarantee.
 *
 * The hook accepts an optional `loader` so tests can swap shopService
 * for a stub. Production callers omit it.
 */
export type ShopListData = {
  shops: Shop[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

export type ShopLoader = (location: GeoPoint) => Promise<Shop[]>;

const defaultLoader: ShopLoader = location =>
  shopService.getNearbyShops(location);

export async function loadShopListOnce(
  location: GeoPoint,
  loader: ShopLoader = defaultLoader,
): Promise<{ shops: Shop[]; error: string | null }> {
  try {
    const shops = await loader(location);
    return { shops, error: null };
  } catch (e: any) {
    console.warn('[ShopList] load failed:', e);
    return {
      shops: [],
      error: e?.message || 'Could not load shops. Pull to refresh.',
    };
  }
}

export function useShopListData(
  location: GeoPoint | null,
  loader: ShopLoader = defaultLoader,
): ShopListData {
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!location) return;
    setRefreshing(true);
    try {
      const { shops: next, error: err } = await loadShopListOnce(
        location,
        loader,
      );
      setShops(next);
      setError(err);
    } finally {
      setRefreshing(false);
    }
  }, [location, loader]);

  useEffect(() => {
    if (!location) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { shops: next, error: err } = await loadShopListOnce(
          location,
          loader,
        );
        if (!cancelled) {
          setShops(next);
          setError(err);
        }
      } finally {
        // Guaranteed reset — the whole point of the hotfix.
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location, loader]);

  return { shops, loading, refreshing, error, reload };
}
