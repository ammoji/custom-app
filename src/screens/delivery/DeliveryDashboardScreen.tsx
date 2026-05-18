import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    FlatList,
    Pressable,
    StyleSheet,
    Switch,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import Loader from '../../components/common/Loader';
import ScreenHeader from '../../components/common/ScreenHeader';
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
// PR 3 — concurrency cleanup. authService.refreshClaims used by the
// role-revocation UX path; helpers below race-guard rollbacks and
// detect revoked claims. NOTE: auto-formatter has stripped these
// imports twice during this PR — if you save and tsc complains
// about Cannot find name 'handleRoleAuthError' / 'authService' /
// 'shouldRollbackOptimistic', re-add this block.
import { authService } from '../../services/authService';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
import type { Order } from '../../types';
import {
    formatOrderTime,
    formatRelativeDeliveryTime,
    formatRupees,
    isToday,
} from '../../utils/format';
import { handleRoleAuthError } from '../../utils/handleRoleAuthError';
import { shouldRollbackOptimistic } from '../../utils/optimisticRollback';

/**
 * DeliveryDashboardScreen — Phase 12b.
 *
 * Layout:
 *   [Online/Offline switch]
 *   [Today stats: completed | active]
 *   [Available pickups section]   (poll 15s, 'Accept' optimistic)
 *   [My active deliveries section] (poll 10s, picked-up / delivered actions)
 *
 * No new state-machine entries. We branch on:
 *   pickedUpAt == null   →  next action is "I've picked it up"
 *   pickedUpAt != null   →  next action is "Delivered"
 *
 * The online toggle writes users/{uid}.deliveryStatus via setDeliveryStatus.
 * That doc is what the sendNewPickupPushToDelivery trigger queries to
 * decide who gets the new-pickup push.
 */
export default function DeliveryDashboardScreen() {
  const nav = useNavigation<any>();
  const isDelivery = useAuthStore(s => s.isDelivery);
  // PR 3 — concurrency cleanup (item 4). Used to push refreshed
  // claims into useAuthStore when a watcher hands back permission-
  // denied (admin revoked delivery role mid-session). NOTE:
  // auto-formatter has stripped this declaration once already; if
  // tsc complains "Cannot find name 'setUser'", re-add it.
  const setUser = useAuthStore(s => s.setUser);

  const [available, setAvailable] = useState<Order[]>([]);
  const [mine, setMine] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [showAvailable, setShowAvailable] = useState(true);
  // PR 12 — "heads up" pool (accepted/preparing) shown above the
  // claimable section so partners can plan ahead. Defaults open
  // because the whole point of the feature is early visibility.
  const [showHeadsUp, setShowHeadsUp] = useState(true);
  const [showMine, setShowMine] = useState(true);
  // Delivery History defaults collapsed — it's reference data, not
  // action data. The partner shouldn't have to scroll past it to
  // reach the live action lists above.
  const [showHistory, setShowHistory] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  // Subscribe to the two pollers. Both fire immediately on mount and
  // then every 10/15s respectively. The "loading" flag flips once
  // EITHER list's first callback arrives — success OR failure — so a
  // failed first poll on either watcher can never leave the loader
  // spinning forever.
  useEffect(() => {
    if (!isDelivery) {
      setLoading(false);
      return;
    }
    let firstSeen = false;
    let availableErr: Error | null = null;
    let mineErr: Error | null = null;
    const reconcileError = () => {
      // Only show error banner if BOTH watchers have errored — if just
      // one source is healthy, render whatever it produced and stay
      // quiet. Latest error wins so the user sees the freshest cause.
      if (availableErr && mineErr) {
        setError(
          (mineErr.message || availableErr.message) ||
            'Could not load deliveries. Tap Retry.',
        );
      } else {
        setError(null);
      }
    };
    const markLoaded = () => {
      if (!firstSeen) {
        firstSeen = true;
        setLoading(false);
      }
    };
    const off1 = orderService.watchAvailableDeliveries((list, err) => {
      if (err) {
        availableErr = err;
        setAvailable([]);
        // PR 3 — best-effort claim refresh on permission-denied.
        // No-op for unrelated errors. Fire-and-forget; the role-guard
        // render branch will pick up the cleared claim on next render.
        void handleRoleAuthError(err, authService.refreshClaims, setUser);
      } else {
        availableErr = null;
        setAvailable(list);
      }
      reconcileError();
      markLoaded();
    });
    const off2 = orderService.watchMyDeliveries((list, err) => {
      if (err) {
        mineErr = err;
        setMine([]);
        void handleRoleAuthError(err, authService.refreshClaims, setUser);
      } else {
        mineErr = null;
        setMine(list);
      }
      reconcileError();
      markLoaded();
    });
    return () => {
      off1();
      off2();
    };
  }, [isDelivery, retryNonce]);

  const stats = useMemo(() => {
    let completedToday = 0;
    let active = 0;
    for (const o of mine) {
      if (o.status === 'delivered' && isToday(o.deliveredAt ?? 0)) {
        completedToday += 1;
      }
      if (o.status === 'ready_for_pickup') active += 1;
    }
    return { completedToday, active };
  }, [mine]);

  // Active deliveries = currently assigned and not yet delivered. We
  // intentionally hide already-delivered orders from the active list
  // so the screen doesn't accumulate cruft over the day.
  const activeMine = useMemo(
    () => mine.filter(o => o.status === 'ready_for_pickup'),
    [mine],
  );

  // PR 12 — the server `listAvailableDeliveries` callable now returns
  // the union of {accepted, preparing, ready_for_pickup} that nobody
  // has claimed yet. Split client-side:
  //   - headsUp (accepted | preparing) — NOT claimable yet; shown
  //     so partners can plan routes / batches before the shop
  //     signals "ready".
  //   - availableNow (ready_for_pickup) — the existing claim pool.
  const headsUp = useMemo(
    () =>
      available.filter(
        o => o.status === 'accepted' || o.status === 'preparing',
      ),
    [available],
  );
  const availableNow = useMemo(
    () => available.filter(o => o.status === 'ready_for_pickup'),
    [available],
  );

  // Delivery History = orders this partner has delivered, newest
  // first. Data is already in scope via watchMyDeliveries (same
  // source the "Completed today" stat reads from).
  const deliveredMine = useMemo(
    () =>
      mine
        .filter(o => o.status === 'delivered')
        .sort((a, b) => (b.deliveredAt ?? 0) - (a.deliveredAt ?? 0)),
    [mine],
  );

  const toggleOnline = async (next: boolean) => {
    setTogglingOnline(true);
    // Optimistic flip — rollback on failure so the switch reflects
    // server reality.
    setOnline(next);
    try {
      await orderService.setDeliveryStatus({
        status: next ? 'online' : 'offline',
      });
    } catch (e: any) {
      setOnline(!next);
      Alert.alert(
        'Could not update status',
        e?.message || 'Please try again.',
      );
    } finally {
      setTogglingOnline(false);
    }
  };

  // The inline Accept on AvailablePickupCard was removed in the
  // view-first-cards pass (Phase 12a-v2-iv-followup-view-first).
  // Claim now happens on DeliveryOrderDetailScreen, which owns the
  // claim race + revert via the useDeliveryOrderDetail hook. The
  // previous in-flight-claim state moved with it.

  const handlePickedUp = async (order: Order) => {
    setPendingAction(order.id);
    // PR 3 — concurrency cleanup (item 3b). Capture the OPTIMISTIC
    // pickedUpAt value so the rollback can verify the watcher
    // hasn't installed a different value while the API was in
    // flight. Without this guard, a 10s watcher tick that arrives
    // between markPickedUp() failing and the rollback firing gets
    // clobbered — worst case, undoing a real successful pickup
    // recorded by a parallel call from another device.
    const optimisticPickedUpAt = Date.now();
    setMine(prev =>
      prev.map(o =>
        o.id === order.id ? { ...o, pickedUpAt: optimisticPickedUpAt } : o,
      ),
    );
    try {
      await orderService.markPickedUp({ orderId: order.id });
    } catch (e: any) {
      setMine(prev => {
        const current = prev.find(o => o.id === order.id);
        if (
          !current ||
          !shouldRollbackOptimistic(current.pickedUpAt, optimisticPickedUpAt)
        ) {
          console.warn(
            '[DeliveryDashboard] handlePickedUp rollback suppressed — watcher already updated',
          );
          return prev;
        }
        return prev.map(o =>
          o.id === order.id ? { ...o, pickedUpAt: null } : o,
        );
      });
      Alert.alert('Update failed', e?.message || 'Please try again.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleDelivered = async (order: Order) => {
    setPendingAction(order.id);
    // PR 3 — concurrency cleanup (item 3c). Same guard pattern as
    // handlePickedUp. We compare the optimistic status — 'delivered'
    // — against current; if a watcher already moved the order to a
    // DIFFERENT status (cancelled by admin, for instance), the
    // rollback to 'ready_for_pickup' would be wrong.
    const optimisticDeliveredAt = Date.now();
    setMine(prev =>
      prev.map(o =>
        o.id === order.id
          ? {
              ...o,
              status: 'delivered',
              deliveredAt: optimisticDeliveredAt,
            }
          : o,
      ),
    );
    try {
      await orderService.markDelivered({ orderId: order.id });
    } catch (e: any) {
      setMine(prev => {
        const current = prev.find(o => o.id === order.id);
        if (
          !current ||
          !shouldRollbackOptimistic(current.status, 'delivered')
        ) {
          console.warn(
            '[DeliveryDashboard] handleDelivered rollback suppressed — watcher already updated to',
            current?.status,
          );
          return prev;
        }
        return prev.map(o =>
          o.id === order.id
            ? { ...o, status: 'ready_for_pickup', deliveredAt: null }
            : o,
        );
      });
      Alert.alert('Update failed', e?.message || 'Please try again.');
    } finally {
      setPendingAction(null);
    }
  };

  if (!isDelivery) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Delivery Dashboard" onBack={() => nav.goBack()} />
        <EmptyState
          title="Delivery role required"
          subtitle="Register as a delivery partner from the Home screen first."
        />
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Delivery Dashboard" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  // We render everything inside ONE FlatList to keep the whole screen
  // scrollable. The header builds the static + active-deliveries
  // chunks, the FlatList itself owns the available-pickups list (which
  // is the most likely to grow long).
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Delivery Dashboard" onBack={() => nav.goBack()} />
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            onPress={() => setRetryNonce(n => n + 1)}
            style={styles.retryBtn}
            accessibilityRole="button"
            accessibilityLabel="Retry loading deliveries"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
      <FlatList
        data={showAvailable ? availableNow : []}
        keyExtractor={o => `avail-${o.id}`}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListHeaderComponent={
          <View>
            <View
              style={[
                styles.statusCard,
                online ? styles.statusOnline : styles.statusOffline,
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.statusLabel,
                    online ? styles.statusLabelOnline : styles.statusLabelOffline,
                  ]}
                >
                  {online ? "You're online" : "You're offline"}
                </Text>
                <Text style={styles.statusSub}>
                  {online
                    ? 'Receiving pickup notifications.'
                    : 'Toggle on to receive pickup notifications.'}
                </Text>
              </View>
              <Switch
                value={online}
                onValueChange={toggleOnline}
                disabled={togglingOnline}
                trackColor={{ false: '#ccc', true: colors.primary }}
              />
            </View>

            <View style={styles.statsCard}>
              <Text style={styles.statsTitle}>Today</Text>
              <View style={styles.statsRow}>
                <Stat
                  label="Completed"
                  value={String(stats.completedToday)}
                />
                <Stat
                  label="Active"
                  value={String(stats.active)}
                  emphasize={stats.active > 0}
                />
              </View>
            </View>

            {/* My Active Deliveries section. Inlined into the header
                because FlatList only renders one data type at a time
                and "available pickups" is the long list. */}
            <SectionHeader
              title="My Active Deliveries"
              expanded={showMine}
              onToggle={() => setShowMine(s => !s)}
              count={activeMine.length}
            />
            {showMine && activeMine.length === 0 && (
              <EmptyState
                title="No active deliveries"
                subtitle="Accept a pickup below to start delivering."
              />
            )}
            {showMine &&
              activeMine.map(o => (
                <View key={`mine-${o.id}`} style={{ marginBottom: spacing.md }}>
                  <ActiveDeliveryCard
                    order={o}
                    pending={pendingAction === o.id}
                    onPickedUp={() => handlePickedUp(o)}
                    onDelivered={() => handleDelivered(o)}
                    onPress={() =>
                      nav.navigate('DeliveryOrderDetail', { orderId: o.id })
                    }
                  />
                </View>
              ))}

            {/* Delivery History section — collapsed by default. The
                partner can expand to see today's / past completed
                runs. Data is already loaded via watchMyDeliveries. */}
            <SectionHeader
              title="Delivery History"
              expanded={showHistory}
              onToggle={() => setShowHistory(s => !s)}
              count={deliveredMine.length}
            />
            {showHistory && deliveredMine.length === 0 && (
              <EmptyState
                title="No completed deliveries yet"
                subtitle="Your delivered orders will appear here."
              />
            )}
            {showHistory &&
              deliveredMine.map(o => (
                <View
                  key={`hist-${o.id}`}
                  style={{ marginBottom: spacing.md }}
                >
                  <DeliveryHistoryCard
                    order={o}
                    onPress={() =>
                      nav.navigate('DeliveryOrderDetail', { orderId: o.id })
                    }
                  />
                </View>
              ))}

            {/* PR 12 — Heads up section: accepted / preparing
                orders the shop hasn't yet flipped to
                ready_for_pickup. Visual treatment differs from
                Available Pickups (no "Tap to accept" hint, no
                claim affordance) so partners don't try to
                pre-commit. Tapping opens detail; the detail screen
                shows the pickup is not yet claimable. */}
            <SectionHeader
              title="Heads up — coming soon"
              expanded={showHeadsUp}
              onToggle={() => setShowHeadsUp(s => !s)}
              count={headsUp.length}
            />
            {showHeadsUp && headsUp.length === 0 && (
              <EmptyState
                title="No upcoming pickups"
                subtitle="Accepted / preparing orders will appear here so you can plan routes ahead."
              />
            )}
            {showHeadsUp &&
              headsUp.map(o => (
                <View key={`heads-${o.id}`} style={{ marginBottom: spacing.md }}>
                  <HeadsUpCard
                    order={o}
                    onPress={() =>
                      nav.navigate('DeliveryOrderDetail', { orderId: o.id })
                    }
                  />
                </View>
              ))}

            <SectionHeader
              title="Available now"
              expanded={showAvailable}
              onToggle={() => setShowAvailable(s => !s)}
              count={availableNow.length}
            />
            {showAvailable && availableNow.length === 0 && (
              <EmptyState
                title="No pickups available"
                subtitle={
                  online
                    ? 'New pickups will appear here within ~15s.'
                    : 'Toggle online to start receiving pickups.'
                }
              />
            )}
          </View>
        }
        renderItem={({ item }) => (
          <AvailablePickupCard
            order={item}
            onPress={() =>
              nav.navigate('DeliveryOrderDetail', { orderId: item.id })
            }
          />
        )}
      />
    </SafeAreaView>
  );
}

function SectionHeader({
  title,
  expanded,
  onToggle,
  count,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  count: number;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={styles.sectionHeader}
      accessibilityRole="button"
      accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
    >
      <Text style={styles.sectionTitle}>
        {title}
        {count > 0 ? `  (${count})` : ''}
      </Text>
      <Text style={styles.sectionChevron}>{expanded ? '▾' : '▸'}</Text>
    </Pressable>
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

/**
 * PR 12 — HeadsUpCard.
 *
 * Visually distinct from AvailablePickupCard so partners don't
 * mistake an accepted/preparing order (NOT claimable yet) for an
 * available-now pickup. Differences:
 *   - "Coming soon" pill instead of the implicit available state.
 *   - "Ready by HH:MM" line surfaces the shopkeeper's ETA so the
 *     partner can plan routes / batches.
 *   - "Tap to view items" hint (no mention of accept) — claim
 *     happens later, only on the Available now section.
 *
 * No optimistic claim here. Tapping opens DeliveryOrderDetail,
 * which shows the not-yet-claimable state cleanly.
 */
function HeadsUpCard({
  order,
  onPress,
}: {
  order: Order;
  onPress: () => void;
}) {
  const itemCount = order.items.reduce((n, i) => n + i.quantity, 0);
  const stateLabel =
    order.status === 'preparing' ? 'Shop preparing' : 'Shop accepted';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Upcoming pickup for ${order.shopName}`}
      style={({ pressed }) => [
        styles.card,
        styles.headsUpCard,
        pressed && styles.cardBodyPressed,
      ]}
    >
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.shopName} numberOfLines={1}>
            {order.shopName}
          </Text>
          <Text style={styles.headsUpState}>{stateLabel}</Text>
        </View>
        <Text style={styles.cardChevron}>›</Text>
      </View>
      {order.readyByEstimate ? (
        <Text style={styles.headsUpEta}>
          ⏰ Ready by {formatOrderTime(order.readyByEstimate)}
        </Text>
      ) : (
        <Text style={styles.headsUpEta}>
          ⏰ ETA not yet set by the shop
        </Text>
      )}
      <Text style={styles.address} numberOfLines={2}>
        Drop: {order.deliveryAddress.line1}
        {order.deliveryAddress.line2
          ? `, ${order.deliveryAddress.line2}`
          : ''}
        , {order.deliveryAddress.pincode}
      </Text>
      <Text style={styles.meta}>
        {itemCount} item{itemCount > 1 ? 's' : ''} ·{' '}
        {formatRupees(order.total)}
      </Text>
      <Text style={styles.tapHint}>Tap to view items</Text>
    </Pressable>
  );
}

function AvailablePickupCard({
  order,
  onPress,
}: {
  order: Order;
  onPress: () => void;
}) {
  // View-first card: body is the only tap target. Accept lives
  // inside DeliveryOrderDetail so the partner has seen items +
  // exact drop address before committing. The previous inline
  // Accept button caused accidental commits in solo testing.
  const itemCount = order.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open pickup details for ${order.shopName}`}
      style={({ pressed }) => [styles.card, pressed && styles.cardBodyPressed]}
    >
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.shopName} numberOfLines={1}>
            {order.shopName}
          </Text>
        </View>
        <Text style={styles.cardChevron}>›</Text>
      </View>
      <Text style={styles.address} numberOfLines={2}>
        Drop: {order.deliveryAddress.line1}
        {order.deliveryAddress.line2
          ? `, ${order.deliveryAddress.line2}`
          : ''}
        , {order.deliveryAddress.pincode}
      </Text>
      <Text style={styles.meta}>
        {itemCount} item{itemCount > 1 ? 's' : ''} ·{' '}
        {formatRupees(order.total)} · {formatOrderTime(order.createdAt)}
      </Text>
      <Text style={styles.tapHint}>Tap to view items & accept</Text>
    </Pressable>
  );
}

/**
 * Delivery History row — read-only summary of a delivered order.
 *
 * Customer phone is NOT shown (matches the privacy guard on
 * DeliveryOrderDetailScreen's available-for-claim state). The
 * partner already had the phone while assigned; once the order is
 * delivered we don't keep surfacing it on the dashboard.
 */
function DeliveryHistoryCard({
  order,
  onPress,
}: {
  order: Order;
  onPress: () => void;
}) {
  const when = formatRelativeDeliveryTime(order.deliveredAt ?? 0);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open delivered order for ${order.shopName}`}
      style={({ pressed }) => [styles.card, pressed && styles.cardBodyPressed]}
    >
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.shopName} numberOfLines={1}>
            {order.shopName}
          </Text>
          <Text style={styles.subStatus}>✅ Delivered · {when}</Text>
        </View>
        <Text style={styles.cardChevron}>›</Text>
      </View>
      <Text style={styles.address} numberOfLines={1}>
        {order.deliveryAddress.line1} · {order.deliveryAddress.pincode}
      </Text>
      <Text style={styles.meta}>{formatRupees(order.total)}</Text>
    </Pressable>
  );
}

function ActiveDeliveryCard({
  order,
  pending,
  onPickedUp,
  onDelivered,
  onPress,
}: {
  order: Order;
  pending: boolean;
  onPickedUp: () => void;
  onDelivered: () => void;
  onPress: () => void;
}) {
  const itemCount = order.items.reduce((n, i) => n + i.quantity, 0);
  const pickedUp = !!order.pickedUpAt;
  return (
    <Pressable
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Delivery details for ${order.shopName}`}
    >
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.shopName} numberOfLines={1}>
            {order.shopName}
          </Text>
          <Text style={styles.subStatus}>
            {pickedUp ? '🚚 On the way to customer' : '🏪 Pickup from shop'}
          </Text>
        </View>
      </View>
      <Text style={styles.address} numberOfLines={2}>
        {order.deliveryAddress.name} · 📞 {order.deliveryAddress.phone}
      </Text>
      <Text style={styles.address} numberOfLines={2}>
        {order.deliveryAddress.line1}
        {order.deliveryAddress.line2 ? `, ${order.deliveryAddress.line2}` : ''},{' '}
        {order.deliveryAddress.pincode}
      </Text>
      <Text style={styles.meta}>
        {itemCount} item{itemCount > 1 ? 's' : ''} ·{' '}
        {formatRupees(order.total)}
      </Text>
      <View style={{ marginTop: spacing.md }}>
        {pickedUp ? (
          <Button
            title="Delivered"
            onPress={onDelivered}
            loading={pending}
            disabled={pending}
          />
        ) : (
          <Button
            title="I've picked it up"
            onPress={onPickedUp}
            loading={pending}
            disabled={pending}
          />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
  },
  statusOnline: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  statusOffline: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  statusLabel: { ...typography.h3 },
  statusLabelOnline: { color: colors.primaryDark },
  statusLabelOffline: { color: colors.textSecondary },
  statusSub: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statsCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statsTitle: {
    ...typography.caption,
    color: colors.textSecondary,
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
  statValue: { ...typography.h2 },
  statValueEmphasize: { color: colors.primaryDark },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionTitle: { ...typography.bodyBold },
  sectionChevron: { ...typography.h3, color: colors.textSecondary },
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
    marginBottom: spacing.xs,
  },
  cardBodyPressed: { opacity: 0.7 },
  // PR 12 — heads-up card visual treatment. Soft yellow tint
  // distinguishes from the active blue/green Available cards so
  // partners don't mistake one for the other at a glance.
  headsUpCard: {
    backgroundColor: '#FEF9E7',
    borderColor: '#F4D03F',
  },
  headsUpState: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  headsUpEta: {
    ...typography.bodyBold,
    color: colors.primaryDark,
    marginTop: spacing.xs,
  },
  cardChevron: {
    ...typography.h2,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
  },
  shopName: { ...typography.h3 },
  subStatus: {
    ...typography.caption,
    color: colors.primaryDark,
    fontWeight: '600',
    marginTop: 2,
  },
  address: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  meta: { ...typography.body, marginTop: spacing.sm },
  tapHint: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
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
