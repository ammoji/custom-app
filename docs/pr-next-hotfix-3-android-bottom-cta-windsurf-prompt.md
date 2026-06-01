# HOTFIX-3 — Android: cart + checkout bottom CTA overlapped by gesture-nav pill

**Bug source:** Sudhir's second smoke pass on PR-NEXT-2 (finding #1 follow-up). Screenshot shows the **Cart screen's "Proceed to Checkout · ₹152" button** partially overlapped by the Android gesture-nav pill (back arrow / home circle / recents). The button text is visible but the bottom half is underneath the system bar, making the tap target unreliable.

**Critical distinction from PR-NEXT-2:** PR-NEXT-2 (finding #1, original) fixed the **floating "View Cart" bar** on four BROWSE screens (Home, ShopList, ShopDetail, Search). Those bars are `position: 'absolute'` and escape SafeAreaView's natural flow, so PR-NEXT-2 added `bottom: insets.bottom + spacing.sm` via `useSafeAreaInsets()`.

This hotfix targets a **different button on a different screen**: the Cart screen's own "Proceed to Checkout" button (plus the Checkout screen's "Place Order" / "Pay" button), both in normal flow inside `<SafeAreaView edges={['top']}>`. The `edges={['top']}` declaration tells SafeAreaView to respect ONLY the top inset, leaving the bottom unprotected. On Android with gesture-nav, the system bar then overlaps the bottom-anchored CTA.

**Deploy class:** pure client OTA. No callable, no rules, no `app.json`, no permission, no plugin. Ships via `eas update --branch production` alone.

**Read first**

1. `CLAUDE.md` (full)
2. `docs/TESTING-FINDINGS-2026-05-30.md` — finding #1 (PR-NEXT-2 + this hotfix's expansion)
3. `.windsurf/code-discipline.md` (Rules 1, 2)
4. `src/screens/CartScreen.tsx` lines 26 + 39 — both `<SafeAreaView edges={['top']}>` declarations (empty-cart branch + populated branch); `styles.ctaWrap` at lines 106–111
5. `src/screens/CheckoutScreen.tsx` lines 744 + 757 — both `<SafeAreaView edges={['top']}>` declarations; `styles.ctaWrap` block (search "ctaWrap" in the styles)
6. `docs/pr-android-cart-bar-safe-area-windsurf-prompt.md` (PR-NEXT-2's prompt, if still in repo) — to understand the prior fix's scope and why these two screens weren't included

---

## Root cause (one read confirmed)

`CartScreen.tsx` line 39:

```tsx
<SafeAreaView style={styles.container} edges={['top']}>
```

The `edges={['top']}` prop tells `react-native-safe-area-context` to respect the top inset only. The bottom is NOT padded. Then at line 70–76:

```tsx
<View style={styles.ctaWrap}>
  <Button title={`Proceed to Checkout · ${formatRupees(total)}`} ... />
</View>
```

`styles.ctaWrap` (lines 106–111):

```ts
ctaWrap: {
  padding: spacing.lg,
  borderTopWidth: 1,
  borderTopColor: colors.border,
  backgroundColor: colors.bg,
},
```

No `paddingBottom: insets.bottom`, no SafeAreaView bottom edge. On Android with gesture-nav (where the system nav-bar height is ~24–48 dp depending on device), the button's bottom edge sits underneath the pill. iOS happens to clear because the home-indicator inset is small (~34pt) and `spacing.lg` (~16pt of padding) is enough margin in practice. Android gesture-nav reports a real `insets.bottom` that's bigger than `spacing.lg` + the button's natural height — hence the overlap your screenshot shows.

`CheckoutScreen.tsx` has the identical pattern at lines 744 and 757 — both `<SafeAreaView edges={['top']}>` — and a `ctaWrap` with the "Place Order" / "Pay" button inside. Same bug.

---

## Why PR-NEXT-2's pattern doesn't apply verbatim

PR-NEXT-2 used `useSafeAreaInsets()` and added `bottom: insets.bottom + spacing.sm` to four `cartBar` styles. That was the right tool for those screens because the cart bar is `position: 'absolute'` — it escapes SafeAreaView's natural flow, so SafeAreaView's bottom edge wouldn't push it up. Manual offset was the only fix.

CartScreen + CheckoutScreen's `ctaWrap` is **in normal flow**, NOT `position: 'absolute'`. SafeAreaView's bottom-edge handling can push it up naturally. The simpler and more idiomatic fix is:

```tsx
<SafeAreaView edges={['top', 'bottom']}>
```

One word change per occurrence. SafeAreaView reads the device's real `insets.bottom` (which on Android gesture-nav is the pill height) and pads the bottom of the safe area automatically. The `ctaWrap` then sits inside that padded area.

Both approaches are valid; for in-flow content, `edges={['top', 'bottom']}` is the cleaner expression and doesn't require importing `useSafeAreaInsets`. For absolutely-positioned content (PR-NEXT-2's case), `insets.bottom` is the only option.

---

## Plan

### §A — CartScreen.tsx

Two `SafeAreaView` declarations in this file (empty-cart branch at line 26, populated branch at line 39). Both need the same fix.

```tsx
// Line 26 — empty-cart branch
<SafeAreaView style={styles.container} edges={['top', 'bottom']}>
  <ScreenHeader title="Your Cart" onBack={() => nav.goBack()} />
  <EmptyState ... />
</SafeAreaView>

// Line 39 — populated branch
<SafeAreaView style={styles.container} edges={['top', 'bottom']}>
  ...
</SafeAreaView>
```

No style block changes; SafeAreaView's bottom padding handles everything. The button stays in normal flow at the bottom of the `ctaWrap` View; it's just now inside a padded safe area.

### §B — CheckoutScreen.tsx

Same fix at lines 744 and 757:

```tsx
// Line 744 — loading / pre-validate branch
<SafeAreaView style={styles.container} edges={['top', 'bottom']}>

// Line 757 — main render branch
<SafeAreaView style={styles.container} edges={['top', 'bottom']}>
```

No style block changes.

### §C — Verify no regression on other screens

There are 37 screens using `edges={['top']}` (most are scrollable content where the scroll padding handles the bottom, OR are header-only screens where there's no bottom CTA). Grep already confirmed that **`ctaWrap` only exists in CartScreen and CheckoutScreen** — no other screen has the same in-flow-bottom-CTA pattern.

For belt-and-braces: do a quick visual review (Windsurf doesn't need to test all 37) that the other screens render correctly after the build. The fix is additive (adding an edge), not subtractive — it can't break screens we didn't touch.

---

## Discipline checklist

1. **Rule 1 — Imports stay.** No new imports (SafeAreaView already imported on both files; we're just changing the `edges` prop value).
2. **Rule 2 — Hooks above conditionals.** N/A (no new hooks).
3. **No schema, no callable, no helper.** Pure presentation fix.
4. **No new tests.** This is a SafeAreaView prop change; the behavior is determined by `react-native-safe-area-context`'s implementation against the device's real inset reporting. Can only be smoke-tested on physical Android + iOS.
5. **OTA classification.** Pure JS. No `app.json` change, no permission, no plugin. OTA-safe.

---

## Acceptance checklist

Run on **Android first** (this is an Android-specific bug); confirm iOS still looks right.

**Android (Sudhir's device, build 6 or later):**

1. Add 2+ items to the cart from any shop. Tap "View Cart" to navigate to the Cart screen.
2. Scroll if needed. The green "Proceed to Checkout · ₹X" button at the bottom should now sit ABOVE the system gesture-nav pill, with visible whitespace between the button's bottom edge and the pill. **No overlap.** Compare to the pre-hotfix screenshot showing the pill cutting through the button.
3. Tap "Proceed to Checkout." Should navigate to the Checkout screen without any tap-target issues.
4. On Checkout screen, scroll to the bottom. The "Pay ₹X" / "Place Order · ₹X" button should also sit above the system bar, with visible whitespace below. **No overlap.**
5. Tap the Place Order / Pay button. Should fire the order normally.
6. Empty-cart case: clear the cart manually if possible (or use Firestore Console / reset-pilot-data on a test account). Open Cart screen with no items → the empty-state EmptyState should render with no overlap; the "Browse shops" CTA inside EmptyState is part of a different layout but verify it's reachable too.

**iOS regression sweep:**

7. Same flow on iOS. The "Proceed to Checkout" and "Pay" / "Place Order" buttons should look essentially identical to pre-hotfix (iOS already cleared the home indicator by coincidence). Confirm: no extra padding, no layout shift, button still tap-able.

**Other screens (no expected change):**

8. HomeScreen, ShopListScreen, ShopDetailScreen, SearchScreen — the floating "View Cart" bar at the bottom of these screens still respects `insets.bottom` (PR-NEXT-2 territory; this hotfix doesn't touch it). Should look identical to pre-hotfix.

**Test suite:**

9. `npx tsc --noEmit` clean
10. `npm run test:unit` clean (no new tests; existing tests should pass unchanged)

---

## Out of scope (explicit deferrals)

- **Other screens with bottom buttons.** Sweep showed CartScreen + CheckoutScreen are the only screens with the `ctaWrap` in-flow-CTA pattern. Other screens either scroll or have header-only content. If a tester reports a new screen with the same Android-overlap symptom, file as a follow-up hotfix and apply the same `edges={['top', 'bottom']}` fix.
- **Migrating PR-NEXT-2's four screens to `edges={['top', 'bottom']}` style.** Those use `position: 'absolute'` cart bars which need `insets.bottom` — the current `insets.bottom` approach is correct. Leave them.
- **Custom Android nav bar handling (`react-native-edge-to-edge`, `expo-status-bar`).** Default `react-native-safe-area-context` behavior is sufficient here; only reach for edge-to-edge if a screen needs truly under-the-bar content.

---

## Deploy plan

Pure client OTA. No Firebase deploy.

```
npx tsc --noEmit            # clean
npm run test:unit           # all green; suite count unchanged
git commit -m "HOTFIX-3: Android cart + checkout bottom CTA safe-area"
eas update --branch production --message "HOTFIX-3 Android cart + checkout bottom CTA"
```

Pull on installed Android device → run steps 1–6 of the acceptance checklist. Then iOS regression sweep at step 7.

---

## Doc trail updates after ship

- `docs/TESTING-FINDINGS-2026-05-30.md` — under finding #1, add a sub-note: `Cart + Checkout bottom CTA Android-overlap (different button from PR-NEXT-2's floating bar) → ✅ SHIPPED in PR-NEXT-HOTFIX-3 (June 1 2026)`.
- `docs/SESSION_LOG.md` — one-paragraph entry covering the diagnosis (in-flow CTA vs floating bar — different SafeAreaView pattern), the one-word fix, why PR-NEXT-2's insets-approach wasn't the right tool here.
- `CLAUDE.md` — bump date; brief note that PR-NEXT-2 + HOTFIX-3 together cover the two Android nav-overlap patterns (floating bar uses `insets.bottom` manual offset; in-flow CTA uses `edges={['top', 'bottom']}`).
- `.windsurf/code-discipline.md` — consider adding a brief note: *"When adding a bottom CTA button to a screen, decide upfront: floating (`position: 'absolute'`) → use `useSafeAreaInsets()` + manual `bottom: insets.bottom + spacing.X`. In-flow (sibling of scroll content) → use `<SafeAreaView edges={['top', 'bottom']}>` and let the library handle it. Either way: NEVER ship a bottom CTA with `edges={['top']}` alone — Android gesture-nav will overlap it."* (Optional polish; the two PR commits + their prompts are the durable record.)
