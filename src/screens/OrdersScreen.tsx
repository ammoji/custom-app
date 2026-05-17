import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import EmptyState from '../components/common/EmptyState';
import Loader from '../components/common/Loader';
import ScreenHeader from '../components/common/ScreenHeader';
import OrderStatusChip from '../components/order/OrderStatusChip';
import { colors, radii, shadow, spacing, typography } from '../constants/theme';
import { orderService } from '../services/orderService';
import { useAuthStore } from '../store/useAuthStore';
import type { Order } from '../types';
import { formatOrderTime, formatRupees } from '../utils/format';

export default function OrdersScreen() {
  const nav = useNavigation<any>();
  const uid = useAuthStore(s => s.uid);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // PR 3 — concurrency cleanup (item 1). Without an error state the
  // catch block silently swallowed listMine failures and the empty
  // FlatList rendered "No orders yet" — confidence-destroying for
  // any customer who knew they had a real order. Mirror
  // AdminOrdersScreen's error-banner + retryNonce posture so the
  // UX is consistent across roles.
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const load = useCallback(async () => {
    if (!uid) {
      setOrders([]);
      setError(null);
      setLoading(false);
      return;
    }
    try {
      const data = await orderService.listMine(uid);
      setOrders(data);
      setError(null);
    } catch (err: any) {
      console.warn('[orders] listMine failed:', err);
      // Preserve whatever orders we had (don't flip to []) — a
      // transient network blip shouldn't wipe stale-but-correct
      // data the user was looking at.
      setError(err?.message || "Couldn't load orders. Tap Retry.");
    }
  }, [uid]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
    // retryNonce is intentional in deps: bumping it from the Retry
    // button re-runs this effect.
  }, [load, retryNonce]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="My Orders" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  if (orders.length === 0 && !error) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="My Orders" onBack={() => nav.goBack()} />
        <EmptyState
          title="No orders yet"
          subtitle="Place your first order to see it here."
          ctaLabel="Browse shops"
          onCtaPress={() => nav.navigate('ShopList')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="My Orders" onBack={() => nav.goBack()} />
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => {
          const itemCount = item.items.reduce((n, i) => n + i.quantity, 0);
          return (
            <Pressable
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
              onPress={() => nav.navigate('OrderDetail', { orderId: item.id })}
              accessibilityRole="button"
              accessibilityLabel={`Order from ${item.shopName}, total ${formatRupees(item.total)}, status ${item.status}`}
            >
              <View style={styles.cardRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shopName} numberOfLines={1}>{item.shopName}</Text>
                  <Text style={styles.meta}>
                    {itemCount} item{itemCount > 1 ? 's' : ''} · {formatRupees(item.total)}
                  </Text>
                  <Text style={styles.time}>{formatOrderTime(item.createdAt)}</Text>
                </View>
                <OrderStatusChip status={item.status} />
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          // Only reached when error is set and orders is still []
          // (the no-error empty state above short-circuits earlier).
          // Suppress the "Place your first order" CTA — we don't
          // know whether the user has orders; the banner already
          // tells them what's wrong + offers Retry.
          error ? (
            <EmptyState
              title="Couldn't load orders"
              subtitle="Tap Retry above when your connection is back."
            />
          ) : null
        }
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
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  shopName: { ...typography.h3 },
  meta: { ...typography.caption, marginTop: 2 },
  time: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  // PR 3 — error banner styles mirror AdminOrdersScreen / Shop /
  // Delivery dashboards so the recovery affordance looks the same
  // everywhere.
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
