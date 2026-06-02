# PR-NEXT-HOTFIX-7 — Reusable `BottomSheet` + code-discipline Rule 13 (Android gesture-nav clearance)

**Source:** Sudhir's June 1 retest of ADDRESS-UX.1. Screenshot of `SaveCurrentLocationModal` shows the Skip / Save CTA row clipped by Android's gesture-nav pill. Same failure mode HOTFIX-3 hit on `CartScreen` (fixed locally via `edges={['top','bottom']}`). And:

> *"Whenever we add anything new in the app, this issue always comes. Can we make sure fix is applied at first place instead of applying a fix. It wasted so much time."*

He's right — this is a recurring discipline failure, not a one-off bug. Fix it structurally so the next new modal can't ship broken.

**Audit-grep first** (the discipline tweak from last cycle's commitment):

```
grep -r "justifyContent: 'flex-end'" src/components | findstr Modal
```

| File | Pre-PR `paddingBottom` | Pre-PR insets-aware? | Status |
| --- | --- | --- | --- |
| `src/components/order/CancelAndRefundModal.tsx` | `spacing.xxl` (~48) | ❌ | Survives on most Androids, lucky |
| `src/components/order/PartnerDetailsSheet.tsx` (PR-NEXT-PARTNER-CARD) | `spacing.xl` (~32) | ❌ | Clipped on tall-pill Androids |
| `src/components/address/SaveCurrentLocationModal.tsx` (PR-NEXT-ADDRESS-UX.1) | `spacing.xl` (~32) | ❌ | **Visibly broken per screenshot** |

In-scope: all three. Out-of-scope: `ReorderModal` (center-aligned, no bottom edge to clear), `QuickSwitchModal` (dev-only), `DeliveryProofViewer` (full-screen).

**Deploy class:** pure client OTA. No callable, no schema.

---

## Plan

### §A — New reusable `BottomSheet` component

`src/components/common/BottomSheet.tsx`:

```tsx
/**
 * PR-NEXT-HOTFIX-7 — single source of truth for bottom-anchored
 * modal sheets. Three things every such sheet needs that have been
 * hand-rolled (inconsistently) across the codebase:
 *
 *   1. `Modal` with `transparent` + `animationType="slide"` +
 *      `onRequestClose` (Android back-button hook).
 *   2. Backdrop `Pressable` that dismisses on tap, with an inner
 *      `Pressable` swallowing the tap so the sheet body doesn't
 *      dismiss itself (the "inner-press-swallow" trick from
 *      ReorderModal).
 *   3. `paddingBottom` that accounts for Android gesture-nav pill
 *      + iOS home-indicator via `useSafeAreaInsets`. Hardcoded
 *      `spacing.xl` / `spacing.xxl` was the recurring failure mode
 *      that clipped CTAs on tall-pill Androids — Sudhir's
 *      ADDRESS-UX.1 retest screenshot.
 *
 * Callers pass children + onClose. Optional `keyboardAvoid` toggles
 * KeyboardAvoidingView (default: true; off for sheets with no text
 * inputs to skip the layout cost).
 *
 * Visual: bg + rounded top corners + handle bar match the
 * conventions established by ReorderModal / CancelAndRefundModal,
 * so migrating callers keeps the same look.
 */
import React, { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing } from '../../constants/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  keyboardAvoid?: boolean;
  // Escape hatch — caller can opt out of the handle bar if the
  // sheet already has its own visual top affordance (rare).
  showHandle?: boolean;
};

export default function BottomSheet({
  visible,
  onClose,
  children,
  keyboardAvoid = true,
  showHandle = true,
}: Props) {
  const insets = useSafeAreaInsets();
  // `insets.bottom + spacing.lg` is the contract:
  //   - On Android tall-pill devices insets.bottom ≈ 24-48; lg adds
  //     comfortable breathing room above the system gesture area.
  //   - On iOS home-indicator devices insets.bottom ≈ 34; same +lg.
  //   - On Android nav-button devices (3-button mode) insets.bottom = 0,
  //     so total bottom padding is `spacing.lg` — the visual we
  //     intended pre-PR but hand-coded with bigger fudge factors.
  const sheetPaddingBottom = insets.bottom + spacing.lg;

  const body = (
    <Pressable
      style={[styles.sheet, { paddingBottom: sheetPaddingBottom }]}
      onPress={() => {}}
    >
      {showHandle && <View style={styles.handle} />}
      {children}
    </Pressable>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        {keyboardAvoid ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ width: '100%' }}
          >
            {body}
          </KeyboardAvoidingView>
        ) : (
          body
        )}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    // paddingBottom is overridden by the inline style above so
    // useSafeAreaInsets can drive it.
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
});
```

### §B — Migrate three existing modals

**SaveCurrentLocationModal**: rip out the `Modal` + `Pressable backdrop` + `KeyboardAvoidingView` + outer sheet `Pressable` + handle. Wrap the remaining content in `<BottomSheet visible={visible} onClose={onSkip}>…</BottomSheet>`. Delete the now-unused `backdrop`, `sheet`, `handle` style entries. Keep the form-specific styles (label, input, chips, ctaRow, etc.).

**PartnerDetailsSheet**: same migration. Delete `backdrop` / `sheet` / `handle` style entries; wrap content in `<BottomSheet visible={visible} onClose={onClose} keyboardAvoid={false}>…</BottomSheet>` — no text inputs in this sheet so KeyboardAvoidingView is unnecessary overhead.

**CancelAndRefundModal**: same migration. Audit any specific behavior it has — `CancelAndRefundModal` may have an explicit "are you sure" confirm step or a multi-stage flow; the migration just replaces the chrome, not the body logic.

Run `npx tsc --noEmit` after each migration to catch reference drift.

### §C — Code-discipline Rule 13

Append to `.windsurf/code-discipline.md`:

```markdown
## Rule 13 — bottom-anchored modals use `BottomSheet`

Any modal that anchors to the bottom of the screen (slide-up "sheet"
pattern, where the outer container has `justifyContent: 'flex-end'`
on the backdrop) MUST be built via `src/components/common/BottomSheet.tsx`
or, if it can't be (rare), MUST use `useSafeAreaInsets().bottom` for
its bottom padding.

Hardcoded `paddingBottom: spacing.xl` / `spacing.xxl` does NOT
clear Android gesture-nav pills on tall-pill devices. The CTA at
the bottom of the sheet gets clipped. This bug class shipped in
HOTFIX-3 (CartScreen, fixed locally with `edges={['top','bottom']}`),
PR-NEXT-PARTNER-CARD (sheet survived because no CTA at the very
bottom), and PR-NEXT-ADDRESS-UX.1 (visibly broken per Sudhir's
June 1 retest screenshot — Save button clipped). Fixed structurally
in PR-NEXT-HOTFIX-7.

**Audit-grep before any PR that adds a bottom-anchored Modal:**

```
grep -r "justifyContent: 'flex-end'" src/components
```

Every result must either be the shared `BottomSheet` itself or a
caller of it.

**Acceptance checklist addition for any PR that adds a
bottom-anchored modal:**
*"Verified on an Android device with 3-button mode AND
gesture-nav mode that the bottom-most CTA / interactive element
is fully tappable (not clipped by system bars)."*
```

### §D — Update the PR prompt template I use

This isn't a code change — it's a prompt-author commitment Claude is making. Add to `docs/PROMPT_AUTHORING_NOTES.md` (create if missing) under a "Discipline tweaks" section:

```markdown
## Discipline tweaks (2026-06-01 commitments)

1. **Impact-audit grep upfront.** Any "fix the display of X" or
   "render Y in a new way" prompt opens with the `grep` results
   for every read-site of X / Y, with an explicit in-scope /
   out-of-scope split BEFORE the Plan section.

2. **"Lean or rich?" check on disclosure surfaces.** Sheets,
   modals, detail screens, info cards — confirm intentional
   minimalism BEFORE freezing the prompt rather than after
   shipping the lean version.

3. **Scope cuts surface in chat.** Multi-section prompts with
   parts I'd cut as over-engineering get flagged in chat as
   "**§C as written would do X. I'd cut it because Y. Cut or
   keep?**" — forces a yes/no instead of soft "confirm?".

4. **Android gesture-nav clearance** (PR-NEXT-HOTFIX-7). Any
   new bottom-anchored modal MUST use `BottomSheet` or
   `useSafeAreaInsets`. Acceptance checklist must include
   "verified bottom CTA fully tappable on Android tall-pill."
```

---

## Discipline checklist

1. **Rule 1** — every migrated import carries "PR-NEXT-HOTFIX-7 — DO NOT REMOVE" comment.
2. **Rule 2** — N/A (no new hooks added to existing screens; `useSafeAreaInsets` lives inside the new component).
3. **Rule 13** (newly added by this PR) — `BottomSheet` itself is the only allowed `justifyContent: 'flex-end'` site; all three migrated modals route through it.
4. **No schema, no callable.**
5. **No new tests** — presentational migration. Acceptance is manual on Android.

---

## Acceptance checklist

**Visual parity (iOS — should look identical to pre-PR):**

1. Open the address book on iOS, place a current-location order. `SaveCurrentLocationModal` slides up; CTAs visible and tappable; backdrop dismisses; keyboard avoidance works.
2. On a delivered order, open `OrderDetailScreen`, tap the partner card. `PartnerDetailsSheet` slides up; same look as pre-PR.
3. As shop owner with a paid online order, tap "Cancel & refund" from `ShopOrderDetailScreen`. `CancelAndRefundModal` slides up; CTAs visible.

**Android gesture-nav (the bug we're fixing):**

4. On the Android device that produced Sudhir's June 1 screenshot, repeat steps 1–3. **Bottom CTAs are fully visible and tappable; nothing clipped by the gesture pill.**
5. Toggle Android system Settings → Display → Navigation bar → 3-button mode. Repeat steps 1–3. Same result (no over-padding, no under-padding).
6. Repeat once more with gesture-nav re-enabled.

**Regression:**

7. Open `ReorderModal`, `QuickSwitchModal`, `DeliveryProofViewer` (the three NOT migrated). Confirm nothing changed about their behavior — they're center-aligned or full-screen, not bottom-sheet.
8. `npx tsc --noEmit` clean; `npm run test:unit` clean (no test count change).

---

## Out of scope

- **Migrating non-bottom-anchored modals.** `ReorderModal` is center-aligned, `QuickSwitchModal` is dev-only — separate scope.
- **A `useSheetSafeArea` hook** without the component wrapper. Caller-side discipline still wins (`spacing.xl` makes it back in). Wrap-by-construction is the lock.
- **Custom drag-to-dismiss gesture.** RN `Modal`'s `slide` animation is good enough; gesture sheets are a `@gorhom/bottom-sheet` dependency we explicitly haven't taken on.

---

## Deploy

```
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "PR-NEXT-HOTFIX-7 BottomSheet + safe-area discipline"
```

## Doc trail

- `docs/TESTING-FINDINGS-2026-05-30.md` — append new finding "Android gesture-nav clipping on bottom-anchored modals" → `✅ SHIPPED in PR-NEXT-HOTFIX-7` with the audit-grep results + the discipline rule reference.
- `.windsurf/code-discipline.md` — Rule 13 added (per §C).
- `docs/PROMPT_AUTHORING_NOTES.md` — created/updated with the four discipline-tweak commitments (per §D).
- `docs/SESSION_LOG.md` — one paragraph.
- `CLAUDE.md` — bump date.
