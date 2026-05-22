import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import ScreenHeader from '../../components/common/ScreenHeader';
import { colors, radii, spacing, typography } from '../../constants/theme';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
import { useLocationStore } from '../../store/useLocationStore';
import type { ShopKycDocKind } from '../../types';

// PR 31 — One slot's upload state. The four slots (storefront, GST,
// FSSAI, owner ID) each carry an independent copy. `localPreviewUri`
// is the asset URI from `expo-image-picker` and is shown as the
// thumbnail BEFORE/AFTER the PUT — `/shop-kyc/` is read-deny for
// non-admins so we deliberately do NOT round-trip through a signed
// read URL. `storagePath` is the durable identity returned by the
// server's `getShopKycUploadUrl`.
type KycSlotState = {
  uploading: boolean;
  storagePath: string | null;
  localPreviewUri: string | null;
  error: string | null;
};

const initialSlotState: KycSlotState = {
  uploading: false,
  storagePath: null,
  localPreviewUri: null,
  error: null,
};

const KYC_LABELS: Record<ShopKycDocKind, string> = {
  storefront: 'Storefront photo',
  gstDoc: 'GST certificate',
  fssaiDoc: 'FSSAI license',
  ownerIdDoc: 'Owner ID (Aadhaar/PAN)',
};

/**
 * Phase 12a-v2-i shop registration form. Replaces the old
 * BecomeShopOwnerScreen claim-a-seeded-shop picker. Submitting puts the
 * shop in `pending` state; admin reviews via the PendingShops dashboard
 * and approves or rejects with reason.
 *
 * Optional `prefill` route param lets a rejected shop owner re-open
 * the form with their previous values from the WaitingForApproval
 * screen (rejected → "Edit and resubmit").
 */
export default function RegisterShopScreen() {
  const nav = useNavigation<any>();
  const route =
    useRoute<RouteProp<RootStackParamList, 'RegisterShop'>>();
  const prefill = route.params?.prefill;

  const isAnonymous = useAuthStore(s => s.isAnonymous);
  const phoneFromAuth = useAuthStore(s => s.phoneNumber);
  const location = useLocationStore(s => s.location);

  const [name, setName] = useState(prefill?.name ?? '');
  const [address, setAddress] = useState(prefill?.address ?? '');
  const [phone, setPhone] = useState(
    prefill?.phone ?? phoneFromAuth ?? '',
  );
  // 24h "HH:mm" strings — kept as plain text so we don't drag in a
  // native time picker for MVP. Server stores whatever we send.
  const [openTime, setOpenTime] = useState(prefill?.hours?.open ?? '09:00');
  const [closeTime, setCloseTime] = useState(
    prefill?.hours?.close ?? '21:00',
  );
  const [gstNumber, setGstNumber] = useState(prefill?.gstNumber ?? '');
  const [fssaiLicense, setFssaiLicense] = useState(
    prefill?.fssaiLicense ?? '',
  );
  const [submitting, setSubmitting] = useState(false);

  // PR 31 — 2-step wizard. Step 1 collects the basic info; tapping
  // "Continue" calls `registerShop` to create the pending-shop doc
  // and stores the returned `shopId` (the upload callable needs it
  // to gate write-access). Step 2 surfaces the four KYC upload
  // slots. All state is hoisted ABOVE the `if (isAnonymous)` early
  // return per Rules-of-Hooks discipline (PR 12 lineage).
  const [step, setStep] = useState<1 | 2>(1);
  const [submittedShopId, setSubmittedShopId] = useState<string | null>(null);
  const [storefront, setStorefront] = useState<KycSlotState>(initialSlotState);
  const [gstDoc, setGstDoc] = useState<KycSlotState>(initialSlotState);
  const [fssaiDoc, setFssaiDoc] = useState<KycSlotState>(initialSlotState);
  const [ownerIdDoc, setOwnerIdDoc] = useState<KycSlotState>(initialSlotState);

  if (isAnonymous) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          title="Register your shop"
          onBack={() => nav.goBack()}
        />
        <EmptyState
          title="Sign in first"
          subtitle="You need a phone-verified account to register a shop."
        />
      </SafeAreaView>
    );
  }

  const validate = (): string | null => {
    if (!name.trim()) return 'Shop name is required';
    if (!address.trim()) return 'Shop address is required';
    if (!phone.trim()) return 'Phone number is required';
    const hhmm = /^\d{2}:\d{2}$/;
    if (!hhmm.test(openTime) || !hhmm.test(closeTime)) {
      return 'Hours must be in HH:mm format (e.g. 09:00)';
    }
    return null;
  };

  // PR 31 — Step 1: create the pending shop doc, then advance the
  // wizard to step 2 (KYC document uploads). The shopId returned
  // here gates the per-slot upload callable, so the registration
  // MUST land before any document upload is attempted.
  const handleContinue = async () => {
    const err = validate();
    if (err) {
      Alert.alert('Missing info', err);
      return;
    }
    setSubmitting(true);
    try {
      const result = await orderService.registerShop({
        name: name.trim(),
        address: address.trim(),
        location: location ?? undefined,
        phone: phone.trim(),
        hours: { open: openTime, close: closeTime },
        gstNumber: gstNumber.trim() || undefined,
        fssaiLicense: fssaiLicense.trim() || undefined,
      });
      setSubmittedShopId(result.shopId);
      setStep(2);
    } catch (e: any) {
      const message =
        e?.message ||
        'Could not submit registration. Please try again later.';
      Alert.alert('Registration failed', message);
    } finally {
      setSubmitting(false);
    }
  };

  // PR 31 — Pick from camera roll and upload via the signed PUT
  // URL flow. Mirrors `services/storage.ts` (PR 6.1) for menu
  // images: `getShopKycUploadUrl` mints a v4 PUT URL bound to
  // `Content-Type: image/jpeg`, client `fetch().blob()` the local
  // asset and PUTs the bytes, then `recordShopKycUpload` stamps
  // the path on the shop doc. Each step is failure-isolated — a
  // network blip surfaces in the slot's `error` field; nothing
  // throws to Sentry.
  const pickAndUpload = async (
    docKind: ShopKycDocKind,
    setSlot: (s: KycSlotState) => void,
  ) => {
    if (!submittedShopId) {
      Alert.alert(
        'Save basics first',
        'Please complete step 1 before uploading documents.',
      );
      return;
    }
    setSlot({ ...initialSlotState, uploading: true });
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        quality: 0.7,
        allowsEditing: true,
      });
      if (picked.canceled || !picked.assets?.length) {
        setSlot(initialSlotState);
        return;
      }
      const asset = picked.assets[0];

      const { uploadUrl, storagePath } =
        await orderService.getShopKycUploadUrl({
          shopId: submittedShopId,
          docKind,
        });

      const blob = await (await fetch(asset.uri)).blob();
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      });
      if (!putRes.ok) {
        const errBody = await putRes.text().catch(() => '');
        throw new Error(
          `Upload failed (HTTP ${putRes.status})${errBody ? `: ${errBody.slice(0, 120)}` : ''}`,
        );
      }

      await orderService.recordShopKycUpload({
        shopId: submittedShopId,
        docKind,
        storagePath,
      });

      setSlot({
        uploading: false,
        storagePath,
        localPreviewUri: asset.uri,
        error: null,
      });
    } catch (e: any) {
      setSlot({
        uploading: false,
        storagePath: null,
        localPreviewUri: null,
        error: e?.message ?? 'Upload failed',
      });
    }
  };

  // PR 31 — Step 2 finish. All four slots are optional — admin can
  // approve on whatever evidence exists (free-text GST/FSSAI numbers
  // + whatever docs were uploaded). Routes to WaitingForApproval.
  const handleFinish = () => {
    if (!submittedShopId) return;
    nav.reset({
      index: 1,
      routes: [
        { name: 'Home' },
        {
          name: 'WaitingForApproval',
          params: { shopId: submittedShopId },
        },
      ],
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Register your shop" onBack={() => nav.goBack()} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content}>
          {/* PR 31 — Step indicator. Two-step wizard: basics → docs.
              Both steps stay in the same screen so the back button on
              the screen-header still navigates "out", not between
              steps. */}
          <View style={styles.stepRow}>
            <View
              style={[
                styles.stepDot,
                step >= 1 && styles.stepDotActive,
              ]}
            >
              <Text
                style={[
                  styles.stepNumber,
                  step >= 1 && styles.stepNumberActive,
                ]}
              >
                1
              </Text>
            </View>
            <View style={styles.stepLine} />
            <View
              style={[
                styles.stepDot,
                step >= 2 && styles.stepDotActive,
              ]}
            >
              <Text
                style={[
                  styles.stepNumber,
                  step >= 2 && styles.stepNumberActive,
                ]}
              >
                2
              </Text>
            </View>
          </View>

          {step === 1 && (
            <>
          <Text style={styles.intro}>
            Tell us about your shop. An admin will review your registration
            and notify you within 24 hours.
          </Text>

          <Field
            label="Shop name *"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Sharma Provision Store"
          />
          <Field
            label="Shop address *"
            value={address}
            onChangeText={setAddress}
            placeholder="Building, street, area, city, pincode"
            multiline
          />
          {location && (
            <Text style={styles.helper}>
              📍 GPS captured: {location.lat.toFixed(4)},{' '}
              {location.lng.toFixed(4)}. Used for delivery distance only.
            </Text>
          )}
          <Field
            label="Phone *"
            value={phone}
            onChangeText={setPhone}
            placeholder="+91XXXXXXXXXX"
            keyboardType="phone-pad"
          />

          <Text style={styles.sectionLabel}>Business hours</Text>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field
                label="Opens at"
                value={openTime}
                onChangeText={setOpenTime}
                placeholder="09:00"
              />
            </View>
            <View style={{ width: spacing.md }} />
            <View style={{ flex: 1 }}>
              <Field
                label="Closes at"
                value={closeTime}
                onChangeText={setCloseTime}
                placeholder="21:00"
              />
            </View>
          </View>

          <Text style={styles.sectionLabel}>Compliance (optional)</Text>
          <Field
            label="GST number"
            value={gstNumber}
            onChangeText={setGstNumber}
            placeholder="22AAAAA0000A1Z5"
            autoCapitalize="characters"
          />
          <Field
            label="FSSAI license"
            value={fssaiLicense}
            onChangeText={setFssaiLicense}
            placeholder="14-digit FSSAI number"
            keyboardType="number-pad"
          />

          <View style={{ marginTop: spacing.lg }}>
            <Button
              title={submitting ? 'Saving…' : 'Continue to documents'}
              onPress={handleContinue}
              loading={submitting}
              disabled={submitting}
              size="lg"
            />
          </View>

          <Text style={styles.footnote}>
            By submitting you confirm the information is accurate. Providing
            false details may result in your shop being suspended.
          </Text>
            </>
          )}

          {step === 2 && (
            <>
              <Text style={styles.intro}>
                Help us verify your shop is genuine. The storefront photo
                appears on your shop card and is highly recommended;
                the rest help admin confirm your registration is real.
                All four are optional — you can add or replace any of
                them while your shop is pending review.
              </Text>

              <KycSlotCard
                label={KYC_LABELS.storefront}
                hint="Front of your shop with the signage visible"
                state={storefront}
                onPress={() => pickAndUpload('storefront', setStorefront)}
              />
              <KycSlotCard
                label={KYC_LABELS.gstDoc}
                hint="Photo or scan of your GST certificate"
                state={gstDoc}
                onPress={() => pickAndUpload('gstDoc', setGstDoc)}
              />
              <KycSlotCard
                label={KYC_LABELS.fssaiDoc}
                hint="Photo or scan of your FSSAI license"
                state={fssaiDoc}
                onPress={() => pickAndUpload('fssaiDoc', setFssaiDoc)}
              />
              <KycSlotCard
                label={KYC_LABELS.ownerIdDoc}
                hint="Aadhaar or PAN card of the proprietor"
                state={ownerIdDoc}
                onPress={() => pickAndUpload('ownerIdDoc', setOwnerIdDoc)}
              />

              <View style={{ marginTop: spacing.lg }}>
                <Button
                  title="Finish & wait for approval"
                  onPress={handleFinish}
                  size="lg"
                />
              </View>

              <Text style={styles.footnote}>
                You can return to this step from "Waiting for approval"
                if you need to add a missing document.
              </Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// PR 31 — One KYC upload slot. Renders the label + hint, the
// thumbnail (if uploaded) or an empty placeholder, an inline
// activity indicator while uploading, and any error message. Tap
// anywhere on the card invokes the picker.
function KycSlotCard({
  label,
  hint,
  state,
  onPress,
}: {
  label: string;
  hint: string;
  state: KycSlotState;
  onPress: () => void;
}) {
  const uploaded = !!state.localPreviewUri && !!state.storagePath;
  return (
    <Pressable
      onPress={onPress}
      disabled={state.uploading}
      style={({ pressed }) => [
        styles.kycCard,
        pressed && !state.uploading && { opacity: 0.85 },
      ]}
    >
      <View style={styles.kycThumbWrap}>
        {state.localPreviewUri ? (
          <Image
            source={{ uri: state.localPreviewUri }}
            style={styles.kycThumb}
            resizeMode="cover"
          />
        ) : (
          <Text style={styles.kycThumbPlaceholder}>📷</Text>
        )}
        {state.uploading && (
          <View style={styles.kycThumbOverlay}>
            <ActivityIndicator color={colors.surface} />
          </View>
        )}
      </View>
      <View style={styles.kycCardBody}>
        <Text style={styles.kycCardLabel}>{label}</Text>
        <Text style={styles.kycCardHint}>{hint}</Text>
        {uploaded && !state.error && (
          <Text style={styles.kycCardStatusOk}>
            ✓ Uploaded — tap to replace
          </Text>
        )}
        {state.error && (
          <Text style={styles.kycCardStatusErr}>{state.error}</Text>
        )}
        {!uploaded && !state.error && !state.uploading && (
          <Text style={styles.kycCardStatusEmpty}>Tap to upload</Text>
        )}
      </View>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'phone-pad' | 'number-pad' | 'email-address';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize ?? 'sentences'}
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  intro: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  field: { marginBottom: spacing.md },
  fieldLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
    ...typography.body,
    color: colors.textPrimary,
  },
  inputMultiline: {
    minHeight: 84,
    textAlignVertical: 'top',
    paddingTop: spacing.sm,
  },
  helper: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    marginTop: -spacing.xs,
  },
  sectionLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  row: { flexDirection: 'row' },
  footnote: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.md,
    fontStyle: 'italic',
  },
  // PR 31 — Wizard step indicator + KYC card styles.
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  stepNumber: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  stepNumberActive: { color: colors.surface },
  stepLine: {
    flex: 0,
    width: 48,
    height: 2,
    backgroundColor: colors.border,
    marginHorizontal: spacing.sm,
  },
  kycCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  kycThumbWrap: {
    width: 72,
    height: 72,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  kycThumb: { width: '100%', height: '100%' },
  kycThumbPlaceholder: { fontSize: 28 },
  kycThumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kycCardBody: { flex: 1 },
  kycCardLabel: {
    ...typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  kycCardHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  kycCardStatusOk: {
    ...typography.caption,
    color: colors.success,
    marginTop: spacing.xs,
    fontWeight: '600',
  },
  kycCardStatusErr: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
  },
  kycCardStatusEmpty: {
    ...typography.caption,
    color: colors.primary,
    marginTop: spacing.xs,
    fontWeight: '600',
  },
});
