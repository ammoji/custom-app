// Stub for firebase/functions + @firebase/functions web SDK. Tests
// rarely hit the web path (most callers are Native plan-B); when
// they do, httpsCallable returns a function that resolves with
// whatever __setWebCallable injects.

type WebCallable = (data?: unknown) => Promise<{ data: unknown }>;

let factory: (name: string) => WebCallable = () => async () => ({ data: undefined });

export const __setWebCallable = (f: typeof factory) => {
  factory = f;
};
export const __reset = () => {
  factory = () => async () => ({ data: undefined });
};

export const httpsCallable = (_app: unknown, name: string) => factory(name);
export const getFunctions = () => ({});
