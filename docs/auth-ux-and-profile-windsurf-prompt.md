# Auth UX + Profile + Saved Addresses — Windsurf prompt

## Why this PR exists

Two real UX gaps surfaced during Sudhir's solo testing:

1. **No way to sign out.** `authService.signOut()` exists but is never
   called from anywhere in the app. Multi-user testing is literally
   blocked because once you sign in, you can't switch users without
   uninstalling the app. This is the immediate blocker for solo +
   family testing.
2. **No saved profile or addresses.** Customers re-type their full
   address (name, phone, line1, line2, city, pincode) on every
   single checkout. Production-unacceptable UX. Same applies to
   email — never captured anywhere despite being useful for
   receipts/notifications.

This PR fixes both with a single coherent `/users/{uid}` schema
extension + a new Profile screen + auto-fill at checkout. Sized as
one PR (not split) because the schema + Cloud Functions are shared,
and a half-built version (sign-out only, no profile) just creates
re-work later.

## Read first

- **`.windsurf/test-discipline.md`** — tests run **once at end**,
  plus the deliberate-break demo. Use `npm test` (audit + unit) or
  `npm run test:full` (adds rules) — pick the narrowest one your
  changes warrant. This PR doesn't touch `firestore.rules`, so
  `npm test` is enough.
- `.windsurf/deploy-discipline.md`
- `src/services/authService.ts` (existing `signOut` method to call)
- `src/components/AuthBootstrap.tsx` (auth subscription that drives
  `useAuthStore`; sign-out should flow through it cleanly)
- `src/screens/CheckoutScreen.tsx` (existing address-entry form to
  refactor)
- `src/screens/HomeScreen.tsx` (where the new Profile/Sign-Out entry
  point lives)
- `functions/src/index.ts` (existing `registerPushToken` /
  `becomeDelivery` show the `/users` doc shape we're extending)
- `tests/jest.unit.config.js` and `tests/__mocks__/` — unit-test infra
  to extend

## Scope (in)

### A. Schema

Extend `/users/{uid}` Firestore doc with optional fields:

```ts
{
  // existing
  uid: string;
  phone?: string;            // captured from auth.phoneNumber on first save
  fcmTokens?: string[];      // already used by registerPushToken
  isAdmin?: boolean;         // already used by pushToAdmins
  deliveryStatus?: 'online' | 'offline';  // already used by Phase 12b

  // new
  name?: string;
  email?: string;
  addresses?: SavedAddress[];
  defaultAddressId?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}
```

`SavedAddress` shape:

```ts
type SavedAddress = {
  id: string;          // server-generated UUID
  label?: string;      // 'Home' / 'Office' / etc, optional free text
  name: string;        // recipient (may differ from profile.name)
  phone: string;       // recipient phone (may differ from profile.phone)
  line1: string;
  line2?: string;
  city: string;
  pincode: string;     // 6 digits, validated
  createdAt: number;   // epoch ms
  updatedAt: number;
};
```

### B. Cloud Functions

Five new callables, all under `functions/src/index.ts`, all
auth-required (no anon allowed). Region `asia-south1` per existing
pattern.

1. `getMyProfile()` → returns the calling user's full profile doc
   `{ profile, addresses, defaultAddressId }`. Creates the doc on
   first call if missing (idempotent), seeded with `phone` from
   `auth.token.phone_number`. Never returns fcmTokens or isAdmin —
   those are server-internal fields.

2. `updateMyProfile({ name?, email? })` → patches name/email.
   Validates: name length ≤ 80, email matches a basic regex (no
   need to be RFC-perfect, just `^[^\s@]+@[^\s@]+\.[^\s@]+$`), both
   trimmed. `null` or empty string clears the field.

3. `saveAddress(address)` → adds OR updates an address. If
   `address.id` is present and exists in the user's addresses,
   updates it; otherwise generates a new UUID and appends. Returns
   `{ id }`. Validates: `name` non-empty, `phone` matches Indian
   10-digit format (`/^[6-9]\d{9}$/`), `line1` non-empty, `city`
   non-empty, `pincode` matches `/^\d{6}$/`. Sets `updatedAt` to
   server time. If this is the user's first address, also sets
   `defaultAddressId` to its id atomically.

4. `deleteAddress({ id })` → removes the address with that id. If
   it was the default, promotes another address to default
   (most-recent-by-updatedAt wins). If no addresses remain, sets
   `defaultAddressId` to null.

5. `setDefaultAddress({ id })` → throws `not-found` if the id isn't
   in the user's addresses; otherwise sets `defaultAddressId`.

All five must be **idempotent** for retries — calling
`saveAddress` with the same payload twice should produce one row,
not two (achieved via the id-or-new-uuid logic).

### C. Service layer

In `src/services/`:

1. New `profileService.ts` with the five callables, Platform.OS
   dispatch like `orderService` (web SDK on web, RNFB callable on
   native). Match the existing service patterns exactly.

2. Existing `authService.signOut()` stays as-is. The sign-out flow
   needs one new helper: `signOutAndClearLocalState()` that calls
   `signOut`, then clears `useCartStore`, clears any other persisted
   stores that should not survive a user switch (`useAuthStore`
   resets via the auth subscription firing), then navigates to Home.
   This goes in `authService.ts` next to `signOut`.

### D. Screens

1. **New `ProfileScreen`** at `src/screens/ProfileScreen.tsx`.
   - Header: phone (read-only, from auth)
   - Form: name (text input), email (text input, optional)
   - Save button → calls `updateMyProfile`
   - Section: "Saved addresses" with each address as a card
     (label + line1, default chip if applicable)
     - Tap a card → navigate to `AddressEditScreen` with that id
     - "Add new address" button → navigate to `AddressEditScreen`
       with no id
     - Long-press a card → action sheet with "Set as default" /
       "Delete"
   - Section: "Account" with **Sign Out** button at the bottom
     (red, with a confirm modal)

2. **New `AddressEditScreen`** at `src/screens/AddressEditScreen.tsx`.
   - Form fields: label (optional), recipient name, recipient phone,
     line1, line2, city, pincode
   - Server-side validation duplicated client-side for instant feedback
   - "Save" button → calls `saveAddress`
   - "Delete" button (only when editing existing) → confirm modal →
     calls `deleteAddress`

3. **Modify `HomeScreen`**: add a row between "My Orders" and the
   sign-in row (for anon users) / "Your Roles" section. Looks like:
   ```
   👤  Profile  ›
   ```
   Tapping it navigates to `ProfileScreen`.

4. **Modify `CheckoutScreen`**: replace the existing address form
   with:
   - If user has ≥1 saved address: show them as selectable cards
     (default selected by default), with a "Use a different address"
     CTA at the bottom that switches to the form
   - If user has 0 saved addresses: show the existing form
   - After successful checkout (in either case), if the address used
     was NOT a saved one, prompt: "Save this address for next time?"
     → calls `saveAddress`. If user has 0 addresses, save it
     automatically without asking (it becomes their default).

5. **Register routes** in `AppNavigator.tsx`:
   ```
   Profile: undefined;
   AddressEdit: { addressId?: string } | undefined;
   ```

### E. Auto-fill helper

New util in `src/utils/`:

```ts
// src/utils/addressFormatting.ts
export function addressToCheckoutFields(addr: SavedAddress): {
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  pincode: string;
};

export function checkoutFieldsToAddress(
  fields: ReturnType<typeof addressToCheckoutFields>,
  label?: string,
): Omit<SavedAddress, 'id' | 'createdAt' | 'updatedAt'>;
```

Pure functions; no React, no React Native imports. Trivially testable.

### F. Tests (mandatory, per `.windsurf/test-discipline.md`)

Add tests under `tests/services/`, `tests/functions/`, and
`tests/utils/` — all use the existing `jest.unit.config.js`. No new
test infra.

Required test count: **≥18 tests**. Suggested split:

1. `tests/utils/addressFormatting.test.ts` (≥4 tests)
   - `addressToCheckoutFields` round-trip with all fields
   - `addressToCheckoutFields` handles missing optional `line2`
   - `checkoutFieldsToAddress` produces an Omit'd shape (no id /
     createdAt / updatedAt)
   - `checkoutFieldsToAddress` accepts an optional label

2. `tests/functions/profileValidation.test.ts` (≥6 tests)
   - Extract validation helpers from `updateMyProfile` and
     `saveAddress` into pure functions (`validateProfilePatch`,
     `validateAddressInput`) so they can be unit-tested without
     firebase-admin. Same architectural pattern as
     `scripts/reset-test-data.helpers.ts`.
   - `validateProfilePatch` accepts valid name + email
   - `validateProfilePatch` rejects name longer than 80 chars
   - `validateProfilePatch` rejects malformed email
   - `validateProfilePatch` accepts empty/null to clear
   - `validateAddressInput` rejects bad pincode (5 digits, alpha,
     etc.)
   - `validateAddressInput` rejects bad phone (starts with 0, 11
     digits, etc.)

3. `tests/services/profileService.test.ts` (≥4 tests)
   - Native dispatch for `saveAddress` calls the right callable
   - Web dispatch for `updateMyProfile` uses web functions SDK
   - Error from callable propagates to caller
   - `getMyProfile` returns the parsed shape

4. `tests/services/authService.signOut.test.ts` (≥2 tests)
   - `signOutAndClearLocalState` calls `signOut`
   - `signOutAndClearLocalState` resets `useCartStore`
   - (UI-level navigation isn't tested here — RNTL is still out of
     scope)

5. `tests/utils/defaultAddressPromotion.test.ts` (≥2 tests)
   - When deleting the default address, the most-recently-updated
     remaining address is promoted
   - When deleting the last address, `defaultAddressId` becomes null

   (Extract this logic from the `deleteAddress` Cloud Function into
   a pure helper, same pattern.)

**Deliberate-break demo required.** Suggest reverting one of the
validation rejections (e.g. accept any pincode) and confirming the
corresponding test fails by name. Same ritual as the cleanup script
PR.

### G. Deploy + OTA + checklist

Per deploy discipline:

```
firebase deploy --only functions:getMyProfile --project grocery-mvp-dev
firebase deploy --only functions:updateMyProfile --project grocery-mvp-dev
firebase deploy --only functions:saveAddress --project grocery-mvp-dev
firebase deploy --only functions:deleteAddress --project grocery-mvp-dev
firebase deploy --only functions:setDefaultAddress --project grocery-mvp-dev
firebase functions:list --project grocery-mvp-dev
```

(Five separate deploys, one per function. **Do NOT** chain them with
`functions:getMyProfile,updateMyProfile,...` — single `--only` target
per command, per the discipline doc.)

Then OTA:

```
eas update --branch preview --message "auth UX + profile + saved addresses"
```

Update `PRELAUNCH_CHECKLIST.md`:
- Move the existing "Sign out gap" / "Address re-entry" follow-up
  items (if any) to Done
- Add new tracked items for any deferred work surfaced during the PR

## Scope (out — explicitly defer)

- **Multiple shipping addresses per order** — one address per order,
  same as today. Saved addresses are about reuse, not splitting.
- **Address geocoding** — pincode is the only structured location
  data; we don't reverse-geocode line1/2 to lat/lng. Distance
  calculations on orders still use shop location only.
- **Profile picture upload** — no avatars. Phone + name + email is
  enough for MVP receipts.
- **Email verification flow** — accept the email at face value;
  don't send a verification link. Add later if email becomes
  important for marketing/notifications.
- **Address autocomplete (Google Places, etc.)** — manual entry only.
- **Importing addresses from past orders** — fresh start; users build
  their address book from this PR forward. Past order addresses
  remain on the order docs but don't auto-populate the address book.
- **Multi-recipient name/phone vs. account name/phone** —
  intentionally allowed (recipient differs from account holder for
  gift orders, sending to family, etc.). UI doesn't try to enforce
  match.
- **"Edit Profile" Cloud-Function-side governance** (admin editing
  another user's profile) — out of scope; admin governance is for
  roles/suspensions, not personal data.
- **React Native rendering tests (RNTL)** — still out of scope.
  Hook + helper + service tests cover the bug surface.

## What stays unchanged

- `firestore.rules` — `/users/{uid}` rule already says `read,write
  if isOwner(uid)`. The new fields are just more keys in the same
  doc the user already owns. **Do not modify rules.**
- The 11 pre-existing TS errors stay — don't fix them in this PR
- `orderService` and the watcher contract from the earlier hotfix
- The cleanup script (its `protectAdminFromUserList` etc. continue
  to work since `/users` doc shape is just being extended, not
  restructured)
- Web behaviour stays parity with native — both go through the same
  callables ultimately

## Acceptance checklist

- [ ] All 5 Cloud Functions deployed (one `--only` deploy each,
      not chained); `firebase functions:list` shows all 5 with
      recent updateTimes
- [ ] `npm test` passes — total unit test count ≥ 64 (46 prior + ≥18
      new); audit clean
- [ ] `npx tsc --noEmit` shows the same 11 pre-existing errors,
      0 new
- [ ] Deliberate-break demo executed and reverted; failing test
      name captured in the report
- [ ] On Sudhir's Android phone (after OTA + force-restart x2):
   - Tapping the new 👤 Profile row on Home opens ProfileScreen
   - Editing name + email saves correctly (verify via re-opening
     the screen)
   - Adding an address saves; appears in list with Default chip
     (since it's the first)
   - Adding a 2nd address — tap the 1st address → Set as default —
     verify chip moves
   - Delete the default address — verify another is promoted
   - Sign Out button → confirm modal → tap Sign Out → returns to
     Home in anonymous state (no Your Roles section, sign-in CTA
     visible)
- [ ] Sign in as a test phone number, place an order through
      Checkout, see saved-address picker if any addresses exist
      OR the entry form if none — and after the order, see the
      "Save this address?" prompt (or auto-save if it was the
      first)
- [ ] Tests run **once** at the very end + the deliberate-break
      cycle. No iterative re-runs.

## Reporting back

- Output of each `firebase deploy --only functions:<name>` (raw,
  not piped through Select-Object or Out-File)
- The functions:list excerpt showing all 5 new entries
- Total test count from `npm test`
- The deliberate-break demo: what was reverted, which test failed
  by name, that it was reverted, that it's green again
- The OTA `eas update` output with group ID + iOS + Android IDs
- Files added/modified — paths + line counts
- Any safety/UX guards added beyond what's specified
- Anything you noticed but did NOT fix (logged for follow-up)

## Important — do not

- Do not modify `firestore.rules` — the new `/users` fields are
  inside the existing `isOwner(uid)` write rule, no rule change
  needed
- Do not fix the 11 pre-existing TS errors in this PR
- Do not add a new test runner or jest config — extend the existing
  `jest.unit.config.js`
- Do not add full React Native rendering tests (RNTL) — separate PR
- Do not auto-format files outside the diff
- Do not `chain` multiple `--only` targets in a single `firebase
  deploy` command (per deploy discipline)
- Do not commit anything — leave staged for Sudhir's review
- Do not silently fix bugs you discover during the PR — surface
  every finding in the report
- Do not run tests iteratively during development — tests run at
  the end + during the deliberate-break demo. Two runs total.
