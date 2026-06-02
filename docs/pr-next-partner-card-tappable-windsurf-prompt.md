# PR-NEXT-PARTNER-CARD — Make `PartnerIdentityCard` tappable with a details sheet

**Source:** Case 6 in Sudhir's June 1 testing pass. *"On customer side, I see a card 'your delivery partner' with a message 'heading to the shop' but not clickable and not able to show any details."*

**Deploy class:** pure client OTA. No callable, no schema, no rules.

**Read first**

1. `CLAUDE.md`
2. `.windsurf/code-discipline.md` Rules 1, 2
3. `src/components/order/PartnerIdentityCard.tsx` — current static card (PR-NEXT-13a)
4. `src/utils/partnerInitials.ts` — `initialsFor` helper (reused)
5. `src/screens/OrderDetailScreen.tsx` lines 412–430 — the card's render call site

---

## Plan

### §A — Make the card a `Pressable`

In `src/components/order/PartnerIdentityCard.tsx`, wrap the outer `<View style={styles.card}>` in a `<Pressable>` and accept an `onPress` prop:

```tsx
export default function PartnerIdentityCard({
  name,
  pickedUpAt,
  onPress,
}: {
  name?: string | null;
  pickedUpAt: number | null;
  onPress?: () => void;
}) {
  // ... existing displayName, initials, subtitle logic ...

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={
        onPress
          ? `Open details for ${displayName}`
          : undefined
      }
      style={({ pressed }) => [
        styles.card,
        pressed && onPress && { opacity: 0.85 },
      ]}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
      </View>
      {onPress && (
        <Text style={styles.chevron}>›</Text>
      )}
    </Pressable>
  );
}
```

Add a `chevron` style:

```ts
chevron: {
  ...typography.h2,
  color: colors.textSecondary,
  paddingLeft: spacing.sm,
},
```

### §B — Open a details bottom sheet on tap

Two choices:
- (A) Use React Native's `Modal` with a slide-up animation
- (B) Use a dedicated library (`@gorhom/bottom-sheet`)

This codebase uses raw `Modal` elsewhere (ReorderModal, CancelAndRefundModal). Stay consistent — use Modal.

Create `src/components/order/PartnerDetailsSheet.tsx`:

```tsx
/**
 * PR-NEXT-PARTNER-CARD (Case 6) — bottom-sheet-style modal showing
 * the safely-disclosable partner details on customer's OrderDetail.
 *
 * Disclosed pre-pickup:
 *   - Display name + initials avatar
 *   - State subtitle (📦 Heading to the shop / 🛵 On the way to you)
 *   - Shop pickup location (the shop name customer already knows)
 *   - Approximate ETA if computable from PR 50's distance estimate
 *
 * NOT disclosed pre-pickup:
 *   - Phone number (gated to post-pickup as before)
 *   - Partner's exact current location (privacy + not pre-pickup useful)
 *
 * Post-pickup adds:
 *   - Phone number (if `pickedUpAt != null` AND shop has confirmed
 *     the partner picked up — existing customer-side phone gate)
 *
 * Sheet dismisses on backdrop tap or explicit Close button.
 */
import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { initialsFor } from '../../utils/partnerInitials';

type Props = {
  visible: boolean;
  onClose: () => void;
  partnerName?: string | null;
  pickedUpAt: number | null;
  shopName?: string | null;
};

export default function PartnerDetailsSheet({
  visible,
  onClose,
  partnerName,
  pickedUpAt,
  shopName,
}: Props) {
  const displayName =
    typeof partnerName === 'string' && partnerName.trim().length > 0
      ? partnerName.trim()
      : 'Your delivery partner';
  const initials = initialsFor(partnerName);
  const stateText =
    pickedUpAt != null
      ? '🛵 On the way to you'
      : '📦 Heading to the shop';
  const shopPart =
    shopName && shopName.trim().length > 0 ? shopName.trim() : 'the shop';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Inner pressable swallows the tap so backdrop dismiss
            doesn't fire when tapping the sheet itself. Same trick
            as ReorderModal. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>{displayName}</Text>
              <Text style={styles.state}>{stateText}</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Picking up from</Text>
            <Text style={styles.rowValue} numberOfLines={1}>{shopPart}</Text>
          </View>
          {pickedUpAt == null && (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Phone</Text>
              <Text style={styles.rowValueMuted}>Shared once the order is picked up</Text>
            </View>
          )}
          {/* Post-pickup phone disclosure stays gated to the existing
              code path (OrderDetailScreen surfaces it elsewhere). Don't
              duplicate the lookup here. */}
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeBtn,
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Close partner details"
          >
            <Text style={styles.closeBtnText}>Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const AVATAR_SIZE = 56;

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
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typography.h2, color: colors.primaryDark },
  title: { ...typography.h2 },
  state: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.lg },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  rowLabel: { ...typography.body, color: colors.textSecondary },
  rowValue: { ...typography.bodyBold, flex: 1, textAlign: 'right', marginLeft: spacing.md },
  rowValueMuted: { ...typography.caption, color: colors.textSecondary, flex: 1, textAlign: 'right', marginLeft: spacing.md },
  closeBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.primaryLight,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  closeBtnText: { ...typography.bodyBold, color: colors.primaryDark },
});
```

### §C — Wire into `OrderDetailScreen`

In `src/screens/OrderDetailScreen.tsx` around the existing `<PartnerIdentityCard ... />` render (lines 421–430), add state + the sheet:

```tsx
// Add state near other useState at the top
const [partnerSheetOpen, setPartnerSheetOpen] = useState(false);
```

Update the card render to pass `onPress`:

```tsx
<PartnerIdentityCard
  name={order.deliveryPersonName}
  pickedUpAt={
    typeof order.pickedUpAt === 'number' ? order.pickedUpAt : null
  }
  onPress={() => setPartnerSheetOpen(true)}
/>
```

Add the sheet near the bottom of the JSX tree (after the main ScrollView, inside the SafeAreaView):

```tsx
<PartnerDetailsSheet
  visible={partnerSheetOpen}
  onClose={() => setPartnerSheetOpen(false)}
  partnerName={order.deliveryPersonName}
  pickedUpAt={
    typeof order.pickedUpAt === 'number' ? order.pickedUpAt : null
  }
  shopName={order.shopName}
/>
```

Add imports:

```tsx
import PartnerDetailsSheet from '../components/order/PartnerDetailsSheet';
```

### §D — Keep card useful WITHOUT `onPress`

The card is also rendered on the customer's `OrderDetailScreen` only (per PR-NEXT-13a). If future surfaces want the card without the tap (e.g. an admin overview), the `onPress` prop is optional — when omitted, the card renders without the chevron and isn't pressable.

---

## Discipline checklist

1. **Rule 1** — `PartnerDetailsSheet` import + state useState carry standard comments.
2. **Rule 2** — `useState` for `partnerSheetOpen` sits with other useStates above the existing conditional returns.
3. **No schema, no callable.**
4. **No new tests** — presentation logic. `initialsFor` already pinned by PR-NEXT-13a's tests.
5. **OTA classification** — pure JS.

---

## Acceptance checklist

1. Customer places an order. Walk through to partner-claimed (`deliveryPersonId != null`, `pickedUpAt == null`).
2. On `OrderDetailScreen`, `PartnerIdentityCard` shows. It now has a right-side chevron `›`.
3. Tap the card. **Bottom sheet slides up** with: avatar, partner name, state ("📦 Heading to the shop"), "Picking up from: [shop name]", "Phone: Shared once the order is picked up".
4. Tap backdrop OR Close button — sheet dismisses smoothly.
5. After partner taps "I've picked it up", the card subtitle flips to "🛵 On the way to you". Tap card again — sheet shows updated state. Phone row no longer shows the muted "Shared once…" copy (it's pre-pickup-only).
6. **Regression — card still renders without onPress:** if a future caller omits `onPress`, the card has no chevron and isn't pressable. (Verify by manually removing the prop in dev.)
7. `npx tsc --noEmit` clean; `npm run test:unit` unchanged.

---

## Out of scope

- **Phone disclosure inside the sheet post-pickup.** Today phone reveal lives on a different code path (the existing customer-side phone surface). Don't duplicate; sheet just notes when it'll become available.
- **Partner rating display.** Could surface partner's rolling rating in the sheet later if pilot wants. Punt — keeps post-pilot scope tight.
- **Partner profile photo.** No profile photo flow exists yet (deferred from PR-NEXT-13a). Initials avatar stays.
- **Live ETA / distance to shop.** Reuses PR 50 plumbing on the partner side but not yet surfaced to customer here. Punt.

---

## Deploy

```
eas update --branch production --message "PR-NEXT-PARTNER-CARD tappable card + details sheet"
```

## Doc trail

- `docs/TESTING-FINDINGS-2026-05-30.md` — Case 6 → `✅ SHIPPED in PR-NEXT-PARTNER-CARD`.
- `docs/SESSION_LOG.md` — one paragraph.
- `CLAUDE.md` — bump date.
