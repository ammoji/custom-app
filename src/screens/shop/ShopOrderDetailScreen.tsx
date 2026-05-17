import { useNavigation, useRoute } from '@react-navigation/native';
import React from 'react';
import {
    Alert,
    Image,
    Linking,
    Platform,
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
import OrderStatusChip from '../../components/order/OrderStatusChip';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { useAuthStore } from '../../store/useAuthStore';
import { formatOrderTime, formatRupees } from '../../utils/format';
import {
    ACTION_LABELS,
    nextActionsFor,
    OrderStatus,
} from '../../utils/orderStateMachine';
import { useShopOrderDetail } from './ShopOrderDetailScreen.useShopOrderDetail';

/**
 * Per-order detail screen for shop owners. Mirrors the customer
 * OrderDetailScreen layout but adds:
 *   - tap-to-call on the customer's phone number (the most-used
 *     fulfilment action: "are you home?", "which floor?", "is the
 *     gate open?")
 *   - the same action buttons as the dashboard card so the owner
 *     can advance the order without going back
 *
 * Removes (vs. customer OrderDetailScreen):
 *   - Cancel order — that's a customer/admin action
 *   - Retry payment — customer-only flow
 *
 * Data + state machine live in
 * `./ShopOrderDetailScreen.useShopOrderDetail.ts`. The screen is a
 * thin presenter so the watcher contract + revert behaviour can be
 * unit-tested without RNTL.
 */

// Same allow-list as the dashboard. Kept in sync intentionally —
// extracting to a shared module would hide the cross-screen
// coupling we want reviewers to notice.
const SHOP_OWNER_ALLOWED_ACTIONS: OrderStatus[] = [
  'accepted',
  'preparing',
  'out_for_delivery',
];

export default function ShopOrderDetailScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const orderId: string = route.params.orderId;

  const isShopOwner = useAuthStore(s => s.isShopOwner);
  const ownedShopId = useAuthStore(s => s.shopId);

  const {
    order,
    loading,
    error,
    pendingStatus,
    handleAction,
    retry,
  } = useShopOrderDetail(orderId);

  // Role guard: if the caller isn't a shop owner at all, the
  // navigation entry point shouldn't have been visible — but in
  // case of a stale stack or a deep-link, fall through cleanly.
  //
  // We DO NOT cross-check `order.shopId !== ownedShopId` here.
  // The dashboard already filters by shopId server-side, and the
  // Firestore rules independently reject reads from non-owners.
  // An extra UI guard here was producing false negatives for real
  // orders whenever the auth claim's shopId drifted from the
  // order's shopId field (stale claim after a re-grant, token
  // refresh race, etc.) — Sudhir hit this on his own placed-then-
  // owned order. Trust the dashboard + rules; if the watcher
  // genuinely can't read, the error banner shows.
  if (!isShopOwner || !ownedShopId) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Order" onBack={() => nav.goBack()} />
        <EmptyState
          title="Shop owner access required"
          subtitle="Your account isn't registered as a shop owner."
        />
      </SafeAreaView>
    );
  }

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
            subtitle="It may have been cleared or moved."
          />
        )}
      </SafeAreaView>
    );
  }

  const minutesLeft = Math.max(
    0,
    Math.round((order.estimatedDeliveryAt - Date.now()) / 60_000),
  );
  const itemCount = order.items.reduce((n, i) => n + i.quantity, 0);
  const actions = nextActionsFor(order.status).filter(s =>
    SHOP_OWNER_ALLOWED_ACTIONS.includes(s),
  );

  const onActionPress = async (newStatus: OrderStatus) => {
    const result = await handleAction(newStatus);
    if (!result.ok) {
      Alert.alert('Update failed', result.error);
    }
  };

  const onCallCustomer = () => {
    const phone = order.deliveryAddress?.phone;
    if (!phone) return;
    const url = `tel:${phone}`;
    // Web has no useful tel: handler; only attempt on native to
    // avoid a "no app to handle this" toast on the web preview.
    if (Platform.OS === 'web') {
      Linking.openURL(url).catch(() => {
        /* ignore — desktop browsers without softphones do nothing */
      });
      return;
    }
    Linking.openURL(url).catch(err => {
      Alert.alert(
        'Could not place call',
        err?.message || 'Your device does not support phone calls.',
      );
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Order details" onBack={() => nav.goBack()} />
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
        {/* Status header */}
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <OrderStatusChip status={order.status} />
            <Text style={styles.orderId}>#{order.id}</Text>
          </View>
          <Text style={styles.placedAt}>
            Placed {formatOrderTime(order.createdAt)}
          </Text>
          {order.status !== 'delivered' &&
            order.status !== 'cancelled' &&
            minutesLeft > 0 && (
              <Text style={styles.eta}>ETA ~{minutesLeft} min</Text>
            )}
        </View>

        {/* Customer */}
        <Text style={styles.sectionTitle}>Customer</Text>
        <View style={styles.card}>
          <Text style={typography.bodyBold}>{order.deliveryAddress.name}</Text>
          <Pressable
            onPress={onCallCustomer}
            style={styles.callRow}
            accessibilityRole="button"
            accessibilityLabel={`Call customer at ${order.deliveryAddress.phone}`}
          >
            <Text style={styles.callText}>
              📞 {order.deliveryAddress.phone}
            </Text>
            <Text style={styles.callHint}>Tap to call</Text>
          </Pressable>
        </View>

        {/* Delivery address */}
        <Text style={styles.sectionTitle}>Delivery address</Text>
        <View style={styles.card}>
          <Text style={styles.addressLine}>{order.deliveryAddress.line1}</Text>
          {!!order.deliveryAddress.line2 && (
            <Text style={styles.addressLine}>
              {order.deliveryAddress.line2}
            </Text>
          )}
          <Text style={styles.addressLine}>
            {order.deliveryAddress.city} - {order.deliveryAddress.pincode}
          </Text>
        </View>

        {/* Items — the section that motivated this PR */}
        <Text style={styles.sectionTitle}>
          Items ({itemCount})
        </Text>
        <View style={styles.card}>
          {order.items.map((it, idx) => (
            <View
              key={it.productId}
              style={[styles.itemRow, idx !== 0 && styles.itemDivider]}
            >
              {!!it.imageUrl && (
                <Image source={{ uri: it.imageUrl }} style={styles.itemImage} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={typography.body} numberOfLines={2}>
                  {it.name}
                </Text>
                {!!it.packLabel && (
                  <Text style={styles.itemMeta}>
                    {it.packLabel} · × {it.quantity}
                  </Text>
                )}
                {!it.packLabel && (
                  <Text style={styles.itemMeta}>× {it.quantity}</Text>
                )}
              </View>
              <Text style={typography.bodyBold}>
                {formatRupees(it.price * it.quantity)}
              </Text>
            </View>
          ))}
        </View>

        {/* Bill summary */}
        <Text style={styles.sectionTitle}>Bill</Text>
        <View style={styles.card}>
          <Row label="Subtotal" value={formatRupees(order.subtotal)} />
          <Row label="Delivery fee" value={formatRupees(order.deliveryFee)} />
          <View style={styles.divider} />
          <Row label="Total" value={formatRupees(order.total)} bold />
        </View>

        {/* Payment */}
        <Text style={styles.sectionTitle}>Payment</Text>
        <View style={styles.card}>
          <Row
            label="Method"
            value={
              order.paymentMethod === 'online'
                ? 'Online (Razorpay)'
                : 'Cash on Delivery'
            }
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
                  : order.paymentStatus === 'failed' ||
                      order.paymentStatus === 'expired'
                    ? colors.danger
                    : colors.textSecondary
              }
            />
          )}
        </View>

        {/* Action buttons */}
        {actions.length > 0 && (
          <View style={styles.actionsRow}>
            {actions.map(next => {
              const isLoading = pendingStatus === next;
              const anyPending = !!pendingStatus;
              return (
                <View key={next} style={styles.actionBtn}>
                  <Button
                    title={ACTION_LABELS[next]}
                    onPress={() => onActionPress(next)}
                    loading={isLoading}
                    disabled={anyPending && !isLoading}
                    fullWidth
                  />
                </View>
              );
            })}
          </View>
        )}
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
      <Text
        style={
          bold
            ? typography.bodyBold
            : [typography.body, { color: colors.textSecondary }]
        }
      >
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
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  statusCard: {
    backgroundColor: colors.primaryLight,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  orderId: { ...typography.caption, color: colors.textSecondary },
  placedAt: { ...typography.caption, marginTop: spacing.sm },
  eta: {
    ...typography.bodyBold,
    color: colors.primaryDark,
    marginTop: spacing.xs,
  },
  sectionTitle: { ...typography.h3, marginTop: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  callRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  callText: { ...typography.bodyBold, color: colors.primary },
  callHint: { ...typography.caption, color: colors.textSecondary },
  addressLine: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  itemDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  itemImage: {
    width: 48,
    height: 48,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
  },
  itemMeta: { ...typography.caption, marginTop: 2 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionBtn: { flexGrow: 1, minWidth: 140 },
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
