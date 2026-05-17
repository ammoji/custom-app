# Keyboard handling sweep (Windsurf prompt)

## Why this PR exists

During PR 2 testing on May 17 2026, the `CancelAndRefundModal` had two
bugs:

1. The phone keyboard covered the modal's bottom buttons (no
   `KeyboardAvoidingView`), so the user couldn't reach
   "Cancel and refund" or "Keep order" after typing a reason.
2. Tapping the backdrop (which in React Native is unreliably blocked
   by a nested `Pressable` with `onPress={() => {}}`) closed the
   modal entirely, wiping the typed reason.

Both were fixed in `src/components/order/CancelAndRefundModal.tsx`
during testing. The fix pattern:

- Wrap content in `<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>`
- Replace `<Pressable backdrop><Pressable card></Pressable></Pressable>`
  with a column-stacked `<Pressable backdropTapZone /><View card />`
  inside the KAV.
- Backdrop tap calls `Keyboard.dismiss()` ONLY — does NOT close the
  modal. Modal closes only via an explicit dismiss button.

The same pattern needs to ship to every other modal in the codebase
that contains a `TextInput`. None of them are blocking launch, but
they all have the same bugs and family testing will hit them.

## Read first

- `src/components/order/CancelAndRefundModal.tsx` — reference
  implementation (already shipped with the fix). Copy this exact
  pattern.
- `.windsurf/test-discipline.md` — UI fixes don't get unit tests
  (Modal + KeyboardAvoidingView interaction needs an emulator). Run
  `npx tsc --noEmit` and a build before reporting back; that's the
  full acceptance.
- `.windsurf/deploy-discipline.md` — no functions change; only OTA.

## Scope (in)

### Phase 1 — Known input modals

Apply the `CancelAndRefundModal` keyboard pattern to these files.
Each contains a `Modal` with a `TextInput` and exhibits the same
bugs:

1. `src/screens/admin/UserDetailScreen.tsx` — confirm modal for
   revokeShopOwner / revokeDelivery / suspendShop. Single modal,
   three trigger paths.
2. `src/screens/admin/ShopDetailManagementScreen.tsx` — suspend shop
   modal (reason input).
3. `src/screens/admin/ShopRegistrationDetailScreen.tsx` — reject
   shop modal (reason input).
4. `src/screens/admin/DeliveryRequestDetailScreen.tsx` — reject
   delivery request modal (reason input).

For each: same pattern as `CancelAndRefundModal`:
- Add `Keyboard`, `KeyboardAvoidingView`, `Platform` to the
  `react-native` imports (the auto-formatter on save will try to
  strip unused imports — verify after save).
- Wrap modal content in `<KeyboardAvoidingView behavior={...} style={styles.kavRoot}>`.
- Replace the outer-Pressable-backdrop + inner-Pressable-card structure
  with `<Pressable backdropTapZone onPress={Keyboard.dismiss} /><View card>`.
- Add `kavRoot` (flex:1 + dark backdrop + justify-end) and
  `backdropTapZone` (flex:1) to styles.
- Remove any old `backdrop` style that's now unused.
- Backdrop tap dismisses keyboard ONLY. Modal close goes through
  the explicit dismiss button on each screen (Cancel / Keep / etc).

### Phase 2 — Verify full-screen input forms

Run a quick sweep over screens that have `TextInput` but are NOT in a
Modal. Most should already work because they're inside a `ScrollView`
and React Native handles keyboard adjustment automatically — but
verify each one's TextInputs are reachable when the keyboard opens.
Files to inspect:

- `src/screens/CheckoutScreen.tsx`
- `src/screens/AddressEditScreen.tsx`
- `src/screens/roles/RegisterShopScreen.tsx`
- `src/screens/roles/BecomeDeliveryPartnerScreen.tsx`
- `src/screens/LoginScreen.tsx` (OTP entry)
- `src/screens/shop/AddCustomMenuItemScreen.tsx`
- `src/screens/shop/ShopMenuItemEditScreen.tsx`

For each: check that the screen uses `ScrollView` AND that any
TextInput near the bottom of the form is reachable when focused. If
NOT (i.e. TextInput is in a fixed-position View, or the form is
long enough that the last input gets hidden), wrap the form in
`<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>`
above the SafeAreaView's child.

For LoginScreen specifically: OTP is a short input usually visible
above the keyboard. If it's working today, leave it.

If a screen already has `KeyboardAvoidingView` or uses
`react-native-keyboard-aware-scroll-view`, skip it. Just verify and
move on.

### Phase 3 — Reference comment in CancelAndRefundModal

The existing comment in `CancelAndRefundModal.tsx:92-101` explains
the pattern. After this PR ships, add a brief mention on top of the
file that this is the canonical pattern other input modals follow:

```ts
/**
 * ...existing doc...
 *
 * Keyboard handling pattern reference: the KAV + backdropTapZone +
 * dismiss-keyboard-only-on-backdrop-tap pattern in this file is
 * mirrored across all other input modals (UserDetailScreen,
 * ShopDetailManagementScreen, ShopRegistrationDetailScreen,
 * DeliveryRequestDetailScreen). If you fix a keyboard or
 * tap-dismiss bug here, propagate to those.
 */
```

## Scope (out — explicitly defer)

- **Don't migrate to a 3rd-party keyboard library** (e.g.
  `react-native-keyboard-aware-scroll-view`). The built-in
  `KeyboardAvoidingView` works for these cases; adding a dep for a
  one-line behavior swap isn't worth it.
- **Don't add scroll behavior to the modals.** They're short enough
  that lifting above the keyboard is sufficient. If a modal grows
  long post-launch, wrap content in `ScrollView` then.
- **Don't change full-screen forms that already work.** If a screen
  has no keyboard issue today (TextInputs reachable when focused),
  leave it alone — adding KeyboardAvoidingView can sometimes
  introduce new layout bugs (extra padding above keyboard on
  Android, etc).

## Acceptance checklist

- [ ] All 4 admin modals (UserDetail, ShopDetailManagement,
      ShopRegistrationDetail, DeliveryRequestDetail) use the
      `CancelAndRefundModal` pattern.
- [ ] `Grep` for `<Modal` in `src/` confirms no other input modals
      are missed (check what's there beyond the 4 listed).
- [ ] Each updated modal's `react-native` import block includes
      `Keyboard`, `KeyboardAvoidingView`, `Platform` and the
      auto-formatter doesn't strip them.
- [ ] Full-screen form sweep is documented in your report:
      which screens were checked, which (if any) needed
      KeyboardAvoidingView added, which were already correct.
- [ ] `CancelAndRefundModal.tsx` top doc comment mentions the
      pattern is canonical.
- [ ] `npx tsc --noEmit` — 0 new errors (baseline preserved).
- [ ] No unit tests added (UI fix; no helper changes). `npm test`
      still passes at the existing count.

## Deploy plan (hand to user)

Pure JS-only client changes. No functions, no rules, no indexes.

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
eas update --branch preview --message "Keyboard handling sweep — all input modals"
```

After OTA, force-reload the app, open each modal, type a long-ish
reason, confirm:
- Keyboard appears, modal lifts above it, buttons visible.
- Tapping the dark backdrop dismisses keyboard, keeps modal open.
- Explicit dismiss button closes modal.

If all 4 admin modals behave correctly, promote:

```powershell
eas update --branch production --message "Keyboard handling sweep — all input modals"
```

## Reporting back

- List of modal files updated + a brief note on any that you
  expected to find but were already correct (e.g. if there's a
  modal you found that doesn't have a TextInput — no fix needed).
- Full-screen form sweep results: per-file status (already correct
  / needed KAV added / no TextInput / N/A).
- Output of `npx tsc --noEmit` (error count, baseline vs new).
- Output of `npm test` (just the Tests:/Suites: summary line).
- The two deploy commands handed back — NOT executed.

## Design notes for Windsurf

- The CancelAndRefundModal pattern is deliberately strict: backdrop
  tap does NOT close the modal. This was the conscious fix for the
  "wipe my typed reason by accident" problem during PR 2 testing.
  Don't soften this for other modals.
- The auto-formatter import-stripping issue (documented in PRs 1
  and 12c) likes to drop newly-added imports. Add the three new
  imports (`Keyboard`, `KeyboardAvoidingView`, `Platform`), save,
  then grep the file to confirm they survived. If not, re-add and
  ensure each is used in the body BEFORE saving again.
- React Native's `Platform.OS === 'ios' ? 'padding' : undefined`
  is intentional. On Android, the system handles keyboard layout
  better with `behavior` left unset and `android:windowSoftInputMode="adjustResize"`
  (which is the Expo default). Forcing `behavior='height'` on
  Android often causes glitchy double-resize.
