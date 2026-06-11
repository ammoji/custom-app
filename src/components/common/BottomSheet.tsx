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
 *      that clipped CTAs on tall-pill Androids — see Sudhir's
 *      ADDRESS-UX.1 retest screenshot (Save button clipped). This
 *      is the bug class code-discipline Rule 13 now forbids.
 *
 * Callers pass children + onClose. Optional `keyboardAvoid` toggles
 * `KeyboardAvoidingView` (default: true; off for sheets with no
 * text inputs to skip the layout cost). Optional `showHandle`
 * toggles the visual drag-handle bar (default: true).
 *
 * Visual: bg + rounded top corners + handle bar match the
 * conventions established by `ReorderModal` / `CancelAndRefundModal`
 * / `PartnerDetailsSheet` / `SaveCurrentLocationModal`, so migrating
 * callers keeps the same look (minus the bug).
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
  showHandle?: boolean;
  // PR-NEXT-HOTFIX-7 — opt-out escape hatch for sheets where a
  // backdrop tap should NOT dismiss (e.g. `CancelAndRefundModal`
  // wants backdrop tap to only dismiss the keyboard, never the
  // sheet itself — otherwise a half-typed cancellation reason gets
  // wiped). When provided, runs INSTEAD of `onClose`. The Android
  // hardware back button still fires `onClose` (via the underlying
  // `Modal`'s `onRequestClose`) so callers retain a deliberate
  // dismissal path.
  onBackdropPress?: () => void;
};

export default function BottomSheet({
  visible,
  onClose,
  children,
  keyboardAvoid = true,
  showHandle = true,
  onBackdropPress,
}: Props) {
  const insets = useSafeAreaInsets();
  // `insets.bottom + spacing.lg` is the contract:
  //   - On Android tall-pill devices `insets.bottom` ≈ 24-48; lg
  //     adds comfortable breathing room above the system gesture
  //     area.
  //   - On iOS home-indicator devices `insets.bottom` ≈ 34; same +lg.
  //   - On Android 3-button-mode devices `insets.bottom = 0`, so
  //     total bottom padding is just `spacing.lg` — the visual we
  //     intended pre-PR but hand-coded with bigger fudge factors
  //     that over-padded 3-button-mode and under-padded gesture-nav.
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
      <Pressable
        style={styles.backdrop}
        onPress={onBackdropPress ?? onClose}
      >
        {keyboardAvoid ? (
          <KeyboardAvoidingView
            // HOTFIX 2026-06-10 — Android needs `behavior: 'height'`
            // (not undefined) for KeyboardAvoidingView to actually
            // move the sheet above the keyboard. Pre-hotfix the
            // ResponseModal (PR-5.1 §C), SaveCurrentLocationModal,
            // and CancelAndRefundModal all had keyboard covering
            // their TextInputs on Android because behavior=undefined
            // made the wrapper inert. iOS stays on 'padding'.
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.kbWrap}
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
  kbWrap: { width: '100%' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    // `paddingBottom` is overridden by the inline style above so
    // `useSafeAreaInsets` can drive it.
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
