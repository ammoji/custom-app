import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import Loader from '../../components/common/Loader';
import ScreenHeader from '../../components/common/ScreenHeader';
import OrderStatusChip from '../../components/order/OrderStatusChip';
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
import type { Order } from '../../types';
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
      // Rollback the optimistic write and surface the failure.
      setOrders(previousOrders);
      const message = err?.message || 'Failed to update order status.';
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
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
