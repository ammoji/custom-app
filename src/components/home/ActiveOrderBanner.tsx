/**
 * PR-NEXT-BUNDLE-F §B — compact active-order banner.
 *
 * Replaces the old big "Active orders" card. 60px tall, light-green
 * fill, circle icon + two-line text + chevron. Self-hides when there
 * are no active orders. Single order → tap opens OrderDetail; multiple
 * → tap opens the Orders list.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { brandGreen, radii, spacing } from '../../constants/theme';
import type { Order } from '../../types';
import { statusToLabel } from '../../utils/homeRedesignHelpers';

type Props = {
  orders: Order[];
  nowMs: number;
  onPressSingle: (orderId: string) => void;
  onPressMultiple: () => void;
};

// Customer-friendly ETA line from the order's estimatedDeliveryAt.
function computeEtaText(order: Order, nowMs: number): string {
  const eta = order.estimatedDeliveryAt;
  if (typeof eta !== 'number' || eta <= 0) return 'Arriving soon';
  const mins = Math.round((eta - nowMs) / 60_000);
  if (mins <= 0) return 'Arriving any moment';
  if (mins === 1) return 'Arriving in 1 min';
  return `Arriving in ${mins} min`;
}

export default function ActiveOrderBanner({
  orders,
  nowMs,
  onPressSingle,
  onPressMultiple,
}: Props) {
  if (orders.length === 0) return null;

  const single = orders.length === 1;
  const order = orders[0];
  const title = single ? statusToLabel(order.status) : `${orders.length} orders on the way`;
  const subtitle = single ? computeEtaText(order, nowMs) : 'Tap to view all';

  return (
    <Pressable
      style={styles.banner}
      onPress={() => (single ? onPressSingle(order.id) : onPressMultiple())}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
    >
      <View style={styles.iconCircle}>
        <Text style={styles.iconText}>📦</Text>
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    height: 60,
    backgroundColor: brandGreen.fillLight,
    borderRadius: radii.md,
    marginHorizontal: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: brandGreen.fillMedium,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  iconText: { fontSize: 16 },
  textWrap: { flex: 1 },
  title: { fontSize: 13, fontWeight: '500', color: brandGreen.textDark },
  subtitle: { fontSize: 12, fontWeight: '400', color: brandGreen.textMedium },
  chevron: { fontSize: 18, color: brandGreen.textDark, marginLeft: spacing.sm },
});
