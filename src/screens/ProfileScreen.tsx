/**
 * Profile screen — Phase 12a-v2-iv.
 *
 * Three sections, top to bottom:
 *   1. Header: phone number (read-only, from auth — the user can't
 *      change their phone here; that's a separate re-auth flow).
 *   2. Form: name + email. Save button calls updateMyProfile.
 *   3. Saved addresses: each as a card. Tap → AddressEdit. Long-press
 *      → action sheet (Set default / Delete). "Add new address" CTA
 *      below the list. The default address gets a chip.
 *   4. Account: Sign Out (red, with confirm).
 *
 * Profile state lives in this component, hydrated by getMyProfile on
 * mount and after every mutation (the callables return the fresh
 * profile so we don't need a separate getMyProfile follow-up).
 *
 * useFocusEffect refetches on every focus so an AddressEditScreen
 * → goBack reflects the new address list immediately. Without that,
 * users see stale data after editing.
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../components/common/Button';
import Input from '../components/common/Input';
import ScreenHeader from '../components/common/ScreenHeader';
import { colors, radii, spacing, typography } from '../constants/theme';
import { authService } from '../services/authService';
import { profileService } from '../services/profileService';
import { pushService } from '../services/pushService';
import { signOutAndClearLocalState } from '../services/signOutAndClearLocalState';
import { openPrivacy, openTerms } from '../utils/openLegal';
import { useAuthStore } from '../store/useAuthStore';
import { useCartStore } from '../store/useCartStore';
import type { SavedAddress, UserProfile } from '../types';

// Confirm helper that works on both web (window.confirm) and native
// (Alert.alert). Same pattern as CheckoutScreen — the require('react-native')
// shim avoids breaking the web bundle.
function confirmAsync(title: string, message: string): Promise<boolean> {
  return new Promise(resolve => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // eslint-disable-next-line no-alert
      resolve(window.confirm(`${title}\n\n${message}`));
      return;
    }
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Confirm', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export default function ProfileScreen() {
  const nav = useNavigation<any>();
  const phoneNumber = useAuthStore(s => s.phoneNumber);
  const clearCart = useCartStore(s => s.clearCart);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Refetch on every focus so the address list reflects edits made
  // on AddressEditScreen. Cheap call; no perceived latency.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      setLoadError(null);
      profileService
        .getMyProfile()
        .then(p => {
          if (cancelled) return;
          setProfile(p);
          setName(p.name ?? '');
          setEmail(p.email ?? '');
        })
        .catch(e => {
          if (cancelled) return;
          console.warn('[Profile] getMyProfile failed:', e);
          setLoadError(e?.message ?? 'Could not load your profile.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const onSaveProfile = async () => {
    // PR 10 — name is required. Belt-and-braces: server rejects
    // empty `name` patches too (validateProfilePatch), but checking
    // here gives an instant inline message instead of a roundtrip.
    if (!name.trim()) {
      Alert.alert(
        'Name required',
        'Please enter your full name to continue.',
      );
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await profileService.updateMyProfile({
        name: name.trim(),
        email: email.trim() || null,
      });
      setProfile(updated);
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (e: any) {
      // Functions throw HttpsError with message "field: detail" — show
      // the operator something they can act on.
      setSaveError(e?.message ?? 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const onSetDefault = async (id: string) => {
    try {
      const updated = await profileService.setDefaultAddress(id);
      setProfile(updated);
    } catch (e: any) {
      Alert.alert('Could not set default', e?.message ?? 'Please try again.');
    }
  };

  const onDeleteAddress = async (id: string) => {
    const ok = await confirmAsync(
      'Delete address?',
      'This cannot be undone. Future orders will need a fresh address if this was your default.',
    );
    if (!ok) return;
    try {
      const updated = await profileService.deleteAddress(id);
      setProfile(updated);
    } catch (e: any) {
      Alert.alert('Could not delete', e?.message ?? 'Please try again.');
    }
  };

  const onAddressLongPress = (addr: SavedAddress, isDefault: boolean) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // Web doesn't have an action sheet — fall back to two confirm
      // dialogs. Crude but functional; web is dev/role-play only.
      // eslint-disable-next-line no-alert
      const setDef = window.confirm(
        isDefault
          ? 'This is already your default address. Delete instead?\n\nOK = delete, Cancel = nothing'
          : 'Set as default?\n\nOK = set default, Cancel = delete',
      );
      if (isDefault) {
        if (setDef) onDeleteAddress(addr.id);
      } else if (setDef) {
        onSetDefault(addr.id);
      } else {
        onDeleteAddress(addr.id);
      }
      return;
    }
    const buttons: Array<{
      text: string;
      style?: 'default' | 'cancel' | 'destructive';
      onPress?: () => void;
    }> = [{ text: 'Cancel', style: 'cancel' }];
    if (!isDefault) {
      buttons.unshift({
        text: 'Set as default',
        onPress: () => onSetDefault(addr.id),
      });
    }
    buttons.unshift({
      text: 'Delete',
      style: 'destructive',
      onPress: () => onDeleteAddress(addr.id),
    });
    Alert.alert(addr.label || 'Address', addressOneLine(addr), buttons);
  };

  const onSignOut = async () => {
    const ok = await confirmAsync(
      'Sign out?',
      'You will need to sign in again to place orders or manage your shop.',
    );
    if (!ok) return;
    try {
      await signOutAndClearLocalState({
        signOut: () => authService.signOut(),
        unregisterPushToken: () => pushService.unregisterPushToken(), // PR 24
        clearCart: () => clearCart(),
        resetNavigation: () =>
          nav.reset({ index: 0, routes: [{ name: 'Home' }] }),
      });
    } catch (e: any) {
      Alert.alert('Could not sign out', e?.message ?? 'Please try again.');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Profile" onBack={() => nav.goBack()} />
        <View style={styles.loaderWrap}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Profile" onBack={() => nav.goBack()} />
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{loadError}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const addresses = profile?.addresses ?? [];
  const defaultId = profile?.defaultAddressId ?? null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Profile" onBack={() => nav.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>Phone</Text>
        <View style={styles.readOnlyField}>
          <Text style={typography.body}>
            {phoneNumber || profile?.phone || '—'}
          </Text>
        </View>

        <Text style={styles.label}>
          Full name <Text style={styles.requiredAsterisk}>*</Text>
        </Text>
        <Input
          value={name}
          onChangeText={setName}
          placeholder="Your full name"
          maxLength={80}
        />
        <Text style={styles.helperText}>Required</Text>

        <Text style={styles.label}>Email</Text>
        <Input
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
        />

        {saveError && (
          <View style={styles.inlineError}>
            <Text style={styles.inlineErrorText}>{saveError}</Text>
          </View>
        )}

        <View style={{ marginTop: spacing.md }}>
          <Button
            title={saving ? 'Saving…' : 'Save profile'}
            onPress={onSaveProfile}
            loading={saving}
            disabled={name.trim().length === 0}
            fullWidth
          />
        </View>

        <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>
          Saved addresses
        </Text>
        {addresses.length === 0 && (
          <Text style={styles.emptyHint}>
            No saved addresses yet. Add one to skip address entry at checkout.
          </Text>
        )}
        {addresses.map(addr => {
          const isDefault = addr.id === defaultId;
          return (
            <Pressable
              key={addr.id}
              style={styles.addressCard}
              onPress={() =>
                nav.navigate('AddressEdit', { addressId: addr.id })
              }
              onLongPress={() => onAddressLongPress(addr, isDefault)}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${addr.label || 'address'}`}
            >
              <View style={{ flex: 1 }}>
                <View style={styles.addressTitleRow}>
                  <Text style={typography.bodyBold}>
                    {addr.label || 'Address'}
                  </Text>
                  {isDefault && (
                    <View style={styles.defaultChip}>
                      <Text style={styles.defaultChipText}>Default</Text>
                    </View>
                  )}
                </View>
                <Text
                  style={[typography.caption, { marginTop: 2 }]}
                  numberOfLines={2}
                >
                  {addressOneLine(addr)}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          );
        })}

        <View style={{ marginTop: spacing.md }}>
          <Button
            title="+ Add new address"
            variant="secondary"
            onPress={() => nav.navigate('AddressEdit')}
            fullWidth
          />
        </View>

        {/* PR 25 — Legal section. Sits above Account so the user
            can read the policy before deciding to sign out / delete
            their account. Both rows open the hosted URL in the
            in-app browser tab. */}
        <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>
          Legal
        </Text>
        <Pressable
          style={styles.legalRow}
          onPress={openTerms}
          accessibilityRole="link"
          accessibilityLabel="View Terms of Service"
        >
          <Text style={styles.legalRowText}>Terms of Service</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        <Pressable
          style={styles.legalRow}
          onPress={openPrivacy}
          accessibilityRole="link"
          accessibilityLabel="View Privacy Policy"
        >
          <Text style={styles.legalRowText}>Privacy Policy</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>
          Account
        </Text>
        <Pressable
          style={styles.signOutRow}
          onPress={onSignOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function addressOneLine(addr: SavedAddress): string {
  const parts = [
    addr.line1,
    addr.line2,
    addr.city,
    addr.pincode,
  ].filter(p => p && p.length > 0);
  return parts.join(', ');
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 120 },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  readOnlyField: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  sectionTitle: { ...typography.h2, marginBottom: spacing.sm },
  emptyHint: { ...typography.caption, color: colors.textMuted },
  addressCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  addressTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  defaultChip: {
    backgroundColor: colors.primaryLight,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  defaultChipText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
  chevron: { ...typography.h2, color: colors.textSecondary },
  // PR 25 — Legal section rows (Terms of Service / Privacy Policy).
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  legalRowText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  inlineError: {
    marginTop: spacing.sm,
    backgroundColor: '#FEE2E2',
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
  requiredAsterisk: {
    color: colors.danger,
  },
  helperText: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  inlineErrorText: { ...typography.caption, color: colors.danger },
  errorBanner: {
    margin: spacing.lg,
    padding: spacing.md,
    backgroundColor: '#FEE2E2',
    borderRadius: radii.md,
  },
  errorBannerText: { ...typography.body, color: colors.danger },
  signOutRow: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  signOutText: {
    ...typography.bodyBold,
    color: colors.danger,
  },
});
