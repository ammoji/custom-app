/**
 * AddressEdit screen — Phase 12a-v2-iv.
 *
 * Two modes:
 *   - Create: route param `addressId` is undefined. Form starts blank
 *     (or pre-filled with optional `prefill` from Checkout's "save
 *     this for next time" flow). On Save → calls saveAddress with no
 *     id, server mints a UUID, screen pops back.
 *   - Edit: `addressId` is present. We fetch the parent profile, find
 *     the matching address, and pre-fill. On Save → calls saveAddress
 *     with the same id, server updates in place. Delete button is
 *     visible only in this mode.
 *
 * Validation duplicated from functions/src/profileHelpers.ts so the
 * user gets instant feedback instead of waiting for a round-trip.
 * The server is still authoritative — if the client somehow lets bad
 * data through, the Cloud Function rejects with HttpsError.
 */
import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../components/common/Button';
import Input from '../components/common/Input';
import ScreenHeader from '../components/common/ScreenHeader';
import { colors, radii, spacing, typography } from '../constants/theme';
import { locationService } from '../services/locationService';
import { profileService } from '../services/profileService';
import type { SavedAddress } from '../types';

type FormErrors = Partial<
  Record<'label' | 'name' | 'phone' | 'line1' | 'city' | 'pincode', string>
>;

type RouteParams = {
  addressId?: string;
  /**
   * Optional pre-fill from Checkout's "save this for next time" flow.
   * Lets the user tweak the captured address before persisting (rare
   * but cheap to support; same shape as a freshly-validated checkout
   * address). When present and `addressId` is absent we treat this
   * as Create mode with seed values.
   */
  prefill?: {
    name?: string;
    phone?: string;
    line1?: string;
    line2?: string;
    city?: string;
    pincode?: string;
  };
};

export default function AddressEditScreen() {
  const nav = useNavigation<any>();
  const route = useRoute();
  const params = (route.params ?? {}) as RouteParams;
  const editingId = params.addressId;
  const isEditing = typeof editingId === 'string' && editingId.length > 0;

  const [label, setLabel] = useState('');
  const [name, setName] = useState(params.prefill?.name ?? '');
  const [phone, setPhone] = useState(params.prefill?.phone ?? '');
  const [line1, setLine1] = useState(params.prefill?.line1 ?? '');
  const [line2, setLine2] = useState(params.prefill?.line2 ?? '');
  const [city, setCity] = useState(params.prefill?.city ?? '');
  const [pincode, setPincode] = useState(params.prefill?.pincode ?? '');
  // PR 22 — saved delivery instructions for this address. Hoisted
  // with the other field state above all early returns per
  // Rules-of-Hooks discipline (PR 12 → 17 → 19 → 20 → 21 → 22
  // lineage). Empty string = absent; the trimmed value is passed
  // through to saveAddress on submit (or omitted entirely if
  // empty/whitespace).
  const [deliveryInstructions, setDeliveryInstructions] = useState('');

  // PR 46 — optional GPS pin for the address. Captured via the
  // "📍 Use my current location" button using expo-location only
  // (NO react-native-maps — keeps this OTA-safe). When set, the
  // coords are stamped onto the SavedAddress on save and
  // CheckoutScreen reads them to compute the delivery distance
  // estimate without re-prompting the customer for location at
  // checkout. Either both lat AND lng are non-null or both are
  // null; the validator (server + client-side below) rejects
  // half-set pairs.
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  // 'idle' = no capture in progress; 'capturing' = expo-location
  // call in flight; 'done' = coords successfully captured (button
  // collapses to a "captured" status row); 'error' = permission
  // denied or location service errored — banner explains.
  const [coordsStatus, setCoordsStatus] = useState<
    'idle' | 'capturing' | 'done' | 'error' | 'fallback'
  >('idle');
  const [coordsError, setCoordsError] = useState<string | null>(null);

  const [hydrating, setHydrating] = useState(isEditing);
  const [hydrateError, setHydrateError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Edit mode: hydrate the form from the existing address. We fetch
  // the whole profile (cheap — it's a single doc) and pick the row
  // by id, since there's no per-address callable.
  useEffect(() => {
    if (!isEditing) return;
    let cancelled = false;
    profileService
      .getMyProfile()
      .then(p => {
        if (cancelled) return;
        const found = p.addresses.find(a => a.id === editingId);
        if (!found) {
          setHydrateError(
            'This address could not be found. It may have been deleted.',
          );
          return;
        }
        setLabel(found.label ?? '');
        setName(found.name);
        setPhone(found.phone);
        setLine1(found.line1);
        setLine2(found.line2 ?? '');
        setCity(found.city);
        setPincode(found.pincode);
        // PR 22 — hydrate instructions on edit. Missing field on
        // legacy saved addresses → empty string (no pre-fill).
        setDeliveryInstructions(found.deliveryInstructions ?? '');
        // PR 46 — hydrate the saved GPS pin if present. Legacy
        // addresses (saved before PR 46) lack the fields entirely;
        // those stay at null and CheckoutScreen falls back to live
        // GPS at order time. Strict typeof checks defend against
        // half-set legacy data (shouldn't exist but cheap to gate).
        if (
          typeof found.lat === 'number' &&
          typeof found.lng === 'number' &&
          Number.isFinite(found.lat) &&
          Number.isFinite(found.lng)
        ) {
          setCoords({ lat: found.lat, lng: found.lng });
          setCoordsStatus('done');
        }
      })
      .catch(e => {
        if (cancelled) return;
        setHydrateError(e?.message ?? 'Could not load address.');
      })
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isEditing, editingId]);

  // Client-side validation. Mirrors the server (functions/src/
  // profileHelpers.ts validateAddressInput). The server is the
  // source of truth; this exists for instant feedback.
  const validate = (): FormErrors => {
    const e: FormErrors = {};
    if (label.trim().length > 32) e.label = '32 characters max';
    if (!name.trim()) e.name = 'Required';
    if (!/^[6-9]\d{9}$/.test(phone.trim()))
      e.phone = 'Enter a valid 10-digit Indian mobile number';
    if (!line1.trim()) e.line1 = 'Required';
    if (!city.trim()) e.city = 'Required';
    if (!/^\d{6}$/.test(pincode.trim())) e.pincode = '6-digit pincode';
    return e;
  };

  // PR 46 — capture the customer's current GPS pin via expo-location
  // (wrapped by locationService). On success the coords stamp onto
  // local state and get persisted with saveAddress on submit. On
  // permission-denied / location-service-error we fall back to the
  // mock fallback (locationService returns 'fallback' source) so
  // the customer at least gets *something* on file rather than a
  // hard block — but we surface the fallback status visibly so they
  // know the pin isn't their actual location. They can re-tap the
  // button after enabling permissions to get the real coords.
  const onCaptureCurrentLocation = async () => {
    setCoordsStatus('capturing');
    setCoordsError(null);
    try {
      const result = await locationService.getCurrentLocation();
      setCoords({
        lat: result.location.lat,
        lng: result.location.lng,
      });
      // 'fallback' source means permission was denied OR the
      // location call threw — either way the coords are the
      // MOCK_USER_LOCATION constant, not the real device. Surface
      // that distinction so the customer doesn't think we just
      // pinned their roof onto a default-Delhi coordinate.
      setCoordsStatus(result.source === 'gps' ? 'done' : 'fallback');
    } catch (err: any) {
      // locationService swallows most errors and returns the
      // fallback, so reaching this catch means something more
      // exotic failed (Sentry will surface it). UI treats this
      // identically to fallback — coords are unset, error message
      // is shown.
      setCoords(null);
      setCoordsStatus('error');
      setCoordsError(err?.message ?? 'Could not capture location');
    }
  };

  const onClearCoords = () => {
    setCoords(null);
    setCoordsStatus('idle');
    setCoordsError(null);
  };

  const onSave = async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      await profileService.saveAddress({
        id: isEditing ? editingId : undefined,
        label: label.trim() || undefined,
        name: name.trim(),
        phone: phone.trim(),
        line1: line1.trim(),
        line2: line2.trim() || undefined,
        city: city.trim(),
        pincode: pincode.trim(),
        // PR 22 — instructions. Empty / whitespace-only → undefined
        // so the server-side normalizer omits the field entirely
        // rather than persisting an empty string.
        deliveryInstructions: deliveryInstructions.trim() || undefined,
        // PR 46 — pass through the captured GPS pin if any. Server
        // validates both must be set or both absent; we pass either
        // both fields or neither (never a half-set pair).
        ...(coords
          ? { lat: coords.lat, lng: coords.lng }
          : {}),
      });
      nav.goBack();
    } catch (err: any) {
      setSaveError(err?.message ?? 'Could not save address.');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!isEditing) return;
    const ok = await new Promise<boolean>(resolve => {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        // eslint-disable-next-line no-alert
        resolve(window.confirm('Delete this address? This cannot be undone.'));
        return;
      }
      Alert.alert(
        'Delete address?',
        'This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => resolve(true),
          },
        ],
      );
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await profileService.deleteAddress(editingId);
      nav.goBack();
    } catch (err: any) {
      Alert.alert('Could not delete', err?.message ?? 'Please try again.');
      setDeleting(false);
    }
  };

  if (hydrateError) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Address" onBack={() => nav.goBack()} />
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{hydrateError}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={isEditing ? 'Edit address' : 'New address'}
        onBack={() => nav.goBack()}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {hydrating ? (
            <Text style={styles.hint}>Loading…</Text>
          ) : (
            <>
              <Text style={styles.label}>Label (optional)</Text>
              <Input
                value={label}
                onChangeText={setLabel}
                placeholder="Home / Office / etc."
                error={errors.label}
                maxLength={32}
              />

              <Text style={styles.label}>Recipient name</Text>
              <Input
                value={name}
                onChangeText={setName}
                placeholder="Full name"
                error={errors.name}
              />

              <Text style={styles.label}>Recipient phone</Text>
              <Input
                value={phone}
                onChangeText={setPhone}
                placeholder="10-digit mobile"
                keyboardType="phone-pad"
                maxLength={10}
                error={errors.phone}
              />

              <Text style={styles.label}>Address line 1</Text>
              <Input
                value={line1}
                onChangeText={setLine1}
                placeholder="House, street"
                error={errors.line1}
              />

              <Text style={styles.label}>Address line 2 (optional)</Text>
              <Input
                value={line2}
                onChangeText={setLine2}
                placeholder="Landmark, area"
              />

              <View style={styles.rowFields}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>City</Text>
                  <Input
                    value={city}
                    onChangeText={setCity}
                    placeholder="City"
                    error={errors.city}
                  />
                </View>
                <View style={{ width: 130 }}>
                  <Text style={styles.label}>Pincode</Text>
                  <Input
                    value={pincode}
                    onChangeText={setPincode}
                    placeholder="6 digits"
                    keyboardType="numeric"
                    maxLength={6}
                    error={errors.pincode}
                  />
                </View>
              </View>

              {/* PR 46 — GPS pin capture. expo-location only (no
                  react-native-maps wired in this PR — that's a
                  follow-up so this stays OTA-safe). Three render
                  states:
                    - idle / fallback / error: show the capture
                      button + (optionally) status text.
                    - capturing: button shows "Capturing…", disabled.
                    - done: collapsed status row with the captured
                      coords + a re-capture / clear pair.
                  When `coords` is non-null and status === 'fallback'
                  we show a yellow warning so the customer knows the
                  pin is the default-Delhi mock, not their real
                  location. */}
              <Text style={styles.label}>Location pin (optional)</Text>
              {coordsStatus === 'done' && coords ? (
                <View style={styles.coordsCapturedRow}>
                  <Text style={styles.coordsCapturedText}>
                    📍 Captured ({coords.lat.toFixed(5)},{' '}
                    {coords.lng.toFixed(5)})
                  </Text>
                  <View style={styles.coordsActions}>
                    <Pressable
                      onPress={onCaptureCurrentLocation}
                      accessibilityRole="button"
                      accessibilityLabel="Re-capture current location"
                    >
                      <Text style={styles.coordsActionText}>Re-capture</Text>
                    </Pressable>
                    <Pressable
                      onPress={onClearCoords}
                      accessibilityRole="button"
                      accessibilityLabel="Clear captured location"
                    >
                      <Text
                        style={[styles.coordsActionText, styles.coordsClear]}
                      >
                        Clear
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  onPress={onCaptureCurrentLocation}
                  disabled={coordsStatus === 'capturing'}
                  accessibilityRole="button"
                  accessibilityLabel="Use my current location"
                  style={[
                    styles.coordsButton,
                    coordsStatus === 'capturing' && styles.coordsButtonDisabled,
                  ]}
                >
                  <Text style={styles.coordsButtonText}>
                    {coordsStatus === 'capturing'
                      ? 'Capturing…'
                      : '📍 Use my current location'}
                  </Text>
                </Pressable>
              )}
              {coordsStatus === 'fallback' && (
                <Text style={styles.coordsFallbackNote}>
                  Couldn&apos;t access GPS — captured the default city
                  centre instead. Enable location permission and tap
                  again for a precise pin.
                </Text>
              )}
              {coordsStatus === 'error' && (
                <Text style={styles.coordsErrorNote}>
                  {coordsError ?? 'Could not capture location.'}
                </Text>
              )}
              <Text style={styles.coordsHelp}>
                Used to estimate delivery time + distance from the
                shop. Skip if you&apos;d rather use your live location
                at checkout instead.
              </Text>

              {/* PR 22 — delivery instructions input. Multi-line
                  TextInput (not the shared Input component which is
                  single-line) so the customer can compose a short
                  paragraph. Hard 280-char clamp on input matches the
                  server's MAX_INSTRUCTIONS_LEN; the counter below
                  gives instant feedback. */}
              <Text style={styles.label}>
                Delivery instructions (optional)
              </Text>
              <TextInput
                value={deliveryInstructions}
                onChangeText={t =>
                  setDeliveryInstructions(t.slice(0, 280))
                }
                placeholder="e.g. Ring second bell, leave at door if no answer"
                placeholderTextColor={colors.textSecondary}
                multiline
                style={styles.instructionsInput}
              />
              <Text style={styles.charCount}>
                {deliveryInstructions.length}/280
              </Text>

              {saveError && (
                <View style={styles.inlineError}>
                  <Text style={styles.inlineErrorText}>{saveError}</Text>
                </View>
              )}

              <View style={{ marginTop: spacing.lg }}>
                <Button
                  title={saving ? 'Saving…' : 'Save address'}
                  onPress={onSave}
                  loading={saving}
                  fullWidth
                />
              </View>

              {isEditing && (
                <View style={{ marginTop: spacing.md }}>
                  <Button
                    title={deleting ? 'Deleting…' : 'Delete address'}
                    variant="ghost"
                    onPress={onDelete}
                    loading={deleting}
                    fullWidth
                  />
                </View>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 120 },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  rowFields: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  hint: { ...typography.caption, color: colors.textMuted },
  inlineError: {
    marginTop: spacing.md,
    backgroundColor: '#FEE2E2',
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
  inlineErrorText: { ...typography.caption, color: colors.danger },
  errorBanner: {
    margin: spacing.lg,
    padding: spacing.md,
    backgroundColor: '#FEE2E2',
    borderRadius: radii.md,
  },
  errorBannerText: { ...typography.body, color: colors.danger },
  // PR 22 — multiline instructions input + char counter. minHeight
  // gives the field visible affordance for multi-line input
  // (default TextInput multiline collapses to one line until typed).
  instructionsInput: {
    ...typography.body,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 80,
    textAlignVertical: 'top',
    marginTop: spacing.xs,
    backgroundColor: colors.surface,
  },
  charCount: {
    ...typography.caption,
    color: colors.textSecondary,
    alignSelf: 'flex-end',
    marginTop: 2,
  },
  // PR 46 — GPS pin capture UI. Distinct visual treatment from
  // the saveAddress submit button (which is the primary action) —
  // an outlined pill rather than a filled button so the customer
  // doesn't accidentally tap it thinking it submits the form.
  coordsButton: {
    marginTop: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  coordsButtonDisabled: {
    opacity: 0.5,
  },
  coordsButtonText: {
    ...typography.bodyBold,
    color: colors.primary,
  },
  coordsCapturedRow: {
    marginTop: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: '#E6F4EA', // light green = success
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  coordsCapturedText: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
  coordsActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  coordsActionText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
  coordsClear: {
    color: colors.danger,
  },
  coordsFallbackNote: {
    ...typography.caption,
    color: '#92400E', // amber-700
    backgroundColor: '#FEF3C7', // amber-100
    padding: spacing.sm,
    borderRadius: radii.sm,
    marginTop: spacing.xs,
  },
  coordsErrorNote: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
  },
  coordsHelp: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
});
