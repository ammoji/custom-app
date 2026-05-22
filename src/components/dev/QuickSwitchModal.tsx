/**
 * PR 18 — Quick Switch test account modal.
 *
 * Renders a list of pre-configured test phones (see
 * `constants/testAccounts.ts`); tapping an entry runs the same
 * authentication chain LoginScreen runs manually, but
 * programmatically:
 *
 *   1. authService.signOut()
 *   2. authService.startPhoneAuth(`+91${phone}`)
 *   3. authService.confirmOtp(confirmation, otp)
 *   4. useAuthStore.setUser(refreshedUser)
 *
 * No backdoor — Firebase Auth still gates everything. The shortcut
 * just removes the manual typing for phones that are already
 * configured in Firebase Console's "Phone numbers for testing".
 *
 * Concurrency: a single `busy` slot tracks the in-flight phone so
 * rapid taps on multiple entries are no-ops. The Cancel button is
 * also disabled mid-switch — bailing mid-flow would leave the auth
 * store in a half-signed-out state.
 *
 * Failure mode: errors are surfaced inline at the bottom of the
 * card and the modal stays open so the user can retry a different
 * entry without re-summoning the modal.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { TEST_ACCOUNTS, type TestAccount } from '../../constants/testAccounts';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { authService } from '../../services/authService';
import { pushService } from '../../services/pushService';
import { signOutAndClearLocalState } from '../../services/signOutAndClearLocalState';
import { useAuthStore } from '../../store/useAuthStore';
import { useCartStore } from '../../store/useCartStore';
import Button from '../common/Button';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function QuickSwitchModal({ visible, onClose }: Props) {
  // `busy` holds the phone of the in-flight switch (or null when
  // idle). Doubles as both the mutex flag and the spinner-target
  // selector — that's intentional, single source of truth.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSelect = async (account: TestAccount) => {
    setBusy(account.phone);
    setError(null);
    try {
      // 1. Sign out current user via the shared orchestrator so
      //    QuickSwitch picks up the full sign-out discipline:
      //    PR 24 push-token cleanup (so the previous tester stops
      //    receiving pushes on this device) AND the cart clear
      //    (so the incoming customer doesn't inherit the previous
      //    tester's cart). No resetNavigation — the AuthBootstrap
      //    re-render handles routing once the next sign-in lands.
      await signOutAndClearLocalState({
        signOut: () => authService.signOut(),
        unregisterPushToken: () => pushService.unregisterPushToken(),
        clearCart: useCartStore.getState().clearCart,
      });

      // 2. Kick off phone auth. On native this calls
      //    signInWithPhoneNumber (no reCAPTCHA); on web the
      //    invisible reCAPTCHA fires. The Firebase Console test
      //    list short-circuits the actual SMS — that's why the
      //    canned OTP works.
      const confirmation = await authService.startPhoneAuth(
        `+91${account.phone}`,
      );

      // 3. Submit the canned OTP. confirmOtp force-refreshes the
      //    ID token internally, so the resulting AuthUser already
      //    carries the latest custom claims (admin / shopOwner /
      //    delivery) for this uid.
      const user = await authService.confirmOtp(confirmation, account.otp);

      // 4. Push the refreshed user into useAuthStore so HomeScreen
      //    re-renders with the new role flags immediately. Without
      //    this, the screen would only update on the next
      //    onAuthStateChanged tick, which on web sometimes lags
      //    enough to be noticeable.
      if (user) useAuthStore.getState().setUser(user);

      onClose();
    } catch (err: any) {
      console.error('[QuickSwitchModal] switch failed:', err);
      setError(
        err?.message ??
          'Switch failed. Check that the phone is configured in Firebase Console test list.',
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Switch test account</Text>
          <Text style={styles.subtitle}>
            Dev shortcut. Signs out, then signs in as the selected
            test phone using its pre-configured OTP.
          </Text>

          <ScrollView style={styles.list}>
            {TEST_ACCOUNTS.map(account => (
              <Pressable
                key={account.phone}
                onPress={() => onSelect(account)}
                disabled={busy !== null}
                style={[
                  styles.item,
                  busy === account.phone && styles.itemBusy,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${account.label}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemLabel}>{account.label}</Text>
                  <Text style={styles.itemPhone}>+91 {account.phone}</Text>
                </View>
                {busy === account.phone && (
                  <ActivityIndicator color={colors.primary} />
                )}
              </Pressable>
            ))}
          </ScrollView>

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.footer}>
            <Button
              title="Cancel"
              variant="secondary"
              onPress={onClose}
              disabled={busy !== null}
              fullWidth
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    maxHeight: '80%',
  },
  title: { ...typography.h2, marginBottom: spacing.xs },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  list: { maxHeight: 400, marginBottom: spacing.md },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemBusy: { opacity: 0.6 },
  itemLabel: { ...typography.bodyBold, marginBottom: 2 },
  itemPhone: { ...typography.caption, color: colors.textSecondary },
  error: {
    ...typography.caption,
    color: colors.danger,
    marginBottom: spacing.sm,
  },
  footer: { marginTop: spacing.sm },
});
