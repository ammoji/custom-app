/**
 * HOTFIX-RESPOND-OWNER-AND-CARD-NAV §E — dedicated screen showing
 * only flagged_low orders awaiting this role's response. Reached by
 * tapping "Reviews & Ratings" on the dashboard card grid. Single
 * shared screen serves both delivery + shop via the `role` route param.
 */
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import EmptyState from '../components/common/EmptyState';
import ScreenHeader from '../components/common/ScreenHeader';
import { colors, radii, spacing, typography } from '../constants/theme';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { orderService } from '../services/orderService';
import {
  buildAttentionQueueRows,
  type AttentionQueueRow,
} from '../utils/attentionQueueViewModel';

export default function AttentionQueueScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'AttentionQueue'>>();
  const nav = useNavigation<any>();
  const { role } = route.params;

  // Rule 2 — all useState above any conditional return.
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AttentionQueueRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRows = useCallback(async () => {
    try {
      const raw =
        role === 'delivery'
          ? await orderService.listMyAttentionReviews()
          : await orderService.listShopAttentionReviews();
      setRows(buildAttentionQueueRows(role, raw, Date.now()));
    } catch (e) {
      // Non-fatal — show the empty state rather than crashing. Pull-to-
      // refresh / re-focus retries.
      console.warn('[AttentionQueueScreen] fetch failed:', e);
      setRows([]);
    }
  }, [role]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      fetchRows().finally(() => {
        if (!cancelled) setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }, [fetchRows]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRows().finally(() => setRefreshing(false));
  }, [fetchRows]);

  const handleRowPress = (orderId: string) => {
    const screenName =
      role === 'delivery' ? 'DeliveryOrderDetail' : 'ShopOrderDetail';
    nav.navigate(screenName, { orderId });
  };

  const renderRow = ({ item }: { item: AttentionQueueRow }) => (
    <Pressable
      onPress={() => handleRowPress(item.orderId)}
      accessibilityRole="button"
      accessibilityLabel={`Respond to review for ${item.shopName ?? 'order'}`}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.82 }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.shopName ?? `Order #${item.orderId.slice(0, 6)}`}
        </Text>
        <Text style={styles.rowStars}>
          {'★'.repeat(Math.max(0, Math.min(5, item.ratingStars)))}
          {item.ratingStars > 0 ? ` ${item.ratingStars}/5` : 'Low rating'}
        </Text>
        {item.commentExcerpt ? (
          <Text style={styles.rowComment} numberOfLines={2}>
            "{item.commentExcerpt}"
          </Text>
        ) : null}
        {item.daysLeft != null && (
          <Text style={styles.rowBadge}>
            {item.daysLeft === 0
              ? 'Auto-publishes today'
              : `${item.daysLeft} day${item.daysLeft === 1 ? '' : 's'} left to respond`}
          </Text>
        )}
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={`Reviews & Ratings${rows.length > 0 ? ` · ${rows.length}` : ''}`}
        onBack={() => nav.goBack()}
      />
      {loading ? (
        <ActivityIndicator
          style={{ marginTop: spacing.xl }}
          color={colors.primary}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={r => r.orderId}
          renderItem={renderRow}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <EmptyState
              title="✨ All caught up"
              subtitle="No reviews need your attention right now."
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl ?? spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowTitle: { ...typography.bodyBold, color: colors.textPrimary },
  rowStars: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  rowComment: {
    ...typography.caption,
    color: colors.textPrimary,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  rowBadge: {
    ...typography.caption,
    color: colors.primary,
    marginTop: spacing.xs,
    fontWeight: '700',
  },
  chevron: { ...typography.h3, color: colors.textMuted, marginLeft: spacing.sm },
});
