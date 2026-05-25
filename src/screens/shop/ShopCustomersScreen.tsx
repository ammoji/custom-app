/**
 * PR 36 — Shop owner Customer CRM.
 *
 * Three tabs (Top by revenue / Recent / Stopped 30d+) over a
 * server-aggregated rollup of the shop's most-recent 1000 orders,
 * with a 90d / 180d / All-time period selector. Tapping a row
 * expands an inline detail with the customer's phone (tap-to-call
 * on native), full order count, total spent, and first-order date.
 *
 * All sorting / aggregation is server-side via the
 * `listShopCustomers` callable; this screen is a pure
 * presentation layer over the response. State machine is small
 * (`tab`, `period`, `expandedUid`, plus `data` / `loading` /
 * `error`) and ALL `useState` calls live above the early returns
 * to satisfy React's rules-of-hooks (the same trap that bit us
 * in the watchAllOrders refactor — DO NOT move them down).
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Analytics } from '../../services/analytics';
import { orderService } from '../../services/orderService';
import type { ShopCustomer } from '../../types';
import { formatRupees } from '../../utils/format';
import type { RootStackParamList } from '../../navigation/AppNavigator';

type SortBy = 'top_revenue' | 'recent' | 'stopped';
type Period = '90d' | '180d' | 'all';

type Summary = {
  totalUniqueCustomers: number;
  totalRevenue: number;
  ordersScanned: number;
  ordersInPeriod: number;
  truncated: boolean;
};

type Data = {
  customers: ShopCustomer[];
  summary: Summary;
  // The shopId the rollup was computed for. We surface this in
  // the analytics event because the screen itself never knows
  // it (server derives from claim). Captured from the response
  // when the server echoes it; for now we read claims via the
  // current user context on emit instead — see below.
};

const SORTS: Array<{ id: SortBy; label: string }> = [
  { id: 'top_revenue', label: 'Top by revenue' },
  { id: 'recent', label: 'Recent' },
  { id: 'stopped', label: 'Stopped 30d+' },
];

const PERIODS: Array<{ id: Period; label: string }> = [
  { id: '90d', label: '90d' },
  { id: '180d', label: '180d' },
  { id: 'all', label: 'All time' },
];

function daysAgo(ms: number): number {
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString();
}

export default function ShopCustomersScreen() {
  // All hooks declared above any conditional return. (Empty-state
  // / loading / error UI is rendered inside the same JSX tree to
  // avoid the early-return-with-different-hook-counts bug.)
  const nav =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [tab, setTab] = useState<SortBy>('top_revenue');
  const [period, setPeriod] = useState<Period>('90d');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedUid, setExpandedUid] = useState<string | null>(null);
  // We don't have direct access to the resolved shopId on the
  // client (server reads it from claims), so the analytics
  // events emit shop_id as the empty string when unavailable.
  // BigQuery can join via the user_id from Firebase Analytics
  // if we ever need shop-level rollups.
  const [shopId] = useState<string>('');

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await orderService.listShopCustomers({
        sortBy: tab,
        period,
        limit: 100,
        ...(tab === 'stopped' ? { minDaysSinceLastOrder: 30 } : {}),
      });
      setData(res);
      Analytics.shop_customers_viewed({
        shop_id: shopId,
        sort_by: tab,
        period,
        total_unique_customers: res.summary.totalUniqueCustomers,
        customers_shown: res.customers.length,
      });
    } catch (e) {
      console.warn('[ShopCustomersScreen] listShopCustomers failed:', e);
      setError(
        e instanceof Error ? e.message : 'Failed to load customers',
      );
    } finally {
      setLoading(false);
    }
  }, [tab, period, shopId]);

  // Tab / period changes refetch. Initial load is also covered by
  // this effect (tab + period have initial defaults).
  useEffect(() => {
    refetch();
    // Collapse any expanded row when we swap views; the row
    // identity may not exist in the new result set.
    setExpandedUid(null);
  }, [refetch]);

  const customers = data?.customers ?? [];
  const summary = data?.summary;

  const emptyCopy = useMemo(() => {
    if (tab === 'stopped') {
      return {
        title: 'No lapsed customers',
        subtitle:
          'Nobody has stopped ordering for 30 days or more in this period. Healthy retention!',
      };
    }
    if (tab === 'recent') {
      return {
        title: 'No recent customers',
        subtitle: 'Customers in this period will appear here.',
      };
    }
    return {
      title: 'No customers in this view yet',
      subtitle:
        'Once customers place orders, your top spenders will show up here.',
    };
  }, [tab]);

  const onRowPress = (c: ShopCustomer, rank: number) => {
    setExpandedUid(prev => (prev === c.uid ? null : c.uid));
    Analytics.shop_customer_tapped({
      shop_id: shopId,
      sort_by: tab,
      rank_in_view: rank + 1,
    });
  };

  const onCallPhone = (phone: string) => {
    // tel: URLs no-op on web; on native they open the dialer.
    const url = `tel:${phone}`;
    Linking.canOpenURL(url)
      .then(ok => {
        if (ok) Linking.openURL(url);
      })
      .catch(err =>
        console.warn('[ShopCustomersScreen] dialer open failed:', err),
      );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => nav.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
        >
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>My customers</Text>
        <View style={styles.backSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* Stats card */}
        <View style={styles.statsCard}>
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>
                {summary?.totalUniqueCustomers ?? '—'}
              </Text>
              <Text style={styles.statLabel}>Unique customers</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>
                {summary ? formatRupees(summary.totalRevenue) : '—'}
              </Text>
              <Text style={styles.statLabel}>Revenue ({periodLabel(period)})</Text>
            </View>
          </View>
          <View style={styles.periodRow}>
            {PERIODS.map(p => (
              <Pressable
                key={p.id}
                style={[
                  styles.periodChip,
                  period === p.id && styles.periodChipActive,
                ]}
                onPress={() => setPeriod(p.id)}
                accessibilityRole="button"
                accessibilityLabel={`Period ${p.label}`}
                accessibilityState={{ selected: period === p.id }}
              >
                <Text
                  style={[
                    styles.periodChipText,
                    period === p.id && styles.periodChipTextActive,
                  ]}
                >
                  {p.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Tab strip */}
        <View style={styles.tabRow}>
          {SORTS.map(s => (
            <Pressable
              key={s.id}
              style={[styles.tab, tab === s.id && styles.tabActive]}
              onPress={() => setTab(s.id)}
              accessibilityRole="button"
              accessibilityLabel={s.label}
              accessibilityState={{ selected: tab === s.id }}
            >
              <Text
                style={[
                  styles.tabText,
                  tab === s.id && styles.tabTextActive,
                ]}
              >
                {s.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Truncated banner — surfaces when the working set hit
            the 1000-order cap so the shop owner knows older
            history isn't reflected. Only visible at very large
            scale; safe to show without alarming copy. */}
        {summary?.truncated ? (
          <View style={styles.truncBanner}>
            <Text style={styles.truncText}>
              Showing your most recent 1,000 orders. Older history isn't
              included in this view.
            </Text>
          </View>
        ) : null}

        {/* Body */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={refetch}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : customers.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>{emptyCopy.title}</Text>
            <Text style={styles.emptySub}>{emptyCopy.subtitle}</Text>
          </View>
        ) : (
          customers.map((c, idx) => {
            const expanded = expandedUid === c.uid;
            const last = daysAgo(c.lastOrderAt);
            return (
              <Pressable
                key={c.uid}
                style={[styles.row, expanded && styles.rowExpanded]}
                onPress={() => onRowPress(c, idx)}
                accessibilityRole="button"
                accessibilityLabel={`Customer ${c.displayName ?? 'Unknown'}`}
              >
                <View style={styles.rowHeader}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {(c.displayName ?? '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {c.displayName ?? 'Unknown'}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {c.phone ?? 'No phone'}
                    </Text>
                  </View>
                  <View style={styles.rowStats}>
                    <Text style={styles.rowSpent}>
                      {formatRupees(c.totalSpent)}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {c.orderCount} order{c.orderCount === 1 ? '' : 's'} ·
                      {last === 0 ? ' today' : ` ${last}d ago`}
                    </Text>
                  </View>
                </View>
                {expanded ? (
                  <View style={styles.expand}>
                    {c.phone ? (
                      <Pressable
                        onPress={() => onCallPhone(c.phone!)}
                        style={styles.callBtn}
                        accessibilityRole="button"
                        accessibilityLabel={`Call ${c.phone}`}
                        disabled={Platform.OS === 'web'}
                      >
                        <Text style={styles.callBtnText}>
                          📞 {c.phone}
                          {Platform.OS === 'web' ? '' : '  (tap to call)'}
                        </Text>
                      </Pressable>
                    ) : null}
                    <View style={styles.expandRow}>
                      <Text style={styles.expandLabel}>Total orders</Text>
                      <Text style={styles.expandValue}>{c.orderCount}</Text>
                    </View>
                    <View style={styles.expandRow}>
                      <Text style={styles.expandLabel}>Total spent</Text>
                      <Text style={styles.expandValue}>
                        {formatRupees(c.totalSpent)}
                      </Text>
                    </View>
                    <View style={styles.expandRow}>
                      <Text style={styles.expandLabel}>First order</Text>
                      <Text style={styles.expandValue}>
                        {formatDate(c.firstOrderAt)}
                      </Text>
                    </View>
                    <View style={styles.expandRow}>
                      <Text style={styles.expandLabel}>Last order</Text>
                      <Text style={styles.expandValue}>
                        {formatDate(c.lastOrderAt)}
                      </Text>
                    </View>
                  </View>
                ) : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function periodLabel(p: Period): string {
  if (p === '90d') return '90d';
  if (p === '180d') return '180d';
  return 'all time';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F7FA' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  back: { fontSize: 16, color: '#2563EB', fontWeight: '600' },
  backSpacer: { width: 50 },
  title: { fontSize: 18, fontWeight: '700', color: '#111827' },
  scroll: { padding: 16, paddingBottom: 48 },
  statsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  statBox: { alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '700', color: '#111827' },
  statLabel: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  periodRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 12,
    gap: 8,
  },
  periodChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
  },
  periodChipActive: { backgroundColor: '#2563EB' },
  periodChipText: { fontSize: 13, color: '#374151', fontWeight: '600' },
  periodChipTextActive: { color: '#FFFFFF' },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 4,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabActive: { backgroundColor: '#EFF6FF' },
  tabText: { fontSize: 13, color: '#6B7280', fontWeight: '600' },
  tabTextActive: { color: '#1D4ED8' },
  truncBanner: {
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  truncText: { fontSize: 12, color: '#92400E' },
  center: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: { color: '#DC2626', marginBottom: 12 },
  retryBtn: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryText: { color: '#FFFFFF', fontWeight: '700' },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  emptySub: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  row: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  rowExpanded: { borderWidth: 1, borderColor: '#BFDBFE' },
  rowHeader: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: { fontSize: 18, fontWeight: '700', color: '#1D4ED8' },
  rowMain: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 15, fontWeight: '600', color: '#111827' },
  rowSub: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  rowStats: { alignItems: 'flex-end', marginLeft: 8 },
  rowSpent: { fontSize: 15, fontWeight: '700', color: '#111827' },
  rowMeta: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  expand: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
  },
  callBtn: {
    backgroundColor: '#10B981',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  callBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  expandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  expandLabel: { fontSize: 13, color: '#6B7280' },
  expandValue: { fontSize: 13, color: '#111827', fontWeight: '600' },
});
