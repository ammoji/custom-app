# PR-NEXT-SHOP-LOCATION-REQUIRED — Three layers of defense so location-less shops can't exist

**Source:** Sudhir's June 2 observation. *"Shop current location is optional so how can we calculate shop distance?"* + the cascading symptoms (#2/#3/#4/#7) that all trace to either the `showAllShops` flag or shops without a location pin.

Decision locked (pre-design check): **defense in depth.** Three layers, each independently sufficient:

1. **Client gate** — RegisterShop submit disabled until `location` is captured. Cannot send a location-less registration.
2. **Server gate** — `approveShop` rejects with `failed-precondition` if the pending shop has no `location`. Cannot approve a location-less shop even via admin-side bypass.
3. **Filter gate** — `filterShopsByServiceRadius` fail-OPEN → fail-CLOSED for shops without `location`. Even if a location-less shop somehow gets `status: 'active'` (legacy data, manual Firestore edit, future refactor regression), customers don't see it.

Plus an explicit `locationVerifiedAt` stamp at approval time so the admin's verification is auditable.

**Deploy class:** **server-first** (approveShop + filter helper) → IAM verify approveShop → client OTA (registration UI gate + admin verification UI).

**Audit-grep (Rule 5):**

```
grep -n "shop.location\|location?: " src/types/index.ts
grep -n "registerShop\|approveShop\|filterShopsByServiceRadius" functions/src/index.ts
grep -n "useLocationStore\|location.*registerShop" src/screens/roles/RegisterShopScreen.tsx
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `Shop.location` | `src/types/index.ts` | `{ lat: number; lng: number }` optional |
| `registerShop` callable input | accepts optional `location` | client passes `location ?? undefined` (RegisterShopScreen:192) |
| `approveShop` reads `shops/{shopId}` | `functions/src/index.ts:4896` | currently checks status; does NOT check location |
| `filterShopsByServiceRadius` fail-OPEN | `functions/src/geoVisibilityHelpers.ts:50-56` | returns `true` (keep) on missing distance |
| Existing shops without location | possible — schema is optional | one-time backfill prompt needed |

**Read first**

1. `CLAUDE.md`
2. `.windsurf/code-discipline.md` Rules 1, 2, 5, 11
3. `functions/src/geoVisibilityHelpers.ts` (small file, ~67 lines)
4. `functions/src/index.ts:4884-4980` approveShop body
5. `src/screens/roles/RegisterShopScreen.tsx:175-210` handleContinue + validate
6. `src/screens/admin/ShopRegistrationDetailScreen.tsx` — admin approval surface (find by reading)
7. `src/types/index.ts` Shop type — confirm `location?` shape

---

## Plan

### §A — Filter helper: fail-OPEN → fail-CLOSED for shops without location

`functions/src/geoVisibilityHelpers.ts` — change the missing-distance branch to **drop** (not keep). The comment block at the top must be updated to match.

```ts
// BEFORE (lines 50-57):
return shops.filter(s => {
  if (
    typeof s.distanceKm !== 'number' ||
    !Number.isFinite(s.distanceKm)
  ) {
    return true; // fail-open: can't measure → don't hide
  }
  // …

// AFTER:
return shops.filter(s => {
  if (
    typeof s.distanceKm !== 'number' ||
    !Number.isFinite(s.distanceKm)
  ) {
    // PR-NEXT-SHOP-LOCATION-REQUIRED — fail-CLOSED. Was fail-OPEN
    // pre-PR (kept shops with missing distance) which produced
    // shops without `location` being globally visible — exactly
    // Sudhir's June 2 observation. Defense layer 3 of 3:
    //   1. RegisterShop gates submit on location
    //   2. approveShop rejects approval without location
    //   3. THIS filter — last-resort hide if a location-less shop
    //      somehow lands in the active set
    // Note: this only fires when the SHOP has no location. Customer
    // missing location still keeps all shops visible because
    // `rankShopsByDistance` then stamps `distanceKm` as undefined
    // UNIFORMLY across shops — we detect that case via
    // `opts.customerHasLocation` and bypass the gate.
    return false;
  }
  // … existing radius check
});
```

But wait — the original fail-OPEN comment says *"when we cannot measure a distance (no customer location, no shop location, non-finite haversine) we KEEP the shop. The alternative (hide on missing data) would silently strand customers."* Fail-CLOSED would, in the customer-missing-location case, hide EVERY shop — exactly the stranding the original comment warned about.

So the helper needs to distinguish "customer has no location" (which is a global condition — apply to all shops uniformly, fail-OPEN to avoid stranding) from "shop has no location" (which is per-shop — fail-CLOSED so misconfigured shops don't leak through).

Cleanest: extend the helper's options:

```ts
export function filterShopsByServiceRadius<T extends RadiusFilterable>(
  shops: T[],
  opts: { showAll: boolean; customerHasLocation: boolean },
): T[] {
  if (opts.showAll) return shops.slice();
  return shops.filter(s => {
    if (
      typeof s.distanceKm !== 'number' ||
      !Number.isFinite(s.distanceKm)
    ) {
      // Customer-side gap → keep (don't strand a customer who hasn't
      // granted location). Shop-side gap → drop (the shop is
      // misconfigured; defense layer 3).
      return opts.customerHasLocation === false;
    }
    // … existing radius check
  });
}
```

Caller side in `listShopsPublic`:

```ts
const showAll = await readShowAllShopsFlag();
const visible = filterShopsByServiceRadius(shops, {
  showAll,
  customerHasLocation: !!userLocation,
});
```

Update tests in `tests/functions/geoVisibilityHelpers.test.ts` — split the existing "fail-open when distance undefined" test into:
- "customer has no location → all shops kept" (customerHasLocation: false)
- "shop has no location → that shop dropped" (customerHasLocation: true, shop.distanceKm undefined)

Pin **6 cases** total (3 existing + 2 new + 1 boundary).

### §B — approveShop rejects location-less shops

In `functions/src/index.ts:4884-4980`, after the existing `status === 'pending'` check, add:

```ts
// PR-NEXT-SHOP-LOCATION-REQUIRED — defense layer 2. Refuse to approve
// a shop that has no GPS pin. Customer-side filterShopsByServiceRadius
// would hide it anyway (layer 3), but rejecting here forces the
// admin to coordinate with the owner to capture location BEFORE
// approval — prevents wasted "I see Approved but customers can't
// find me" support cycles.
const loc = (shop as any).location;
if (
  !loc ||
  typeof loc.lat !== 'number' ||
  !Number.isFinite(loc.lat) ||
  loc.lat < -90 ||
  loc.lat > 90 ||
  typeof loc.lng !== 'number' ||
  !Number.isFinite(loc.lng) ||
  loc.lng < -180 ||
  loc.lng > 180
) {
  throw new HttpsError(
    'failed-precondition',
    'Cannot approve shop without a valid GPS location. Ask the shop ' +
      'owner to re-open RegisterShop and capture their location, then ' +
      'retry approval.',
  );
}
```

Stamp `locationVerifiedAt: FieldValue.serverTimestamp()` + `locationVerifiedBy: auth.uid` onto the shop doc inside the existing approval write. New fields are optional on the Shop type so legacy approved shops without them stay back-compat.

### §C — RegisterShop client gate

`src/screens/roles/RegisterShopScreen.tsx` — `validate()` currently doesn't check location. Add:

```ts
if (!location) {
  return 'Please capture your shop\'s GPS location before submitting. Use the "📍 Capture location" button below.';
}
```

And derived flag near other useState block:

```tsx
const canSubmitStep1 =
  name.trim().length > 0 &&
  address.trim().length > 0 &&
  phone.trim().length === 10 &&
  !!location &&
  !submitting;
```

Wire `disabled={!canSubmitStep1}` onto the step-1 Continue button. Add a small hint when location is missing:

```tsx
{!location && (
  <Text style={styles.captureHint}>
    📍 Capture your shop's GPS location before continuing.
  </Text>
)}
```

(Reuse `captureHint` style if present; else add the same one as HOTFIX-9.)

### §D — Admin approval surface — verification affordance

`src/screens/admin/ShopRegistrationDetailScreen.tsx`. Find the existing Approve button render. Add above it:

1. **Location display row** — if `shop.location` is set, show `📍 28.4945, 77.3025` with a `Verify on map` tappable that calls `Linking.openURL(\`https://maps.google.com/?q=${lat},${lng}\`)`. If `shop.location` is missing, show a red banner: `"⚠️ No GPS location captured. Cannot approve until owner re-submits with location."` and **disable the Approve button**.
2. **Verification checkbox** — `[ ] I verified this shop's location on the map.` Disabled-by-default Approve button; enables once checkbox is checked AND location is present.

The checkbox state is local (not persisted) — `locationVerifiedAt` stamp from §B is the durable record.

### §E — One-time backfill consideration

Existing approved shops without `location` would still be visible to customers via the same fail-OPEN bug we're patching — except after this PR, §A's fail-CLOSED hides them. Net effect: any legacy location-less shop becomes invisible to customers post-deploy.

Decision: **let them disappear.** It's the right outcome. Coordinate with affected shop owners (likely zero or one at pilot scale) to re-capture location via a new RegisterShop run. Document the migration step in the deploy plan.

Alternative — a `scripts/audit-shops-without-location.ts` one-shot that prints a list of affected shop ids — included so Sudhir can identify them before deploy and warn owners.

### §F — Shop type updates

`src/types/index.ts` Shop type — add two optional fields next to `location`:

```ts
// PR-NEXT-SHOP-LOCATION-REQUIRED — audit trail of admin location
// verification. Both optional / back-compat: legacy approved shops
// don't have them. Set together at approval time by approveShop.
locationVerifiedAt?: number;
locationVerifiedBy?: string;
```

---

## Discipline checklist

1. **Rule 1** — every new import + state read carries "PR-NEXT-SHOP-LOCATION-REQUIRED — DO NOT REMOVE" comments.
2. **Rule 2** — new useStates (`locationVerifiedChecked` on admin screen) sit with other top-level useStates above conditional returns.
3. **Rule 5** — audit-grep table in header confirms field names + schema. `Shop.location` already optional `{ lat: number; lng: number }`; not changing the type's optionality (back-compat for the few minutes between filter-fail-CLOSED deploy and §E backfill).
4. **Rule 7** — test fixtures in `tests/functions/geoVisibilityHelpers.test.ts` MUST include `customerHasLocation` in the opts; reusing an old fixture without it would silently take the "customer missing" branch and mask shop-side gaps.
5. **Rule 11** — IAM verify on `approveShop` AND `listShopsPublic` post-deploy (the new filter signature touches the listShopsPublic surface).
6. **Schema-additive only** — 2 new optional fields on Shop.
7. **Test discipline** — 6 tests for filter (3 existing + 2 new branches + 1 boundary) + 4 tests for approveShop location gate (no-location reject, bad-lat reject, bad-lng reject, success path) = +10 tests minimum.

---

## Acceptance checklist

**Operational pre-deploy:**

1. Run `npx tsx scripts/audit-shops-without-location.ts` (dry-run). Output lists any existing active shops without `location`. If non-empty, ping their owners BEFORE deploying so they're not surprised when their listings disappear.

**Filter (§A):**

2. **Customer without location** → all active shops visible (legacy "fail-open for customer gap" behaviour preserved).
3. **Customer with location, shop with location, in radius** → shop visible.
4. **Customer with location, shop with location, OUT of radius** → shop hidden (radius gate works).
5. **Customer with location, shop WITHOUT location** → shop hidden (defense layer 3 fires). Different from pre-PR behavior — verify by manually unsetting a test shop's `location` in Firestore Console.

**Registration (§C):**

6. Open RegisterShop. Fill name + address + phone. Don't tap "Capture location." Continue button stays disabled with the hint shown. Tap Capture → location populates → button enables.
7. Tap Continue → registration submits. Server accepts (location present).
8. **Regression**: existing registration flow with location captured still works end-to-end.

**Approval (§B + §D):**

9. As admin, open a pending shop registration that has `location` set. Map deeplink works (opens Google Maps to the pin). Verification checkbox is unchecked → Approve button disabled. Check the box → Approve enables. Approve → shop status flips to 'active' + `locationVerifiedAt` + `locationVerifiedBy` stamped.
10. As admin, manually create a pending shop in Firestore Console without a `location` field. Open ShopRegistrationDetail. Banner shows: `"⚠️ No GPS location captured. Cannot approve until owner re-submits."` Approve button hard-disabled (no checkbox can unlock it).
11. **Server-side defense in depth**: bypass the client (call `approveShop({shopId})` directly via a test script) on a location-less pending shop. Server returns `failed-precondition` with the actionable error message.

**Cloud Run IAM (Rule 11):**

12. After deploy, on both `approveshop` and `listshopspublic`:

    ```
    gcloud run services get-iam-policy <name> --region asia-south1
    ```

    Verify `allUsers / roles/run.invoker`. Add binding if missing.

**Test suite:**

13. `npx tsc --noEmit` clean (root + functions). `npm run test:unit` clean. `npm run test:full` clean. Suite +10 minimum.

---

## Out of scope

- **Map-based location editor** in RegisterShop (drag pin on a map). Existing `useLocationStore` capture is enough for pilot. Phase B if shop owners struggle with "is my pin accurate?".
- **Periodic re-verification** of shop location (e.g. quarterly). The shop's location doesn't really change. Defer.
- **Custom `serviceRadiusKm` at registration** — current default of 5km set at approval works; shop owner can edit in ShopSettings post-approval. No change here.
- **Migration of existing location-less shops** — handled operationally per §E, not in code.

---

## Deploy

**Step 1 — operational pre-deploy check**

```
npx tsx scripts/audit-shops-without-location.ts
```

If output non-empty, message affected shop owners that their listing will be invisible post-deploy until they re-capture location.

**Step 2 — server first**

```
cd functions
npm run build
firebase deploy --only "functions:approveShop,functions:listShopsPublic"
firebase functions:list | findstr -i "approveshop listshopspublic"
```

**Step 3 — IAM verify (mandatory; Rule 11)** per acceptance step 12.

**Step 4 — client OTA**

```
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "PR-NEXT-SHOP-LOCATION-REQUIRED defense in depth"
```

## Doc trail

- `docs/TESTING-FINDINGS-2026-05-30.md` — append Sudhir's June 2 observations #1 + #2 + #3 (radius cluster) → `✅ SHIPPED in PR-NEXT-SHOP-LOCATION-REQUIRED`. Note that #4 + #7 (India team sees nothing) are addressed separately by the operational IAM-verify step + the `showAllShops` flip — both pre-this-PR ops, not code.
- `.windsurf/code-discipline.md` — no rule additions; existing Rule 11 (IAM) covers the deploy hazard.
- `docs/SESSION_LOG.md` — one paragraph.
- `CLAUDE.md` — bump date.
