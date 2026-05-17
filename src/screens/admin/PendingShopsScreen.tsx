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
import type { Shop } from '../../types';
import { formatOrderTime } from '../../utils/format';

const POLL_MS = 30_000;

/**
 * Admin queue of shops awaiting review. Server-sorted by submission
 * time ascending (oldest first) so admins clear the backlog FIFO.
 * Tap a row to open ShopRegistrationDetail with full info + approve /
 * reject actions; this screen only shows summary.
 */
export default function PendingShopsScreen() {
  const nav = useNavigation<any>();
  const isAdmin = useAuthStore(s => s.isAdmin);
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOnce = async () => {
    try {
      const list = await orderService.listPendingShops();
      // Phase 12c: defensive client-side sort by submittedAt asc
      // (oldest first). The Firestore query already orders by
      // registrationData.submittedAt asc, but a missing field on a
      // legacy shop would null-coalesce to 0 server-side and bubble
      // it to the top in unpredictable order. Sorting here pins the
      // oldest-first contract regardless of upstream behaviour.
      list.sort((a, b) => {
        const sa = a.registrationData?.submittedAt ?? 0;
        const sb = b.registrationData?.submittedAt ?? 0;
        return sa - sb;
      });
      setShops(list);
    } catch (e) {
      console.warn('[PendingShops] fetch failed:', e);
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
          title="Pending shops"
          onBack={() => nav.goBack()}
        />
        <EmptyState
          title="Admin only"
          subtitle="You don't have permission to review shop registrations."
        />
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          title="Pending shops"
          onBack={() => nav.goBack()}
        />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={`Pending shops (${shops.length})`}
        onBack={() => nav.goBack()}
      />
      <FlatList
        data={shops}
        keyExtractor={s => s.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          <EmptyState
            title="All caught up"
            subtitle="No shops awaiting review."
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
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() =>
              nav.navigate('ShopRegistrationDetail', { shopId: item.id })
            }
            accessibilityRole="button"
            accessibilityLabel={`Review ${item.name}`}
          >
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.address} numberOfLines={2}>
              {item.address}
            </Text>
            <View style={styles.meta}>
              <Text style={styles.metaItem}>
                📞 {item.registrationData?.phone ?? '—'}
              </Text>
              {item.registrationData?.submittedAt ? (
                <Text style={styles.metaItem}>
                  🕒 {formatOrderTime(item.registrationData.submittedAt)}
                </Text>
              ) : null}
            </View>
          </Pressable>
        )}
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
    marginBottom: spacing.xs,
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
  address: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metaItem: { ...typography.caption, color: colors.textSecondary },
});
