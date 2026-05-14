import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import EmptyState from '../components/common/EmptyState';
import Loader from '../components/common/Loader';
import ScreenHeader from '../components/common/ScreenHeader';
import OrderStatusChip from '../components/order/OrderStatusChip';
import { colors, radii, spacing, typography } from '../constants/theme';
import { Analytics } from '../services/analytics';
import { orderService } from '../services/orderService';
import type { Order } from '../types';
import { formatOrderTime, formatRupees } from '../utils/format';

export default function OrderDetailScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const orderId: string = route.params.orderId;
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let firstLoad = true;
    const unsub = orderService.watchOrder(orderId, o => {
      setOrder(o);
      setLoading(false);
      if (firstLoad && o) {
        firstLoad = false;
        Analytics.view_order({ order_id: o.id, status: o.status });
      }
    });
    return unsub;
  }, [orderId]);

  if (loading && !order) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Order" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Order" onBack={() => nav.goBack()} />
        <EmptyState
          title="Order not found"
          subtitle="It may have been cleared. Check Orders."
          ctaLabel="My Orders"
          onCtaPress={() => nav.navigate('Orders')}
        />
      </SafeAreaView>
    );
  }

  const minutesLeft = Math.max(0, Math.round((order.estimatedDeliveryAt - Date.now()) / 60_000));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Order details" onBack={() => nav.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Status header */}
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <OrderStatusChip status={order.status} />
            <Text style={styles.orderId}>{order.id}</Text>
          </View>
          <Text style={styles.placedAt}>Placed {formatOrderTime(order.createdAt)}</Text>
          {order.status !== 'delivered' && order.status !== 'cancelled' && (
            <Text style={styles.eta}>Arriving in ~{minutesLeft} min</Text>
          )}
        </View>

        {/* Delivery address */}
        <Text style={styles.sectionTitle}>Delivery address</Text>
        <View style={styles.card}>
          <Text style={typography.bodyBold}>{order.deliveryAddress.name}</Text>
          <Text style={styles.addressLine}>{order.deliveryAddress.line1}</Text>
          {!!order.deliveryAddress.line2 && (
            <Text style={styles.addressLine}>{order.deliveryAddress.line2}</Text>
          )}
          <Text style={styles.addressLine}>
            {order.deliveryAddress.city} - {order.deliveryAddress.pincode}
          </Text>
          <Text style={styles.addressLine}>📞 {order.deliveryAddress.phone}</Text>
        </View>

        {/* Items */}
        <Text style={styles.sectionTitle}>{order.shopName}</Text>
        <View style={styles.card}>
          {order.items.map((it, idx) => (
            <View
              key={it.productId}
              style={[styles.itemRow, idx !== 0 && styles.itemDivider]}
            >
              <Image source={{ uri: it.imageUrl }} style={styles.itemImage} />
              <View style={{ flex: 1 }}>
                <Text style={typography.body} numberOfLines={2}>{it.name}</Text>
                <Text style={styles.itemMeta}>
                  {it.packLabel} · Qty {it.quantity}
                </Text>
              </View>
              <Text style={typography.bodyBold}>
                {formatRupees(it.price * it.quantity)}
              </Text>
            </View>
          ))}
        </View>

        {/* Bill summary */}
        <Text style={styles.sectionTitle}>Bill details</Text>
        <View style={styles.card}>
          <Row label="Item total" value={formatRupees(order.subtotal)} />
          <Row label="Delivery fee" value={formatRupees(order.deliveryFee)} />
          <View style={styles.divider} />
          <Row label="Total" value={formatRupees(order.total)} bold />
        </View>

        {/* Payment */}
        <Text style={styles.sectionTitle}>Payment</Text>
        <View style={styles.card}>
          <Row
            label="Method"
            value={order.paymentMethod === 'online' ? 'Online (Razorpay)' : 'Cash on Delivery'}
          />
          {order.paymentMethod === 'online' && (
            <Row
              label="Status"
              value={
                order.paymentStatus === 'paid'
                  ? 'Paid ✓'
                  : order.paymentStatus === 'failed'
                    ? 'Failed'
                    : order.paymentStatus === 'expired'
                      ? 'Expired'
                      : 'Processing…'
              }
              valueColor={
                order.paymentStatus === 'paid'
                  ? colors.success
                  : order.paymentStatus === 'failed' || order.paymentStatus === 'expired'
                    ? colors.danger
                    : colors.textSecondary
              }
            />
          )}
          {order.paymentMethod === 'online' && order.paymentStatus === 'failed' && (
            <Text style={styles.paymentNote}>
              Payment didn't complete. Contact support to retry.
            </Text>
          )}
          {order.paymentMethod === 'online' && order.paymentStatus === 'expired' && (
            <Text style={styles.paymentNote}>
              Payment session expired and the order was auto-cancelled.
              Place a new order to try again.
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  bold,
  valueColor,
}: {
  label: string;
  value: string;
  bold?: boolean;
  valueColor?: string;
}) {
  return (
    <View style={styles.row}>
      <Text style={bold ? typography.bodyBold : [typography.body, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <Text
        style={[
          bold ? typography.bodyBold : typography.body,
          valueColor ? { color: valueColor } : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  statusCard: {
    backgroundColor: colors.primaryLight,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  orderId: { ...typography.caption, color: colors.textSecondary },
  placedAt: { ...typography.caption, marginTop: spacing.sm },
  eta: { ...typography.bodyBold, color: colors.primaryDark, marginTop: spacing.xs },
  sectionTitle: { ...typography.h3, marginTop: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  addressLine: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  itemDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  itemImage: { width: 48, height: 48, borderRadius: radii.sm, backgroundColor: colors.bg },
  itemMeta: { ...typography.caption, marginTop: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  paymentNote: { ...typography.caption, color: colors.danger, marginTop: spacing.sm },
});
