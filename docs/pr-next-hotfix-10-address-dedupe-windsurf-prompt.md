# PR-NEXT-HOTFIX-10 — Address dedupe on current-location save (silent skip + toast)

**Source:** Sudhir's June 2 testing. *"Placed 2 orders from same location and used current location option as delivery address, it saved exact 2 addresses in the profile. I think we should not save duplicated addresses. Or if latitude longitude are same, no need to popup to save duplicate address. Or something else, but creating duplicate address is not good."*

Decisions locked (pre-design check):
- **UX:** silent skip — modal doesn't appear when an existing address is within threshold. Small toast confirms `"Saved as 'Home' (already in your address book)"`.
- **Threshold:** 25m haversine.

**Deploy class:** pure client OTA. No callable, no schema.

**Audit-grep (Rule 5):**

```
grep -n "addresses\|address.lat\|address.lng" src/types/index.ts
grep -n "SaveCurrentLocationModal\|saveLocationModalVisible\|pendingSaveCoords" src/screens/CheckoutScreen.tsx
grep -n "haversineKm" src/utils/distance.ts
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `Address.lat` / `Address.lng` | `src/types/index.ts` (PR 46 fields) | Optional; populated when AddressEditScreen / SaveCurrentLocationModal stamps them |
| `profile.addresses` | UserProfile type | array of Address |
| `haversineKm` | `src/utils/distance.ts` | existing pure helper, takes `{lat, lng}` × 2 |
| Modal trigger site | `CheckoutScreen.tsx` `maybeSaveAddressAfterOrder` current-location branch (post HOTFIX-8 + ADDRESS-UX.1) | This is where we intercept BEFORE opening the modal |

**Read first**

1. `CLAUDE.md`
2. `.windsurf/code-discipline.md` Rules 1, 2, 5
3. `src/screens/CheckoutScreen.tsx` `maybeSaveAddressAfterOrder` — the current-location branch (post-HOTFIX-8) that opens `SaveCurrentLocationModal`
4. `src/utils/distance.ts` — `haversineKm` (reused; not modified)
5. `src/types/index.ts` `Address` — confirm `lat?: number; lng?: number` fields

---

## Plan

### §A — Pure helper: `findAddressNearby`

`src/utils/findAddressNearby.ts`:

```ts
/**
 * PR-NEXT-HOTFIX-10 — pure address-dedupe lookup. Returns the
 * closest existing address within `thresholdM` of the target
 * coords, or null if none. Centralizes the comparison so the
 * SaveCurrentLocationModal flow + any future address-editor
 * dedupe (e.g. AddressEditScreen could warn before saving an
 * obvious duplicate) reuse the same matching logic.
 *
 * Pure; pinned by tests/utils/findAddressNearby.test.ts.
 *
 * Threshold rationale (Sudhir, June 2 2026): 25m collapses pins
 * that are essentially identical (typical urban outdoor GPS
 * accuracy is 5-20m; same-building indoor accuracy 30-50m).
 * Aggressive enough that two orders from the same building won't
 * duplicate; lenient enough that next-door neighbours still save
 * as separate rows.
 */
import type { Address } from '../types';
import { haversineKm } from './distance';

export const DEFAULT_DEDUPE_THRESHOLD_M = 25;

export function findAddressNearby(
  addresses: Address[],
  target: { lat: number; lng: number },
  thresholdM: number = DEFAULT_DEDUPE_THRESHOLD_M,
): Address | null {
  if (
    typeof target.lat !== 'number' ||
    !Number.isFinite(target.lat) ||
    typeof target.lng !== 'number' ||
    !Number.isFinite(target.lng)
  ) {
    return null;
  }
  let closest: { addr: Address; distM: number } | null = null;
  for (const a of addresses) {
    if (
      typeof a.lat !== 'number' ||
      !Number.isFinite(a.lat) ||
      typeof a.lng !== 'number' ||
      !Number.isFinite(a.lng)
    ) {
      continue; // address has no pin (pre-PR-46 or form-only) → not comparable
    }
    const distKm = haversineKm({ lat: a.lat, lng: a.lng }, target);
    const distM = distKm * 1000;
    if (distM <= thresholdM && (!closest || distM < closest.distM)) {
      closest = { addr: a, distM };
    }
  }
  return closest?.addr ?? null;
}
```

Pin with **8 test cases**: exact match (0m), 1m away, 24.9m (in), 25.0m (boundary in — inclusive matches `chargeForDistance` convention), 25.1m (out), no candidates have coords, target has non-finite coords, multiple within threshold (returns closest).

### §B — Minimal Toast primitive

No `Toast` exists in the codebase (audit-grepped). Create `src/components/common/Toast.tsx`:

```tsx
/**
 * PR-NEXT-HOTFIX-10 — bare-minimum toast primitive. Auto-dismisses
 * after `durationMs` (default 3000). Renders absolute-positioned at
 * the bottom of the screen, above safe-area inset (matches
 * BottomSheet convention from HOTFIX-7 / Rule 13).
 *
 * Single Toast per screen for now — the only caller is the
 * address-dedupe path in CheckoutScreen. If multi-toast queueing
 * becomes a need, swap in `react-native-root-toast` later.
 */
import React, { useEffect } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing, typography } from '../../constants/theme';

type Props = {
  visible: boolean;
  message: string;
  onDismiss: () => void;
  durationMs?: number;
};

export default function Toast({ visible, message, onDismiss, durationMs = 3000 }: Props) {
  const insets = useSafeAreaInsets();
  const opacity = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        onDismiss();
      });
    }, durationMs);
    return () => clearTimeout(t);
  }, [visible, durationMs, opacity, onDismiss]);

  if (!visible) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        { bottom: insets.bottom + spacing.xl, opacity },
      ]}
    >
      <Text style={styles.text} numberOfLines={2}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.text,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  text: { ...typography.body, color: colors.bg, textAlign: 'center' },
});
```

### §C — Wire into the current-location save path

In `CheckoutScreen.tsx` `maybeSaveAddressAfterOrder`, the current-location branch (post-ADDRESS-UX.1 wiring) sets `pendingSaveCoords` + opens the modal. Intercept BEFORE that:

```tsx
if (deliveryTargetMode === 'current') {
  if (!liveCoords) return;
  // PR-NEXT-HOTFIX-10 — dedupe gate. Skip the modal entirely when
  // the customer already has an address pin within 25m of the
  // current GPS reading. Toast confirms which existing address
  // matched, so the customer feels acknowledged rather than
  // wondering whether their save fired.
  const match = findAddressNearby(profile?.addresses ?? [], {
    lat: liveCoords.lat,
    lng: liveCoords.lng,
  });
  if (match) {
    setToastMessage(
      `Saved as ${match.label?.trim() || 'an existing address'} (already in your address book)`,
    );
    setToastVisible(true);
    return; // skip modal entirely
  }
  // Existing ADDRESS-UX.1 flow continues unchanged below.
  setPendingSaveCoords({ /* … */ });
  // …
}
```

Add state at top of the screen (above conditional returns — Rule 2):

```tsx
const [toastVisible, setToastVisible] = useState(false);
const [toastMessage, setToastMessage] = useState('');
```

Mount `<Toast>` at the SafeAreaView root, after the modal:

```tsx
<Toast
  visible={toastVisible}
  message={toastMessage}
  onDismiss={() => setToastVisible(false)}
/>
```

Imports (each with "PR-NEXT-HOTFIX-10 — DO NOT REMOVE"):

```tsx
import { findAddressNearby } from '../utils/findAddressNearby';
import Toast from '../components/common/Toast';
```

---

## Discipline checklist

1. **Rule 1** — `findAddressNearby` + `Toast` imports carry "PR-NEXT-HOTFIX-10 — DO NOT REMOVE" comments.
2. **Rule 2** — `toastVisible` + `toastMessage` useStates sit with other top-level useStates above any conditional return.
3. **Rule 5** — audit-grep table in header confirms `Address.lat/lng`, `profile.addresses`, `haversineKm`.
4. **Rule 13** — Toast respects `useSafeAreaInsets().bottom + spacing.xl` for positioning (no hardcoded bottom offset; HOTFIX-7's discipline extends here).
5. **No schema, no callable.**
6. **Test discipline** — +8 helper tests for `findAddressNearby`. Toast is presentational; acceptance covers it.

---

## Acceptance checklist

1. **First save (no match exists)** — fresh customer, place order with current location, modal opens as today, customer names it "Home," saves. Profile has one address with the pin.
2. **Second save from same spot (within 25m)** — same customer, same physical location, second current-location order. **Modal does NOT open.** Toast slides up at bottom: `"Saved as Home (already in your address book)"`. Auto-dismisses after 3s. Profile still has exactly ONE address.
3. **Second save from > 25m away** — drive 100m down the street, repeat. Modal opens. Customer names this one "Mom's place" or whatever. Profile now has TWO addresses.
4. **Boundary case** — manually set up a saved address at exactly 25.0m away (Firestore Console). Repeat the order. Toast fires (inclusive boundary matches `chargeForDistance`).
5. **Address without lat/lng** — customer with a legacy address (pre-PR 46, no GPS pin). Repeat the order. Modal opens (no match candidate; legacy address skipped from comparison).
6. **Address with bad coords** — manually corrupt a saved address with `lat: NaN`. Repeat. Modal opens (defensive Number.isFinite check in findAddressNearby skips bad pin).
7. **Toast renders above Android gesture-nav pill** — visible, not clipped, doesn't intercept touches (pointerEvents="none").
8. **Toast auto-dismisses cleanly** — opacity fades, then sets `visible: false`. No lingering ghost.
9. `npx tsc --noEmit` clean; `npm run test:unit` clean; suite +8.

---

## Out of scope

- **Bulk dedupe** of an existing customer's pre-PR duplicate addresses. One-time scripts territory; not worth the migration risk for pilot.
- **Show existing addresses on a map at modal-open time** so the customer can visually confirm "yes that's me." Defer to Phase B if anyone asks.
- **Notification when CheckoutScreen's saved-address picker actually has duplicates pre-PR** — could surface a "looks like you have nearby addresses, consolidate?" hint. Out of scope.

---

## Deploy

```
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "PR-NEXT-HOTFIX-10 address dedupe silent-skip + toast"
```

## Doc trail

- `docs/TESTING-FINDINGS-2026-05-30.md` — append Sudhir's June 2 observation #6 → `✅ SHIPPED in PR-NEXT-HOTFIX-10`.
- `docs/SESSION_LOG.md` — one paragraph.
- `CLAUDE.md` — bump date.
