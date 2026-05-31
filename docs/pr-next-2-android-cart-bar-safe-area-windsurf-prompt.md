# Android cart-bar safe-area-inset fix (Windsurf prompt)

> Small, focused fix surfaced by the May 30 Android validation pass
> (logged as bug #1 in `docs/TESTING-FINDINGS-2026-05-30.md`).
> Customers on Android cannot proceed to checkout because the
> floating "View Cart" bar is covered by the system navigation bar.
> Pilot-blocker for Android.

## Why this PR exists

The customer-facing cart summary bar — "N items · ₹X · View Cart ›"
that floats at the bottom of menu/list/search screens — uses
`position: 'absolute'; bottom: spacing.lg`. That's a flat distance
from the screen edge with no safe-area-inset consideration. iOS's
home-indicator inset happens to be smaller than `spacing.lg`, so the
bar visually clears — masking the bug during iOS testing. Android's
gesture-nav bar is taller; the cart bar ends up *behind* the system
navigation pills, and the "View Cart" tap target is intercepted by
the OS.

The same anti-pattern is in **four** customer screens (HomeScreen,
ShopListScreen, ShopDetailScreen, SearchScreen). All four need the
same fix. The fix is OTA-safe — pure JS, no native rebuild.

## Read first

- `docs/TESTING-FINDINGS-2026-05-30.md` → bug #1.
- `.windsurf/code-discipline.md` Rule 1 (import-strip discipline —
  this PR adds new imports across 4 files; do not let the LSP
  cascade-remove any of them between edits).
- `.windsurf/code-discipline.md` Rule 2 (hooks above conditional
  early returns — the new `useSafeAreaInsets()` call must sit with
  the other hooks at the top of each component, never inside a
  conditional or after an early return).

## Files to edit (all four — same pattern)

1. `src/screens/HomeScreen.tsx` (`cartBar` style ~line 952)
2. `src/screens/ShopListScreen.tsx` (`cartBar` style ~line 223)
3. `src/screens/ShopDetailScreen.tsx` (`cartBar` style ~line 345)
4. `src/screens/SearchScreen.tsx` (`cartBar` style ~line 439)

## Per-file change pattern

For each of the 4 screens, apply this 3-part change:

**1. Add the import** at the top of the file (alongside other
`react-native-safe-area-context` imports if any; if not, add a new
import line):

```ts
import { useSafeAreaInsets } from 'react-native-safe-area-context';
```

**2. Add the hook call** at the top of the screen component, with
the other hooks, ABOVE any conditional early returns:

```ts
const insets = useSafeAreaInsets();
```

**3. Apply the inset** when rendering the cart bar. Change:

```tsx
<Pressable style={styles.cartBar} ... >
```

to:

```tsx
<Pressable
  style={[styles.cartBar, { bottom: insets.bottom + spacing.sm }]}
  ...
>
```

(`spacing.sm` keeps a small gap above the nav pills so the cart bar
doesn't look glued to the system bar. If `spacing.sm` looks too
tight after on-device verification, bump to `spacing.md`.)

**4. Adjust the scroll/list container's bottom padding** so the last
list item isn't hidden behind the floated cart bar. Each screen has
a `FlatList` (or `ScrollView`) with a
`contentContainerStyle` that currently sets `paddingBottom` to roughly
`spacing.lg + cartBarHeight` (the value differs slightly per screen —
read the actual current value). Add `insets.bottom` to that:

```tsx
contentContainerStyle={[
  styles.listContent,
  { paddingBottom: styles.listContent.paddingBottom + insets.bottom },
]}
```

Or, if the existing style doesn't expose `paddingBottom` directly,
do it inline:

```tsx
contentContainerStyle={{
  ...existing styles...,
  paddingBottom: <existing value> + insets.bottom,
}}
```

The goal: the last item in the list scrolls into a region clear of
both the cart bar AND the Android nav pills.

## Important notes

- **Do this only when the cart bar is actually rendered.** The cart
  bar is rendered conditionally on each screen
  (`cartHasThisShop && items.length > 0` on ShopDetailScreen, similar
  guards elsewhere). The `insets.bottom` adjustment to the cart bar
  is per-render — fine. But for the scroll container's
  `paddingBottom`, it's OK to always add `insets.bottom` (a few extra
  pixels of bottom padding when the cart bar is hidden is harmless;
  conditional `paddingBottom` per cart-state would over-complicate
  the code).
- **SafeAreaProvider must wrap the app for `useSafeAreaInsets()` to
  return real values.** Verify in `App.js` (or wherever the root is)
  that `<SafeAreaProvider>` wraps the navigation tree. If it
  doesn't, this PR also needs to add it — but it almost certainly
  already does, since other screens use `SafeAreaView` from the same
  library and those would fail without the provider.
- **No `app.json` change. No new permissions. No native module.**
  This is a pure JS edit and ships via:
  ```
  eas update --branch production --message "Android cart-bar safe-area fix"
  ```

## Tests

Pure visual / layout fix — no new unit-test surface needed. If the
existing test suite imports the touched screens for any rendering
test, confirm those still pass (`npm test`); they should, since the
hooks-order and import additions are syntactically standard.

Manual verification:
- **Android phone with gesture navigation** (Sudhir's new test
  device): the cart bar sits clearly above the system nav pills with
  a small visible gap; "View Cart ›" is tappable; the last item in
  the menu/shop list/search results is reachable by scrolling without
  being clipped.
- **Android phone with button navigation** (if any tester has one):
  same — `insets.bottom` reports the button-bar height correctly.
- **iOS** (regression): cart bar still positions correctly above the
  home indicator (it always did, but confirm the inset value didn't
  push it visibly higher than before; if it does and looks off,
  reduce the `+ spacing.sm` to `+ 0` or `+ 4`).

## Deploy

OTA-safe. After Windsurf finishes:

```
eas update --branch production --message "Android cart-bar safe-area fix"
```

No native rebuild. Internal-testing Android users on Play, sideload
APK users, and iOS users all pick it up on next app launch.

## Update doc trail after shipping

1. Mark bug #1 as **Shipped** in `docs/TESTING-FINDINGS-2026-05-30.md`.
2. Append a one-paragraph note to `docs/SESSION_LOG.md` documenting:
   the bug shape, the safe-area-inset fix, the 4 screens affected,
   the lesson (iOS-only testing can mask Android nav-bar overlap
   because of inset-size differences).
3. Bump test suite count in `CLAUDE.md` Current state if any tests
   changed (likely 930/930 stays).
4. Strike the "Distribute Android build for testers tomorrow" task
   if appropriate, given the bug has shipped.
