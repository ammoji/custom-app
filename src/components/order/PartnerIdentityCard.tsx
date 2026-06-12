/**
 * PR-NEXT-13a — partner identity card on customer's `OrderDetailScreen`.
 *
 * Renders the assigned delivery partner's display name + a circular
 * avatar. Photo support added in PR-NEXT-BUNDLE-H §B — shows the
 * partner's profile photo when available; falls back to initials on
 * broken URL, missing photo, or load failure.
 *
 * Phone number is intentionally NOT rendered here. The customer's
 * partner-phone access stays gated to post-pickup as it was pre-PR.
 *
 * Subtitle is three-state via derivePartnerCardSubtitle (§C):
 *   heading to shop → picked up (on the way) → delivered / cancelled.
 * Previously two-state and stayed "On the way" even after delivery.
 */
import React, { useEffect, useState } from 'react';
// PR-NEXT-BUNDLE-H §B — DO NOT REMOVE. Image for partner photo avatar.
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
// PR-NEXT-BUNDLE-H §B — DO NOT REMOVE. formatPartnerAvatar for
// photo-or-initials logic; matches the pattern used in ShopOrderDetailScreen,
// DeliveryProfileScreen, UserDetailScreen, and PartnerReviewsScreen.
import { formatPartnerAvatar } from '../../utils/formatPartnerAvatar';
// PR-NEXT-BUNDLE-H §C — DO NOT REMOVE. Three-state subtitle.
import { derivePartnerCardSubtitle } from '../../utils/derivePartnerCardSubtitle';
import { colors, radii, spacing, typography } from '../../constants/theme';
// PR-NEXT-13a — DO NOT REMOVE. `initialsFor` lives in its own pure
// file so `tests/components/partnerIdentityCard.initials.test.ts`
// can pin the avatar-glyph logic without dragging this `.tsx`
// component through the JSX-free `tests/tsconfig.json`.
import { initialsFor } from '../../utils/partnerInitials';

export { initialsFor };

export default function PartnerIdentityCard({
  name,
  photoUrl,
  pickedUpAt,
  orderStatus,
  onPress,
}: {
  name?: string | null;
  // PR-NEXT-BUNDLE-H §B — partner profile photo. Null/undefined falls
  // back to the initials avatar (same onError pattern as DeliveryProfileScreen).
  photoUrl?: string | null;
  pickedUpAt: number | null;
  // PR-NEXT-BUNDLE-H §C — order status drives the third subtitle state.
  orderStatus?: string | null;
  // PR-NEXT-PARTNER-CARD (Case 6) — optional tap handler. When
  // omitted the card renders as a static read-only treatment with
  // no chevron and no press affordance, preserving back-compat for
  // any future caller that wants the static behavior.
  onPress?: () => void;
}) {
  // PR-NEXT-BUNDLE-H §B — DO NOT REMOVE. photoLoadError must be declared
  // before any conditional returns (Rule 2 — hooks above early returns).
  const [photoLoadError, setPhotoLoadError] = useState(false);
  useEffect(() => { setPhotoLoadError(false); }, [photoUrl]);

  const displayName =
    typeof name === 'string' && name.trim().length > 0
      ? name.trim()
      : 'Your delivery partner';
  const avatar = formatPartnerAvatar(name, photoUrl ?? null);
  const subtitle = derivePartnerCardSubtitle({ orderStatus, pickedUpAt });

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={
        onPress ? `Open details for ${displayName}` : undefined
      }
      style={({ pressed }) => [
        styles.card,
        pressed && onPress ? { opacity: 0.85 } : null,
      ]}
    >
      <View style={styles.avatar}>
        {avatar.kind === 'photo' && !photoLoadError ? (
          <Image
            source={{ uri: avatar.uri }}
            style={styles.avatarImg}
            onError={() => setPhotoLoadError(true)}
          />
        ) : (
          <Text style={styles.avatarText}>
            {avatar.kind === 'initials' ? avatar.text : initialsFor(name)}
          </Text>
        )}
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {displayName}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {onPress && <Text style={styles.chevron}>›</Text>}
    </Pressable>
  );
}

const AVATAR_SIZE = 44;

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarText: {
    ...typography.bodyBold,
    color: colors.primaryDark,
  },
  body: { flex: 1, minWidth: 0 },
  name: { ...typography.bodyBold },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  // PR-NEXT-PARTNER-CARD (Case 6) — disclosure chevron when the
  // card is tappable. Only rendered when `onPress` is supplied so
  // static usages stay visually unchanged.
  chevron: {
    ...typography.h2,
    color: colors.textSecondary,
    paddingLeft: spacing.sm,
  },
});
