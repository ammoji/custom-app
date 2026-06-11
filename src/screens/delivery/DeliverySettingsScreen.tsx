import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import {
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../../components/common/ScreenHeader';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { authService } from '../../services/authService';
import { orderService } from '../../services/orderService';
import { pushService } from '../../services/pushService';
import { signOutAndClearLocalState } from '../../services/signOutAndClearLocalState';
import { useAuthStore } from '../../store/useAuthStore';
import { useCartStore } from '../../store/useCartStore';
// PR-NEXT-BUNDLE-D §C — DO NOT REMOVE. Dev-only role switcher (gated
// behind __DEV__). Auto-formatter strip risk; this comment is canary.
import QuickSwitchModal from '../../components/dev/QuickSwitchModal';

/**
 * PR-NEXT-BUNDLE-D §C — delivery partner Settings tab.
 *
 * Houses the low-rating alert preference (moved off the old
 * single-scroll dashboard) plus account actions. Save calls
 * `updatePartnerRatingAlertSettings` (HOTFIX-5 fixed the claim check).
 */
export default function DeliverySettingsScreen() {
  // Rule 2 — hooks above any conditional return.
  const nav = useNavigation<any>();
  const isDelivery = useAuthStore(s => s.isDelivery);
  const clearCart = useCartStore(s => s.clearCart);

  const [threshold, setThreshold] = useState(3);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSwitch, setShowSwitch] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        try {
          const s = await orderService.getMyDeliverySettings();
          if (cancelled) return;
          if (typeof s.lowRatingThreshold === 'number') {
            setThreshold(s.lowRatingThreshold);
          }
          if (typeof s.lowRatingNotificationsEnabled === 'boolean') {
            setEnabled(s.lowRatingNotificationsEnabled);
          }
        } catch {
          // best-effort
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      await orderService.updatePartnerRatingAlertSettings({
        threshold,
        enabled,
      });
      Alert.alert('Saved', 'Alert settings updated.');
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    Alert.alert('Sign out?', 'You will need to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOutAndClearLocalState({
              signOut: () => authService.signOut(),
              unregisterPushToken: () => pushService.unregisterPushToken(),
              clearCart: () => clearCart(),
            });
          } catch (e: any) {
            Alert.alert('Could not sign out', e?.message || 'Please try again.');
          }
        },
      },
    ]);
  };

  if (!isDelivery) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Settings" />
        <View style={styles.center}>
          <Text style={styles.muted}>Delivery role required.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.sectionHeader}>Notifications</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Low-rating alert</Text>
          <Text style={styles.cardHelp}>
            Get notified when a customer rates you at or below this many ★
          </Text>
          <View style={styles.starRow}>
            {[1, 2, 3, 4, 5].map(s => {
              const active = threshold === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => setThreshold(s)}
                  style={[styles.starBtn, active && styles.starBtnActive]}
                  accessibilityLabel={`Alert threshold ${s} stars`}
                >
                  <Text
                    style={[styles.starText, active && styles.starTextActive]}
                  >
                    {s}★
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            onPress={() => setEnabled(v => !v)}
            style={styles.checkRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: enabled }}
            accessibilityLabel="Enable low-rating notifications"
          >
            <View style={[styles.checkbox, enabled && styles.checkboxChecked]}>
              {enabled && <Text style={styles.checkMark}>✓</Text>}
            </View>
            <Text style={styles.checkLabel}>Enabled</Text>
          </Pressable>
          <Pressable
            onPress={handleSave}
            disabled={saving}
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            accessibilityRole="button"
          >
            <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </View>

        <View style={styles.divider} />

        <Text style={styles.sectionHeader}>Account</Text>
        <Pressable
          style={styles.accountRow}
          onPress={handleSignOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
        {__DEV__ && (
          <Pressable
            style={styles.accountRow}
            onPress={() => setShowSwitch(true)}
            accessibilityRole="button"
            accessibilityLabel="Switch role (dev only)"
          >
            <Text style={styles.devText}>Switch role (dev only)</Text>
          </Pressable>
        )}
      </ScrollView>
      {__DEV__ && (
        <QuickSwitchModal
          visible={showSwitch}
          onClose={() => setShowSwitch(false)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { ...typography.body, color: colors.textSecondary },
  body: { padding: spacing.lg, paddingBottom: spacing.xxl },
  sectionHeader: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { ...typography.h3 },
  cardHelp: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  starRow: { flexDirection: 'row', gap: spacing.sm },
  starBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  starBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  starText: { ...typography.bodyBold, color: colors.textPrimary },
  starTextActive: { color: '#fff' },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkMark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  checkLabel: { ...typography.body },
  saveBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { ...typography.bodyBold, color: '#fff' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.lg },
  accountRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  signOutText: { ...typography.bodyBold, color: colors.danger },
  devText: { ...typography.body, color: colors.textSecondary },
});
