/**
 * PR-NEXT-BUNDLE-H §A — customer-side review correction panel.
 *
 * Renders a state-gated section below the "Thanks for rating!" card
 * on OrderDetailScreen when the order has a low-rating correction
 * state. Closes the UX loop where the customer had no in-app surface
 * for the shop/partner response — previously only reachable via push
 * deep-link.
 *
 * State machine:
 *   flagged_low  → "Awaiting response" static info (no CTAs)
 *   responded    → Response text + responder identity + Amend/Ack CTAs
 *   amended      → "You amended this review · published" read-only
 *   published    → "✅ Review published" read-only
 *
 * Accepts a pre-derived view model from `deriveCustomerReviewResponseView`
 * so this component is purely presentational.
 */
import React, { useEffect, useState } from 'react';
// PR-NEXT-BUNDLE-H §A — DO NOT REMOVE. Image for responder avatar.
import { Image, StyleSheet, Text, View } from 'react-native';
import Button from '../common/Button';
import { colors, radii, spacing, typography } from '../../constants/theme';
// PR-NEXT-BUNDLE-H §A — DO NOT REMOVE. formatPartnerAvatar drives the
// photo-or-initials fallback on the responded state responder row.
import { formatPartnerAvatar } from '../../utils/formatPartnerAvatar';
import { initialsFor } from '../../utils/partnerInitials';
import type { CustomerReviewResponseView } from '../../utils/deriveCustomerReviewResponseView';

const AVATAR_SIZE = 36;

type Props = {
  view: CustomerReviewResponseView;
  onAmendPress: () => void;
  onAcknowledgePress: () => void;
  // PR-NEXT-BUNDLE-J §H — DO NOT REMOVE. Which side this panel represents,
  // so the section titles + awaiting copy name the right party when both
  // the shop and delivery panels render together.
  dimensionLabel?: 'shop' | 'delivery';
};

export default function CustomerReviewResponsePanel({
  view,
  onAmendPress,
  onAcknowledgePress,
  dimensionLabel,
}: Props) {
  if (view.kind === 'none') return null;

  // PR-NEXT-BUNDLE-J §H — per-dimension copy.
  const party =
    dimensionLabel === 'delivery'
      ? 'delivery partner'
      : dimensionLabel === 'shop'
        ? 'shop'
        : null;
  const reviewTitle = party
    ? `Your ${dimensionLabel === 'delivery' ? 'delivery' : 'shop'} review`
    : 'Your review';

  if (view.kind === 'awaiting') {
    return (
      <View style={styles.container}>
        <Text style={styles.sectionTitle}>{reviewTitle}</Text>
        <View style={styles.card}>
          <Text style={styles.awaitingIcon}>⏳</Text>
          <View style={styles.awaitingBody}>
            <Text style={styles.awaitingTitle}>Awaiting response</Text>
            <Text style={styles.awaitingSubtitle}>
              {party
                ? `The ${party} may respond within 7 days.`
                : 'The shop or delivery partner may respond within 7 days.'}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  if (view.kind === 'responded') {
    return (
      <View style={styles.container}>
        <Text style={styles.sectionTitle}>
          {party ? `Response from your ${party}` : 'Response to your review'}
        </Text>
        <View style={styles.card}>
          <ResponderIdentityRow
            name={view.responder.name}
            photoUrl={view.responder.photoUrl ?? null}
            responderKind={view.responder.kind}
          />
          <View style={styles.responseDivider} />
          <Text style={styles.responseText}>{view.responseText}</Text>
          <View style={styles.ctaRow}>
            <Button
              title="Amend my rating"
              onPress={onAmendPress}
              variant="secondary"
              style={styles.ctaButton}
            />
            <Button
              title="Acknowledge"
              onPress={onAcknowledgePress}
              style={styles.ctaButton}
            />
          </View>
        </View>
      </View>
    );
  }

  if (view.kind === 'amended') {
    return (
      <View style={styles.container}>
        <Text style={styles.sectionTitle}>{reviewTitle}</Text>
        <View style={[styles.card, styles.resolvedCard]}>
          <Text style={styles.resolvedIcon}>✏️</Text>
          <Text style={styles.resolvedText}>You amended this review · published</Text>
        </View>
      </View>
    );
  }

  if (view.kind === 'published') {
    return (
      <View style={styles.container}>
        <Text style={styles.sectionTitle}>{reviewTitle}</Text>
        <View style={[styles.card, styles.resolvedCard]}>
          <Text style={styles.resolvedIcon}>✅</Text>
          <Text style={styles.resolvedText}>Review published</Text>
        </View>
      </View>
    );
  }

  return null;
}

// ─── ResponderIdentityRow ────────────────────────────────────────────────────

function ResponderIdentityRow({
  name,
  photoUrl,
  responderKind,
}: {
  name: string;
  photoUrl: string | null;
  responderKind: 'shop' | 'partner';
}) {
  // PR-NEXT-BUNDLE-H §A — DO NOT REMOVE. photoLoadError must be declared
  // before any conditional returns (Rule 2 — hooks above early returns).
  const [photoLoadError, setPhotoLoadError] = useState(false);
  useEffect(() => { setPhotoLoadError(false); }, [photoUrl]);

  const avatar = formatPartnerAvatar(name, photoUrl);

  const badgeLabel = responderKind === 'partner' ? 'Delivery partner' : 'Shop';

  return (
    <View style={styles.responderRow}>
      <View style={styles.responderAvatar}>
        {avatar.kind === 'photo' && !photoLoadError ? (
          <Image
            source={{ uri: avatar.uri }}
            style={styles.responderAvatarImg}
            onError={() => setPhotoLoadError(true)}
          />
        ) : (
          <Text style={styles.responderAvatarText}>
            {avatar.kind === 'initials' ? avatar.text : initialsFor(name)}
          </Text>
        )}
      </View>
      <View style={styles.responderBody}>
        <Text style={styles.responderName} numberOfLines={1}>{name}</Text>
        <Text style={styles.responderBadge}>{badgeLabel}</Text>
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.md,
  },
  sectionTitle: {
    ...typography.bodyBold,
    color: colors.textSecondary,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
    textTransform: 'uppercase',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  card: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  // awaiting state
  awaitingIcon: {
    fontSize: 24,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  awaitingBody: { alignItems: 'center' },
  awaitingTitle: {
    ...typography.bodyBold,
    textAlign: 'center',
    marginBottom: 4,
  },
  awaitingSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  // responded state
  responseDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  responseText: {
    ...typography.body,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  ctaButton: {
    flex: 1,
  },
  // responder identity
  responderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  responderAvatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  responderAvatarImg: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  responderAvatarText: {
    ...typography.caption,
    fontWeight: '600' as const,
    color: colors.primaryDark,
  },
  responderBody: { flex: 1 },
  responderName: { ...typography.bodyBold },
  responderBadge: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  // resolved states (amended / published)
  resolvedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  resolvedIcon: { fontSize: 18 },
  resolvedText: {
    ...typography.bodyBold,
    color: colors.textSecondary,
  },
});
