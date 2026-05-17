import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import EmptyState from '../../components/common/EmptyState';
import Loader from '../../components/common/Loader';
import ScreenHeader from '../../components/common/ScreenHeader';
import OrderStatusChip from '../../components/order/OrderStatusChip';
// PR 2 — payment hardening (Phase B). Surface amount_mismatch /
// authorized / refund states inline on the shop dashboard cards so
// owners don't dispatch a problem order. Cancel & Refund is
// initiated from ShopOrderDetail, not here.
import PaymentStatusBanner from '../../components/order/PaymentStatusBanner';
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
// PR 3 — concurrency cleanup. authService.refreshClaims used by the
// role-revocation UX path (admin revoked shopOwner mid-session →
// refresh claims → role-guard EmptyState renders).
import { authService } from '../../services/authService';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
import type { Order } from '../../types';
import { formatOrderTime, formatRupees } from '../../utils/format';
import { handleRoleAuthError } from '../../utils/handleRoleAuthError';
import { OrderStatus } from '../../utils/orderStateMachine';
import { mapShopOrdersError } from '../../utils/shopOrdersErrorMessage';

/**
 * Per-shop order dashboard for users with the shopOwner claim.
 *
 * Differences vs. AdminOrders:
 *   - Scoped to a single shopId (claims.shopId) — Cloud Function
 *     listShopOrders rejects requests for any other shop.
 *   - Today-only stats card on top (count / revenue / pending).
 *   - Active orders only in the main list (delivered/cancelled hidden);
 *     a "View all" toggle reveals history.
 *   - "Mark Delivered" intentionally NOT shown here — that transition
 *     is the delivery partner's action (Phase 12b will enforce it
 *     server-side too).
 */

const TERMINAL_STATUSES: OrderStatus[] = ['delivered', 'cancelled'];

// Action buttons were removed from this dashboard in the
// view-first-cards pass (Phase 12a-v2-iv-followup-view-first).
// Tapping a card opens ShopOrderDetail; all status transitions
// (Accept / Preparing / Out for Delivery) live exclusively on the
// detail screen. Rationale: solo testing surfaced accidental
// Accepts from shop owners who hadn't yet seen the items. One
// extra tap on the happy path eliminates an entire class of
// fulfilment errors.
//
// The SHOP_OWNER_ALLOWED_ACTIONS allow-list still lives on the
// detail screen's hook — kept there as the single source of truth.

function isToday(ms: number): boolean {
  if (!ms) return false;
  const d = new Date(ms);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export default function ShopOwnerDashboardScreen() {
  const nav = useNavigation<any>();
  const isShopOwner = useAuthStore(s => s.isShopOwner);
  const shopId = useAuthStore(s => s.shopId);
  // PR 3 — concurrency cleanup (item 4). When the watcher returns
  // permission-denied, the shopOwner claim was almost certainly
  // revoked server-side by an admin. Refresh claims so the role
  // guard above ('Shop owner access required') takes over on the
  // next render.
  const setUser = useAuthStore(s => s.setUser);

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Manual remount lever for the watcher: bumping this re-runs the
  // effect and re-subscribes after a Retry tap. Re-creating the
  // watcher is the right thing to do here — calling its own poll
  // again from outside would race the existing interval.
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!isShopOwner || !shopId) {
      setLoading(false);
      return;
    }
    const unsubscribe = orderService.watchShopOrders(shopId, (list, err) => {
      if (err) {
        // Map the raw callable error (e.g. RNFB's `INTERNAL` from a
        // missing-index FAILED_PRECONDITION) into something a shop
        // owner can actually act on. See utils/shopOrdersErrorMessage.
        setError(mapShopOrdersError(err));
        setOrders([]);
        // PR 3 — fire-and-forget claim refresh on permission-denied
        // / unauthenticated. No-op on unrelated errors. Once the
        // refreshed claims hit useAuthStore, the role-guard render
        // branch above takes over and the user sees the EmptyState
        // instead of a dead dashboard.
        void handleRoleAuthError(err, authService.refreshClaims, setUser);
      } else {
        setOrders(list);
        setError(null);
      }
      // ALWAYS clear loading on the first callback, regardless of
      // success/failure — the whole reason for the watcher contract
      // refactor (post-loader-spin hotfix).
      setLoading(false);
    });
    return unsubscribe;
  }, [isShopOwner, shopId, retryNonce]);

  const stats = useMemo(() => {
    let countToday = 0;
    let revenueToday = 0;
    let pendingCount = 0;
    for (const o of orders) {
      if (isToday(o.createdAt)) {
        countToday += 1;
        // Revenue counts only successfully-flowing orders. Cancelled
        // orders shouldn't inflate today's number.
        if (o.status !== 'cancelled') revenueToday += o.total;
      }
      if (o.status === 'pending') pendingCount += 1;
    }
    return { countToday, revenueToday, pendingCount };
  }, [orders]);

  const visibleOrders = useMemo(() => {
    if (showAll) return orders;
    return orders.filter(o => !TERMINAL_STATUSES.includes(o.status));
  }, [orders, showAll]);

  if (!isShopOwner || !shopId) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="My Shop" onBack={() => nav.goBack()} />
        <EmptyState
          title="Shop owner access required"
          subtitle="Your account isn't registered as a shop owner. Open a shop from the Home screen first."
        />
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="My Shop" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="My Shop" onBack={() => nav.goBack()} />
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
        data={visibleOrders}
        keyExtractor={o => o.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListHeaderComponent={
          <View>
            <View style={styles.statsCard}>
              <Text style={styles.statsTitle}>Today</Text>
              <View style={styles.statsRow}>
                <Stat label="Orders" value={String(stats.countToday)} />
                <Stat
                  label="Revenue"
                  value={formatRupees(stats.revenueToday)}
                />
                <Stat
                  label="Pending"
                  value={String(stats.pendingCount)}
                  emphasize={stats.pendingCount > 0}
                />
              </View>
            </View>
            {/* PR 5 — shop settings (deliveryFee + minOrder). Placed
                above Manage Menu per the prompt; same visual
                treatment via the shared `manageMenuTile` style. */}
            <Pressable
              style={styles.manageMenuTile}
              onPress={() => nav.navigate('ShopSettings')}
              accessibilityRole="button"
              accessibilityLabel="Shop settings"
            >
              <Text style={styles.manageMenuText}>⚙️  Shop Settings</Text>
              <Text style={styles.manageMenuChevron}>›</Text>
            </Pressable>
            <Pressable
              style={styles.manageMenuTile}
              onPress={() => nav.navigate('ShopMenu')}
              accessibilityRole="button"
              accessibilityLabel="Manage menu"
            >
              <Text style={styles.manageMenuText}>📋  Manage Menu</Text>
              <Text style={styles.manageMenuChevron}>›</Text>
            </Pressable>
            <View style={styles.toggleRow}>
              <Text style={styles.sectionLabel}>
                {showAll ? 'All orders' : 'Active orders'}
              </Text>
              <Text
                style={styles.toggleLink}
                onPress={() => setShowAll(s => !s)}
                accessibilityRole="button"
              >
                {showAll ? 'Show active only' : 'View all ›'}
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title={showAll ? 'No orders yet' : 'No active orders'}
            subtitle={
              showAll
                ? 'Orders will appear here as customers place them.'
                : 'All caught up. New orders will appear here in real time.'
            }
          />
        }
        renderItem={({ item }) => {
          const itemCount = item.items.reduce((n, i) => n + i.quantity, 0);
          return (
            <Pressable
              style={({ pressed }) => [
                styles.card,
                pressed && styles.cardBodyPressed,
              ]}
              onPress={() =>
                nav.navigate('ShopOrderDetail', { orderId: item.id })
              }
              accessibilityRole="button"
              accessibilityLabel={`Open details for order ${item.id}`}
            >
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orderId} numberOfLines={1}>
                    #{item.id}
                  </Text>
                  <Text style={styles.time}>
                    {formatOrderTime(item.createdAt)}
                  </Text>
                </View>
                <OrderStatusChip status={item.status} />
                <Text style={styles.cardChevron}>›</Text>
              </View>
              <Text style={styles.meta}>
                {itemCount} item{itemCount > 1 ? 's' : ''} · {formatRupees(item.total)}
              </Text>
              <Text style={styles.phone}>
                📞 {item.deliveryAddress?.phone || '—'}
              </Text>
              <PaymentStatusBanner paymentStatus={item.paymentStatus} />
              <Text style={styles.tapHint}>Tap to view items & take action</Text>
            </Pressable>
          );
        }}
      />
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
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionLabel: { ...typography.bodyBold },
  toggleLink: { ...typography.body, color: colors.primary, fontWeight: '600' },
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
  cardBodyPressed: { opacity: 0.7 },
  cardChevron: {
    ...typography.h2,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
  },
  orderId: { ...typography.bodyBold },
  time: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  meta: { ...typography.body, marginTop: spacing.sm },
  phone: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  tapHint: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  manageMenuTile: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  manageMenuText: { ...typography.bodyBold },
  manageMenuChevron: { ...typography.h2, color: colors.textSecondary },
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
