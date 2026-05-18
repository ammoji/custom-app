import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import {
    FlatList,
    Pressable,
    RefreshControl,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import Loader from '../../components/common/Loader';
import ScreenHeader from '../../components/common/ScreenHeader';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';

/**
 * PR 8 Part A — Admin audit log viewer.
 *
 * Polls listRecentAuditEntries on mount + every 60s while focused
 * (admin opens this rarely; aggressive polling would waste reads).
 * Pull-to-refresh for an immediate refetch. "Load more" button at
 * bottom for cursor pagination via the `before` timestamp.
 *
 * Each entry can be expanded inline to show metadata JSON. The
 * row collapses by default to keep the list scannable.
 *
 * Routing: registered as `AuditLog` in AppNavigator. Reached from
 * the HomeScreen admin tile "📜 Audit log".
 */

type AuditEntry = {
  id: string;
  timestamp: number;
  actorUid: string;
  // PR 8.1 — 'customer' added (mirrors the server union in
  // functions/src/auditLogHelpers.ts). Keep these in sync; we
  // intentionally don't import from functions/ on the client.
  actorRole: 'admin' | 'shopOwner' | 'customer' | 'system';
  actionType: string;
  targetType: string;
  targetId: string;
  targetSummary?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
};

// Stable canonical-label map for actionType → human-readable text.
// Add new action types here as they're introduced; the audit log
// itself stores the raw enum so renaming this map is safe.
const ACTION_LABELS: Record<string, string> = {
  'shop.approve': 'Shop approved',
  'shop.reject': 'Shop rejected',
  'shop.suspend': 'Shop suspended',
  'shop.unsuspend': 'Shop unsuspended',
  'shop.update_settings': 'Shop settings updated',
  'shop.bulk_menu_availability': 'Bulk menu availability changed',
  'user.revoke_shop_owner': 'Shop owner role revoked',
  'user.revoke_delivery': 'Delivery role revoked',
  'delivery_request.approve': 'Delivery request approved',
  'delivery_request.reject': 'Delivery request rejected',
  'order.cancel_paid': 'Paid order cancelled & refunded',
  'order.cancel_by_customer_window': 'Customer self-cancel (in-window)',
  'order.cancel_abandoned': 'Abandoned order cancelled (cron)',
  'order.manual_status_update': 'Order status manually updated',
};

function formatRelative(ms: number, now: number): string {
  const diff = now - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatAbsolute(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString();
}

export default function AuditLogScreen() {
  const nav = useNavigation<any>();
  const isAdmin = useAuthStore(s => s.isAdmin);

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const fetchInitial = useCallback(async () => {
    try {
      const r = await orderService.listRecentAuditEntries({ limit: 50 });
      setEntries((r.entries ?? []) as AuditEntry[]);
      setHasMore(!!r.hasMore);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Couldn't load audit log.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchMore = useCallback(async () => {
    if (entries.length === 0 || loadingMore) return;
    const oldest = entries[entries.length - 1].timestamp;
    setLoadingMore(true);
    try {
      const r = await orderService.listRecentAuditEntries({
        limit: 50,
        before: oldest,
      });
      const more = (r.entries ?? []) as AuditEntry[];
      // Defensive de-dup: Firestore's `<` should never overlap, but
      // a clock-skew edge could cause an exact-tie boundary entry to
      // appear in both pages. De-duplicate by id.
      const seen = new Set(entries.map(e => e.id));
      const merged = [...entries, ...more.filter(e => !seen.has(e.id))];
      setEntries(merged);
      setHasMore(!!r.hasMore);
    } catch (e: any) {
      setError(e?.message || "Couldn't load more entries.");
    } finally {
      setLoadingMore(false);
    }
  }, [entries, loadingMore]);

  useFocusEffect(
    useCallback(() => {
      if (!isAdmin) return;
      fetchInitial();
      // Tick `now` once a minute so the relative-time labels update.
      const tickId = setInterval(() => setNow(Date.now()), 60_000);
      // Re-poll every 60s for new entries.
      const pollId = setInterval(() => {
        fetchInitial();
      }, 60_000);
      return () => {
        clearInterval(tickId);
        clearInterval(pollId);
      };
    }, [isAdmin, fetchInitial]),
  );

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    fetchInitial();
  }, [isAdmin, fetchInitial]);

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Audit log" onBack={() => nav.goBack()} />
        <EmptyState
          title="Admin access required"
          subtitle="Only admins can view the audit log."
        />
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Audit log" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Audit log" onBack={() => nav.goBack()} />
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            onPress={() => {
              setLoading(true);
              fetchInitial();
            }}
            style={styles.retryBtn}
            accessibilityRole="button"
            accessibilityLabel="Retry"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
      <FlatList
        data={entries}
        keyExtractor={e => e.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchInitial();
            }}
          />
        }
        ListEmptyComponent={
          <EmptyState
            title="No audit entries yet"
            subtitle="Admin actions will be recorded here."
          />
        }
        ListFooterComponent={
          hasMore ? (
            <View style={styles.loadMore}>
              <Button
                title={loadingMore ? 'Loading…' : 'Load more'}
                onPress={fetchMore}
                variant="secondary"
                disabled={loadingMore}
                loading={loadingMore}
              />
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const isExpanded = expandedId === item.id;
          const label = ACTION_LABELS[item.actionType] ?? item.actionType;
          return (
            <Pressable
              style={styles.row}
              onPress={() => setExpandedId(isExpanded ? null : item.id)}
              accessibilityRole="button"
              accessibilityLabel={`${label} entry, tap to ${isExpanded ? 'collapse' : 'expand'}`}
            >
              <View style={styles.rowHeader}>
                <Text style={styles.actionLabel}>{label}</Text>
                <Text style={styles.actorRole}>{item.actorRole}</Text>
              </View>
              <Text style={styles.timestamp}>
                {formatRelative(item.timestamp, now)} ·{' '}
                {formatAbsolute(item.timestamp)}
              </Text>
              {!!item.targetSummary && (
                <Text style={styles.targetSummary}>
                  → {item.targetSummary}
                </Text>
              )}
              <Text style={styles.targetId}>
                {item.targetType}/{item.targetId}
              </Text>
              {!!item.reason && (
                <Text style={styles.reason}>Reason: {item.reason}</Text>
              )}
              {isExpanded && (
                <View style={styles.metadata}>
                  <Text style={styles.metadataLabel}>Actor uid:</Text>
                  <Text style={styles.metadataValue}>{item.actorUid}</Text>
                  {item.metadata && (
                    <>
                      <Text style={styles.metadataLabel}>Metadata:</Text>
                      <Text style={styles.metadataJson}>
                        {JSON.stringify(item.metadata, null, 2)}
                      </Text>
                    </>
                  )}
                </View>
              )}
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  separator: { height: spacing.sm },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionLabel: { ...typography.bodyBold, flex: 1 },
  actorRole: {
    ...typography.caption,
    color: colors.textSecondary,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.sm,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  timestamp: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  targetSummary: {
    ...typography.body,
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  targetId: { ...typography.caption, color: colors.textSecondary },
  reason: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  metadata: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 2,
  },
  metadataLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  metadataValue: { ...typography.caption, color: colors.textPrimary },
  metadataJson: {
    ...typography.caption,
    color: colors.textPrimary,
    fontFamily: 'monospace',
  },
  loadMore: { padding: spacing.lg, alignItems: 'center' },
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
