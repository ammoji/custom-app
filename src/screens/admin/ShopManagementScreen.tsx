import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
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
import type { Shop, ShopStatus } from '../../types';

const POLL_MS = 30_000;

const STATUS_ORDER: ShopStatus[] = [
  'active',
  'pending',
  'suspended',
  'rejected',
];

const STATUS_LABEL: Record<ShopStatus, string> = {
  active: 'Active',
  pending: 'Pending review',
  suspended: 'Suspended',
  rejected: 'Rejected',
};

/**
 * Admin shop list grouped by status. Polls listAllShops every 30s.
 * Tap a row to open ShopDetailManagement with suspend/unsuspend
 * actions. Pending shops route to the dedicated PendingShops review
 * flow (richer registration metadata + approve/reject buttons).
 */
export default function ShopManagementScreen() {
  const nav = useNavigation<any>();
  const isAdmin = useAuthStore(s => s.isAdmin);
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOnce = async () => {
    try {
      const list = await orderService.listAllShops();
      setShops(list);
    } catch (e) {
      console.warn('[ShopManagement] fetch failed:', e);
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

  const grouped = useMemo(() => {
    const out: Record<ShopStatus, Shop[]> = {
      active: [],
      pending: [],
      suspended: [],
      rejected: [],
    };
    shops.forEach(s => {
      const status = (s.status ?? 'active') as ShopStatus;
      if (out[status]) out[status].push(s);
    });
    // Stable alpha sort within each bucket so the list doesn't
    // jitter between polls.
    STATUS_ORDER.forEach(k => out[k].sort((a, b) => a.name.localeCompare(b.name)));
    return out;
  }, [shops]);

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="All shops" onBack={() => nav.goBack()} />
        <EmptyState title="Admin only" subtitle="" />
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="All shops" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={`All shops (${shops.length})`}
        onBack={() => nav.goBack()}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchOnce();
            }}
          />
        }
      >
        {STATUS_ORDER.map(status => {
          const list = grouped[status];
          if (!list.length) return null;
          return (
            <View key={status} style={styles.group}>
              <Text style={styles.groupHeader}>
                {STATUS_LABEL[status]} · {list.length}
              </Text>
              {list.map(shop => (
                <Pressable
                  key={shop.id}
                  style={styles.row}
                  onPress={() => {
                    if (status === 'pending') {
                      // PendingShopsScreen owns the rich approve/
                      // reject flow with registrationData details.
                      nav.navigate('ShopRegistrationDetail', {
                        shopId: shop.id,
                      });
                    } else {
                      nav.navigate('ShopDetailManagement', {
                        shopId: shop.id,
                      });
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${shop.name}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {shop.name}
                    </Text>
                    <Text style={styles.address} numberOfLines={1}>
                      {shop.address}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {shop.registrationData?.phone
                        ? `📞 ${shop.registrationData.phone}`
                        : 'No registration phone'}
                    </Text>
                  </View>
                  <StatusBadge status={status} />
                </Pressable>
              ))}
            </View>
          );
        })}

        {shops.length === 0 && (
          <EmptyState
            title="No shops"
            subtitle="No shops have been registered or seeded yet."
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusBadge({ status }: { status: ShopStatus }) {
  return (
    <View style={[styles.badge, styles[`badge_${status}`]]}>
      <Text style={[styles.badgeText, styles[`badgeText_${status}`]]}>
        {STATUS_LABEL[status]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  group: { marginBottom: spacing.lg },
  groupHeader: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
    ...shadow.card,
  },
  name: { ...typography.bodyBold },
  address: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.sm,
  },
  badgeText: { ...typography.caption, fontWeight: '700' },
  badge_active: { backgroundColor: colors.primaryLight },
  badgeText_active: { color: colors.primaryDark },
  badge_pending: { backgroundColor: colors.warning + '22' },
  badgeText_pending: { color: colors.warning },
  badge_suspended: { backgroundColor: colors.danger + '22' },
  badgeText_suspended: { color: colors.danger },
  badge_rejected: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  badgeText_rejected: { color: colors.textSecondary },
});
