// Stub for src/services/firebase. The real module pulls in the
// firebase web SDK + AsyncStorage and reads env vars — too heavy
// for unit tests. We expose only the symbols imported by the
// services-under-test.
export const app = {} as any;
export const auth = {} as any;
export const db = {} as any;
export const storage = {} as any;
export const functions = {} as any;
export const analytics = null;
export const perf = null;
