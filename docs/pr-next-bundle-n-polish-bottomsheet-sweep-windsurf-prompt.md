# PR-NEXT-BUNDLE-N — Polish + Rule 13 BottomSheet sweep

**Cascade-on-Sonnet handoff prompt** · Author: Claude · Drafted: 2026-06-13 (Sat evening, CST)

Four deferred items bundled. **All can ship in one Devin run.** This
is intentionally lower-risk than Bundle M — small surfaces, no
server-side data-model changes, mostly mechanical.

---

## Why this exists

CLAUDE.md's "Phase B features deferred" list has accumulated four
polish items that are individually too small for their own PR. They're
also all roughly the same shape (small client touch, optional 1-2
callable touches, ~3-6 tests each). Bundling them lets Devin work
through them in one session with shared discipline + verification.

The four items:

1. **§A — Admin order comments** (PR 42.1.2). Today admins (= Sudhir)
   have no way to leave a note on an order during support
   investigation. They have to write in a separate spreadsheet, which
   means when they revisit the order later, context is gone. Add
   `adminComments: AdminComment[]` to the order doc + an
   `addAdminOrderComment` callable + a composer + a render block in
   AdminOrdersScreen detail view.

2. **§B — STATIC-MAP-PREVIEW** (#12b). When admin reviews a shop
   registration or a customer order, they currently see lat/lng as
   numbers — useless for confirming "is this pin in a reasonable
   place." Add a small static-map image preview (no react-native-maps
   dep — uses OSM staticmap URL, OTA-safe) on the shop detail screens
   and the customer order detail screens.

3. **§C — Required vehicleType validation** for delivery partner
   onboarding. The picker UI already exists in
   `BecomeDeliveryPartnerScreen` and `DeliveryProfileScreen`, but
   you can save without picking. Make it required at registration,
   and dirty-mark required in profile edit. This is the "vehicleType
   picker UI" item from CLAUDE.md's Phase B list (the UI was
   built; the gate wasn't).

4. **§D — Rule 13 BottomSheet sweep** across 4 admin screens. The
   `noBottomAnchoredModalAudit` Rule 13 audit-grep has been deferred
   on these since HOTFIX-7. Mechanical migration to the shared
   `BottomSheet` primitive at `src/components/common/BottomSheet.tsx`.

---

## Read first

1. `CLAUDE.md` — current state, Bundle M status.
2. `docs/PROMPT_AUTHORING_NOTES.md` — Rule 5 + verification block.
3. `.windsurf/code-discipline.md` — **Rule 13** (every bottom-anchored
   sheet uses `BottomSheet`).
4. `src/components/common/BottomSheet.tsx` — the shared primitive.
   Its docstring explains the inner-press-swallow + safe-area pattern.
5. `src/screens/admin/AdminOrdersScreen.tsx` — §A primary surface.
6. `src/screens/admin/ShopDetailManagementScreen.tsx` — §B primary
   surface + one of the §D migration targets.
7. `src/screens/roles/BecomeDeliveryPartnerScreen.tsx` lines ~67 + 306
   — existing vehicleType picker for §C.
8. `src/screens/delivery/DeliveryProfileScreen.tsx` lines ~53 + 280
   — same picker on the profile-edit side.

---

## Discipline checklist

- [ ] **Rule 5** consumer audit on every new field.
- [ ] **Rule 5 #14** required completion-report verification block.
- [ ] **Rule 11** IAM `allUsers` verify on the one new callable.
- [ ] **Rule 13** (BottomSheet) — no new `<Modal` introduced; all 4
      admin screens migrated.
- [ ] **Rule W** — complete autonomously, deliberate-break demos.
- [ ] **PROMPT_AUTHORING_NOTES Rule 8** — FEATURES.md update
      instructions in §H.

---

## §A — Admin order comments

### Schema

Add to the `Order` type (schema-additive):

```ts
type AdminComment = {
  uid: string;
  displayName: string;
  text: string;
  createdAt: number; // ms since epoch
};

// On Order:
adminComments?: AdminComment[];
adminCommentsLastAt?: number; // for sort/filter in admin list
```

Default: undefined → treated as empty array on read. No backfill
needed.

### Server callable

```ts
export const addAdminOrderComment = onCall<{
  orderId: string;
  text: string;
}>(...);
```

Auth: admin only (claims.admin === true).
Validation:
- text trimmed, length 1..2000
- order doc must exist
- read → arrayUnion(comment) → write, all in a transaction

Audit log entry written (existing audit log pattern in functions/src).

### Pure helper

`functions/src/adminOrderCommentHelpers.ts` (and mirrored at
`src/utils/adminOrderCommentHelpers.ts`):

```ts
export function validateAdminCommentText(text: string):
  | { ok: true; trimmed: string }
  | { ok: false; reason: 'empty' | 'too_long' };

export function formatAdminCommentTimestamp(createdAt: number): string;
// "2:34 PM · 13 Jun 2026" — short relative-ish format
```

Unit tests on validateAdminCommentText:
- empty string → `'empty'`
- whitespace only → `'empty'`
- 2001 chars → `'too_long'`
- normal text → `{ ok: true, trimmed }`

### Client surface

Edit `src/screens/admin/AdminOrdersScreen.tsx` — the existing per-order
detail/expand view (find the panel that shows order details):

Add a "Admin comments" section below order info:

```
─── Admin comments ───
13 Jun · 2:34 PM · Sudhir
  Customer called about missing item — partner confirms
  delivered, will re-check with shop.

13 Jun · 2:48 PM · Sudhir
  Resolved — shop confirmed item was left out, refunded.

[ Add note...                                  ]
[ + Add ]
```

Composer:
- Multi-line `TextInput` with `maxLength={2000}`.
- Submit button disabled while text is empty after trim.
- Submitting calls `addAdminOrderComment`, optimistically appends to
  local list, refetches order on success or rolls back on error.

### Tests (~+9)
- `validateAdminCommentText` × 4 cases above
- `addAdminOrderComment` non-admin → permission-denied
- `addAdminOrderComment` admin + missing order → not-found
- `addAdminOrderComment` admin + valid text → arrayUnion success
- `addAdminOrderComment` admin + 2001 chars → InvalidArgument
- `addAdminOrderComment` admin + empty text → InvalidArgument

---

## §B — STATIC-MAP-PREVIEW

### Pure helper

`src/utils/staticMapHelpers.ts`:

```ts
/**
 * Bundle N — Build a free-tier OpenStreetMap static-map URL with
 * a single marker pin. NO react-native-maps required — this is just
 * an `Image` source. OTA-safe.
 *
 * Provider: https://staticmap.openstreetmap.de — community-run,
 * no API key, no rate-card. If it ever fails/disappears, swap to
 * a self-hosted tile renderer. For pilot scale this is fine.
 *
 * Returns null when lat/lng are missing or out of range — the caller
 * shows a "Location not set" fallback chip instead of a broken image.
 */
export function buildStaticMapUrl(
  location: { lat?: number; lng?: number } | null | undefined,
  opts?: { width?: number; height?: number; zoom?: number },
): string | null;
```

Defaults: width=400, height=200, zoom=16.

URL pattern:
```
https://staticmap.openstreetmap.de/staticmap.php
  ?center={lat},{lng}
  &zoom=16
  &size=400x200
  &markers={lat},{lng},red
```

### Component

`src/components/common/StaticMapPreview.tsx`:

Renders `<Image source={{ uri: url }} />` with rounded corners and a
fallback `<View>` ("📍 Location not set") when `buildStaticMapUrl`
returns null. Wraps in a `Pressable` that opens the lat/lng in the
device's maps app via `Linking.openURL('https://www.google.com/maps?q=...')`
on tap (same pattern as `openMapsForCoords` in `src/services/maps.ts` —
reuse if present).

### Surfaces

Add the preview to:

1. **`src/screens/admin/ShopDetailManagementScreen.tsx`** —
   under the shop info section, before the actions row.
2. **`src/screens/admin/ShopRegistrationDetailScreen.tsx`** —
   so the admin can eyeball the pin BEFORE approving.
3. **`src/screens/ShopOrderDetailScreen.tsx` (shop-side)** —
   under the delivery address, so the shop can sanity-check
   the customer's pin before handing the order to a partner.
4. **`src/screens/admin/DeliveryRequestDetailScreen.tsx`** if
   request has a location field (verify via grep first).

### Tests (~+6)
- `buildStaticMapUrl({ lat: 28.5, lng: 77.2 })` → URL contains both
- `buildStaticMapUrl(null)` → null
- `buildStaticMapUrl({})` → null
- `buildStaticMapUrl({ lat: 91, lng: 77.2 })` → null (out of range)
- `buildStaticMapUrl({ lat: 28.5, lng: 200 })` → null (out of range)
- `buildStaticMapUrl(..., { width: 800, height: 400, zoom: 14 })` →
  URL contains size=800x400 and zoom=14

---

## §C — Required vehicleType validation

### BecomeDeliveryPartnerScreen

Make vehicleType **required to submit**:
- Gate the "Submit registration" button on `vehicleType !== undefined`.
- Inline error chip below the picker: "Pick a vehicle type to continue."
- Visible only after user has tapped Submit once (avoid scolding before
  the user even sees the picker).

### DeliveryProfileScreen

Make vehicleType **required to save changes**:
- Gate the Save button on `vehicleType !== null` (since profile may
  initially load with null for a pre-Bundle-N partner).
- Same inline error chip, same "show after first save attempt" rule.

### Server-side defense

Existing `submitDeliveryPartnerRequest` callable (find via grep) should
already reject empty vehicleType. **Add the explicit check + an
InvalidArgument error code** if not present. Doc trail comment that
Rule 5 fail-closed default applies: any callable that writes
`vehicleType` rejects empty/undefined.

### Tests (~+5)
- BecomeDeliveryPartnerScreen renders submit button disabled when
  vehicleType undefined
- BecomeDeliveryPartnerScreen renders submit button enabled when
  vehicleType set
- DeliveryProfileScreen Save disabled when vehicleType null
- submitDeliveryPartnerRequest with empty vehicleType → InvalidArgument
- Existing test: submitDeliveryPartnerRequest with valid input → success
  (verify the new gate doesn't break the happy path)

---

## §D — Rule 13 BottomSheet sweep (4 admin screens)

The four screens currently using raw `Modal`:

1. `src/screens/admin/DeliveryRequestDetailScreen.tsx`
2. `src/screens/admin/ShopDetailManagementScreen.tsx`
3. `src/screens/admin/ShopRegistrationDetailScreen.tsx`
4. `src/screens/admin/UserDetailScreen.tsx`

Mechanical migration for each:

1. Find every `<Modal ...>` block in the file.
2. Replace with `<BottomSheet visible={...} onClose={...}>` wrapping
   the existing children.
3. Remove the raw `Modal` import if no longer used.
4. Remove any hand-rolled `paddingBottom` / `useSafeAreaInsets` calls
   that BottomSheet now handles internally.
5. Audit-grep verifies no raw `<Modal` left in admin/.

### `noBottomAnchoredModalAudit` static guard

This guard already exists in `tests/audits/` (Rule 13). Confirm it
passes after the sweep. If the audit needs an updated allowlist now
that admin/ is migrated, update the allowlist comment in the audit
file itself.

### Tests (~+4)
- Each migrated screen: snapshot or render test that shows the
  BottomSheet renders on visible=true (light test; the BottomSheet
  primitive itself is already tested).

---

## §E — Pure helpers summary (unit-testable, no React)

- `functions/src/adminOrderCommentHelpers.ts` (+ mirrored client copy)
- `src/utils/staticMapHelpers.ts`

---

## §F — Tests (forecast: +24 minimum)

§A: +9
§B: +6
§C: +5
§D: +4
Total: 24

Run targets:
- All four target test files via `npx jest tests/functions/admin-order-comments
  tests/utils/staticMapHelpers tests/screens/BecomeDeliveryPartnerScreen
  tests/audits/noBottomAnchoredModalAudit`
- Full suite: 1828 (after Bundle M) → ≥1852 (after Bundle N)
- `tsc --noEmit` clean both sides
- All 6 static guards pass (with Rule 13 now strict on admin/)

---

## §G — Deploy plan

```powershell
# 1. Functions build
cd functions; npm run build; cd ..

# 2. Deploy the one new callable
firebase deploy --only functions:addAdminOrderComment

# 3. IAM verify (Rule 11)
gcloud run services get-iam-policy addadminordercomment --region=asia-south1 --project=grocery-mvp-dev

# 4. Post-deploy smoke
npm run smoke -- --include=addAdminOrderComment

# 5. Client OTA
eas update --branch production --message "Bundle N — polish + Rule 13 BottomSheet sweep"
```

No Firestore rules changes (Order's adminComments + adminCommentsLastAt
fall under existing admin-write rules — verify via grep on
firestore.rules; add admin-only write rule if missing).

---

## §H — Required completion-report verification block

```
=== Bundle N verification ===

# §A — admin order comment helper + callable
$ grep -n "^export function validateAdminCommentText" functions/src/adminOrderCommentHelpers.ts
<line>:export function validateAdminCommentText(

$ grep -n "^export const addAdminOrderComment = onCall" functions/src/index.ts
<line>:export const addAdminOrderComment = onCall<...

$ grep -n "validateAdminCommentText\|addAdminOrderComment" src/screens/admin/AdminOrdersScreen.tsx
<lines showing both wired into the screen>

# §B — static map helper + component + surface count
$ grep -n "^export function buildStaticMapUrl" src/utils/staticMapHelpers.ts
<line>:export function buildStaticMapUrl(

$ grep -n "StaticMapPreview" src/screens/ -r | wc -l
<expected: ≥3 — one per surface listed in §B>

# §C — vehicleType validation gate
$ grep -n "vehicleType !== undefined\|vehicleType !== null" src/screens/roles/BecomeDeliveryPartnerScreen.tsx src/screens/delivery/DeliveryProfileScreen.tsx
<lines showing both>

# §D — BottomSheet sweep complete; no raw <Modal in admin/
$ grep -n "^import.*Modal\b\|<Modal\b" src/screens/admin/ -r
<expected: zero matches outside allowlisted lines>

$ grep -n "BottomSheet" src/screens/admin/DeliveryRequestDetailScreen.tsx src/screens/admin/ShopDetailManagementScreen.tsx src/screens/admin/ShopRegistrationDetailScreen.tsx src/screens/admin/UserDetailScreen.tsx
<lines — at least one per file>

# Static guards including Rule 13
$ npx jest tests/audits 2>&1 | tail -5
<all guards pass>

# Test count
$ npx jest 2>&1 | tail -5
<≥1852 tests pass>

# Type check
$ npx tsc --noEmit && echo "src clean"
src clean

$ cd functions && npx tsc --noEmit && echo "functions clean"
functions clean
```

---

## §I — Deliberate-break demos

**Demo 1: admin-only gate.** Temporarily remove the
`request.auth?.token?.admin === true` check inside
`addAdminOrderComment`. Run the non-admin → permission-denied test →
expect FAIL. Restore → PASS.

**Demo 2: static map out-of-range rejection.** Temporarily remove the
lat/lng range check inside `buildStaticMapUrl`. Run the
"`lat: 91` → null" test → expect FAIL. Restore → PASS.

**Demo 3: vehicleType required.** Temporarily comment out the
`disabled={!vehicleType}` on the Submit button in
BecomeDeliveryPartnerScreen. Run the "submit disabled when vehicle
undefined" test → expect FAIL. Restore → PASS.

**Demo 4: Rule 13 audit.** Temporarily re-introduce a raw `<Modal />`
into one of the migrated admin screens. Run
`tests/audits/noBottomAnchoredModalAudit` → expect FAIL. Restore → PASS.

---

## §J — FEATURES.md updates (Rule 8)

`docs/FEATURES.md` additions/updates:

- **§5.X (Admin panel)** — new "Order comments" subsection. Admins
  can leave threaded comments on any order via AdminOrdersScreen.
  Comments are visible to all admins, audit-logged, max 2000 chars
  per comment.
- **§5.Y (Admin panel)** — static map preview on shop registration,
  shop detail, and delivery request detail screens. OSM-based, no
  API key, OTA-safe.
- **§4.X (Delivery panel)** — vehicleType is now required at
  registration and to save profile changes.
- **§5.10 (Static guards)** — note that Rule 13
  (`noBottomAnchoredModalAudit`) is now strictly enforced on
  `src/screens/admin/`. All 4 admin sheets migrated to BottomSheet.

---

## §K — Out of scope

- **Customer-facing static map** on the customer order detail
  screen (showing where their order is going). Customer already has
  AddressEditScreen's pin via the address book. Adding the preview
  again is redundant.
- **Edit/delete existing admin comments**. Pilot doesn't need it;
  Sudhir is the only admin and can re-add a correction comment.
- **Comment notifications to other admins**. There's only one admin
  today.
- **vehicleType picker visual redesign**. The chip-style picker is
  fine; we're just gating it.
- **Migration of customer-facing screens to BottomSheet**. Already
  done in HOTFIX-7 + post-HOTFIX-7 audit-greps. Bundle N only sweeps
  admin/.

---

## Test count forecast

**+24 minimum.** Total after Bundle M + N: 1828 → ≥1852.

## Estimated Devin quota burn

Small-medium: ~10–15% of weekly quota. Four small additions, mostly
client-side, one callable, no schema migrations. Mechanical sweep on
the BottomSheet front.

End of prompt.
