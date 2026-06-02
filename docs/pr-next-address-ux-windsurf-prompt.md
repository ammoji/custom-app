# PR-NEXT-ADDRESS-UX — "Deliver to current location" address naming + smart defaults

**Source:** Case 10 in Sudhir's June 1 testing pass. *"When customer selects deliver to my current location, it creates new address with name 'Address' and copy address details from Home Address. User needs to give this location a name instead of just saying 'Address', slowly there will be tons of addresses and user will not know which address is what. Also it should not copy other address details as default. We can just keep those details empty and if user wants to fill them later, that's fine. Or not sure if we can get the actual address and put that by default."*

Three sub-fixes bundled:

1. Prompt user for a name when creating a current-location address (default to a contextual placeholder, NOT "Address")
2. Don't auto-copy unrelated fields from Home / other addresses
3. Optionally reverse-geocode the lat/lng to surface an actual street address

**Deploy class:** pure client OTA.

**Read first**

1. `CLAUDE.md`
2. `.windsurf/code-discipline.md` Rules 1, 2
3. `src/screens/AddressEditScreen.tsx` — the "Deliver to current location" handler (added in PR 46)
4. `src/screens/CheckoutScreen.tsx` — "Deliver to current location" path may also live here
5. `src/types/index.ts` — `Address` type structure (label, line1, line2, pincode, lat, lng, etc.)

---

## Plan

### §A — Stop auto-copying fields from Home / other addresses

Grep for `'Address'` literal in `AddressEditScreen.tsx` and `CheckoutScreen.tsx` to find the current-location handler. Identify where it builds the new Address object. Currently it likely does:

```ts
// Something like (pseudocode based on Sudhir's symptom):
const newAddress = {
  label: 'Address',  // ← generic default
  ...existingHomeAddress,  // ← auto-copy bug
  lat: currentLocation.lat,
  lng: currentLocation.lng,
};
```

Fix: build the new address from scratch, NOT spread from another address:

```ts
const newAddress = {
  label: '',  // user-supplied or auto-named below
  line1: '',  // empty; user fills or geocode populates
  line2: '',
  city: '',
  pincode: '',
  phone: existingHomeAddress?.phone ?? '',  // OK to inherit phone
  lat: currentLocation.lat,
  lng: currentLocation.lng,
};
```

Only `phone` is reasonable to inherit (it's the user's own number, not address-specific). Everything else stays empty.

### §B — Prompt for a name with a contextual placeholder

After capturing the current location, show a `prompt`-style Alert (or a small modal) asking for the address name. Default placeholder text should be contextual — e.g. "Current location · [HH:MM]" — so the user has something distinguishable if they skip naming.

Pattern (using React Native's `Alert.prompt` which works on iOS; for Android-compatible alternative, use a small in-app modal):

```ts
import { Alert, Platform } from 'react-native';

const defaultName = `Current location · ${new Date().toLocaleString('en-IN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})}`;

if (Platform.OS === 'ios') {
  Alert.prompt(
    'Name this address',
    'Give it a memorable name (e.g. "Office", "Mom\'s house").',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: (name?: string) => {
          const finalLabel = name?.trim() || defaultName;
          createAddress({ ...newAddress, label: finalLabel });
        },
      },
    ],
    'plain-text',
    defaultName,
  );
} else {
  // Android: Alert.prompt isn't supported. Use a small modal with TextInput.
  // Pattern: state-driven local modal (mirror ETA / ReorderModal posture).
  setNamePromptVisible(true);
  // Modal renders TextInput pre-filled with defaultName + Save button.
}
```

For Android, create `src/components/address/NamePromptModal.tsx` — small reusable modal with TextInput + Save/Cancel buttons. Pre-fills with `defaultName`; user can edit or accept.

### §C — (Optional) Reverse-geocode the actual address

Use `expo-location`'s `Location.reverseGeocodeAsync({ latitude, longitude })` to populate `line1` / `city` / `pincode` from the coordinates:

```ts
import * as Location from 'expo-location';

try {
  const results = await Location.reverseGeocodeAsync({
    latitude: currentLocation.lat,
    longitude: currentLocation.lng,
  });
  if (results.length > 0) {
    const r = results[0]!;
    newAddress.line1 = [r.name, r.street].filter(Boolean).join(', ');
    newAddress.city = r.city ?? r.subregion ?? '';
    newAddress.pincode = r.postalCode ?? '';
  }
} catch (e) {
  console.warn('[reverseGeocode] failed (non-fatal):', e);
  // Leave fields empty; user can fill manually
}
```

`expo-location` is already in dependencies (used by `useLocationStore`). Reverse-geocoding is a free Google service (no extra API costs at pilot scale). Best-effort with a try/catch — if it fails (no network, no Google Play Services on Android emulator, etc.), fall through to empty fields.

### §D — Save flow

After name prompt + (optional) reverse-geocode complete, save the address as today via the existing `addAddress` / `saveAddress` callable. Same auth gate, same persistence, just with the cleaner field defaults.

If reverse-geocoding takes more than a tick, show a small spinner during the save (don't block forever — set a 3s timeout, then save with whatever fields are populated).

---

## Discipline checklist

1. **Rule 1** — `Location` import + `NamePromptModal` import (if Android) carry "DO NOT REMOVE" comments.
2. **Rule 2** — Hooks above conditionals.
3. **No schema change** — same Address type.
4. **No callable change** — uses existing addAddress.
5. **OTA classification** — pure JS. `expo-location` permission is already in `app.json`.

---

## Acceptance checklist

1. iOS: Customer signs in, opens AddressEditScreen, taps "Deliver to current location."
2. iOS prompt appears: "Name this address" with pre-filled default "Current location · 16:42" and Save / Cancel.
3. Type "Office" → tap Save. New address saved with label "Office", line1/line2/city/pincode populated by reverse-geocode (or empty if it failed), phone inherited from existing profile, NOT inherited from Home address.
4. Repeat on Android (or current-location flow on Checkout) — name modal slides up with TextInput; same behavior.
5. Customer's address list now shows "Office" as a distinct entry, not "Address" #N.
6. Edge case: user taps Cancel on the name prompt — current-location flow aborts. No address created. No half-baked state on the screen.
7. Edge case: reverse-geocode throws (test by toggling airplane mode) — name + lat/lng + phone are saved; other fields empty. User can edit later.
8. Regression — manually adding a non-current-location address: nothing changed. Existing form flow intact.
9. `npx tsc --noEmit` clean; `npm run test:unit` clean.

---

## Out of scope

- **Multi-address picker in name prompt** ("Use as: Home / Work / Other / Custom"). Single label field is enough for v1.
- **Maps preview** of the location during naming. Punt.
- **Validation of pincode** against Google's reverse-geocode output. Trust geocode for v1.

---

## Deploy

```
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "PR-NEXT-ADDRESS-UX current location naming + smart defaults"
```

## Doc trail

- `docs/TESTING-FINDINGS-2026-05-30.md` — Case 10 → `✅ SHIPPED in PR-NEXT-ADDRESS-UX`.
- `docs/SESSION_LOG.md` — one paragraph.
- `CLAUDE.md` — bump date.
