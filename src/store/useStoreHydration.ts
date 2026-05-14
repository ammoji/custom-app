import { useEffect, useState } from 'react';
import { useCartStore } from './useCartStore';

function useHydrated(store: { persist: { hasHydrated: () => boolean; onFinishHydration: (fn: () => void) => () => void } }): boolean {
  const [hydrated, setHydrated] = useState(() => store.persist.hasHydrated());
  useEffect(() => {
    const unsub = store.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(store.persist.hasHydrated());
    return () => unsub();
  }, [store]);
  return hydrated;
}

export const useCartStoreHydrated = () => useHydrated(useCartStore as any);
