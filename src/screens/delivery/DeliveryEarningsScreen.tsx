import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import EmptyState from '../../components/common/EmptyState';
import Loader from '../../components/common/Loader';
import ScreenHeader from '../../components/common/ScreenHeader';
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
import { formatOrderTime, formatRupees } from '../../utils/format';

type EarningRow = {
  orderId: string;
  shopName: string | null;
  deliveryFee: number;
  deliveredAt: number;
};

type Windows = { totalRupees: number; count: number };

/**
 * PR-NEXT-BUNDLE-D §D — delivery partner Earnings tab.
 *
 * Today + this-week rupee sums (server-computed) plus a paginated
 * list of recent delivered orders. Flat `deliveryFee` per delivery
 * (pilot — no surge / tips / bonuses).
 */
export default function DeliveryEarningsScreen() {
  // Rule 2 — hooks above conditional returns.
  const isDelivery = useAuthStore(s => s.isDelivery);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState<Windows>({ totalRupees: 0, count: 0 });
  const [week, setWeek] = useState<Windows>({ totalRupees: 0, count: 0 });
  const [rows, setRows] = useState<EarningRow[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await orderService.listMyEarnings({ limit: 20 });
      setToday(res.today);
      setWeek(res.week);
      setRows(res.deliveries);
      setHasMore(res.hasMore);
      setCursor(res.nextCursor);
    } catch (e: any) {
      setError(e?.message || 'Could not load earnings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        if (!cancelled) await load();
      })();
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  const loadMore = async () => {
    if (!hasMore || loadingMore || cursor == null) return;
    setLoadingMore(true);
    try {
      const res = await orderService.listMyEarnings({
        from: cursor,
        limit: 20,
      });
      setRows(prev => [...prev, ...res.deliveries]);
      setHasMore(res.hasMore);
      setCursor(res.nextCursor);
    } catch {
      // keep what we have; surface nothing intrusive on pagination.
    } finally {
      setLoadingMore(false);
    }
  };

  if (!isDelivery) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Earnings" />
        <View style={styles.center}>
          <Text style={styles.muted}>Delivery role required.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Earnings" />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Earnings" />
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      <FlatList
        data={rows}
        keyExtractor={r => r.orderId}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListHeaderComponent={
          <View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Today</Text>
              <Text style={styles.summaryAmount}>
                {formatRupees(today.totalRupees)}
              </Text>
              <Text style={styles.summarySub}>
                from {today.count}{' '}
                {today.count === 1 ? 'delivery' : 'deliveries'}
              </Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>This week</Text>
              <Text style={styles.summaryAmount}>
                {formatRupees(week.totalRupees)}
              </Text>
              <Text style={styles.summarySub}>
                from {week.count}{' '}
                {week.count === 1 ? 'delivery' : 'deliveries'}
              </Text>
            </View>
            <View style={styles.divider} />
            <Text style={styles.sectionHeader}>Recent deliveries</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.shopName ?? 'Delivery'}
              </Text>
              <Text style={styles.rowMeta}>
                #{item.orderId.slice(-6)} ·{' '}
                {item.deliveredAt > 0
                  ? formatOrderTime(item.deliveredAt)
                  : '—'}
              </Text>
            </View>
            <Text style={styles.rowAmount}>{formatRupees(item.deliveryFee)}</Text>
          </View>
        )}
        ListEmptyComponent={
          <EmptyState
            title="No deliveries yet"
            subtitle="Complete deliveries to start earning."
          />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator
              style={{ marginVertical: spacing.lg }}
              color={colors.primary}
            />
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { ...typography.body, color: colors.textSecondary },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  summaryCard: {
    backgroundColor: colors.primaryLight,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  summaryLabel: { ...typography.bodyBold, color: colors.primaryDark },
  summaryAmount: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.primaryDark,
    marginVertical: spacing.xs,
  },
  summarySub: { ...typography.caption, color: colors.primaryDark },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  sectionHeader: { ...typography.h3, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowTitle: { ...typography.bodyBold },
  rowMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  rowAmount: { ...typography.price, color: colors.primary },
  errorBanner: {
    backgroundColor: '#FEF2F2',
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: radii.md,
  },
  errorText: { ...typography.body, color: colors.danger },
});
