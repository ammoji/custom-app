/**
 * PR-NEXT-BUNDLE-F §C — recent shops horizontal strip.
 *
 * Replaces the old big "Order again" card. Compact 90px mini cards in
 * a horizontal scroll; tap opens the shop. Self-hides when empty.
 * Sourced from the same `frequentShops` (FrequentShopEntry[]) the
 * HomeScreen already computes via pickFrequentlyOrderedShops.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../../constants/theme';
import type { FrequentShopEntry } from '../../utils/pickFrequentlyOrderedShops';

type Props = {
  shops: FrequentShopEntry[];
  onPress: (shopId: string) => void;
};

export default function RecentShopsStrip({ shops, onPress }: Props) {
  if (shops.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.strip}
      contentContainerStyle={styles.content}
    >
      {shops.slice(0, 6).map(shop => (
        <Pressable
          key={shop.shopId}
          style={styles.miniCard}
          onPress={() => onPress(shop.shopId)}
          accessibilityRole="button"
          accessibilityLabel={`Reorder from ${shop.shopName}`}
        >
          <View style={styles.iconSlot}>
            <Text style={styles.iconText}>🏪</Text>
          </View>
          <Text style={styles.miniName} numberOfLines={1}>
            {shop.shopName}
          </Text>
          <Text style={styles.miniMeta} numberOfLines={1}>
            {shop.lastOrderItemCount > 0
              ? `${shop.lastOrderItemCount} item${shop.lastOrderItemCount === 1 ? '' : 's'}`
              : 'Order again'}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { marginTop: spacing.xs },
  content: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  miniCard: {
    width: 90,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  iconSlot: {
    height: 40,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  iconText: { fontSize: 18 },
  miniName: { fontSize: 11, fontWeight: '500', color: colors.textPrimary },
  miniMeta: { fontSize: 10, fontWeight: '400', color: colors.textSecondary, marginTop: 2 },
});
