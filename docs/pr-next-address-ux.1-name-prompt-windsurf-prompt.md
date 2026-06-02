# PR-NEXT-ADDRESS-UX.1 — Real name prompt + reverse-geocode for current-location orders

**Source:** Sudhir's June 1 retest of ADDRESS-UX. *"Are we going to use that exact location for final delivery? I wanted to give an option to user to save that address with some meaningful name like Office address, or Sector 10 Home, Or uncle Home so they can use it next time instead of creating new address with all details."*

ADDRESS-UX shipped the no-auto-copy fix (Windsurf's correct scope cut) but punted on the name-prompt + reverse-geocode work because the original prompt's §B + §C were judged "over-engineering." That call was right for that PR, but Sudhir's actual UX intent — letting the customer NAME the current-location pin so it's reusable — wasn't covered. This PR delivers that intent.

**Today's behavior for current-location checkout:**
- `maybeSaveAddressAfterOrder` returns early when `deliveryTargetMode === 'current'`. No save, no prompt.
- The order ships with `deliveryLocation.type = 'current_location'` + label `'Current location'` + the live lat/lng. Delivery happens against that GPS pin — good.
- The customer's address book stays untouched. Next checkout from the same place → "Use current location" again → another anonymous pin. Sudhir's friction: he has to re-tap "current location" every time and never builds an address library.

**Desired behavior:**
After a successful current-location order, prompt: *"Save this location for next time?"* with a name field defaulting to a reverse-geocoded label (e.g. "Sector 10, Ballabgarh") and a few one-tap suggestions ("Home", "Office", "Other"). If user accepts, write a new address with the live coords + reverse-geocoded `line1/city/pincode` + their chosen label. Skip flows: cancel = same as today (no save).

**Deploy class:** pure client OTA. `expo-location` already in dependencies, `reverseGeocodeAsync` is part of the existing package — no new permissions, no plugin changes.

**Read first**

1. `CLAUDE.md`
2. `.windsurf/code-discipline.md` Rules 1, 2
3. `src/screens/CheckoutScreen.tsx` lines 486–537 — `maybeSaveAddressAfterOrder` (the punt site)
4. `src/screens/CheckoutScreen.tsx` lines 315–361 — `resolveDeliveryLocation` (where `liveCoords` is held)
5. `src/services/profileService.ts` lines 37–59 — `SaveAddressInput` already accepts `lat` + `lng`
6. `src/components/common/Button.tsx` — for the modal CTA style
7. Look for an existing single-field input modal pattern in `src/components/` to clone (`ReorderModal`, `CancelAndRefundModal`, or HOTFIX-2's modal). Pick the closest match.

---

## Plan

### §A — New reusable component: `SaveCurrentLocationModal`

Create `src/components/address/SaveCurrentLocationModal.tsx`:

```tsx
/**
 * PR-NEXT-ADDRESS-UX.1 — post-order modal asking the customer to
 * name the current-location pin they just ordered against, so it
 * becomes a reusable saved address instead of a one-off.
 *
 * Pre-fills the `name` input with the reverse-geocoded locality
 * ("Sector 10, Ballabgarh"). Three quick-pick chips ("Home",
 * "Office", "Other") replace the typed value on tap. Save / Skip.
 *
 * Behavior on Save: parent calls saveAddress with the live coords
 * + reverse-geocoded line1/city/pincode + chosen label, then
 * dismisses. Behavior on Skip: dismisses without saving (current
 * production behavior — no regression).
 *
 * Raw `Modal` + backdrop, consistent with ReorderModal etc.
 */
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Button from '../common/Button';
import { colors, radii, spacing, typography } from '../../constants/theme';

type Props = {
  visible: boolean;
  defaultLabel: string;        // reverse-geocoded suggestion
  defaultLine1: string;        // street / locality, may be empty
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

const CHIPS = ['Home', 'Office', 'Other'];

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

  // Re-sync defaults when the modal is re-opened with new geocode
  // results. Without this a second visit (rare but possible — user
  // cancels a save, places another current-location order) would
  // stick the first call's values.
  useEffect(() => {
    if (visible) {
      setLabel(defaultLabel);
      setLine1(defaultLine1);
      setCity(defaultCity);
      setPincode(defaultPincode);
    }
  }, [visible, defaultLabel, defaultLine1, defaultCity, defaultPincode]);

  const handleSave = async () => {
    const trimmed = label.trim() || defaultLabel;
    setSaving(true);
    try {
      await onSave({
        label: trimmed,
        line1: line1.trim(),
        city: city.trim(),
        pincode: pincode.trim(),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onSkip}
    >
      <Pressable style={styles.backdrop} onPress={onSkip}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ width: '100%' }}
        >
          {/* Inner pressable swallows backdrop dismiss — same trick
              as ReorderModal etc. */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.title}>Save this location?</Text>
            <Text style={styles.subtitle}>
              Give it a name so you can pick it next time without
              re-typing the address.
            </Text>

            <Text style={styles.label}>Name</Text>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="e.g. Office, Uncle's house, Sector 10"
              style={styles.input}
              autoFocus
              maxLength={40}
            />
            <View style={styles.chips}>
              {CHIPS.map(c => (
                <Pressable
                  key={c}
                  onPress={() => setLabel(c)}
                  style={({ pressed }) => [
                    styles.chip,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={styles.chipText}>{c}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Street / Area</Text>
            <TextInput
              value={line1}
              onChangeText={setLine1}
              placeholder="(optional)"
              style={styles.input}
              maxLength={120}
            />
            <View style={styles.cityRow}>
              <View style={{ flex: 2 }}>
                <Text style={styles.label}>City</Text>
                <TextInput
                  value={city}
                  onChangeText={setCity}
                  style={styles.input}
                  maxLength={60}
                />
              </View>
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={styles.label}>Pincode</Text>
                <TextInput
                  value={pincode}
                  onChangeText={setPincode}
                  style={styles.input}
                  keyboardType="number-pad"
                  maxLength={6}
                />
              </View>
            </View>

            <View style={styles.ctaRow}>
              <Pressable
                onPress={onSkip}
                style={({ pressed }) => [
                  styles.skipBtn,
                  pressed && { opacity: 0.85 },
                ]}
                disabled={saving}
              >
                <Text style={styles.skipBtnText}>Skip</Text>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Button
                  title={saving ? 'Saving…' : 'Save'}
                  onPress={handleSave}
                  disabled={saving || label.trim().length === 0}
                  fullWidth
                />
              </View>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
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
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  handle: {
    width: 40, height: 4, backgroundColor: colors.border, borderRadius: 2,
    alignSelf: 'center', marginBottom: spacing.md,
  },
  title: { ...typography.h2 },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.md },
  label: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.md },
  input: {
    ...typography.body,
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginTop: spacing.xs,
    color: colors.text,
  },
  chips: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    backgroundColor: colors.primaryLight, borderRadius: radii.full,
  },
  chipText: { ...typography.caption, color: colors.primaryDark },
  cityRow: { flexDirection: 'row' },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  skipBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  skipBtnText: { ...typography.body, color: colors.textSecondary },
});
```

(If `radii.full` doesn't exist on your theme, substitute `999` inline.)

### §B — Reverse-geocode helper (new pure-ish module)

`src/utils/reverseGeocodeLabel.ts`:

```ts
/**
 * PR-NEXT-ADDRESS-UX.1 — best-effort reverse-geocode of a GPS pin
 * to (label, line1, city, pincode) suggestions for the save-this-
 * location modal. Failure is non-fatal: returns sensible empty
 * defaults so the modal still opens with the live coords usable.
 *
 * Why a module-level wrapper: expo-location's `reverseGeocodeAsync`
 * is async + may throw on devices without Google Play Services
 * (Android emulator without play), no network, etc. Keeping the
 * try/catch here means CheckoutScreen's call site stays linear.
 */
import * as Location from 'expo-location';

export type GeocodeSuggestion = {
  label: string;
  line1: string;
  city: string;
  pincode: string;
};

export async function reverseGeocodeLabel(
  coords: { lat: number; lng: number },
): Promise<GeocodeSuggestion> {
  try {
    const results = await Location.reverseGeocodeAsync({
      latitude: coords.lat,
      longitude: coords.lng,
    });
    const r = results[0];
    if (!r) return EMPTY;
    const street = [r.name, r.street].filter(Boolean).join(', ');
    const cityPart = r.city ?? r.subregion ?? '';
    const district = r.subregion && r.subregion !== r.city ? r.subregion : '';
    const labelParts = [r.district || r.name, district || cityPart].filter(Boolean);
    return {
      label: labelParts.join(', ').trim() || 'Current location',
      line1: street,
      city: cityPart,
      pincode: r.postalCode ?? '',
    };
  } catch {
    return EMPTY;
  }
}

const EMPTY: GeocodeSuggestion = {
  label: 'Current location',
  line1: '',
  city: '',
  pincode: '',
};
```

Add a test pin `tests/utils/reverseGeocodeLabel.test.ts` with `jest.mock('expo-location')` for 4 cases: happy-path label assembly, empty results, throw, missing district.

### §C — Wire into CheckoutScreen

In `src/screens/CheckoutScreen.tsx`:

1. **Add state + suggestion** near other useStates (above any conditional return — Rule 2):

   ```tsx
   const [saveLocationModalVisible, setSaveLocationModalVisible] = useState(false);
   const [geocodeSuggestion, setGeocodeSuggestion] = useState<GeocodeSuggestion | null>(null);
   const [pendingSaveCoords, setPendingSaveCoords] = useState<
     { lat: number; lng: number; phone: string; name: string } | null
   >(null);
   ```

2. **Edit `maybeSaveAddressAfterOrder`** — replace the `if (deliveryTargetMode === 'current') return;` early-return with a branch that opens the modal instead:

   ```tsx
   if (deliveryTargetMode === 'current') {
     // PR-NEXT-ADDRESS-UX.1 — instead of silently skipping, offer
     // to save the location with a customer-chosen name so it's
     // reusable from the address book. Skip-on-cancel keeps the
     // pre-PR posture.
     if (!liveCoords) return;
     setPendingSaveCoords({
       lat: liveCoords.lat,
       lng: liveCoords.lng,
       phone: addr.phone,
       name: addr.name,
     });
     const suggestion = await reverseGeocodeLabel({
       lat: liveCoords.lat,
       lng: liveCoords.lng,
     });
     setGeocodeSuggestion(suggestion);
     setSaveLocationModalVisible(true);
     return;
   }
   // … rest of the function unchanged
   ```

3. **Add the modal at the bottom of the JSX tree** (inside the SafeAreaView, after the main scroll):

   ```tsx
   {pendingSaveCoords && geocodeSuggestion && (
     <SaveCurrentLocationModal
       visible={saveLocationModalVisible}
       defaultLabel={geocodeSuggestion.label}
       defaultLine1={geocodeSuggestion.line1}
       defaultCity={geocodeSuggestion.city}
       defaultPincode={geocodeSuggestion.pincode}
       onSkip={() => {
         setSaveLocationModalVisible(false);
         setPendingSaveCoords(null);
         setGeocodeSuggestion(null);
       }}
       onSave={async input => {
         try {
           await profileService.saveAddress({
             label: input.label,
             name: pendingSaveCoords.name,
             phone: pendingSaveCoords.phone,
             line1: input.line1,
             city: input.city,
             pincode: input.pincode,
             lat: pendingSaveCoords.lat,
             lng: pendingSaveCoords.lng,
           });
         } catch (e) {
           console.warn('[Checkout] saveAddress (current location) failed:', e);
         } finally {
           setSaveLocationModalVisible(false);
           setPendingSaveCoords(null);
           setGeocodeSuggestion(null);
         }
       }}
     />
   )}
   ```

4. **Imports** (each with "PR-NEXT-ADDRESS-UX.1 — DO NOT REMOVE" comment):

   ```tsx
   import SaveCurrentLocationModal from '../components/address/SaveCurrentLocationModal';
   import {
     reverseGeocodeLabel,
     type GeocodeSuggestion,
   } from '../utils/reverseGeocodeLabel';
   ```

### §D — Order doesn't block on the prompt

`maybeSaveAddressAfterOrder` runs AFTER `placeOrder` resolves. The modal opens AFTER the order is already placed and the user has been routed to OrderConfirmation. Verify the call ordering in the `placeOrder` paths (lines 658, 724) — `await maybeSaveAddressAfterOrder(address);` runs after `nav.replace('OrderConfirmation', { orderId })`. If the navigation happens FIRST then the modal would render under the confirmation screen — **call `await maybeSaveAddressAfterOrder(address)` BEFORE `nav.replace`** so the modal sits on top of the Checkout screen, gets resolved, then nav fires.

If the existing flow already does the await-then-nav order — leave it. Otherwise, swap. Document the chosen order in a one-line comment so a future reader doesn't undo it.

---

## Discipline checklist

1. **Rule 1** — `SaveCurrentLocationModal`, `reverseGeocodeLabel`, `GeocodeSuggestion` imports all carry "DO NOT REMOVE" comments.
2. **Rule 2** — All new useStates added with the other top-level useStates above the existing `if (loading) return …` branches.
3. **No schema change** — `saveAddress` already accepts `lat` + `lng`.
4. **No callable change.**
5. **Test discipline** — +4 reverse-geocode helper tests; modal is presentational, covered by acceptance.
6. **OTA classification** — pure JS. `expo-location` permission already in `app.json`; `reverseGeocodeAsync` doesn't require a new permission beyond `Location/WhenInUse` already requested.

---

## Acceptance checklist

1. Customer at checkout taps "Deliver to current location," GPS captures within ~3s. Confirms order.
2. **Order places successfully** (OrderConfirmation appears in the background under the modal).
3. **Save-this-location modal slides up** with: title "Save this location?", name pre-filled with reverse-geocode (e.g. "Sector 10, Ballabgarh"), chips for Home / Office / Other, optional line1/city/pincode fields pre-filled from reverse-geocode (or empty if it failed).
4. Tap "Office" chip → name field replaces to "Office". Tap Save → modal dismisses; OrderConfirmation visible.
5. Open Profile → Addresses. The new "Office" entry appears with the GPS pin set (look for the address row icon / label that indicates a pinned address).
6. Place another order. Checkout's saved-address picker now shows "Office" alongside any prior addresses. Picking it → CheckoutScreen runs the saved-address-with-coords primary path (no live-GPS fallback needed — coords are on the row).
7. **Skip path** — repeat the flow, hit Skip instead of Save. Modal dismisses; no new address; same posture as pre-PR.
8. **Reverse-geocode failure path** — toggle airplane mode mid-flow OR run on an Android emulator without Google Play Services. Modal still opens with name default "Current location" + all other fields empty. Customer types a name and saves. Address persists with lat/lng + their typed label; other fields empty (fine — customer can edit later).
9. **First-address case unchanged** — customer with zero saved addresses places a SAVED-form order (not current-location). The existing first-address auto-save path (`addr.city.trim() || 'Home'`) still fires. No regression.
10. **Existing "Save this address?" Alert.alert path unchanged** — customer with ≥1 saved address places a SAVED-form order. The existing yes/no alert still fires for the typed-form path. No regression.
11. `npx tsc --noEmit` clean; `npm run test:unit` clean; suite +4.

---

## Out of scope

- **Maps preview** of the saved pin during naming. Punt to a Phase B address-book overhaul.
- **Auto-name from places API** (Google Places nearby search → "Cafe Coffee Day, Sector 10"). Costs API budget; reverse-geocode label is good enough for pilot.
- **Edit-in-place after Save** ("oops, I called it Home but I meant Office"). Customer can edit via the existing Address book — no new edit surface.
- **Migration of existing current-location-only orders** to retro-create address rows. The locked deliveryLocation pin on those orders stays — orders are historical, not re-savable.

---

## Deploy

```
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "PR-NEXT-ADDRESS-UX.1 save-current-location prompt + reverse-geocode"
```

## Doc trail

- `docs/TESTING-FINDINGS-2026-05-30.md` — Case 10 (ADDRESS-UX reopened) → `⚠️ PARTIAL — completed in PR-NEXT-ADDRESS-UX.1`.
- `docs/SESSION_LOG.md` — one paragraph.
- `CLAUDE.md` — bump date.
