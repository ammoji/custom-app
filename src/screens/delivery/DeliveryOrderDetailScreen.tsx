import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import Loader from '../../components/common/Loader';
import ScreenHeader from '../../components/common/ScreenHeader';
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
import type { Order } from '../../types';
import { formatOrderTime, formatRupees } from '../../utils/format';

/**
 * Full delivery view of a single order. Reuses watchOrder for live
 * status changes (poll on native, snapshot on web). Two action paths
 * mirror the dashboard cards: I've picked it up → Delivered.
 *
 * Navigation:
 *   - Tap shop address → Google Maps directions to shop (we don't
 *     have shop.address structured here so we use the order's shop
 *     name as the search query — good enough for MVP).
 *   - Tap customer phone → tel: link.
 *   - Tap customer address → Google Maps directions to address.
 *
 * No in-app map (per Phase 12b "Do NOT" list — saves time, works
 * everywhere, respects user's preferred maps app).
 */
export default function DeliveryOrderDetailScreen() {
  const nav = useNavigation<any>();
  const route =
    useRoute<RouteProp<RootStackParamList, 'DeliveryOrderDetail'>>();
  const { orderId } = route.params;
  const uid = useAuthStore(s => s.uid);
  const isDelivery = useAuthStore(s => s.isDelivery);

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!isDelivery) {
      setLoading(false);
      return;
    }
    const off = orderService.watchOrder(orderId, o => {
      setOrder(o);
      setLoading(false);
    });
    return off;
  }, [orderId, isDelivery]);

  const openMaps = (query: string) => {
    const url = `https://maps.google.com/?q=${encodeURIComponent(query)}`;
    Linking.openURL(url).catch(() =>
      Alert.alert('Could not open Maps', 'Please copy the address manually.'),
    );
  };

  const callPhone = (phone: string) => {
    const url = `tel:${phone}`;
    Linking.openURL(url).catch(() =>
      Alert.alert('Could not place call', `Number: ${phone}`),
    );
  };

  const handlePickedUp = async () => {
    if (!order) return;
    setPending(true);
    setOrder({ ...order, pickedUpAt: Date.now() });
    try {
      await orderService.markPickedUp({ orderId: order.id });
    } catch (e: any) {
      setOrder(prev => (prev ? { ...prev, pickedUpAt: null } : prev));
      Alert.alert('Update failed', e?.message || 'Please try again.');
    } finally {
      setPending(false);
    }
  };

  const handleDelivered = async () => {
    if (!order) return;
    setPending(true);
    const prevStatus = order.status;
    const prevDelivered = order.deliveredAt;
    setOrder({ ...order, status: 'delivered', deliveredAt: Date.now() });
    try {
      await orderService.markDelivered({ orderId: order.id });
    } catch (e: any) {
      setOrder(prev =>
        prev
          ? { ...prev, status: prevStatus, deliveredAt: prevDelivered ?? null }
          : prev,
      );
      Alert.alert('Update failed', e?.message || 'Please try again.');
    } finally {
      setPending(false);
    }
  };

  if (!isDelivery) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Delivery" onBack={() => nav.goBack()} />
        <EmptyState
          title="Delivery role required"
          subtitle="Register as a delivery partner first."
        />
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Delivery" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Delivery" onBack={() => nav.goBack()} />
        <EmptyState
          title="Order not found"
          subtitle="It may have been cancelled or completed."
        />
      </SafeAreaView>
    );
  }

  // Defensive: if this user isn't the assigned delivery person, show a
  // read-only-ish view. The Cloud Function would reject any action
  // anyway, but hiding the buttons is a clearer UX than letting them
  // tap and fail.
  const isAssigned = order.deliveryPersonId === uid;
  const pickedUp = !!order.pickedUpAt;
  const delivered = order.status === 'delivered';
  const itemCount = order.items.reduce((n, i) => n + i.quantity, 0);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Delivery" onBack={() => nav.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.label}>Pickup from</Text>
          <Text style={styles.value}>{order.shopName}</Text>
          <Pressable onPress={() => openMaps(order.shopName)}>
            <Text style={styles.link}>📍 Directions to shop</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Deliver to</Text>
          <Text style={styles.value}>{order.deliveryAddress.name}</Text>
          <Pressable onPress={() => callPhone(order.deliveryAddress.phone)}>
            <Text style={styles.link}>📞 {order.deliveryAddress.phone}</Text>
          </Pressable>
          <Text style={styles.address}>
            {order.deliveryAddress.line1}
            {order.deliveryAddress.line2
              ? `, ${order.deliveryAddress.line2}`
              : ''}
            {'\n'}
            {order.deliveryAddress.city} {order.deliveryAddress.pincode}
          </Text>
          <Pressable
            onPress={() =>
              openMaps(
                [
                  order.deliveryAddress.line1,
                  order.deliveryAddress.line2,
                  order.deliveryAddress.city,
                  order.deliveryAddress.pincode,
                ]
                  .filter(Boolean)
                  .join(', '),
              )
            }
          >
            <Text style={styles.link}>📍 Directions to customer</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Items ({itemCount})</Text>
          {order.items.map(it => (
            <View key={it.productId} style={styles.itemRow}>
              <Text style={styles.itemName} numberOfLines={2}>
                {it.name}
              </Text>
              <Text style={styles.itemQty}>×{it.quantity}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatRupees(order.total)}</Text>
          </View>
          <Text style={styles.payHint}>
            {order.paymentMethod === 'online'
              ? 'Already paid online — no collection.'
              : `Collect ${formatRupees(order.total)} cash on delivery.`}
          </Text>
        </View>

        {Array.isArray(order.statusHistory) && order.statusHistory.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.label}>Timeline</Text>
            {order.statusHistory.map((h: any, idx: number) => (
              <View key={`${h.status}-${h.at}-${idx}`} style={styles.timelineRow}>
                <Text style={styles.timelineStatus}>{h.status}</Text>
                <Text style={styles.timelineTime}>{formatOrderTime(h.at)}</Text>
              </View>
            ))}
          </View>
        )}

        {isAssigned && !delivered && (
          <View style={{ marginTop: spacing.md }}>
            {pickedUp ? (
              <Button
                title="Delivered"
                onPress={handleDelivered}
                loading={pending}
                disabled={pending}
                size="lg"
              />
            ) : (
              <Button
                title="I've picked it up"
                onPress={handlePickedUp}
                loading={pending}
                disabled={pending}
                size="lg"
              />
            )}
          </View>
        )}

        {delivered && (
          <View style={[styles.card, styles.doneCard]}>
            <Text style={styles.doneText}>✅ Delivered</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.md,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  value: { ...typography.h3 },
  link: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  address: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    gap: spacing.md,
  },
  itemName: { ...typography.body, flex: 1 },
  itemQty: { ...typography.bodyBold },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalLabel: { ...typography.bodyBold },
  totalValue: { ...typography.h3 },
  payHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
  timelineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  timelineStatus: { ...typography.body, textTransform: 'capitalize' },
  timelineTime: { ...typography.caption, color: colors.textSecondary },
  doneCard: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  doneText: {
    ...typography.h2,
    color: colors.primaryDark,
    textAlign: 'center',
  },
});
