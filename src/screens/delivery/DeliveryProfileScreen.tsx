import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import {
    Alert,
    Image,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/common/Button';
import Loader from '../../components/common/Loader';
import ScreenHeader from '../../components/common/ScreenHeader';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
// PR-NEXT-BUNDLE-D §B — DO NOT REMOVE. Photo capture + avatar helpers.
// Auto-formatter strip risk; this comment is the canary.
import { formatPartnerAvatar } from '../../utils/formatPartnerAvatar';
import { pickAndResizeImage } from '../../utils/imageUpload';

type VehicleType = 'motorbike' | 'bicycle' | 'on_foot' | 'car';

const VEHICLES: Array<{ value: VehicleType; emoji: string; label: string }> = [
  { value: 'motorbike', emoji: '🛵', label: 'Motorbike' },
  { value: 'bicycle', emoji: '🚲', label: 'Bicycle' },
  { value: 'on_foot', emoji: '🚶', label: 'On foot' },
  { value: 'car', emoji: '🚗', label: 'Car' },
];

// PR-NEXT-BUNDLE-D §B — default bucket mirrors the onboarding photo
// flow (BecomeDeliveryPartnerScreen). Kept in sync deliberately.
const STORAGE_BUCKET = 'grocery-mvp-dev.appspot.com';

/**
 * PR-NEXT-BUNDLE-D §B — delivery partner self-service profile.
 *
 * Edit display name, vehicle type, and face photo. Phone is verified
 * + read-only. Save is enabled only when something changed; on
 * success we re-pull from the server so any normalization wins.
 */
export default function DeliveryProfileScreen() {
  // Rule 2 — all hooks above any conditional return.
  const phoneNumber = useAuthStore(s => s.phoneNumber);
  const isDelivery = useAuthStore(s => s.isDelivery);

  const [loading, setLoading] = useState(true);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType | null>(null);
  const [ratingAvg, setRatingAvg] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState<number | null>(null);
  // Server snapshot for dirty-tracking.
  const [serverName, setServerName] = useState('');
  const [serverVehicle, setServerVehicle] = useState<VehicleType | null>(null);
  const [serverPhoto, setServerPhoto] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);

  const hydrate = useCallback((s: Awaited<ReturnType<typeof orderService.getMyDeliverySettings>>) => {
    const name = s.displayName ?? s.name ?? '';
    const vehicle = (s.vehicleType as VehicleType | null) ?? null;
    const photo = s.profilePhotoUrl ?? null;
    setDisplayName(name);
    setVehicleType(vehicle);
    setPhotoUrl(photo);
    setServerName(name);
    setServerVehicle(vehicle);
    setServerPhoto(photo);
    setRatingAvg(typeof s.deliveryRatingAvg === 'number' ? s.deliveryRatingAvg : null);
    setRatingCount(typeof s.deliveryRatingCount === 'number' ? s.deliveryRatingCount : null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        try {
          const s = await orderService.getMyDeliverySettings();
          if (cancelled) return;
          hydrate(s);
        } catch {
          // Best-effort — leave defaults; partner can still edit.
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [hydrate]),
  );

  const dirty =
    displayName.trim() !== serverName.trim() ||
    vehicleType !== serverVehicle ||
    photoUrl !== serverPhoto;

  const handleChangePhoto = async () => {
    const picked = await pickAndResizeImage('gallery');
    if (!picked.ok) {
      if (picked.reason === 'cancelled') return;
      Alert.alert('Photo error', picked.message || 'Could not load photo.');
      return;
    }
    setPhotoUploading(true);
    try {
      const { uploadUrl, storagePath } =
        await orderService.getPartnerPhotoUploadUrl('image/jpeg');
      const response = await fetch(picked.uri);
      const blob = await response.blob();
      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      });
      const downloadUrl = `https://storage.googleapis.com/${STORAGE_BUCKET}/${encodeURIComponent(
        storagePath,
      )}`;
      setPhotoUrl(downloadUrl);
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Please try again.');
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const patch: {
        displayName?: string;
        vehicleType?: VehicleType;
        profilePhotoUrl?: string;
      } = {};
      if (displayName.trim() !== serverName.trim()) {
        patch.displayName = displayName.trim();
      }
      if (vehicleType !== serverVehicle && vehicleType) {
        patch.vehicleType = vehicleType;
      }
      if (photoUrl !== serverPhoto && photoUrl) {
        patch.profilePhotoUrl = photoUrl;
      }
      await orderService.updateMyDeliveryProfile(patch);
      // Re-pull so server normalization wins.
      const s = await orderService.getMyDeliverySettings();
      hydrate(s);
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!isDelivery) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Profile" />
        <View style={styles.center}>
          <Text style={styles.muted}>Delivery role required.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Profile" />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  const avatar = formatPartnerAvatar(displayName, photoUrl);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Profile" />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.avatarBlock}>
          <Pressable
            onPress={handleChangePhoto}
            disabled={photoUploading}
            style={styles.avatarWrap}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
          >
            {avatar.kind === 'photo' ? (
              <Image source={{ uri: avatar.uri }} style={styles.avatarImg} />
            ) : (
              <View style={[styles.avatarImg, styles.avatarInitials]}>
                <Text style={styles.avatarInitialsText}>{avatar.text}</Text>
              </View>
            )}
          </Pressable>
          <Text style={styles.tapToChange}>
            {photoUploading ? 'Uploading…' : 'Tap to change'}
          </Text>
          {(ratingCount ?? 0) > 0 && ratingAvg != null ? (
            <Text style={styles.ratingLine}>
              ⭐ {ratingAvg.toFixed(1)} · {ratingCount} deliveries
            </Text>
          ) : (
            <Text style={styles.ratingLineMuted}>New partner</Text>
          )}
        </View>

        <View style={styles.divider} />

        <Text style={styles.fieldLabel}>Display name</Text>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your name"
          style={styles.input}
          maxLength={60}
          accessibilityLabel="Display name"
        />

        <Text style={styles.fieldLabel}>Phone (verified)</Text>
        <Text style={styles.readonly}>{phoneNumber ?? '—'}</Text>

        <Text style={styles.fieldLabel}>Vehicle</Text>
        {VEHICLES.map(v => {
          const selected = vehicleType === v.value;
          return (
            <Pressable
              key={v.value}
              onPress={() => setVehicleType(v.value)}
              style={[styles.radioRow, selected && styles.radioRowSelected]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <Text style={styles.radioDot}>{selected ? '●' : '○'}</Text>
              <Text style={styles.radioLabel}>
                {v.emoji}  {v.label}
              </Text>
            </Pressable>
          );
        })}

        <View style={{ height: spacing.xl }} />
        <Button
          title="Save changes"
          onPress={handleSave}
          loading={saving}
          disabled={!dirty}
          fullWidth
          size="lg"
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { ...typography.body, color: colors.textSecondary },
  body: { padding: spacing.lg, paddingBottom: spacing.xxl },
  avatarBlock: { alignItems: 'center', marginBottom: spacing.lg },
  avatarWrap: { borderRadius: radii.pill },
  avatarImg: { width: 96, height: 96, borderRadius: 48 },
  avatarInitials: {
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitialsText: { ...typography.h1, color: colors.primaryDark },
  tapToChange: { ...typography.caption, color: colors.primary, marginTop: spacing.sm },
  ratingLine: { ...typography.bodyBold, marginTop: spacing.xs },
  ratingLineMuted: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  fieldLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  input: {
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  readonly: { ...typography.body, color: colors.textSecondary },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.xs,
  },
  radioRowSelected: { backgroundColor: colors.primaryLight },
  radioDot: { ...typography.body, color: colors.primary, marginRight: spacing.sm },
  radioLabel: { ...typography.body },
});
