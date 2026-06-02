/**
 * PR-NEXT-ADDRESS-UX.1 (Case 10 retest) — post-order modal asking
 * the customer to name the current-location pin they just ordered
 * against, so it becomes a reusable saved address instead of a
 * one-off. Sudhir's words on the retest:
 *   *"I wanted to give an option to user to save that address with
 *    some meaningful name like Office address, or Sector 10 Home,
 *    Or uncle Home so they can use it next time."*
 *
 * Pre-fills the `name` input with the reverse-geocoded locality
 * (e.g. "Sector 10, Ballabgarh"). Three quick-pick chips ("Home",
 * "Office", "Other") replace the typed value on tap. Save / Skip.
 *
 * Save: parent calls `saveAddress` with the live coords + the
 * (possibly edited) reverse-geocoded line1/city/pincode + chosen
 * label, then dismisses.
 * Skip: dismisses without saving — same posture as
 * pre-PR-NEXT-ADDRESS-UX (no auto-save on current-location).
 *
 * PR-NEXT-HOTFIX-7 — chrome migrated to the shared `BottomSheet`
 * component for Android gesture-nav clearance (the Save CTA was
 * clipped by the gesture pill pre-migration). See Rule 13 in
 * `.windsurf/code-discipline.md`.
 *
 * PR-NEXT-HOTFIX-8 (bug 3) — when the Save button is disabled,
 * render an inline hint listing the missing fields so the customer
 * understands WHY they can't proceed (pre-PR they just saw a dim
 * button with no explanation — Sudhir's June 1 retest:
 * *"I got option to save the address while used default location
 * option but button was disabled as well."*).
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
// PR-NEXT-HOTFIX-7 — DO NOT REMOVE. Shared bottom-sheet chrome
// (Modal + backdrop + KeyboardAvoidingView + safe-area-aware
// paddingBottom). Replaces the hand-rolled per-modal scaffolding
// that under-padded the gesture-nav pill on tall-pill Androids.
import BottomSheet from '../common/BottomSheet';
import Button from '../common/Button';
import { colors, radii, spacing, typography } from '../../constants/theme';

type Props = {
  visible: boolean;
  defaultLabel: string;
  defaultLine1: string;
  defaultCity: string;
  defaultPincode: string;
  onSave: (input: {
    label: string;
    line1: string;
    city: string;
    pincode: string;
  }) => Promise<void>;
  onSkip: () => void;
};

const CHIPS = ['Home', 'Office', 'Other'] as const;

export default function SaveCurrentLocationModal({
  visible,
  defaultLabel,
  defaultLine1,
  defaultCity,
  defaultPincode,
  onSave,
  onSkip,
}: Props) {
  const [label, setLabel] = useState(defaultLabel);
  const [line1, setLine1] = useState(defaultLine1);
  const [city, setCity] = useState(defaultCity);
  const [pincode, setPincode] = useState(defaultPincode);
  const [saving, setSaving] = useState(false);

  // PR-NEXT-ADDRESS-UX.1 — re-sync defaults when the modal is re-
  // opened with new geocode results. Without this a second visit
  // (rare but possible: user cancels Save then places another
  // current-location order) would stick the first call's values.
  useEffect(() => {
    if (visible) {
      setLabel(defaultLabel);
      setLine1(defaultLine1);
      setCity(defaultCity);
      setPincode(defaultPincode);
      setSaving(false);
    }
  }, [visible, defaultLabel, defaultLine1, defaultCity, defaultPincode]);

  // PR-NEXT-ADDRESS-UX.1 — client-side enable gate mirrors the
  // server's `validateAddressInput` requireds (`line1`, `city`,
  // non-empty + 6-digit pincode) so the Save button only enables
  // when the round-trip will succeed. If reverse-geocode failed or
  // returned partial data, the customer fills the blanks in this
  // modal before Save activates — no silent server rejection.
  const trimmedLabel = label.trim();
  const trimmedLine1 = line1.trim();
  const trimmedCity = city.trim();
  const trimmedPincode = pincode.trim();
  const pincodeValid = /^\d{6}$/.test(trimmedPincode);
  const canSave =
    trimmedLabel.length > 0 &&
    trimmedLine1.length > 0 &&
    trimmedCity.length > 0 &&
    pincodeValid;

  // PR-NEXT-HOTFIX-8 (bug 3) — build a single human-readable hint
  // listing the missing/invalid fields. Order matches the visual
  // order of the inputs above so the customer scans top-to-bottom.
  // Empty array → no hint, Save is enabled.
  const missing: string[] = [];
  if (trimmedLabel.length === 0) missing.push('a name');
  if (trimmedLine1.length === 0) missing.push('street/area');
  if (trimmedCity.length === 0) missing.push('city');
  if (!pincodeValid) missing.push('6-digit pincode');
  const missingHint =
    missing.length === 0
      ? null
      : missing.length === 1
        ? `Add ${missing[0]} to enable Save.`
        : `Add ${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]} to enable Save.`;

  const handleSave = async () => {
    if (saving || !canSave) return;
    // `canSave` already gated non-empty label, but keep the
    // defensive `|| defaultLabel` fallback so any future relaxation
    // of `canSave` (e.g. allowing empty label to skip naming) still
    // persists a meaningful entry rather than a blank "Address"
    // row — the original Sudhir complaint.
    const persistedLabel = trimmedLabel || defaultLabel;
    setSaving(true);
    try {
      await onSave({
        label: persistedLabel,
        line1: trimmedLine1,
        city: trimmedCity,
        pincode: trimmedPincode,
      });
    } finally {
      // Reset is handled by the effect on next visible=true, but
      // clear `saving` here so the button is interactable again if
      // the parent decides not to dismiss (it always does today).
      setSaving(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onSkip}>
      <Text style={styles.title}>Save this location?</Text>
      <Text style={styles.subtitle}>
        Give it a name so you can pick it next time without re-typing
        the address.
      </Text>

      <Text style={styles.label}>Name</Text>
      <TextInput
        value={label}
        onChangeText={setLabel}
        placeholder="e.g. Office, Uncle's house, Sector 10"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        autoFocus
        maxLength={40}
      />
      <View style={styles.chips}>
        {CHIPS.map(c => (
          <Pressable
            key={c}
            onPress={() => setLabel(c)}
            accessibilityRole="button"
            accessibilityLabel={`Use ${c} as the name`}
            style={({ pressed }) => [
              styles.chip,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.chipText}>{c}</Text>
          </Pressable>
        ))}
      </View>

      {/* PR-NEXT-HOTFIX-8 (bug 3) — `Street / Area` is required for
          Save (the server's `validateAddressInput` rejects empty
          line1). Reflect that in the label rather than the
          pre-PR "(optional)" placeholder which actively misled the
          customer when reverse-geocode returned an empty street. */}
      <Text style={styles.label}>Street / Area</Text>
      <TextInput
        value={line1}
        onChangeText={setLine1}
        placeholder="House / building, street, locality"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        maxLength={120}
      />
      <View style={styles.cityRow}>
        <View style={styles.cityCol}>
          <Text style={styles.label}>City</Text>
          <TextInput
            value={city}
            onChangeText={setCity}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            maxLength={60}
          />
        </View>
        <View style={styles.pincodeCol}>
          <Text style={styles.label}>Pincode</Text>
          <TextInput
            value={pincode}
            onChangeText={setPincode}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            keyboardType="number-pad"
            maxLength={6}
          />
        </View>
      </View>

      {missingHint && <Text style={styles.missingHint}>{missingHint}</Text>}

      <View style={styles.ctaRow}>
        <Pressable
          onPress={onSkip}
          style={({ pressed }) => [
            styles.skipBtn,
            pressed && { opacity: 0.85 },
          ]}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Skip saving this location"
        >
          <Text style={styles.skipBtnText}>Skip</Text>
        </Pressable>
        <View style={styles.saveBtnWrap}>
          <Button
            title={saving ? 'Saving…' : 'Save'}
            onPress={handleSave}
            disabled={saving || !canSave}
            fullWidth
          />
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.h2 },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  input: {
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
    color: colors.textPrimary,
  },
  chips: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.primaryLight,
    borderRadius: radii.pill,
  },
  chipText: { ...typography.caption, color: colors.primaryDark },
  cityRow: { flexDirection: 'row' },
  cityCol: { flex: 2 },
  pincodeCol: { flex: 1, marginLeft: spacing.md },
  // PR-NEXT-HOTFIX-8 (bug 3) — soft warning color (warning, not
  // danger) since the form isn't broken — it just needs more info.
  missingHint: {
    ...typography.caption,
    color: colors.warning,
    marginTop: spacing.md,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  skipBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  skipBtnText: { ...typography.body, color: colors.textSecondary },
  saveBtnWrap: { flex: 1 },
});
