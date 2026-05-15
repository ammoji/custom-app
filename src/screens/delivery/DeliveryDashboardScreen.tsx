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
import { formatOrderTime, formatRupees, isToday } from '../../utils/format';

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
  const [online, setOnline] = useState(false);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [pendingClaim, setPendingClaim] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [showAvailable, setShowAvailable] = useState(true);
  const [showMine, setShowMine] = useState(true);

  // Subscribe to the two pollers. Both fire immediately on mount and
  // then every 10/15s respectively. The "loading" flag flips once
  // EITHER list arrives — good enough as a "first paint" signal.
  useEffect(() => {
    if (!isDelivery) {
      setLoading(false);
      return;
    }
    let firstSeen = false;
    const markLoaded = () => {
      if (!firstSeen) {
        firstSeen = true;
        setLoading(false);
      }
    };
    const off1 = orderService.watchAvailableDeliveries(list => {
      setAvailable(list);
      markLoaded();
    });
    const off2 = orderService.watchMyDeliveries(list => {
      setMine(list);
      markLoaded();
    });
    return () => {
      off1();
      off2();
    };
  }, [isDelivery]);

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

  const handleClaim = async (orderId: string) => {
    // Optimistic remove from available list. On failure (e.g. someone
    // else won the race), restore via the next 15s poll — no need to
    // cache the previous list.
    setPendingClaim(orderId);
    setAvailable(prev => prev.filter(o => o.id !== orderId));
    try {
      await orderService.claimDelivery({ orderId });
      // Force-refresh "my deliveries" so the new card appears
      // immediately rather than waiting up to 10s for the next poll.
      const refreshed = await orderService.listMyDeliveries();
      setMine(refreshed);
    } catch (e: any) {
      const msg = e?.message || 'Could not claim this pickup.';
      Alert.alert('Already taken', msg);
      // Force-refresh available so the user sees current reality.
      try {
        const refreshed = await orderService.listAvailableDeliveries();
        setAvailable(refreshed);
      } catch {
        // Swallow — next poll will resync.
      }
    } finally {
      setPendingClaim(null);
    }
  };

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
            pending={pendingClaim === item.id}
            anyPending={!!pendingClaim}
            onAccept={() => handleClaim(item.id)}
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
  pending,
  anyPending,
  onAccept,
}: {
  order: Order;
  pending: boolean;
  anyPending: boolean;
  onAccept: () => void;
}) {
  const itemCount = order.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <View style={styles.card}>
      <Text style={styles.shopName} numberOfLines={1}>
        {order.shopName}
      </Text>
      <Text style={styles.address} numberOfLines={2}>
        Drop: {order.deliveryAddress.line1}
        {order.deliveryAddress.line2 ? `, ${order.deliveryAddress.line2}` : ''},{' '}
        {order.deliveryAddress.pincode}
      </Text>
      <Text style={styles.meta}>
        {itemCount} item{itemCount > 1 ? 's' : ''} ·{' '}
        {formatRupees(order.total)} · {formatOrderTime(order.createdAt)}
      </Text>
      <View style={{ marginTop: spacing.md }}>
        <Button
          title={pending ? 'Claiming…' : 'Accept'}
          onPress={onAccept}
          loading={pending}
          // Disable other Accept buttons while one claim is in flight
          // — racing your own clicks adds zero value.
          disabled={anyPending && !pending}
        />
      </View>
    </View>
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
});
