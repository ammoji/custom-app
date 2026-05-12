import { useEffect, useState } from 'react';
import { useCartStore } from './useCartStore';
import { useOrderStore } from './useOrderStore';

function useHydrated(store: { persist: { hasHydrated: () => boolean; onFinishHydration: (fn: () => void) => () => void } }): boolean {
  const [hydrated, setHydrated] = useState(() => store.persist.hasHydrated());
  useEffect(() => {
    const unsub = store.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(store.persist.hasHydrated());
    return () => unsub();
  }, [store]);
  return hydrated;
}

export const useOrderStoreHydrated = () => useHydrated(useOrderStore as any);
export const useCartStoreHydrated = () => useHydrated(useCartStore as any);
