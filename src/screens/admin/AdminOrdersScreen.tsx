import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import Loader from '../../components/common/Loader';
import ScreenHeader from '../../components/common/ScreenHeader';
// PR 2 — payment hardening (Phase B): Cancel & Refund modal +
// payment-status banner for the new statuses (amount_mismatch,
// authorized, refund_pending, refunded, refund_failed). Imports
// kept verbose because the auto-formatter strips these on save and
// the resulting JSX-vs-import drift takes a tsc run to surface.
import CancelAndRefundModal from '../../components/order/CancelAndRefundModal';
import OrderStatusChip from '../../components/order/OrderStatusChip';
import PaymentStatusBanner from '../../components/order/PaymentStatusBanner';
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
import { useOnlineDeliveryCount } from '../../hooks/useOnlineDeliveryCount';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
import type { Order } from '../../types';
import { computeAdminOrderStats } from '../../utils/adminStats';
import { formatOrderTime, formatRupees } from '../../utils/format';
import {
    ACTION_LABELS,
    nextActionsFor,
    OrderStatus,
} from '../../utils/orderStateMachine';

export default function AdminOrdersScreen() {
  const nav = useNavigation<any>();
  const isAdmin = useAuthStore(s => s.isAdmin);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, OrderStatus | null>>({});
  const [retryNonce, setRetryNonce] = useState(0);
  // PR 2 — payment hardening (Phase B). Refund modal target. We track
  // the entire order rather than just the id so the modal can show
  // the amount in its title without an extra lookup.
  const [refundTarget, setRefundTarget] = useState<Order | null>(null);
  // Phase 12c: stats card. Orders-derived stats refresh whenever the
  // 10s watcher ticks; the partner count polls on its own 15s rhythm.
  const { count: onlinePartners } = useOnlineDeliveryCount(isAdmin);
  const stats = useMemo(
    () => computeAdminOrderStats(orders, Date.now()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders],
  );

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    const unsubscribe = orderService.watchAllOrders((list, err) => {
      if (err) {
        setError(err.message || 'Could not load orders. Tap Retry.');
        setOrders([]);
      } else {
        setOrders(list);
        setError(null);
      }
      // ALWAYS — see watcher contract refactor.
      setLoading(false);
    });
    return unsubscribe;
  }, [isAdmin, retryNonce]);

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Shop Dashboard" onBack={() => nav.goBack()} />
        <EmptyState
          title="Admin access required"
          subtitle="Your account doesn't have admin permissions."
        />
      </SafeAreaView>
    );
  }

  const handleAction = async (orderId: string, newStatus: OrderStatus) => {
    // PR 2 — payment hardening (Phase B). Cancelling a paid online
    // order is NOT a status update — it requires a Razorpay refund.
    // Intercept before the optimistic write and route to the
    // Cancel & Refund modal instead. updateOrderStatus on the server
    // also rejects this combination as a belt-and-suspenders guard.
    if (newStatus === 'cancelled') {
      const order = orders.find(o => o.id === orderId);
      if (
        order &&
        order.paymentMethod === 'online' &&
        order.paymentStatus === 'paid'
      ) {
        setRefundTarget(order);
        return;
      }
    }

    // Optimistic update: flip the chip immediately so the UI doesn't
    // wait up to 10s for the next watchAllOrders poll cycle. Capture the
    // previous list BEFORE the setOrders call so a rollback restores the
    // exact pre-optimistic state — using `prev` inside setOrders would
    // close over the already-mutated value.
    const previousOrders = orders;
    setOrders(prev =>
      prev.map(o => (o.id === orderId ? { ...o, status: newStatus } : o)),
    );
    setPending(prev => ({ ...prev, [orderId]: newStatus }));
    try {
      await orderService.updateOrderStatus({ orderId, newStatus });
      // Success: next poll (within 10s) confirms the server state.
      // No success toast — optimistic UX implies confirmation by absence
      // of an error.
    } catch (err: any) {
      // Rollback the optimistic write first.
      setOrders(previousOrders);
      // Self-healing intercept: if the server rejects this cancellation
      // because the order is paid (and our client state was stale at
      // the moment of click — there's a race window between
      // confirmPayment landing on the customer side and the next 10s
      // admin-watcher poll picking up the new paymentStatus), route
      // the admin to the Cancel & Refund modal instead of surfacing
      // the raw failed-precondition message. Server is the source of
      // truth: if it says paid, we trust it.
      const code = err?.code as string | undefined;
      const msg = (err?.message ?? '') as string;
      const looksLikePaidCancelGuard =
        (code === 'functions/failed-precondition' ||
          code === 'failed-precondition') &&
        msg.toLowerCase().includes('cancelpaidorder');
      if (newStatus === 'cancelled' && looksLikePaidCancelGuard) {
        const fresh = previousOrders.find(o => o.id === orderId);
        if (fresh) {
          setRefundTarget(fresh);
          return; // suppress the alert; modal handles the next step.
        }
      }
      const message = msg || 'Failed to update order status.';
      Alert.alert('Update failed', message);
    } finally {
      setPending(prev => ({ ...prev, [orderId]: null }));
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Shop Dashboard" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Shop Dashboard" onBack={() => nav.goBack()} />
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            onPress={() => setRetryNonce(n => n + 1)}
            style={styles.retryBtn}
            accessibilityRole="button"
            accessibilityLabel="Retry loading orders"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
      <FlatList
        data={orders}
        keyExtractor={o => o.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListHeaderComponent={
          <View style={styles.statsCard}>
            <Text style={styles.statsTitle}>Today</Text>
            <View style={styles.statsRow}>
              <Stat label="GMV" value={formatRupees(stats.gmvToday)} />
              <Stat
                label="Active"
                value={String(stats.activeCount)}
                emphasize={stats.activeCount > 0}
              />
              <Stat
                label="Online partners"
                value={onlinePartners == null ? '—' : String(onlinePartners)}
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="No orders yet"
            subtitle="Orders will appear here in real time as customers place them."
          />
        }
        renderItem={({ item }) => {
          const itemCount = item.items.reduce((n, i) => n + i.quantity, 0);
          const actions = nextActionsFor(item.status);
          const pendingStatus = pending[item.id];
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shopName} numberOfLines={1}>{item.shopName}</Text>
                  <Text style={styles.orderId} numberOfLines={1}>#{item.id}</Text>
                </View>
                <OrderStatusChip status={item.status} />
              </View>
              <Text style={styles.time}>{formatOrderTime(item.createdAt)}</Text>
              <Text style={styles.meta}>
                {itemCount} item{itemCount > 1 ? 's' : ''} · {formatRupees(item.total)}
              </Text>
              <Text style={styles.phone}>
                📞 {item.deliveryAddress?.phone || '—'}
              </Text>
              <PaymentStatusBanner
                paymentStatus={item.paymentStatus}
                onRetryRefund={
                  item.paymentStatus === 'refund_failed'
                    ? () => setRefundTarget(item)
                    : undefined
                }
              />
              {actions.length > 0 && (
                <View style={styles.actions}>
                  {actions.map(next => {
                    const isCancel = next === 'cancelled';
                    const isLoading = pendingStatus === next;
                    const anyPending = !!pendingStatus;
                    return (
                      <View key={next} style={styles.actionBtn}>
                        <Button
                          title={ACTION_LABELS[next]}
                          onPress={() => handleAction(item.id, next)}
                          variant={isCancel ? 'secondary' : 'primary'}
                          loading={isLoading}
                          disabled={anyPending && !isLoading}
                          style={isCancel ? styles.cancelBtn : undefined}
                        />
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        }}
      />
      {refundTarget ? (
        <CancelAndRefundModal
          visible={!!refundTarget}
          orderId={refundTarget.id}
          orderTotal={refundTarget.total}
          onClose={() => setRefundTarget(null)}
          onDone={() => {
            // Server has flipped status → cancelled + paymentStatus →
            // refunded (or refund_failed on Razorpay error). The next
            // watchAllOrders tick (within 10s) will reflect it; the
            // banner above the card surfaces refund_failed if so.
            setRefundTarget(null);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

function Stat({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, emphasize && styles.statValueEmphasize]}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  statsCard: {
    backgroundColor: colors.primaryLight,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  statsTitle: {
    ...typography.caption,
    color: colors.primaryDark,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  stat: { flex: 1 },
  statValue: { ...typography.h2, color: colors.primaryDark },
  statValueEmphasize: { color: '#b35400' },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  card: {
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  shopName: { ...typography.h3 },
  orderId: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  time: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  meta: { ...typography.body, marginTop: spacing.xs },
  phone: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionBtn: { flexGrow: 1, minWidth: 140 },
  cancelBtn: { backgroundColor: '#fde2e2' },
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
