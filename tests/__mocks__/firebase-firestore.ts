// Stub for firebase/firestore (Web SDK). Tests inject behaviour via
// __setGetDocs / __setGetDoc / __setOnSnapshot, then assert which
// path was taken.

// Same globalThis trick as rnfb-app.ts — survive jest.isolateModules.
type Snap = {
  docs: { data: () => any; id: string }[];
  exists: () => boolean;
  data: () => any;
};

const emptySnap = (): Snap => ({
  docs: [],
  exists: () => false,
  data: () => undefined,
});

const G = globalThis as any;

const getGetDocs = (): ((q: unknown) => Promise<Snap>) =>
  G.__fs_getDocs || (async () => emptySnap());
const getGetDoc = (): ((r: unknown) => Promise<Snap>) =>
  G.__fs_getDoc || (async () => emptySnap());
const getOnSnapshot = (): ((
  q: unknown,
  next: (s: Snap) => void,
  err?: (e: Error) => void,
) => () => void) => G.__fs_onSnapshot || (() => () => {});

export const __setGetDocs = (f: (q: unknown) => Promise<Snap>) => {
  G.__fs_getDocs = f;
};
export const __setGetDoc = (f: (r: unknown) => Promise<Snap>) => {
  G.__fs_getDoc = f;
};
export const __setOnSnapshot = (
  f: (q: unknown, n: (s: Snap) => void, err?: (e: Error) => void) => () => void,
) => {
  G.__fs_onSnapshot = f;
};
export const __reset = () => {
  delete G.__fs_getDocs;
  delete G.__fs_getDoc;
  delete G.__fs_onSnapshot;
};

export const collection = (..._a: any[]) => ({ __collection: _a });
export const doc = (..._a: any[]) => ({ __doc: _a });
export const query = (..._a: any[]) => ({ __query: _a });
export const where = (..._a: any[]) => ({ __where: _a });
export const orderBy = (..._a: any[]) => ({ __orderBy: _a });
export const limit = (..._a: any[]) => ({ __limit: _a });

export const getDocs = (q: unknown) => getGetDocs()(q);
export const getDoc = (r: unknown) => getGetDoc()(r);
export const onSnapshot = (
  q: unknown,
  next: (snap: Snap) => void,
  err?: (e: Error) => void,
) => getOnSnapshot()(q, next, err);

export class Timestamp {
  constructor(public seconds: number, public nanoseconds: number) {}
  toMillis() {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }
}
