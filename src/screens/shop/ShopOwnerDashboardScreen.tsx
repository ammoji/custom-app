import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
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
import { detectNewOrderIds } from '../../utils/detectNewOrderIds';
import { handleRoleAuthError } from '../../utils/handleRoleAuthError';
import { OrderStatus } from '../../utils/orderStateMachine';
import { mapShopOrdersError } from '../../utils/shopOrdersErrorMessage';
// PR-NEXT-7 (finding #9) — DO NOT REMOVE. "N delivery partners
// online nearby" trust badge. Hook is gated by
// `isShopOwner && !!shopId` at the call-site so unsigned-in /
// wrong-role callers don't trigger the callable. Server reuses
// `filterPartnersByNotificationRadius` (PR 50) so the count
// cannot disagree with the push fanout.
import { useOnlinePartnersNearMyShop } from '../../hooks/useOnlinePartnersNearMyShop';

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
  // PR 7 — pull-to-refresh state. Mirrors AdminOrdersScreen's
  // pattern: bump retryNonce to force the watcher useEffect to
  // re-run (which fetches immediately on mount); clear `refreshing`
  // in the watcher callback below so the spinner clears exactly
  // when fresh data arrives, not on a fixed timeout.
  const [refreshing, setRefreshing] = useState(false);

  // PR 16 — new-order alert state.
  //
  // ⚠️ Rules of Hooks: ALL useState calls in this screen MUST stay
  // ABOVE the early-return guards below (`if (!isShopOwner)`,
  // `if (loading)`). PR 12's ETA-modal hotfix was caused by adding
  // useState below an early return; PRs 13 / 14 / 15 added the same
  // discipline comment to OrdersScreen, HomeScreen, and the rails.
  // Adding state below the role-guard / loader returns here would
  // crash the dashboard the instant the watcher's first callback
  // flips `loading` to false.
  //
  // `seenOrderIds` is the baseline set (or null on first tick —
  // see detectNewOrderIds first-tick semantics). `newOrderIds` is
  // the rolling "unread" set: highlighted with a primary border
  // and a NEW tag, surfaced in the yellow banner above the list,
  // and cleared on tap-card / scroll / banner-dismiss.
  const [seenOrderIds, setSeenOrderIds] = useState<Set<string> | null>(null);
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());

  // PR-NEXT-7 (finding #9) — trust badge: how many online partners
  // would actually receive a push for a new order at this shop.
  // Hook gated by the role+shopId predicate so unsigned-in / wrong-
  // role callers don't trigger the callable + permission-denied
  // noise in Sentry. Lives ABOVE the role-guard returns per Rule 2.
  const nearbyPartners = useOnlinePartnersNearMyShop(
    !!isShopOwner && !!shopId,
  );

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
        // PR 16 — detect new orders since last successful tick. We
        // run the diff INSIDE the watcher callback so a polling
        // tick that returns the same orders doesn't re-trigger
        // haptics / banners on every render. Only successful
        // callbacks update the seen baseline; an error callback
        // leaves the baseline untouched so the next successful
        // tick can still detect what arrived in the meantime.
        const currentIds = list.map(o => o.id);
        setSeenOrderIds(prevSeen => {
          const detected = detectNewOrderIds(currentIds, prevSeen);
          if (detected.size > 0) {
            setNewOrderIds(prevNew => {
              const merged = new Set(prevNew);
              for (const id of detected) merged.add(id);
              return merged;
            });
            // Single 'success'-style buzz per tick that has at
            // least one new order, regardless of count. Multiple
            // buzzes per tick would be jarring on the typical
            // shopkeeper's countertop. Wrapped in .catch so a
            // platform without haptics (web preview, sim) silently
            // no-ops — the visual cues still fire.
            Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success,
            ).catch(() => {
              /* haptics unavailable — visual alert still fires */
            });
          }
          // Always advance the baseline to the current set so the
          // NEXT tick has the right reference point. On first tick
          // (prevSeen=null) this transitions us out of "baseline
          // unset" silently.
          return new Set(currentIds);
        });
      }
      // ALWAYS clear loading on the first callback, regardless of
      // success/failure — the whole reason for the watcher contract
      // refactor (post-loader-spin hotfix).
      setLoading(false);
      // PR 7 — pull-to-refresh: clear the spinner on the first
      // callback after a refresh trigger, regardless of
      // success/error. The flag is only set by the pull-down
      // gesture; a normal poll-cycle callback finds it already
      // false.
      setRefreshing(false);
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

  // PR 16 — clear the "new" highlight on user acknowledgement.
  // Wired to (a) card press, (b) banner press, (c) FlatList
  // onScrollBeginDrag. Three independent ack paths cover every
  // way a shopkeeper can plausibly engage with the screen. Cheap
  // no-op if there's nothing to clear (avoids a spurious re-render
  // every time the shopkeeper scrolls the list).
  const clearNewHighlight = useCallback(() => {
    setNewOrderIds(prev => (prev.size === 0 ? prev : new Set()));
  }, []);

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
      {/* PR 16 — yellow banner above the list when there are
          unacknowledged new orders. Tap dismisses; tapping a card
          or scrolling also dismisses (see clearNewHighlight). */}
      {newOrderIds.size > 0 && (
        <Pressable
          onPress={clearNewHighlight}
          style={styles.newOrderBanner}
          accessibilityRole="button"
          accessibilityLabel={`${newOrderIds.size} new ${
            newOrderIds.size === 1 ? 'order' : 'orders'
          }. Tap to dismiss.`}
        >
          <Text style={styles.newOrderBannerText}>
            🔔 {newOrderIds.size}{' '}
            {newOrderIds.size === 1 ? 'new order' : 'new orders'}
          </Text>
          <Text style={styles.newOrderBannerHint}>Tap to dismiss</Text>
        </Pressable>
      )}
      <FlatList
        data={visibleOrders}
        keyExtractor={o => o.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        onScrollBeginDrag={clearNewHighlight}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              // PR 7 — same posture as AdminOrdersScreen's pull.
              // Bumping retryNonce re-runs the watcher useEffect
              // (which fetches immediately on mount). Spinner
              // clears in the watcher callback above.
              setRefreshing(true);
              setRetryNonce(n => n + 1);
            }}
          />
        }
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
            {/* PR-NEXT-7 (finding #9) — "N delivery partners online
                nearby" trust badge. Renders as a chip directly under
                the Today KPIs to keep the live current-state signal
                visually separated from the historical KPIs above.
                Copy mapping (intentional):
                  count==null  → "Checking partner availability…"
                                 (covers loading AND permanent-fail
                                 stale-clear; never shows "Network
                                 error" here — that would erode the
                                 trust the badge is trying to build)
                  count===0    → "No delivery partners online nearby"
                  count>=1     → "N delivery partner(s) online nearby"
                When the shop has no `location` set, the server
                returns `filtered: false` and we surface a hint
                nudging the owner to set a location for an accurate
                count (the count itself is still meaningful — it
                mirrors the push fanout's fail-open total). */}
            <View style={styles.partnersChip}>
              <Text style={styles.partnersChipIcon}>📦</Text>
              <Text style={styles.partnersChipText}>
                {nearbyPartners.count == null
                  ? 'Checking partner availability…'
                  : nearbyPartners.count === 0
                    ? 'No delivery partners online nearby'
                    : `${nearbyPartners.count} delivery partner${
                        nearbyPartners.count === 1 ? '' : 's'
                      } online nearby`}
              </Text>
              {nearbyPartners.count != null && !nearbyPartners.filtered && (
                <Text style={styles.partnersChipHint}>
                  Set your shop location for an accurate count
                </Text>
              )}
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
            {/* PR 36 — Customer CRM. Same visual treatment as the
                other dashboard tiles; route registered in
                AppNavigator. Server enforces the shopOwner /
                shopId access gate so this is safe to expose to
                every approved shop owner. */}
            <Pressable
              style={styles.manageMenuTile}
              onPress={() => nav.navigate('ShopCustomers')}
              accessibilityRole="button"
              accessibilityLabel="My customers"
            >
              <Text style={styles.manageMenuText}>👥  My customers</Text>
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
          // PR 16 — highlight orders that arrived in a recent
          // watcher tick the shopkeeper hasn't yet acknowledged.
          const isNew = newOrderIds.has(item.id);
          return (
            <Pressable
              style={({ pressed }) => [
                styles.card,
                isNew && styles.cardNew,
                pressed && styles.cardBodyPressed,
              ]}
              onPress={() => {
                clearNewHighlight();
                nav.navigate('ShopOrderDetail', { orderId: item.id });
              }}
              accessibilityRole="button"
              accessibilityLabel={`Open details for order ${item.id}${
                isNew ? ', new order' : ''
              }`}
            >
              {isNew && (
                <View style={styles.newTag}>
                  <Text style={styles.newTagText}>NEW</Text>
                </View>
              )}
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orderId} numberOfLines={1}>
                    #{item.id}
                  </Text>
                  <Text style={styles.time}>
                    {formatOrderTime(item.createdAt)}
                  </Text>
                </View>
                <OrderStatusChip
                  status={item.status}
                  pickedUpAt={item.pickedUpAt}
                  deliveredAt={item.deliveredAt}
                  audience="shopkeeper"
                />
                <Text style={styles.cardChevron}>›</Text>
              </View>
              <Text style={styles.meta}>
                {itemCount} item{itemCount > 1 ? 's' : ''} · {formatRupees(item.total)}
              </Text>
              <Text style={styles.phone}>
                📞 {item.deliveryAddress?.phone || '—'}
              </Text>
              <PaymentStatusBanner paymentStatus={item.paymentStatus} />
              {/* PR 7 — delivery substate timeline. The macro
                  `status` field only goes through pending →
                  accepted → preparing → ready_for_pickup →
                  delivered. The delivery partner's interim states
                  live in `deliveryPersonId` and `pickedUpAt`. Show
                  them so an order doesn't appear to jump from
                  "Out for Delivery" to "Delivered" with no
                  intermediate visibility. Same shape as
                  AdminOrdersScreen — pinned by inspection. */}
              {(item.status === 'ready_for_pickup' ||
                item.status === 'delivered') && (
                <View style={styles.deliveryFlow}>
                  {!item.deliveryPersonId &&
                    item.status === 'ready_for_pickup' && (
                      <Text style={styles.flowStepPending}>
                        ⏳ Awaiting delivery partner
                      </Text>
                    )}
                  {item.deliveryPersonId && (
                    <Text style={styles.flowStepDone}>
                      🛵 Claimed by partner
                    </Text>
                  )}
                  {item.pickedUpAt && (
                    <Text style={styles.flowStepDone}>
                      📦 Picked up · {formatOrderTime(item.pickedUpAt)}
                    </Text>
                  )}
                  {item.deliveredAt && (
                    <Text style={styles.flowStepDone}>
                      ✅ Delivered · {formatOrderTime(item.deliveredAt)}
                    </Text>
                  )}
                </View>
              )}
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
  // PR-NEXT-7 (finding #9) — partners-online chip placed under the
  // Today KPIs. Surface-coloured + bordered so it reads as a
  // distinct live-state pill rather than another stats card.
  // `flexWrap` + `width: '100%'` on the hint let the secondary line
  // ("Set your shop location...") drop below the icon+text row on
  // narrow screens without pushing the chip wider than the parent.
  partnersChip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  partnersChipIcon: { fontSize: 16 },
  partnersChipText: {
    ...typography.body,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  partnersChipHint: {
    ...typography.caption,
    color: colors.textSecondary,
    width: '100%',
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
  // PR 16 — new-order alert visuals.
  // Banner uses a warm-yellow background (the standard
  // attention-but-not-danger colour across consumer apps) with a
  // bold left-rail in `colors.warning` so it reads as informational
  // even at a glance from across the counter.
  newOrderBanner: {
    backgroundColor: '#FEF3C7',
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radii.md,
  },
  newOrderBannerText: { ...typography.bodyBold, color: colors.textPrimary },
  newOrderBannerHint: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  // Card border + tinted background mirrors PR 15's
  // ActiveOrdersRail card aesthetic so the visual language for
  // "live, needs attention" is consistent across customer-side
  // and shopkeeper-side surfaces.
  cardNew: {
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  newTag: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
    zIndex: 1,
  },
  newTagText: {
    ...typography.caption,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  // PR 7 — delivery substate timeline. Style values copied verbatim
  // from AdminOrdersScreen so the two surfaces look identical when
  // an admin and a shop owner side-by-side compare an order's
  // progress. Don't extract to a shared module — explicit
  // duplication makes the cross-screen consistency obvious to
  // reviewers (per the same convention as SHOP_OWNER_ALLOWED_ACTIONS).
  deliveryFlow: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 4,
  },
  flowStepPending: {
    ...typography.caption,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  flowStepDone: {
    ...typography.caption,
    color: colors.textPrimary,
  },
});
