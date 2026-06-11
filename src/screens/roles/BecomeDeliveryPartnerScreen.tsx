import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
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
import EmptyState from '../../components/common/EmptyState';
import Loader from '../../components/common/Loader';
import ScreenHeader from '../../components/common/ScreenHeader';
import { APP_NAME } from '../../constants/branding';
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
// PR-NEXT-PARTNER-PHOTO §A — DO NOT REMOVE. Photo capture pipeline
// (ImagePicker + resize). expo-image-picker is already in deps.
import { pickAndResizeImage } from '../../utils/imageUpload';

// PR 1 — security hardening. Rewritten from the one-tap self-service
// flow to an admin-approval form. Mirrors RegisterShopScreen +
// WaitingForApprovalScreen for shop owners:
//
//   user fills form → submits → server creates deliveryRequests/{uid}
//   → user is redirected to DeliveryApprovalWaiting (polls status)
//   → admin approves or rejects from PendingDeliveryRequestsScreen
//
// Fields are all optional except auth — the helper sanitizes/truncates
// each one. Vehicle type is whitelisted to a short string union to
// keep the admin queue readable; "Other" maps to undefined so the
// admin sees no vehicle hint rather than a free-text value.

const VEHICLE_OPTIONS: { label: string; value?: string }[] = [
  { label: 'Bike', value: 'bike' },
  { label: 'Scooter', value: 'scooter' },
  { label: 'Cycle', value: 'cycle' },
  { label: 'Car', value: 'car' },
  { label: 'On foot', value: 'on_foot' },
  { label: 'Skip', value: undefined },
];

export default function BecomeDeliveryPartnerScreen() {
  const nav = useNavigation<any>();
  const isAnonymous = useAuthStore(s => s.isAnonymous);
  const isDelivery = useAuthStore(s => s.isDelivery);

  const [checking, setChecking] = useState(true);
  const [hasPending, setHasPending] = useState(false);
  // PR-NEXT-PARTNER-PHOTO §A — DO NOT REMOVE. Photo states must sit
  // at top level (above conditional returns) per code-discipline R2.
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUploadedUrl, setPhotoUploadedUrl] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [vehicleType, setVehicleType] = useState<string | undefined>(
    undefined,
  );
  const [city, setCity] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Check if the user already has a delivery request on file. If so,
  // route them straight to the waiting screen so they don't double-
  // submit. Skip the check if they're anonymous (no auth → no doc).
  useEffect(() => {
    if (isAnonymous) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const req = await orderService.getMyDeliveryRequest();
        if (cancelled) return;
        if (req?.status === 'pending' || req?.status === 'rejected') {
          // For both pending AND rejected we route to the waiting
          // screen — rejected users can read the reason there and
          // come back here via Edit & Resubmit.
          setHasPending(true);
          nav.replace('DeliveryApprovalWaiting');
        }
      } catch (e) {
        console.warn('[BecomeDeliveryPartner] getMyDeliveryRequest failed:', e);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAnonymous, nav]);

  // PR-NEXT-PARTNER-PHOTO §A — capture photo from camera or gallery,
  // resize, then mint a signed URL and upload immediately so the URL
  // is ready when the form is submitted.
  const handleTakePhoto = async (source: 'camera' | 'gallery') => {
    const picked = await pickAndResizeImage(source);
    if (!picked.ok) {
      if (picked.reason === 'cancelled') return;
      Alert.alert(
        'Photo error',
        picked.message || 'Could not capture photo. Please try again.',
      );
      return;
    }
    setPhotoUri(picked.uri);
    setPhotoUploadedUrl(null);
    setPhotoUploading(true);
    try {
      const { uploadUrl, storagePath } =
        await orderService.getPartnerPhotoUploadUrl('image/jpeg');
      // Fetch the local file as a Blob, then PUT it to the signed URL.
      const response = await fetch(picked.uri);
      const blob = await response.blob();
      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      });
      // Construct the download URL from the storage path.
      const bucket = 'grocery-mvp-dev.appspot.com'; // project default bucket
      const encodedPath = encodeURIComponent(storagePath);
      const downloadUrl = `https://storage.googleapis.com/${bucket}/${encodedPath}`;
      setPhotoUploadedUrl(downloadUrl);
    } catch (e: any) {
      Alert.alert(
        'Upload failed',
        e?.message || 'Could not upload photo. Please try again.',
      );
      setPhotoUri(null);
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!photoUploadedUrl) {
      Alert.alert(
        'Photo required',
        'Please take a face photo before submitting your application.',
      );
      return;
    }
    setSubmitting(true);
    try {
      await orderService.requestDeliveryRole({
        name: name.trim() || undefined,
        vehicleType,
        city: city.trim() || undefined,
        profilePhotoUrl: photoUploadedUrl,
      });
      nav.replace('DeliveryApprovalWaiting');
    } catch (e: any) {
      Alert.alert(
        'Could not submit',
        e?.message || 'Please try again in a moment.',
      );
      setSubmitting(false);
    }
  };

  if (isAnonymous) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          title="Become a delivery partner"
          onBack={() => nav.goBack()}
        />
        <EmptyState
          title="Sign in first"
          subtitle="You need a phone-verified account to apply as a delivery partner."
        />
      </SafeAreaView>
    );
  }
  if (isDelivery) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          title="Become a delivery partner"
          onBack={() => nav.goBack()}
        />
        <EmptyState
          title="You're already a delivery partner"
          subtitle="Open the Delivery Dashboard from your Home screen."
        />
      </SafeAreaView>
    );
  }
  if (checking || hasPending) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          title="Become a delivery partner"
          onBack={() => nav.goBack()}
        />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Apply to deliver"
        onBack={() => nav.goBack()}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>{`Earn flexibly with ${APP_NAME}`}</Text>
        <Text style={styles.body}>
          Tell us a bit about yourself. An admin will review your application
          (usually within 24 hours) and approve you to start picking up orders.
        </Text>

        {/* PR-NEXT-PARTNER-PHOTO §A — photo capture */}
        <View style={styles.card}>
          <Text style={styles.label}>Your Face Photo *</Text>
          {photoUri ? (
            <Image
              // R9: truthy guard applied (photoUri is non-null here)
              source={{ uri: photoUri }}
              style={styles.photoPreview}
              accessibilityLabel="Your face photo preview"
            />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Text style={styles.photoPlaceholderText}>No photo yet</Text>
            </View>
          )}
          {photoUploading && (
            <Text style={styles.photoHint}>Uploading…</Text>
          )}
          {!photoUploading && photoUploadedUrl && (
            <Text style={[styles.photoHint, { color: colors.success }]}>
              ✅ Photo uploaded
            </Text>
          )}
          <View style={styles.photoRow}>
            <Pressable
              style={styles.photoBtn}
              onPress={() => handleTakePhoto('camera')}
              disabled={photoUploading || submitting}
              accessibilityRole="button"
              accessibilityLabel="Take photo with camera"
            >
              <Text style={styles.photoBtnText}>📷 Camera</Text>
            </Pressable>
            <Pressable
              style={styles.photoBtn}
              onPress={() => handleTakePhoto('gallery')}
              disabled={photoUploading || submitting}
              accessibilityRole="button"
              accessibilityLabel="Choose from gallery"
            >
              <Text style={styles.photoBtnText}>🖼 Gallery</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Name (optional)</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="How customers should see you"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
            maxLength={80}
            autoCapitalize="words"
            autoCorrect={false}
            editable={!submitting}
          />

          <View style={{ height: spacing.md }} />

          <Text style={styles.label}>Vehicle (optional)</Text>
          <View style={styles.vehicleRow}>
            {VEHICLE_OPTIONS.map(opt => {
              const active = vehicleType === opt.value;
              return (
                <Pressable
                  key={opt.label}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setVehicleType(opt.value)}
                  accessibilityRole="button"
                  accessibilityLabel={`Vehicle: ${opt.label}`}
                  disabled={submitting}
                >
                  <Text
                    style={[
                      styles.chipText,
                      active && styles.chipTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ height: spacing.md }} />

          <Text style={styles.label}>City (optional)</Text>
          <TextInput
            value={city}
            onChangeText={setCity}
            placeholder="e.g. Bengaluru"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
            maxLength={60}
            autoCorrect={false}
            editable={!submitting}
          />
        </View>

        <Text style={styles.disclaimer}>
          We&apos;ll add ID + vehicle document verification before launch.
          For now an admin manually reviews each application.
        </Text>

        <View style={{ marginTop: spacing.lg }}>
          <Button
            title="Submit application"
            onPress={handleSubmit}
            loading={submitting}
            disabled={submitting}
            size="lg"
          />
        </View>
        <View style={{ marginTop: spacing.sm }}>
          <Button
            title="Cancel"
            variant="ghost"
            onPress={() => nav.goBack()}
            disabled={submitting}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  heading: { ...typography.h2, marginBottom: spacing.sm },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.lg,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: colors.textPrimary,
  },
  vehicleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  chipTextActive: { color: '#fff' },
  disclaimer: {
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  // PR-NEXT-PARTNER-PHOTO §A
  photoPreview: {
    width: 120,
    height: 120,
    borderRadius: radii.md,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  photoPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: radii.md,
    alignSelf: 'center',
    marginBottom: spacing.sm,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  photoHint: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  photoRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  photoBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  photoBtnText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '600',
  },
});
