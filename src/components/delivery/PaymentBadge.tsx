/**
 * PR-NEXT-BUNDLE-G §E — DO NOT REMOVE. Payment status badge for
 * delivery partner surfaces. Uses `derivePartnerPaymentBadge` to
 * compute the badge from order fields; renders null for 'none'.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { derivePartnerPaymentBadge } from '../../utils/derivePartnerPaymentBadge';
import type { PartnerPaymentBadge } from '../../utils/derivePartnerPaymentBadge';

type Props = {
  paymentMethod?: 'cod' | 'online' | null;
  paymentStatus?: 'paid' | 'unpaid' | 'not_required' | null;
  paidMethod?: 'cash' | 'online' | null;
};

const BADGE_BG: Record<PartnerPaymentBadge['kind'], string> = {
  paid_online: '#D1FAE5',
  paid_cash: '#FEF9C3',
  awaiting_cod: '#FEE2E2',
  none: 'transparent',
};

const BADGE_TEXT_COLOR: Record<PartnerPaymentBadge['kind'], string> = {
  paid_online: '#065F46',
  paid_cash: '#78350F',
  awaiting_cod: '#991B1B',
  none: 'transparent',
};

export default function PaymentBadge({ paymentMethod, paymentStatus, paidMethod }: Props) {
  const badge = derivePartnerPaymentBadge({ paymentMethod, paymentStatus, paidMethod });
  if (badge.kind === 'none') return null;
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: BADGE_BG[badge.kind] },
      ]}
      accessibilityRole="text"
    >
      <Text style={[styles.label, { color: BADGE_TEXT_COLOR[badge.kind] }]}>
        {badge.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  label: {
    ...typography.caption,
    fontWeight: '600',
  },
});
