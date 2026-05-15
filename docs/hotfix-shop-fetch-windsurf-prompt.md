# Hotfix — spinning-bug class sweep + Plan B for shopService + tests

## Why this PR exists (read first — context matters)

Two bugs surfaced in solo testing today, both with the same symptom
("Loader spins forever, no error shown"):

1. **`ShopListScreen`** — `shopService.getNearbyShops` uses the
   Firebase Web SDK (`getDocs(collection(db, 'shops'))`), which
   doesn't work on React Native in this project. Call hangs/throws
   on native; screen has no try/catch; loader sticks forever.

2. **`ShopOwnerDashboardScreen`** — `orderService.watchShopOrders`
   catches errors with `console.warn` and never invokes the callback.
   Screen flips `loading = false` only inside the callback. So any
   poll failure → callback never fires → loader sticks forever.

Both are instances of the same bug class:

> **Service-level errors are silently swallowed; screens have no way
> to know "the load failed" and so the loading state is never reset.**

Sudhir explicitly chose the long-term fix path here, not patches. So
this PR sweeps the entire bug class across all customer + admin +
delivery + shop-owner watchers and screens, plus the shopService Plan
B fix, plus tests so this regression class can never silently return.

This PR is bigger than the average hotfix. That's the right call —
finishing it once now is cheaper than re-fixing it across 5 future
manual-testing sessions.

## New project standard: tests with every PR

Sudhir requested that **every PR going forward includes automated
tests for what it changes/fixes.** This applies to all subsequent
work, not just this PR. Establish the pattern here. Future Windsurf
prompts will reference this requirement; PRs without tests for new
behaviour will be rejected.

For this PR specifically: tests are listed in §6 below as part of
the spec, not as an optional add-on.

## Read first

- `functions/src/index.ts` (`listShopMenuPublic` — pattern to match)
- `src/services/orderService.ts` (Plan B dispatch + watch* polling
  patterns)
- `src/services/shopService.ts` (file under fix)
- `src/screens/ShopListScreen.tsx` (broken loader screen #1)
- `src/screens/shop/ShopOwnerDashboardScreen.tsx` (broken loader
  screen #2)
- `src/services/firebase.ts` (web vs RNFB split)
- `tests/jest.config.js` and `tests/helpers.ts` (existing rules-test
  infra — extend, don't fork)
- `.windsurf/deploy-discipline.md`

## Scope (in)

### A. Service layer

1. **New Cloud Function: `listShopsPublic`** in `functions/src/index.ts`.
2. **`shopService` → Plan B dispatch** for `getNearbyShops` and
   `getById` (Platform.OS pattern; web stays on web SDK, native goes
   through callables).
3. **All polling watchers in `orderService` → guaranteed-callback
   contract.** Refactor the callback signature so the screen always
   knows whether the call succeeded:

   ```ts
   type WatchCallback<T> = (data: T, error?: Error) => void;
   ```

   Every `watch*` method must call `cb(data, undefined)` on success
   and `cb(emptyValue, error)` on failure. Never silently swallow.
   Apply to: `watchShopOrders`, `watchAllOrders`, `watchOrder`,
   `watchAvailableDeliveries`, `watchMyDeliveries`, and any other
   watcher discovered during the audit (§D).

### B. Screen layer

4. **`ShopListScreen`** — wrap load in try/catch; guarantee
   `setLoading(false)` via `finally`; render error state with retry.
5. **`ShopOwnerDashboardScreen`** — adopt new watcher signature;
   set loading false on first callback regardless of error; render
   error state with retry.
6. **All other screens consuming the refactored watch* methods** —
   update to the new signature, set loading false on first callback,
   render error state. Specifically (verify with grep):
   - `AdminOrdersScreen` (watchAllOrders)
   - `OrderDetailScreen` (watchOrder)
   - `DeliveryDashboardScreen` (watchAvailableDeliveries,
     watchMyDeliveries)
   - Any others discovered during §D audit.

### C. Generic loading-state pattern

7. **Audit every screen in `src/screens/`** for the
   loader-stuck-forever pattern:
   - `useState(true)` for loading state
   - useEffect that may bail early or rely on a callback that may
     not fire
   - No `finally` block guaranteeing loading reset

   For each screen found, fix it OR log to PRELAUNCH_CHECKLIST as a
   tracked follow-up. Don't try to refactor every one in this PR —
   the rule is "no screen reachable from the customer/owner/delivery
   happy path can spin forever". Admin-only obscure screens can be
   logged.

### D. Service-layer audit

8. **Audit `src/services/*.ts`** for the same web-SDK-on-native
   pattern from the earlier prompt. Hits include `getDoc(`,
   `getDocs(`, `collection(db,`, `doc(db,`, `query(db,`,
   `onSnapshot(`, `addDoc(`, `setDoc(`, `updateDoc(`, `deleteDoc(`.
   For each: file:line, function, reachable-on-native?, status
   (already Plan B / fix here / log to checklist).

### E. Tests (mandatory)

9. **Cloud Function tests** — extend the existing jest infra in
   `tests/` to cover Cloud Functions. New file:
   `tests/functions/listShopsPublic.test.ts`. Cover happy path
   with location (sorted by distance), without location (unsorted),
   filters out non-active shops, filters out legacy no-status shops.
10. **shopService Plan B dispatch tests** — `tests/services/shopService.test.ts`.
    Mock `Platform.OS = 'ios'` and verify the callable path is
    taken; mock `Platform.OS = 'web'` and verify the web-SDK path
    is taken. Mock callable to return / throw and verify error
    propagation.
11. **Watcher contract tests** — `tests/services/orderService.watchers.test.ts`.
    For each refactored watch* method, prove it calls `cb(data, undefined)`
    on success and `cb([], error)` on failure. Mock the underlying
    callable, advance fake timers, assert callback invocations.
12. **Screen logic tests** — extract the load-and-error state
    handling from `ShopListScreen` and `ShopOwnerDashboardScreen`
    into testable hooks (`useShopListData`, `useShopOwnerOrders`)
    and unit-test the hooks directly. **Do not** add full React
    Native rendering tests in this PR — RNTL setup is its own PR.

### F. Deploy + OTA + checklist

13. Deploy `listShopsPublic` per deploy discipline.
14. Push OTA on `preview` branch.
15. Update `PRELAUNCH_CHECKLIST.md`:
    - Hotfix entry (sweep description, files touched)
    - §C audit findings (screens fixed vs logged)
    - §D audit findings (services fixed vs logged)
    - New "Testing standard" section confirming tests-with-every-PR

## Scope (out — explicitly defer)

- React Native Testing Library / full screen-render tests (separate
  PR; setup cost is significant; hook-level tests cover the bug
  class for now)
- Caching layer ("while you're in there")
- Removing the web SDK from `services/firebase.ts` (web depends on
  it; deferred to dep-upgrade PR)
- Replacing the polling pattern with snapshot listeners on native
  (out of scope; the polling is the established Plan B)
- "Improving" orderService's existing Plan B for non-watcher methods
  (works; leave it)
- Any screens that aren't reachable from a tested role flow

## Implementation spec

### A.1 — `listShopsPublic` Cloud Function

```ts
type LatLng = { lat: number; lng: number };

function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const listShopsPublic = onCall(
  { region: 'asia-south1', cors: true },
  async (req) => {
    const userLocation = req.data?.userLocation as LatLng | undefined;
    const snap = await db
      .collection('shops')
      .where('status', '==', 'active')
      .get();
    const shops = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
    if (
      userLocation &&
      typeof userLocation.lat === 'number' &&
      typeof userLocation.lng === 'number'
    ) {
      for (const s of shops) {
        if (s.location?.lat != null && s.location?.lng != null) {
          s.distanceKm = haversineKm(userLocation, s.location);
        }
      }
      shops.sort(
        (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
      );
    }
    return { shops };
  },
);
```

### A.2 — shopService Plan B

Match orderService dispatch pattern. `getNearbyShops` calls
`listShopsPublic` on native; `getById` reuses `listShopMenuPublic`
on native (returns `{ shop, items }`; we only use `shop`). Web stays
on web SDK.

### A.3 — Watcher contract refactor

New shape for every `watch*` method:

```ts
watchShopOrders(
  shopId: string,
  cb: (orders: Order[], error?: Error) => void,
): () => void {
  let cancelled = false;
  const poll = async () => {
    if (cancelled) return;
    try {
      const fn = getNativeFunctions().httpsCallable('listShopOrders');
      const result = await fn({ shopId });
      if (!cancelled) cb((result.data as any[]).map(toOrder), undefined);
    } catch (e) {
      console.warn('[watchShopOrders] poll failed:', e);
      if (!cancelled) cb([], e instanceof Error ? e : new Error(String(e)));
    }
  };
  poll();
  const interval = setInterval(poll, 10000);
  return () => {
    cancelled = true;
    clearInterval(interval);
  };
}
```

The web path must also adopt the new signature. For `onSnapshot`,
pass the `error` callback through:

```ts
return onSnapshot(
  q,
  snap => cb(snap.docs.map(d => toOrder(d.data())), undefined),
  err => cb([], err),
);
```

### B.1 — ShopListScreen

```ts
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);

const load = useCallback(async () => {
  if (!location) return;
  try {
    const data = await shopService.getNearbyShops(location);
    setShops(data);
    setError(null);
    Analytics.view_shop_list({ count: data.length });
  } catch (e: any) {
    console.warn('[ShopList] load failed:', e);
    setError(e?.message || 'Could not load shops. Pull to refresh.');
    setShops([]);
  }
}, [location]);

useEffect(() => {
  if (!location) {
    setLoading(false);
    return;
  }
  let cancelled = false;
  (async () => {
    setLoading(true);
    try {
      await load();
    } finally {
      if (!cancelled) setLoading(false);
    }
  })();
  return () => {
    cancelled = true;
  };
}, [load, location]);
```

Render error banner when `error && !loading`. Add retry button that
calls `onRefresh`.

### B.2 — ShopOwnerDashboardScreen

```ts
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);

useEffect(() => {
  if (!isShopOwner || !shopId) {
    setLoading(false);
    return;
  }
  const unsubscribe = orderService.watchShopOrders(shopId, (list, err) => {
    if (err) {
      setError(err.message || 'Could not load orders. Pull to refresh.');
      setOrders([]);
    } else {
      setOrders(list);
      setError(null);
    }
    setLoading(false);  // ALWAYS, regardless of err
  });
  return unsubscribe;
}, [isShopOwner, shopId]);
```

Same error banner pattern as ShopListScreen.

### B.3 — Other screens

Apply the equivalent pattern to AdminOrdersScreen, OrderDetailScreen,
DeliveryDashboardScreen, and anything else hitting the refactored
watchers. Each screen needs:
- error state alongside loading
- callback handles `(data, err)` not just `data`
- `setLoading(false)` runs unconditionally on first callback

### E.1 — Cloud Function tests

`tests/functions/listShopsPublic.test.ts`:

- Set up firebase-functions-test in offline mode
- Mock `db.collection('shops').where().get()` to return:
  - 3 active shops at varying distances + 2 pending shops + 1 with
    no `status` field
- Call `listShopsPublic` wrapper with a userLocation
- Assert response contains exactly 3 shops, sorted by `distanceKm`
- Call again without userLocation; assert no `distanceKm` field set
  and no specific order required
- Call with malformed userLocation (string instead of number);
  assert it falls back to "no distance" path without throwing

Use `firebase-functions-test`'s offline mode (no emulator needed).
If Windsurf finds the offline mode awkward for v2 callable functions,
use the existing emulator setup from `firebase emulators:exec`.

### E.2 — shopService dispatch tests

`tests/services/shopService.test.ts`:

- Mock `react-native`'s `Platform.OS`
- Mock `getNativeFunctions().httpsCallable` returning a stub
- Mock `getDocs` from `firebase/firestore`
- Test 4 cases:
  1. Platform.OS='ios', getNearbyShops calls native callable, returns
     shops from response
  2. Platform.OS='web', getNearbyShops calls getDocs, returns mapped
     shops
  3. Platform.OS='ios', callable throws, error propagates to caller
  4. Platform.OS='ios', getById uses listShopMenuPublic and extracts
     shop only

### E.3 — Watcher contract tests

`tests/services/orderService.watchers.test.ts`:

For each refactored watcher:
- Mock the underlying callable
- Subscribe with a spy callback
- Resolve callable with data → assert `spy(data, undefined)` called
- Reject callable with error → assert `spy([], errorWith.message)`
  called
- Use jest fake timers to verify polling interval behaviour:
  the spy should be called at least twice across two intervals

### E.4 — Screen logic hook tests

Extract the load+error state management from each fixed screen into a
custom hook (kept colocated with the screen, e.g.
`src/screens/ShopListScreen.useShopListData.ts`).

`tests/hooks/useShopListData.test.ts`:

- Use `@testing-library/react-hooks` (or equivalent — check what
  works with the existing jest preset)
- Mount the hook with a mock shopService that throws
- Wait for the effect to settle
- Assert: `loading === false`, `error !== null`, `shops === []`
- Mount with a mock that resolves
- Assert: `loading === false`, `error === null`, `shops` populated

Do NOT mount the actual screen component. We're testing the state
machine, not the JSX. RNTL is a separate PR.

## Acceptance checklist

- [ ] `listShopsPublic` deployed and visible in functions:list
- [ ] On Sudhir's Android device (after OTA + force-restart x2):
      Browse shops near me loads within 3s OR shows clear error
- [ ] Shop Dashboard either shows orders/empty state OR shows clear
      error within 15s — never indefinite spin
- [ ] All 4+ identified screens with the bug pattern fixed
- [ ] All 5+ watcher methods refactored to new (data, error?) signature
- [ ] Audit table from §C and §D included in report
- [ ] All audit-found issues either fixed or logged to checklist
- [ ] `npm run audit` passes
- [ ] `npm run test:rules` still 52/52 passing (rules untouched)
- [ ] `npm run test` (or whatever the new test script is named for
      Cloud Functions / services / hooks) all green; report total count
- [ ] `npx tsc --noEmit` shows the same 11 pre-existing errors,
      0 new
- [ ] Deliberate-break demo for new tests: temporarily revert one of
      the watcher fixes (so `cb` never fires on error), confirm the
      new watcher contract test fails, revert the revert, confirm
      green. Same approach as the rules-test PR's deliberate-break.
- [ ] OTA published; group ID + iOS + Android update IDs in report

## Reporting back

- The deployed function entry from `firebase functions:list`
- Output of `firebase deploy --only functions:listShopsPublic` (raw,
  not piped)
- §C audit table (screens)
- §D audit table (services)
- Total test count added in this PR (split by file)
- Deliberate-break demo output for the new watcher tests
- The OTA `eas update` output (group ID, iOS ID, Android ID)
- Any sub-bugs discovered during the audit that you fixed inline OR
  logged for follow-up

## Important — do not

- Do not add full React Native rendering tests (RNTL is a separate PR)
- Do not refactor passing tests in `tests/rules/`
- Do not "improve" orderService's existing Plan B dispatch for
  non-watcher methods (works; leave it)
- Do not add a caching layer
- Do not remove the web SDK from firebase.ts
- Do not auto-format files outside the diff
- Do not commit your work — leave it staged for Sudhir to review
- Do not silently fix bugs you discover during audits without
  reporting them — surface every finding
