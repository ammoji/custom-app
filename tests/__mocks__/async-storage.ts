// Minimal in-memory @react-native-async-storage/async-storage mock for
// unit tests. The cart store's persist middleware writes/reads through
// this; tests can pre-seed state via __setStorageValue() to simulate a
// pre-migration cart-v1 entry.
//
// State on globalThis so jest.isolateModules() doesn't lose it across
// the test↔SUT module-registry boundary (same pattern as rnfb-app.ts
// and react-native.ts).

const KEY = '__test_async_storage__';

function store(): Map<string, string> {
  if (!(globalThis as any)[KEY]) {
    (globalThis as any)[KEY] = new Map<string, string>();
  }
  return (globalThis as any)[KEY];
}

export const __setStorageValue = (key: string, value: string) => {
  store().set(key, value);
};
export const __resetStorage = () => {
  store().clear();
};

const AsyncStorage = {
  getItem: async (key: string) => store().get(key) ?? null,
  setItem: async (key: string, value: string) => {
    store().set(key, value);
  },
  removeItem: async (key: string) => {
    store().delete(key);
  },
  clear: async () => {
    store().clear();
  },
  getAllKeys: async () => Array.from(store().keys()),
  multiGet: async (keys: string[]) =>
    keys.map(k => [k, store().get(k) ?? null] as [string, string | null]),
  multiSet: async (kvs: [string, string][]) => {
    for (const [k, v] of kvs) store().set(k, v);
  },
  multiRemove: async (keys: string[]) => {
    for (const k of keys) store().delete(k);
  },
};

export default AsyncStorage;
