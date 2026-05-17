// Stub for firebase/functions + @firebase/functions web SDK. Tests
// rarely hit the web path (most callers are Native plan-B); when
// they do, httpsCallable returns a function that resolves with
// whatever __setWebCallable injects.
//
// State is held on globalThis so it survives jest.isolateModules() —
// the SUT (orderService etc.) loads a fresh copy of THIS module
// inside the isolated registry, but reads/writes flow through the
// same global slot the test wrote to. Same pattern as rnfb-app.ts
// and react-native.ts.

type WebCallable = (data?: unknown) => Promise<{ data: unknown }>;
type Factory = (name: string) => WebCallable;

const KEY = '__web_callable_factory__';

const getFactory = (): Factory =>
  (globalThis as any)[KEY] || (() => async () => ({ data: undefined }));

export const __setWebCallable = (f: Factory) => {
  (globalThis as any)[KEY] = f;
};
export const __reset = () => {
  (globalThis as any)[KEY] = () => async () => ({ data: undefined });
};

export const httpsCallable = (_app: unknown, name: string) =>
  getFactory()(name);
export const getFunctions = () => ({});
