import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import React from 'react';
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
import { useAuthStore } from '../../store/useAuthStore';
import { formatOrderTime, formatRupees } from '../../utils/format';
import { useDeliveryOrderDetail } from './DeliveryOrderDetailScreen.useDeliveryOrderDetail';

/**
 * Full delivery view of a single order. Reuses watchOrder for live
 * status changes (poll on native, snapshot on web). Three action
 * paths:
 *
 *   1. Available-for-claim   → "Accept this pickup" button (the
 *                              v2-iv-followup addition — without it
 *                              partners had to claim from the
 *                              dashboard with no item visibility).
 *   2. Assigned, not delivered → "I've picked it up" → "Delivered"
 *      (existing — same flow as the dashboard's ActiveDeliveryCard).
 *   3. Delivered             → green "Delivered" card, no actions.
 *
 * State machine + derived flags live in
 * `./DeliveryOrderDetailScreen.useDeliveryOrderDetail.ts`. Screen
 * stays a thin presenter so the watcher contract + claim race +
 * action revert can be unit-tested without RNTL.
 */
export default function DeliveryOrderDetailScreen() {
  const nav = useNavigation<any>();
  const route =
    useRoute<RouteProp<RootStackParamList, 'DeliveryOrderDetail'>>();
  const { orderId } = route.params;
  const uid = useAuthStore(s => s.uid);
  const isDelivery = useAuthStore(s => s.isDelivery);

  const {
    order,
    loading,
    error,
    isAssigned,
    isAvailableForClaim,
    isPickedUp,
    isDelivered,
    isTerminalForOthers,
    pendingAction,
    handleClaim,
    handlePickedUp,
    handleDelivered,
    retry,
  } = useDeliveryOrderDetail(orderId, uid, !!isDelivery);

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

  const onClaim = async () => {
    const result = await handleClaim();
    if (!result.ok) {
      Alert.alert('Already taken', result.error);
      return;
    }
    // Navigate back to the dashboard so the new card appears in
    // "My Active Deliveries" via the post-claim listMyDeliveries
    // refresh path. (Dashboard owns that refresh; the detail
    // screen's watcher would also update, but going back is the
    // expected UX after a successful claim.)
    nav.goBack();
  };

  const onPickedUp = async () => {
    const result = await handlePickedUp();
    if (!result.ok) Alert.alert('Update failed', result.error);
  };

  const onDelivered = async () => {
    const result = await handleDelivered();
    if (!result.ok) Alert.alert('Update failed', result.error);
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

  if (loading && !order) {
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
        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              onPress={retry}
              style={styles.retryBtn}
              accessibilityRole="button"
              accessibilityLabel="Retry loading order"
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <EmptyState
            title="Order not found"
            subtitle="It may have been cancelled or completed."
          />
        )}
      </SafeAreaView>
    );
  }

  // Terminal state for non-owners: claimed by someone else, OR
  // already delivered. Render an EmptyState instead of leaving
  // dead buttons that would error server-side anyway.
  if (isTerminalForOthers && isDelivered) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Pickup details" onBack={() => nav.goBack()} />
        <EmptyState
          title="Order already delivered"
          subtitle="This pickup is no longer available."
        />
      </SafeAreaView>
    );
  }
  if (isTerminalForOthers && !isDelivered) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Pickup details" onBack={() => nav.goBack()} />
        <EmptyState
          title="Already taken"
          subtitle="Another partner claimed this pickup. Check the dashboard for new ones."
        />
      </SafeAreaView>
    );
  }

  const itemCount = order.items.reduce((n, i) => n + i.quantity, 0);
  const headerTitle = isAvailableForClaim ? 'Pickup details' : 'Delivery';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={headerTitle} onBack={() => nav.goBack()} />
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            onPress={retry}
            style={styles.retryBtn}
            accessibilityRole="button"
            accessibilityLabel="Retry loading order"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
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
          {/* Phone is hidden until the partner has actually claimed
              the order — protects customer privacy from any
              delivery person merely browsing available pickups.
              Address line 1 + city + pincode are still shown so the
              partner can decide whether the area is in their range. */}
          {isAssigned && (
            <Pressable onPress={() => callPhone(order.deliveryAddress.phone)}>
              <Text style={styles.link}>📞 {order.deliveryAddress.phone}</Text>
            </Pressable>
          )}
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

        {isAvailableForClaim && (
          <View style={{ marginTop: spacing.md }}>
            <Button
              title={
                pendingAction === 'claim' ? 'Claiming…' : 'Accept this pickup'
              }
              onPress={onClaim}
              loading={pendingAction === 'claim'}
              disabled={pendingAction !== null}
              size="lg"
            />
          </View>
        )}

        {isAssigned && !isDelivered && (
          <View style={{ marginTop: spacing.md }}>
            {isPickedUp ? (
              <Button
                title="Delivered"
                onPress={onDelivered}
                loading={pendingAction === 'delivered'}
                disabled={pendingAction !== null}
                size="lg"
              />
            ) : (
              <Button
                title="I've picked it up"
                onPress={onPickedUp}
                loading={pendingAction === 'pickedUp'}
                disabled={pendingAction !== null}
                size="lg"
              />
            )}
          </View>
        )}

        {isAssigned && isDelivered && (
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
  errorBanner: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: '#FEF2F2',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorText: {
    ...typography.body,
    color: colors.danger,
    flex: 1,
    marginRight: spacing.md,
  },
  retryBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.danger,
    borderRadius: radii.sm,
  },
  retryText: { ...typography.bodyBold, color: '#fff' },
});
