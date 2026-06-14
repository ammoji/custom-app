# PR-NEXT-BUNDLE-M — Shop publish gate (pilot publish-readiness)

**Cascade-on-Sonnet handoff prompt** · Author: Claude · Drafted: 2026-06-13 (Sat evening, CST)

---

## Why this exists

Today, a shop owner registers, gets approved, and is immediately visible
to customers — **regardless of whether they have any items in their
menu**, whether their hours are set, or whether their location is
properly verified. For pilot launch day this is a real
embarrassment-risk:

- Shop owner registers Monday morning
- Gets approved by admin
- Has to step away for an hour before building their catalog
- Customer opens the app, sees the shop, taps in, sees zero items
- Customer assumes the app is broken, uninstalls

Bundle M closes that risk with a server-side **publish gate**: a shop
is only visible to customers if it meets all readiness requirements
(menu has ≥ N items, hours are set, location is verified). The
shopkeeper sees a "what's missing" banner in their own dashboard until
all gates pass. After the last gate flips, the shop appears to
customers automatically — no admin action needed.

This is **pure pilot value, not polish.** It directly converts a known
launch-day embarrassment into "impossible by construction."

---

## Read first

1. `CLAUDE.md` — current state, today's K.1 + HOTFIX-K1 + Bundle L ships.
2. `docs/PROMPT_AUTHORING_NOTES.md` — Rule 5 worked examples + required
   completion-report verification block.
3. `functions/src/index.ts` lines ~8006 — existing `listShopsPublic`
   callable. Bundle M adds a filter inside this.
4. `functions/src/index.ts` line ~7994 — existing
   `appConfig/shopVisibility` read pattern. Bundle M follows the same
   pattern for `appConfig/pilotConfig`.
5. `src/types/Shop.ts` (or wherever Shop type lives — grep `interface Shop`
   to confirm path). Bundle M adds `isPublishable`, `publishGateState`,
   `forcePublishOverride`.
6. `src/screens/shop/ShopOwnerDashboardScreen.tsx` — banner location.
7. `src/screens/admin/ShopManagementScreen.tsx` — admin filter additions.
8. **PR 48 service-radius visibility doc trail** at the top of
   `functions/src/index.ts` (~line 7972) — the existing
   `showAllShops` pattern is the model for `forcePublishOverride`.

---

## Discipline checklist

- [ ] **Rule 5**: every consumer of `Shop` type audited for the new
      fields. Defaults must mean "treat as not publishable" for
      backfill safety (fail-closed: a Shop without `isPublishable`
      reads as unpublishable, NOT publishable).
- [ ] **Rule 5 #14**: required completion-report verification block.
- [ ] **Rule 5 #16**: post-deploy smoke. `npm run smoke -- --include=listShopsPublic`
      must show clean.
- [ ] **Rule 11**: IAM `allUsers` verify on the new + modified
      callables.
- [ ] **Rule W**: complete autonomously, including deliberate-break
      demos.
- [ ] **PROMPT_AUTHORING_NOTES Rule 8**: FEATURES.md update
      instructions in §H.

---

## §A — Pure publish-status helper

New file: `functions/src/shopPublishHelpers.ts`.

Mirror this helper on the client at `src/utils/shopPublishHelpers.ts`
(byte-identical pure helper — both sides import the same function
shape so the banner matches the gate exactly). This is the same
duplicate-helper pattern as `filterShopsByServiceRadius` (PR 48 lives
in both `functions/src/index.ts` and `src/utils/geoVisibilityHelpers.ts`).

```ts
export type PublishRequirementKey =
  | 'menu_items_below_minimum'
  | 'hours_not_set'
  | 'location_not_verified'
  | 'shop_status_not_active'
  | 'force_publish_off_and_above_active_required';

export type PublishGateInput = {
  shopStatus: 'active' | 'pending' | 'suspended' | string;
  menuItemCount: number;
  hoursOpen?: string | null;
  hoursClose?: string | null;
  location?: { lat?: number; lng?: number } | null;
  locationVerifiedAt?: number | null;
  forcePublishOverride?: boolean;
  // From appConfig/pilotConfig.minMenuItemsForPublish, default 5.
  minMenuItems: number;
};

export type PublishGateResult = {
  isPublishable: boolean;
  missing: PublishRequirementKey[];
  // For diagnostic + Sentry breadcrumb logging — not for client display.
  signal: 'force_override' | 'all_met' | 'missing_requirements';
};

export function evaluateShopPublishStatus(
  input: PublishGateInput,
): PublishGateResult;
```

Logic:

1. If `forcePublishOverride === true`, return `{ isPublishable: true,
   missing: [], signal: 'force_override' }` regardless of other state.
   (This is the admin/test-shop escape hatch — same pattern as PR 48
   `showAllShops`.)
2. Otherwise build a `missing[]` array:
   - `shopStatus !== 'active'` → `'shop_status_not_active'`
   - `menuItemCount < minMenuItems` → `'menu_items_below_minimum'`
   - hoursOpen empty/null OR hoursClose empty/null → `'hours_not_set'`
   - location missing OR lat/lng invalid (out of -90..90 / -180..180
     range, also catches swapped lat/lng — same check as
     SHOP-LOCATION-REQUIRED Rule 14) OR `locationVerifiedAt` null →
     `'location_not_verified'`
3. Return `{ isPublishable: missing.length === 0, missing, signal }`.

Unit tests (in `tests/functions/shopPublishHelpers.test.ts`):
- All gates passing → publishable, missing=[]
- `forcePublishOverride: true` with all gates failing → publishable
- Below minimum menu → missing includes 'menu_items_below_minimum'
- Status pending → missing includes 'shop_status_not_active'
- Hours blank → missing includes 'hours_not_set'
- Location null → missing includes 'location_not_verified'
- Lat out of range → 'location_not_verified'
- Swapped lat/lng (lat 77.2, lng 28.5 — Faridabad swapped) → 'location_not_verified'
- locationVerifiedAt null → 'location_not_verified'
- All 4 failing simultaneously → missing has 4 entries

---

## §B — Shop type additions

Add to the `Shop` interface (schema-additive only):

```ts
/** Bundle M — denormalized publish-gate result, kept in sync by
 *  recomputeShopPublishStatus (callable) + onShopMenuWrite trigger +
 *  onShopUpdate trigger. UI reads this; do NOT recompute on the
 *  client. */
isPublishable?: boolean;

/** Bundle M — last-computed gate result for diagnostics + banner. */
publishGateState?: {
  missing: PublishRequirementKey[];
  menuItemCount: number;
  signal: 'force_override' | 'all_met' | 'missing_requirements';
  computedAt: number;
};

/** Bundle M — admin escape hatch. Set by an admin-only callable
 *  forceShopPublishOverride to flip a test shop or known-quirky
 *  shop to publishable regardless of gates. */
forcePublishOverride?: boolean;
forcePublishOverrideSetAt?: number;
forcePublishOverrideSetBy?: string; // admin UID
forcePublishOverrideReason?: string;
```

**Rule 5 fail-closed default**: any read of `shop.isPublishable` on the
client + server should treat `undefined` / `null` as `false`. Helper:

```ts
// src/utils/shopPublishHelpers.ts AND functions/src/shopPublishHelpers.ts
export function isShopPublishable(shop: { isPublishable?: boolean | null }): boolean {
  return shop.isPublishable === true;
}
```

---

## §C — Triggers + callable to keep `isPublishable` in sync

In `functions/src/index.ts`:

1. **Firestore trigger** `onShopMenuWrite` — fires on any write to
   `shops/{shopId}/menu/{itemId}`. Reads the shop doc + menu collection
   count + reads `appConfig/pilotConfig.minMenuItemsForPublish` (default
   5), calls `evaluateShopPublishStatus`, writes
   `isPublishable + publishGateState` back to the shop doc.

   ```ts
   export const onShopMenuWrite = onDocumentWritten(
     'shops/{shopId}/menu/{itemId}',
     async (event) => { ... }
   );
   ```

2. **Firestore trigger** `onShopUpdate` — fires on update to
   `shops/{shopId}` itself, but only when one of
   `[hours, location, locationVerifiedAt, status, forcePublishOverride]`
   changed. Same recompute logic. **Watch for infinite loop** — the
   trigger writes `isPublishable + publishGateState + computedAt` back,
   which itself triggers `onShopUpdate`. Guard: skip recompute if the
   only changed fields are `isPublishable`, `publishGateState`,
   `forcePublishOverride*` (write came from the trigger or admin
   callable themselves; downstream recompute would be no-op).

3. **Callable** `recomputeShopPublishStatus({ shopId })` — manual
   recompute trigger for admin debugging + the backfill script. Auth:
   admin only OR shop owner of that shop (latter for "I added 5 items
   but the banner still says 'almost ready' — please refresh").

4. **Callable** `forceShopPublishOverride({ shopId, override, reason })`
   — admin only. Sets `forcePublishOverride + setAt + setBy + reason`,
   then triggers a recompute. Audit log entry written.

All three deployed via the existing onCall pattern. IAM `allUsers`
binding required for the callables (Rule 11).

---

## §D — `listShopsPublic` filter additions

In the existing `listShopsPublic` callable at functions/src/index.ts:8006:

After the existing `filterShopsByServiceRadius` filter, add:

```ts
// Bundle M — publish-gate filter. Shops not yet publishable are
// hidden from customers regardless of service radius. Admin can use
// forcePublishOverride for test shops (same pattern as the showAllShops
// escape hatch). When `appConfig/pilotConfig.showUnpublishedShops` is
// true (set during integration testing), this filter is bypassed.
const showUnpublished = await readShowUnpublishedShopsFlag(); // new helper
const publishableShops = showUnpublished
  ? rankedShops
  : rankedShops.filter(s => s.isPublishable === true);
```

`readShowUnpublishedShopsFlag()` reads `appConfig/pilotConfig.showUnpublishedShops`,
default `false`. **This is the family-testing escape hatch** — Sudhir
can flip it true during integration testing to see test shops without
populating them fully.

---

## §E — Shop owner banner

Edit `src/screens/shop/ShopOwnerDashboardScreen.tsx` and
`src/screens/shop/catalog/BuildCatalogScreen.tsx`:

If `!isShopPublishable(shop)`, render a sticky banner at the top:

```
┌────────────────────────────────────────────────┐
│ 📋 Almost ready to go live                     │
│                                                │
│ Customers can't see your shop yet. To publish: │
│   • Add 3 more items to your menu              │
│   • Set your opening hours                     │
│                                                │
│ [Add items]  [Set hours]                       │
└────────────────────────────────────────────────┘
```

Use a new pure helper `formatPublishMissingForBanner(missing,
menuItemCount, minMenuItems): { lines: string[]; primaryCta: { label, route } }`
in `src/utils/shopPublishHelpers.ts`. Unit-testable; banner is a thin
render over it.

Copy guidance:
- `menu_items_below_minimum` → `"Add ${minMenuItems - menuItemCount} more items to your menu"` (handle 1 item gracefully: "1 more item")
- `hours_not_set` → `"Set your opening hours"`
- `location_not_verified` → `"Verify your shop location"`
- `shop_status_not_active` → `"Awaiting admin approval"` (no CTA — they wait)

Primary CTA = the first missing requirement that the shop owner can act on:
- menu → navigate to BuildCatalogScreen
- hours → navigate to ShopSettingsScreen with section=hours scrolled to
- location → ShopSettingsScreen with section=location scrolled to

When `isPublishable === true`, banner is replaced with a success
chip on first render only (auto-dismiss after 3s via `useEffect`
timeout, AsyncStorage key `shopPublishedToastSeen` to prevent
re-show on every dashboard load):

```
✓ Your shop is live! Customers can see and order from you now.
```

---

## §F — Admin filter + force-override UI

Edit `src/screens/admin/ShopManagementScreen.tsx`:

Add a filter chip row above the list:

```
[ All ] [ Live ] [ Awaiting publish ] [ Pending approval ] [ Suspended ]
```

`Awaiting publish` = `status === 'active' && isPublishable !== true`.

Each shop row already shows status; add a small chip showing publish
state: `🟢 Live` / `🟡 Almost ready (3 missing)` / `⚪ Forced` (when
`forcePublishOverride === true`).

In `src/screens/admin/ShopDetailManagementScreen.tsx`, add a
"Force publish override" section visible only when `!isPublishable`
or `forcePublishOverride === true`. Tap → bottom-sheet form (Rule 13):

```
Force-publish this shop?

This bypasses the publish gate (menu items, hours, location).
Use only for test shops or known edge cases.

Reason (required):
[                                          ]

[ Cancel ]  [ Force publish ]
```

Submit → calls `forceShopPublishOverride({ shopId, override: true,
reason })`. On success → recompute fires, banner disappears from shop
owner's dashboard within ~1s, shop now shows in customer listings.

A second control "Remove override" reverses it.

---

## §G — Backfill + integration testing

New script: `scripts/backfill-shop-publishable.ts`.

For every shop in `shops/`:
1. Read menu count from `shops/{shopId}/menu`
2. Read appConfig/pilotConfig.minMenuItemsForPublish (default 5)
3. Compute `evaluateShopPublishStatus(...)`
4. Write `isPublishable + publishGateState + computedAt` to shop doc

Safety guards (mirror seed-master-catalog.ts):
- Project allowlist (grocery-mvp-dev only)
- Dry-run default, --execute required
- Typed "WRITE" confirm unless --yes
- Audit log to scripts/.cleanup-logs/

**Test fleet handling:** the 9 test accounts created in the multi-region
test setup (6 India + 3 US) include 2 shop accounts. Their existing
shops probably don't have 5+ menu items. The backfill will mark them
unpublishable. **Two options to keep family-testing functional:**

Option A (recommended): Sudhir runs `forceShopPublishOverride` from the
admin app on each test shop with reason "test shop — family testing
phase".

Option B: Sudhir flips `appConfig/pilotConfig.showUnpublishedShops:
true` before family testing, flips it false on real-customer launch day.
Same pattern as `showAllShops` (PR 48).

Document BOTH in PRELAUNCH_CHECKLIST.md so we don't forget on launch
day. The flag flip should appear in the PR 39.2 launch-day section.

---

## §H — Tests (forecast: +28 minimum)

`tests/functions/shopPublishHelpers.test.ts` — +10 tests
- All 10 cases from §A's unit-tests list above

`tests/services/clientShopPublishHelpers.test.ts` (new — mirrors
the server file on the client) — +6 tests
- formatPublishMissingForBanner: menu only missing → primary CTA "Add items"
- formatPublishMissingForBanner: hours only missing → primary CTA "Set hours"
- formatPublishMissingForBanner: 3 missing → 3 bullet lines + first as primary
- formatPublishMissingForBanner: 1 menu item short → "1 more item" not "1 more items"
- isShopPublishable: undefined → false (Rule 5 fail-closed)
- isShopPublishable: false → false
- isShopPublishable: true → true

`tests/functions/listShopsPublicFilter.test.ts` — +5 tests
- Shop with isPublishable=true is in result
- Shop with isPublishable=false is NOT in result
- Shop with isPublishable=undefined is NOT in result (fail-closed)
- `showUnpublishedShops=true` flag → all shops returned regardless
- `forcePublishOverride=true` shop is publishable regardless of gates

`tests/functions/recomputeShopPublishStatus.test.ts` — +4 tests
- shop owner of shop X calling for shop X → success
- shop owner of shop X calling for shop Y → permission-denied
- non-shop-owner caller → unauthenticated
- admin → success regardless

`tests/functions/forceShopPublishOverride.test.ts` — +3 tests
- non-admin caller → permission-denied
- admin sets override=true with reason → success, audit log entry
- admin sets override=true with empty reason → InvalidArgument

Run targets:
- `npx jest tests/functions/shopPublish tests/services/clientShopPublishHelpers tests/functions/listShopsPublicFilter tests/functions/recomputeShopPublishStatus tests/functions/forceShopPublishOverride` → +28
- Full suite: 1800 → ≥1828
- `tsc --noEmit` clean on both `src/` and `functions/`
- All 6 static guards pass

---

## §I — Deploy plan (you run; never auto-run)

```powershell
# 1. Functions build
cd functions; npm run build; cd ..

# 2. Deploy new + modified callables + triggers
firebase deploy --only functions:listShopsPublic
firebase deploy --only functions:recomputeShopPublishStatus
firebase deploy --only functions:forceShopPublishOverride
firebase deploy --only functions:onShopMenuWrite
firebase deploy --only functions:onShopUpdate

# 3. IAM verify (Rule 11) — only the two new callables (triggers
#    don't have IAM); listShopsPublic already public.
foreach ($svc in 'recomputeshoppublishstatus','forceshoppublishoverride') {
  gcloud run services get-iam-policy $svc --region=asia-south1 --project=grocery-mvp-dev
}

# 4. Post-deploy smoke (Rule 5 #16)
npm run smoke -- --include=listShopsPublic,recomputeShopPublishStatus,forceShopPublishOverride

# 5. One-time backfill (dry-run first)
npx tsx scripts/backfill-shop-publishable.ts
npx tsx scripts/backfill-shop-publishable.ts --execute

# 6. Family-testing escape hatch — flip ONE of these (your call):
#    Option A (preferred): force-publish each test shop from admin app
#    Option B: flip appConfig/pilotConfig.showUnpublishedShops to true
#    DO NOT leave both off, or family won't see the test shops.

# 7. Client OTA
eas update --branch production --message "Bundle M — Shop publish gate"
```

**Critical:** if you DON'T run step 6 BEFORE the client OTA, your family
testing accounts will see zero shops on launch. Test-shop force-publish
or the `showUnpublishedShops` flag has to be set first.

---

## §J — Required completion-report verification block

```
=== Bundle M verification ===

# Helper modules (both sides)
$ grep -n "^export function evaluateShopPublishStatus" functions/src/shopPublishHelpers.ts
<line>:export function evaluateShopPublishStatus(

$ grep -n "^export function evaluateShopPublishStatus" src/utils/shopPublishHelpers.ts
<line>:export function evaluateShopPublishStatus(

# Confirm helpers are byte-identical in logic (signature + body)
$ diff -u functions/src/shopPublishHelpers.ts src/utils/shopPublishHelpers.ts | head -20
<expected: only `import` paths differ; the function body is identical>

# Callables
$ grep -n "^export const \(recomputeShopPublishStatus\|forceShopPublishOverride\) = onCall" functions/src/index.ts
<line>:export const recomputeShopPublishStatus = onCall<...
<line>:export const forceShopPublishOverride = onCall<...

# Triggers
$ grep -n "^export const \(onShopMenuWrite\|onShopUpdate\) = onDocumentWritten" functions/src/index.ts
<line>:export const onShopMenuWrite = onDocumentWritten(
<line>:export const onShopUpdate = onDocumentWritten(

# listShopsPublic filter modification
$ grep -n "isPublishable\|showUnpublishedShops\|readShowUnpublishedShopsFlag" functions/src/index.ts | head -10
<lines showing the filter, helper, and constants>

# Shop type fields
$ grep -n "isPublishable\|publishGateState\|forcePublishOverride" src/types/Shop.ts
<lines showing all field additions>

# Banner wired into both shop owner screens
$ grep -n "formatPublishMissingForBanner\|isShopPublishable" src/screens/shop/ShopOwnerDashboardScreen.tsx src/screens/shop/catalog/BuildCatalogScreen.tsx
<lines from both files>

# Admin filter + force-override
$ grep -n "Awaiting publish\|forceShopPublishOverride" src/screens/admin/ShopManagementScreen.tsx src/screens/admin/ShopDetailManagementScreen.tsx
<lines from both files>

# Backfill script
$ ls -la scripts/backfill-shop-publishable.ts
<file info>

$ grep -n "ALLOWED_PROJECT\s*=\s*'grocery-mvp-dev'" scripts/backfill-shop-publishable.ts
<line>:const ALLOWED_PROJECT = 'grocery-mvp-dev';

# Test counts
$ npx jest tests/functions/shopPublishHelpers.test.ts 2>&1 | tail -3
<output showing ≥10 passing>

$ npx jest tests/functions/listShopsPublicFilter.test.ts tests/functions/recomputeShopPublishStatus.test.ts tests/functions/forceShopPublishOverride.test.ts 2>&1 | tail -3
<output showing ≥12 passing>

$ npx jest tests/services/clientShopPublishHelpers.test.ts 2>&1 | tail -3
<output showing ≥6 passing>

# Full suite
$ npx jest 2>&1 | tail -5
<PASS, suites ≥ 173, tests ≥ 1828>

# Type check
$ npx tsc --noEmit && echo "src clean"
src clean

$ cd functions && npx tsc --noEmit && echo "functions clean"
functions clean

# Static guards
$ npx jest tests/audits 2>&1 | tail -3
<all 6 static guards pass>
```

Without this block in the completion report, the PR is **not complete**.

---

## §K — Deliberate-break demos

**Demo 1: fail-closed default.** Temporarily change
`isShopPublishable` to `return shop.isPublishable !== false`. Run the
"undefined → false" test → expect FAIL. Restore → PASS.

**Demo 2: hours gate.** Temporarily remove the hours check from
`evaluateShopPublishStatus`. Run the "hours blank → missing
'hours_not_set'" test → expect FAIL. Restore → PASS.

**Demo 3: listShopsPublic filter.** Temporarily comment out the
`.filter(s => s.isPublishable === true)` line. Run the "unpublishable
shop NOT in result" test → expect FAIL. Restore → PASS.

---

## §L — FEATURES.md updates (Rule 8)

`docs/FEATURES.md` additions:

**§3.X (Shop panel)** new "Publish gate" subsection:
> "Shops are not visible to customers until all publish-readiness
> requirements are met: ≥5 menu items (configurable via
> `appConfig/pilotConfig.minMenuItemsForPublish`), opening hours set,
> location verified. The shop owner sees a 'Almost ready' banner in
> their dashboard listing exactly what's missing, with one-tap CTAs
> to each fix. When the last gate flips, the shop appears in customer
> listings automatically — no admin action needed."

**§5.X (Admin panel)** addition:
> "Admin ShopManagement screen has a new filter chip 'Awaiting publish'
> showing shops that registered + were approved but haven't met
> publish gates. Admin can also `forceShopPublishOverride` an
> individual shop (e.g. test shops, known edge cases) with required
> reason; audit-logged."

**§5.10 (Static guards)**: no new guards.

**§5.11 (Test infrastructure)**: bump test count.

---

## §M — Out of scope

- **Dynamic gate weights** ("hours matter more than location"). All
  gates are equal; missing any one keeps the shop unpublishable.
- **Custom per-shop minimums** ("this shop only sells 3 items
  intentionally"). Use forcePublishOverride for outliers.
- **Customer-side "this shop is almost ready" preview**. Out of scope
  — customers shouldn't see unpublished shops at all.
- **Push notification to admin on shop publish readiness transition.**
  Could be useful later; admin polls today.
- **Auto-suspend shops that drop BELOW the gate after publishing**
  (e.g. shop deletes all items). The gate is asymmetric for pilot:
  once published, stay published unless admin intervenes. Avoids
  whipsawing shops in and out of customer view during normal
  catalog edits.

---

## Test count forecast

**+28 minimum.** Total: 1800 → ≥1828.
`tsc --noEmit` clean on both. All 6 static guards pass.

## Estimated Devin quota burn

Medium-high: ~18–25% of weekly quota. Bundle M has real surface area —
2 new pure helpers (server + client), 2 new callables, 2 new
Firestore triggers, 1 modified callable, 2 modified shop owner screens,
2 modified admin screens, 1 new backfill script, 5 test files. The
discipline checklist is long and the verification block is exhaustive
on purpose — Bundle M ships a server-side gate that gates the
customer's view of the entire app, so a mistake here breaks pilot.

End of prompt.
