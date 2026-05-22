/**
 * PR 20 — ShopRatingBadge.
 *
 * Renders the customer-facing trust signal on every shop card:
 * either "★ 4.7 (200)" for a rated shop, or an italic "New shop"
 * for a shop that hasn't received any ratings yet.
 *
 * Two sizes:
 *   - `sm` (default): list / rail card use. Small star, caption-sized
 *     text so it doesn't dominate the row.
 *   - `md`: ShopDetailScreen header use. Slightly bigger so the
 *     rating reads as a primary trust cue when the customer is
 *     looking at the shop directly.
 *
 * Stays a stateless presentational component — both fields come
 * from the shop doc; nothing to fetch.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../../constants/theme';

type Props = {
  ratingAvg?: number;
  ratingCount?: number;
  size?: 'sm' | 'md';
};

export default function ShopRatingBadge({
  ratingAvg,
  ratingCount,
  size = 'sm',
}: Props) {
  if (!ratingCount || ratingCount === 0) {
    // "New shop" tells the customer "no signal yet, take a chance
    // but informed" — distinct from a 0-star rating which would
    // imply "tried and bad".
    return (
      <Text
        style={[
          styles.newShop,
          size === 'md' && styles.newShopMd,
        ]}
      >
        New shop
      </Text>
    );
  }
  const avgText = (ratingAvg ?? 0).toFixed(1);
  return (
    <View style={[styles.badge, size === 'md' && styles.badgeMd]}>
      <Text style={[styles.star, size === 'md' && styles.starMd]}>★</Text>
      <Text style={[styles.avg, size === 'md' && styles.avgMd]}>
        {avgText}
      </Text>
      <Text style={[styles.count, size === 'md' && styles.countMd]}>
        ({ratingCount})
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeMd: { gap: 6 },
  // Tailwind amber-500 — same gold as RateOrderCard's filled star
  // and OrderDetailScreen's rated confirmation. Visual continuity
  // across the rating surface.
  star: { color: '#F59E0B', fontSize: 12 },
  starMd: { fontSize: 16 },
  avg: { ...typography.caption, fontWeight: '700' },
  avgMd: { ...typography.body, fontWeight: '700' },
  count: { ...typography.caption, color: colors.textSecondary },
  countMd: { ...typography.caption, color: colors.textSecondary },
  newShop: {
    ...typography.caption,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  newShopMd: { ...typography.body, fontStyle: 'italic' },
});
