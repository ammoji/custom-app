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
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
import type { Order } from '../../types';
import {
    formatOrderTime,
    formatRelativeDeliveryTime,
    formatRupees,
    isToday,
} from '../../utils/format';

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

  const [available, setAvailable] = useState<Order[]>([]);
  const [mine, setMine] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [showAvailable, setShowAvailable] = useState(true);
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
      if (o.status === 'out_for_delivery') active += 1;
    }
    return { completedToday, active };
  }, [mine]);

  // Active deliveries = currently assigned and not yet delivered. We
  // intentionally hide already-delivered orders from the active list
  // so the screen doesn't accumulate cruft over the day.
  const activeMine = useMemo(
    () => mine.filter(o => o.status === 'out_for_delivery'),
    [mine],
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
    // Optimistic: stamp pickedUpAt locally so the button flips to
    // "Delivered" without waiting for the poll.
    setMine(prev =>
      prev.map(o =>
        o.id === order.id ? { ...o, pickedUpAt: Date.now() } : o,
      ),
    );
    try {
      await orderService.markPickedUp({ orderId: order.id });
    } catch (e: any) {
      // Rollback
      setMine(prev =>
        prev.map(o => (o.id === order.id ? { ...o, pickedUpAt: null } : o)),
      );
      Alert.alert('Update failed', e?.message || 'Please try again.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleDelivered = async (order: Order) => {
    setPendingAction(order.id);
    // Optimistic: flip status. Customer-facing push fires server-side
    // via sendOrderStatusPush.
    setMine(prev =>
      prev.map(o =>
        o.id === order.id
          ? { ...o, status: 'delivered', deliveredAt: Date.now() }
          : o,
      ),
    );
    try {
      await orderService.markDelivered({ orderId: order.id });
    } catch (e: any) {
      setMine(prev =>
        prev.map(o =>
          o.id === order.id
            ? { ...o, status: 'out_for_delivery', deliveredAt: null }
            : o,
        ),
      );
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
        data={showAvailable ? available : []}
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

            <SectionHeader
              title="Available Pickups"
              expanded={showAvailable}
              onToggle={() => setShowAvailable(s => !s)}
              count={available.length}
            />
            {showAvailable && available.length === 0 && (
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
