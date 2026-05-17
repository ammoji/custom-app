import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import {
    FlatList,
    Pressable,
    RefreshControl,
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
import type { DeliveryRequest } from '../../types';
import { daysSince, formatOrderTime } from '../../utils/format';

const POLL_MS = 30_000;

/**
 * PR 1 — security hardening. Admin queue of pending delivery
 * partner applications. Mirror of PendingShopsScreen — same FIFO
 * sort, same days-since chip with > 7d warning treatment, same
 * tap-row-to-detail pattern.
 */
export default function PendingDeliveryRequestsScreen() {
  const nav = useNavigation<any>();
  const isAdmin = useAuthStore(s => s.isAdmin);
  const [requests, setRequests] = useState<DeliveryRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOnce = async () => {
    try {
      const list = await orderService.listPendingDeliveryRequests();
      // Defensive client-side sort — same posture as PendingShopsScreen.
      // The server orders by submittedAt asc but legacy/missing fields
      // could bubble in unpredictable order.
      list.sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
      setRequests(list);
    } catch (e) {
      console.warn('[PendingDeliveryRequests] fetch failed:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    fetchOnce();
    const interval = setInterval(fetchOnce, POLL_MS);
    return () => clearInterval(interval);
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          title="Delivery requests"
          onBack={() => nav.goBack()}
        />
        <EmptyState
          title="Admin only"
          subtitle="You don't have permission to review delivery applications."
        />
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          title="Delivery requests"
          onBack={() => nav.goBack()}
        />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  const now = Date.now();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={`Delivery requests (${requests.length})`}
        onBack={() => nav.goBack()}
      />
      <FlatList
        data={requests}
        keyExtractor={r => r.uid}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          <EmptyState
            title="All caught up"
            subtitle="No delivery applications awaiting review."
          />
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchOnce();
            }}
          />
        }
        renderItem={({ item }) => {
          const d = daysSince(item.submittedAt, now);
          const stale = d > 7;
          return (
            <Pressable
              style={styles.card}
              onPress={() =>
                nav.navigate('DeliveryRequestDetail', { uid: item.uid })
              }
              accessibilityRole="button"
              accessibilityLabel={`Review ${item.name ?? item.phone ?? item.uid}`}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name || item.phone || item.uid}
                </Text>
                <View
                  style={[styles.daysChip, stale && styles.daysChipStale]}
                >
                  <Text
                    style={[
                      styles.daysChipText,
                      stale && styles.daysChipTextStale,
                    ]}
                  >
                    {d === 0 ? 'today' : `${d}d ago`}
                  </Text>
                </View>
              </View>
              <View style={styles.meta}>
                <Text style={styles.metaItem}>📞 {item.phone || '—'}</Text>
                {item.vehicleType ? (
                  <Text style={styles.metaItem}>🛵 {item.vehicleType}</Text>
                ) : null}
                {item.city ? (
                  <Text style={styles.metaItem}>📍 {item.city}</Text>
                ) : null}
                <Text style={styles.metaItem}>
                  🕒 {formatOrderTime(item.submittedAt)}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  name: { ...typography.h3, flex: 1 },
  daysChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  daysChipStale: {
    backgroundColor: '#FEF2E5',
    borderColor: colors.warning ?? '#E89A3C',
  },
  daysChipText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  daysChipTextStale: { color: colors.warning ?? '#B35400' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  metaItem: { ...typography.caption, color: colors.textSecondary },
});
