import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../components/common/Button';
import EmptyState from '../components/common/EmptyState';
import Loader from '../components/common/Loader';
import ScreenHeader from '../components/common/ScreenHeader';
import OrderStatusChip from '../components/order/OrderStatusChip';
import { colors, radii, spacing, typography } from '../constants/theme';
import { Analytics } from '../services/analytics';
import { orderService } from '../services/orderService';
import { Sentry } from '../services/sentry';
import type { Order } from '../types';
import { formatOrderTime, formatRupees } from '../utils/format';
import { openRazorpayCheckout } from '../utils/razorpay';

const showAlert = (title: string, message: string) => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // eslint-disable-next-line no-alert
    window.alert(`${title}\n\n${message}`);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Alert } = require('react-native');
    Alert.alert(title, message);
  }
};

const confirmAlert = (
  title: string,
  message: string,
  onConfirm: () => void,
  confirmLabel = 'Confirm',
) => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // eslint-disable-next-line no-alert
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Alert } = require('react-native');
    Alert.alert(title, message, [
      { text: 'Keep order', style: 'cancel' },
      { text: confirmLabel, style: 'destructive', onPress: onConfirm },
    ]);
  }
};

export default function OrderDetailScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const orderId: string = route.params.orderId;
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let firstLoad = true;
    const unsub = orderService.watchOrder(orderId, (o, err) => {
      if (err) {
        setError(err.message || 'Could not load order. Pull back later.');
        // Keep `order` as-is so any previously-displayed data stays
        // on screen; just show the error banner above it.
      } else {
        setError(null);
        setOrder(o);
        if (firstLoad && o) {
          firstLoad = false;
          Analytics.view_order({ order_id: o.id, status: o.status });
        }
      }
      // ALWAYS — see watcher contract refactor.
      setLoading(false);
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
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
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

        {/* Stuck-payment recovery: if the customer dismissed Razorpay
            without paying, the order sits in paymentStatus='pending'
            until the 24h cleanup. Surface Pay Now / Cancel here so they
            can act immediately. Only shown while the shop hasn't
            accepted yet — once status moves past 'pending', the order
            belongs to the shop and admin handles cancellation. */}
        {order.paymentMethod === 'online' &&
          order.paymentStatus === 'pending' &&
          order.status === 'pending' && (
            <View style={styles.recoveryCard}>
              <Text style={styles.recoveryTitle}>Payment incomplete</Text>
              <Text style={styles.recoverySubtitle}>
                Your order is on hold. Complete payment to confirm it, or
                cancel if you've changed your mind.
              </Text>
              <View style={{ height: spacing.md }} />
              <Button
                title={
                  paying
                    ? 'Opening payment…'
                    : `Pay ${formatRupees(order.total)} now`
                }
                onPress={handleRetryPayment}
                loading={paying}
                disabled={paying || cancelling}
                fullWidth
              />
              <View style={{ height: spacing.sm }} />
              <Button
                title="Cancel order"
                onPress={handleCancel}
                variant="secondary"
                loading={cancelling}
                disabled={paying || cancelling}
                fullWidth
              />
            </View>
          )}
      </ScrollView>
    </SafeAreaView>
  );

  function handleRetryPayment() {
    if (!order) return;
    setPaying(true);
    (async () => {
      try {
        const session = await orderService.retryPayment(order.id);
        await openRazorpayCheckout({
          key: session.razorpayKeyId,
          order_id: session.razorpayOrderId,
          amount: Math.round(session.total * 100),
          currency: 'INR',
          name: 'grocery-mvp',
          description: `Order ${order.id}`,
          prefill: {
            name: order.deliveryAddress.name,
            contact: order.deliveryAddress.phone,
          },
          theme: { color: colors.primary },
          handler: () => {
            // Webhook will flip paymentStatus to 'paid'; watchOrder
            // picks it up within 5s on native or instantly on web.
            Analytics.payment_success({
              order_id: order.id,
              value: session.total,
            });
            setPaying(false);
          },
          modal: {
            ondismiss: () => {
              setPaying(false);
              showAlert(
                'Payment cancelled',
                'Your order is still pending. You can retry any time before it expires.',
              );
            },
          },
          onError: (err: any) => {
            setPaying(false);
            const reason: string =
              err?.error?.description ?? err?.description ?? 'unknown';
            Analytics.payment_failed({ order_id: order.id, reason });
            Sentry.captureMessage(
              `Payment retry failed for order ${order.id}: ${reason}`,
              'warning',
            );
            showAlert(
              'Payment failed',
              reason === 'unknown' ? 'Please try again.' : reason,
            );
          },
        });
      } catch (err: any) {
        setPaying(false);
        showAlert(
          'Could not retry payment',
          err?.message ?? 'Try again in a moment.',
        );
      }
    })();
  }

  function handleCancel() {
    if (!order) return;
    confirmAlert(
      'Cancel this order?',
      'This will release the order. You can place a new one anytime.',
      async () => {
        setCancelling(true);
        try {
          await orderService.cancelMyPendingOrder(order.id);
          // watchOrder snapshot/poll will reflect status='cancelled'.
        } catch (err: any) {
          showAlert(
            'Could not cancel',
            err?.message ?? 'Please try again.',
          );
        } finally {
          setCancelling(false);
        }
      },
      'Cancel order',
    );
  }
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
  recoveryCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  recoveryTitle: { ...typography.h3, color: colors.danger },
  recoverySubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  errorBanner: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: '#FEF2F2',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  errorText: { ...typography.body, color: colors.danger },
});
