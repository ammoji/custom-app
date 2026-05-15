import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import React, { useState } from 'react';
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
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

  const handleSubmit = async () => {
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
      Alert.alert(
        'Submitted for review',
        "Shop submitted for approval. You'll be notified when reviewed.",
        [
          {
            text: 'OK',
            onPress: () =>
              // Replace so back-button doesn't return to a now-stale form
              nav.reset({
                index: 1,
                routes: [
                  { name: 'Home' },
                  {
                    name: 'WaitingForApproval',
                    params: { shopId: result.shopId },
                  },
                ],
              }),
          },
        ],
      );
    } catch (e: any) {
      const message =
        e?.message ||
        'Could not submit registration. Please try again later.';
      Alert.alert('Registration failed', message);
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Register your shop" onBack={() => nav.goBack()} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content}>
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
              title={submitting ? 'Submitting…' : 'Submit for approval'}
              onPress={handleSubmit}
              loading={submitting}
              disabled={submitting}
              size="lg"
            />
          </View>

          <Text style={styles.footnote}>
            By submitting you confirm the information is accurate. Providing
            false details may result in your shop being suspended.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
});
