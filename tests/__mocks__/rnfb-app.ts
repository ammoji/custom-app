// Test-controllable stub for @react-native-firebase/app.
// State lives on globalThis so it survives jest.isolateModules() —
// when the SUT (orderService / shopService) is loaded inside an
// isolated module registry, IT gets a fresh copy of THIS module too,
// which would lose any local state. Reading from globalThis means
// both the test file's copy and the isolated SUT's copy see the
// same factory.

type CallableFactory = (
  name: string,
) => (data?: unknown) => Promise<{ data: unknown }>;

const KEY = '__rnfb_app_factory__';

const getFactory = (): CallableFactory =>
  (globalThis as any)[KEY] || (() => async () => ({ data: undefined }));

export const __setHttpsCallable = (f: CallableFactory) => {
  (globalThis as any)[KEY] = f;
};
export const __resetHttpsCallable = () => {
  (globalThis as any)[KEY] = () => async () => ({ data: undefined });
};

export const firebase = {
  app: () => ({
    functions: (_region: string) => ({
      httpsCallable: (name: string) => getFactory()(name),
    }),
  }),
};
