import React from 'react';
import { View, Image, Text, Pressable, StyleSheet } from 'react-native';
import { Shop } from '../../types';
import { colors, spacing, radii, typography, shadow } from '../../constants/theme';
import { formatDistance, formatRupees } from '../../utils/format';
import Badge from '../common/Badge';
import ShopRatingBadge from './ShopRatingBadge';

type Props = {
  shop: Shop;
  onPress: () => void;
};

export default function ShopCard({ shop, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
    >
      <Image source={{ uri: shop.imageUrl }} style={styles.image} />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>{shop.name}</Text>
          <Badge
            label={shop.isOpen ? 'OPEN' : 'CLOSED'}
            tone={shop.isOpen ? 'success' : 'danger'}
          />
        </View>
        <Text style={styles.address} numberOfLines={1}>{shop.address}</Text>
        <View style={styles.metaRow}>
          {/* PR 20 — replaces the legacy "★ {shop.rating}" placeholder
              with the live rolling-avg badge. ShopRatingBadge handles
              the "New shop" fallback when ratingCount is 0/missing. */}
          <ShopRatingBadge
            ratingAvg={shop.ratingAvg}
            ratingCount={shop.ratingCount}
            size="sm"
          />
          <Text style={styles.dot}>·</Text>
          <Text style={styles.meta}>{formatDistance(shop.distanceKm)}</Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.meta}>{shop.etaMinutes} min</Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.meta}>{formatRupees(shop.deliveryFee)} delivery</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  image: { width: '100%', height: 140, backgroundColor: colors.surface },
  body: { padding: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  name: { ...typography.h3, flex: 1 },
  address: { ...typography.caption, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, flexWrap: 'wrap' },
  meta: { ...typography.caption, color: colors.textSecondary },
  dot: { ...typography.caption, color: colors.textMuted, marginHorizontal: spacing.xs },
});
