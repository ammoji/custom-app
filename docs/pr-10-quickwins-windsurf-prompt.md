# PR 10 — Quickwins bundle: shop radius + mandatory profile fields + Resend OTP (Windsurf prompt)

## Why this PR exists

Three small items bundled into one OTA so the team currently testing
gets all the fixes at once instead of three sequential force-quit-and-
reopen cycles.

**Part 1: Remove shop distance filter.** Testers in different Indian
cities can't see each other's shops because `shopService.ts` filters
results to a 1 km radius from the tester's location. There's already
a `FORCE_SHOW_ALL_SHOPS_IN_DEV` flag, but it's gated on `__DEV__`
which is `false` in TestFlight production builds. We need this off
across the board for the testing phase, with a clear path to turn it
back on for real-customer launch.

**Part 2: Mandatory profile fields.** Phone is auto-populated from
OTP, but full name is currently optional — leaving the profile in a
half-set state that bites later (e.g. delivery address book defaults
the name from profile.fullName). Make full name required on first
sign-in / profile setup.

**Part 3: Resend OTP button** — already coded on disk in
`src/screens/LoginScreen.tsx`. Include in this PR's commit so it
ships with the other two in one OTA.

JS-only. No native module changes. No schema changes. Ships via
`eas update` to existing TestFlight build.

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md`.
- `src/services/shopService.ts` — `getNearbyShops` has the 1km filter
  and the existing `FORCE_SHOW_ALL_SHOPS_IN_DEV` flag. Part 1 widens
  this.
- `src/screens/ProfileScreen.tsx` (or whatever the profile-edit screen
  is named; check `src/screens/` and `src/navigation/AppNavigator.tsx`
  for the route).
- `src/screens/LoginScreen.tsx` — already has the uncommitted Resend
  OTP changes from the prior debugging session. Verify the diff
  matches what's described in Part 3 below before committing.
- `src/services/profileService.ts` (or similar) — validation surface
  for profile updates. If validation is server-side via a callable,
  also check `functions/src/profileHelpers.ts`.

## Scope (in)

### Part 1 — Open up shop radius for testing

In `src/services/shopService.ts`, change the radius gate so testers
across India can see all active shops. Two options — pick **Option A**
unless there's a reason to keep client-side toggling:

**Option A (recommended):** Replace the constant with a runtime flag
sourced from a future Settings doc, but for now just default it to
`true`:

```ts
// Phase-of-testing flag. While the team is testing across multiple
// Indian cities, every tester should see every active shop regardless
// of distance. Flip back to a 1km filter once we're ready for real-
// customer launch (and ideally make this server-side configurable per
// pincode / state at that point).
const SHOW_ALL_SHOPS = true;
const NEAR_KM = 1;
```

Then in `getNearbyShops`, replace:

```ts
.filter(s => FORCE_SHOW_ALL_SHOPS_IN_DEV || (s.distanceKm ?? 0) <= NEAR_KM)
```

with:

```ts
.filter(s => SHOW_ALL_SHOPS || (s.distanceKm ?? 0) <= NEAR_KM)
```

In **both** the web branch and the native callable-result branch.
Remove the `FORCE_SHOW_ALL_SHOPS_IN_DEV` constant entirely — it's
been superseded.

**Server-side too:** the `listShopsPublic` callable in
`functions/src/index.ts` likely also does distance filtering server-
side. Verify by grep. If yes, add the same `SHOW_ALL_SHOPS` constant
in functions/src/ (separate copy — the codebases don't share consts)
and gate the server filter the same way. If the callable currently
returns all active shops sorted by distance and lets the client filter,
no server change needed.

Add a comment block above the constant explaining the why so a future
PR doesn't blindly flip it back without considering the testing
context.

### Part 2 — Mandatory phone + full name on profile

Find the profile edit / first-time-setup screen. Likely
`ProfileScreen.tsx` or `ProfileEditScreen.tsx`.

**Phone field**: should already be readonly/auto-filled from the
phone-auth user. If it's currently a text input that can be cleared,
make it readonly (it's the immutable identity anchor — changing it
would require re-auth which isn't a flow we support).

**Full name field**: add validation:

```ts
if (!fullName.trim()) {
  Alert.alert(
    'Name required',
    'Please enter your full name to continue.',
  );
  return;
}
```

Disable the Save button when `fullName.trim().length === 0`. Add a
red asterisk to the "Full Name" label and a small "Required" helper
text below it for first-time setup.

**Server-side enforcement**: the `validateProfilePatch` helper in
`functions/src/profileHelpers.ts` should already reject empty
strings for required fields. Verify it covers `fullName`. If not, add
a check + a test in `tests/functions/profileHelpers.test.ts`.

**First-sign-in flow**: if there's a path where a newly-OTP'd user
gets into the app without filling out the profile (e.g. they skip the
profile screen), gate it. The simplest gate: after `confirmOtp` in
`LoginScreen.tsx`, if `useAuthStore.user.fullName` is empty,
navigate to ProfileScreen with a flag like `requiredSetup: true`
instead of going back to wherever they came from. The profile screen
in `requiredSetup` mode hides the back button until the form is
submitted.

(If this gate is non-trivial to wire up, scope it OUT of this PR and
just add an Alert that says "Please complete your profile before
placing an order" on the order placement screen. Track the proper
gate as a follow-up.)

### Part 3 — Resend OTP button (commit the staged work)

The staged changes to `src/screens/LoginScreen.tsx` should include:

1. New `RESEND_COOLDOWN_SECS = 30` constant
2. `resendCooldown` state + `useEffect` countdown timer
3. `onResendOtp` async handler that calls `authService.startPhoneAuth`
   again and resets the cooldown
4. Specific catch for `auth/too-many-requests` with a clearer error
   message
5. New `<Pressable>` "Resend OTP" link in the OTP phase, showing
   "Resend OTP in Xs" while cooldown active, "Didn't get the code?
   Resend OTP" when ready
6. `linkDisabled` style for the cooldown state
7. Diagnostic `console.error` in `onConfirmOtp` catch block

Verify the diff with `git diff src/screens/LoginScreen.tsx`. If
anything else is in there (e.g. leftover web-debugging changes),
revert that part — only the Resend OTP + diagnostic log should ship
in this PR.

## Scope (out)

- **Admin-configurable distance filter.** Hardcoded `SHOW_ALL_SHOPS =
  true` is fine for testing phase. A server-side setting tied to
  launch-pincode list is a separate PR.
- **Allow phone number change.** Phone is identity, immutable. Out
  of scope.
- **Profile photo / address upload.** Out of scope.

## Acceptance checklist

- [ ] `src/services/shopService.ts`: `FORCE_SHOW_ALL_SHOPS_IN_DEV`
  removed, `SHOW_ALL_SHOPS = true` constant added, both branches
  (web + native) use it.
- [ ] If `functions/src/index.ts` had a server-side distance filter
  in `listShopsPublic`, mirror the same flag there.
- [ ] Profile screen: full name required, save disabled when empty,
  red asterisk on label.
- [ ] Phone field on profile is readonly (or already was).
- [ ] `validateProfilePatch` rejects empty fullName + a test pins it.
- [ ] LoginScreen Resend OTP block matches Part 3 spec.
- [ ] `npx tsc --noEmit` (root + functions): 0 errors (PR 8.1
  baseline preserved).
- [ ] `npm run audit` passes (auto-formatter tripwire).
- [ ] `npm test`: all 476+ tests pass plus any new ones added for
  Part 2's validation.
- [ ] Deliberate-break demo: change the fullName-required test to
  expect the wrong message, confirm it fails, then revert.
- [ ] Zero new `DO NOT REMOVE` markers (auto-formatter fix should
  hold from PR 8.1 + PR 9).

## Smoke tests (manual, after deploy)

1. **Tester in Bangalore + tester in Mumbai both see every active
   shop.** Pre-PR: each sees only shops within 1 km of their location
   (often zero). Post-PR: both see all shops.
2. **New phone-auth user is forced to complete profile.** Sign in
   with a fresh test phone → land on Profile → can't proceed until
   Full Name is entered.
3. **Existing user with full name set continues normally.** No regression
   for users already past first-time setup.
4. **Save profile fails server-side if client bypasses validation.**
   Use the Firebase console or a curl test to call `updateProfile`
   with `fullName: ''` directly — server returns invalid-argument.
5. **Resend OTP cooldown works.** Sign out, sign in, on OTP screen
   see "Resend OTP in 30s" countdown. Wait for 0, tap, new SMS
   arrives, cooldown restarts at 30s.

## Deploy plan

Per `.windsurf/deploy-discipline.md`: one `--only` target per command.

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Functions (only if Part 2 modified validateProfilePatch server-side)
cd functions
npm run build
cd ..
firebase deploy --only functions --project grocery-mvp-dev

# 2. Client OTA
npm test                 # final pre-OTA confirmation
eas update --branch preview --message "PR 10 quickwins"

# 3. Verify on preview channel (set TestFlight to preview if not already)
# 4. Promote
eas update --branch production --message "PR 10 quickwins"
```

If Part 2 didn't change anything in `functions/`, skip the functions
deploy entirely — pure client change ships in one `eas update`.

## Estimated time

~1.5–2 hours Windsurf work:

- Part 1: 15 min (find filter, replace constant, mirror in functions if needed)
- Part 2: 45 min (profile screen UI + validation + first-sign-in gate)
- Part 3: 10 min (already coded, just commit + diff-check)
- Tests + verification: 20–30 min

All JS — no EAS rebuild — ships via OTA to existing TestFlight build.
