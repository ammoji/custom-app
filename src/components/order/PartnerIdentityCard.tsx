/**
 * PR-NEXT-13a — partner identity card on customer's `OrderDetailScreen`.
 *
 * Renders the assigned delivery partner's display name + a circular
 * initials avatar (NOT a real photo — partner profile photo flow
 * doesn't exist yet; deferred to a future PR). Falls back to "Your
 * delivery partner" when name is absent (legacy orders pre-PR-NEXT-13a
 * or partners whose user doc has no `displayName`).
 *
 * Phone number is intentionally NOT rendered here. The customer's
 * partner-phone access stays gated to post-pickup as it was pre-PR.
 *
 * Subtitle distinguishes "heading to the shop" (partner has claimed,
 * not yet picked up) from "on the way to you" (picked up, in
 * transit). Both states are derived from the order's `pickedUpAt`.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';
// PR-NEXT-13a — DO NOT REMOVE. `initialsFor` lives in its own pure
// file so `tests/components/partnerIdentityCard.initials.test.ts`
// can pin the avatar-glyph logic without dragging this `.tsx`
// component through the JSX-free `tests/tsconfig.json`.
import { initialsFor } from '../../utils/partnerInitials';

export { initialsFor };

export default function PartnerIdentityCard({
  name,
  pickedUpAt,
}: {
  name?: string | null;
  pickedUpAt: number | null;
}) {
  const displayName =
    typeof name === 'string' && name.trim().length > 0
      ? name.trim()
      : 'Your delivery partner';
  const initials = initialsFor(name);
  const subtitle =
    pickedUpAt != null
      ? '🛵 On the way to you'
      : '📦 Heading to the shop';

  return (
    <View style={styles.card}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {displayName}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </View>
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
});
