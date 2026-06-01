import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import Loader from '../../components/common/Loader';
import ScreenHeader from '../../components/common/ScreenHeader';
// PR 2 — payment hardening (Phase B): Cancel & Refund modal +
// payment-status banner for the new statuses (amount_mismatch,
// authorized, refund_pending, refunded, refund_failed). Imports
// kept verbose because the auto-formatter strips these on save and
// the resulting JSX-vs-import drift takes a tsc run to surface.
import CancelAndRefundModal from '../../components/order/CancelAndRefundModal';
// PR-NEXT-6.1 — closes PR-NEXT-6 §D.4. Reusable thumbnail + tap-to-zoom
// modal that mints a 15-min signed-read URL on mount. DO NOT REMOVE on
// auto-format save.
import DeliveryProofViewer from '../../components/order/DeliveryProofViewer';
// PR 11 — admin order timeline. Renders the full statusHistory
// behind a per-card disclosure. DO NOT REMOVE on auto-format save.
import OrderStatusChip from '../../components/order/OrderStatusChip';
import OrderTimeline from '../../components/order/OrderTimeline';
import PaymentStatusBanner from '../../components/order/PaymentStatusBanner';
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
import { useOnlineDeliveryCount } from '../../hooks/useOnlineDeliveryCount';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
import type { Order } from '../../types';
import { computeAdminOrderStats } from '../../utils/adminStats';
import { formatOrderTime, formatRupees } from '../../utils/format';
// PR-NEXT-6.1 — authoritative settlement-method copy shared with the
// shop + customer order-detail screens (PR-NEXT-6). DO NOT REMOVE on
// auto-format save.
import { formatPaymentMethod } from '../../utils/formatPaymentMethod';
import {
    ACTION_LABELS,
    nextActionsFor,
    OrderStatus,
} from '../../utils/orderStateMachine';

// PR 12 — DO NOT REMOVE. Auto-formatter has eaten this declaration
// once during PR 12 development; if tsc complains
// "Cannot find name 'findOriginalEta'" after a save, re-add it.
//
// Walks statusHistory looking for the FIRST entry whose `reason`
// looks like `ETA: <ISO timestamp>` written by the server when
// the shopkeeper accepted (PR 12). Returns the parsed epoch ms,
// or null when no such entry exists (legacy orders / no reason).
// The admin card uses this to render "(updated from HH:MM)" when
// the current `readyByEstimate` differs from the original one.
const findOriginalEta = (
  statusHistory: Order['statusHistory'],
): number | null => {
  if (!Array.isArray(statusHistory)) return null;
  for (const entry of statusHistory) {
    if (
      (entry.status === 'accepted' || entry.status === 'preparing') &&
      typeof entry.reason === 'string' &&
      entry.reason.startsWith('ETA: ')
    ) {
      const iso = entry.reason.slice('ETA: '.length);
      const parsed = Date.parse(iso);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
};

export default function AdminOrdersScreen() {
  const nav = useNavigation<any>();
  const isAdmin = useAuthStore(s => s.isAdmin);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, OrderStatus | null>>({});
  const [retryNonce, setRetryNonce] = useState(0);
  // Pull-to-refresh state. We bump retryNonce to force-restart the
  // watcher (which fetches immediately on mount), then turn off
  // `refreshing` on the next watcher callback so the spinner clears
  // exactly when fresh data arrives — not on a fixed timeout.
  const [refreshing, setRefreshing] = useState(false);
  // Hotfix: per-card "Manual override" disclosure state. Only ONE
  // card's override panel is expanded at a time — tapping another
  // collapses the first. Prevents the admin from leaving multiple
  // override panels open and tapping a wrong card by accident.
  const [overrideExpandedId, setOverrideExpandedId] = useState<string | null>(null);
  // PR 11 — per-card timeline disclosure. Independent state from
  // overrideExpandedId so admins can have either / both open
  // without the disclosures fighting each other. Same one-card-at-
  // a-time semantics: opening a different card's timeline collapses
  // the previous one.
  const [timelineExpandedId, setTimelineExpandedId] = useState<string | null>(
    null,
  );
  // PR-NEXT-6.1 (closes PR-NEXT-6 §D.4) — delivery-proof disclosure.
  // Same one-card-at-a-time semantics as overrideExpandedId +
  // timelineExpandedId. DeliveryProofViewer fetches its own signed-read
  // URL on mount; collapse + re-expand re-mints (acceptable — the 15-min
  // validity means most pilot-scale interactions land within one mint).
  // Trigger row only renders when the order actually has a proof on it
  // (partners can deliver without one — photo is optional by design).
  const [proofExpandedId, setProofExpandedId] = useState<string | null>(null);
  // PR 2 — payment hardening (Phase B). Refund modal target. We track
  // the entire order rather than just the id so the modal can show
  // the amount in its title without an extra lookup.
  const [refundTarget, setRefundTarget] = useState<Order | null>(null);
  // Phase 12c: stats card. Orders-derived stats refresh whenever the
  // 10s watcher ticks; the partner count polls on its own 15s rhythm.
  const { count: onlinePartners } = useOnlineDeliveryCount(isAdmin);
  const stats = useMemo(
    () => computeAdminOrderStats(orders, Date.now()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders],
  );

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    const unsubscribe = orderService.watchAllOrders((list, err) => {
      if (err) {
        setError(err.message || 'Could not load orders. Tap Retry.');
        setOrders([]);
      } else {
        setOrders(list);
        setError(null);
      }
      // ALWAYS — see watcher contract refactor.
      setLoading(false);
      // Pull-to-refresh: clear the spinner on the first callback
      // after a refresh trigger, regardless of success/error. The
      // refreshing flag is only set by the pull-down gesture; a
      // normal poll-cycle callback finds it already false.
      setRefreshing(false);
    });
    return unsubscribe;
  }, [isAdmin, retryNonce]);

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Shop Dashboard" onBack={() => nav.goBack()} />
        <EmptyState
          title="Admin access required"
          subtitle="Your account doesn't have admin permissions."
        />
      </SafeAreaView>
    );
  }

  const handleAction = async (orderId: string, newStatus: OrderStatus) => {
    // PR 2 — payment hardening (Phase B). Cancelling a paid online
    // order is NOT a status update — it requires a Razorpay refund.
    // Intercept before the optimistic write and route to the
    // Cancel & Refund modal instead. updateOrderStatus on the server
    // also rejects this combination as a belt-and-suspenders guard.
    if (newStatus === 'cancelled') {
      const order = orders.find(o => o.id === orderId);
      if (
        order &&
        order.paymentMethod === 'online' &&
        order.paymentStatus === 'paid'
      ) {
        setRefundTarget(order);
        return;
      }
    }

    // Optimistic update: flip the chip immediately so the UI doesn't
    // wait up to 10s for the next watchAllOrders poll cycle. Capture the
    // previous list BEFORE the setOrders call so a rollback restores the
    // exact pre-optimistic state — using `prev` inside setOrders would
    // close over the already-mutated value.
    const previousOrders = orders;
    setOrders(prev =>
      prev.map(o => (o.id === orderId ? { ...o, status: newStatus } : o)),
    );
    setPending(prev => ({ ...prev, [orderId]: newStatus }));
    try {
      await orderService.updateOrderStatus({ orderId, newStatus });
      // Success: next poll (within 10s) confirms the server state.
      // No success toast — optimistic UX implies confirmation by absence
      // of an error.
    } catch (err: any) {
      // Rollback the optimistic write first.
      setOrders(previousOrders);
      // Self-healing intercept: if the server rejects this cancellation
      // because the order is paid (and our client state was stale at
      // the moment of click — there's a race window between
      // confirmPayment landing on the customer side and the next 10s
      // admin-watcher poll picking up the new paymentStatus), route
      // the admin to the Cancel & Refund modal instead of surfacing
      // the raw failed-precondition message. Server is the source of
      // truth: if it says paid, we trust it.
      const code = err?.code as string | undefined;
      const msg = (err?.message ?? '') as string;
      const looksLikePaidCancelGuard =
        (code === 'functions/failed-precondition' ||
          code === 'failed-precondition') &&
        msg.toLowerCase().includes('cancelpaidorder');
      if (newStatus === 'cancelled' && looksLikePaidCancelGuard) {
        const fresh = previousOrders.find(o => o.id === orderId);
        if (fresh) {
          setRefundTarget(fresh);
          return; // suppress the alert; modal handles the next step.
        }
      }
      const message = msg || 'Failed to update order status.';
      Alert.alert('Update failed', message);
    } finally {
      setPending(prev => ({ ...prev, [orderId]: null }));
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Shop Dashboard" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Shop Dashboard" onBack={() => nav.goBack()} />
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
        data={orders}
        keyExtractor={o => o.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              // Pull-to-refresh: bump retryNonce to force the watcher
              // useEffect to re-run, which fetches immediately on
              // mount. The spinner clears in the watcher callback.
              setRefreshing(true);
              setRetryNonce(n => n + 1);
            }}
          />
        }
        ListHeaderComponent={
          <View style={styles.statsCard}>
            <Text style={styles.statsTitle}>Today</Text>
            <View style={styles.statsRow}>
              <Stat label="GMV" value={formatRupees(stats.gmvToday)} />
              <Stat
                label="Active"
                value={String(stats.activeCount)}
                emphasize={stats.activeCount > 0}
              />
              <Stat
                label="Online partners"
                value={onlinePartners == null ? '—' : String(onlinePartners)}
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="No orders yet"
            subtitle="Orders will appear here in real time as customers place them."
          />
        }
        renderItem={({ item }) => {
          const itemCount = item.items.reduce((n, i) => n + i.quantity, 0);
          const actions = nextActionsFor(item.status);
          const pendingStatus = pending[item.id];
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shopName} numberOfLines={1}>{item.shopName}</Text>
                  <Text style={styles.orderId} numberOfLines={1}>#{item.id}</Text>
                </View>
                <OrderStatusChip
                  status={item.status}
                  pickedUpAt={item.pickedUpAt}
                  deliveredAt={item.deliveredAt}
                  audience="admin"
                />
              </View>
              <Text style={styles.time}>{formatOrderTime(item.createdAt)}</Text>
              {/* PR 12 — surface the shopkeeper-provided ETA on
                  every active card so admin sees what the customer
                  is being told. The "updated from" trail comes
                  from statusHistory: walk back through entries
                  whose status is `accepted`/`preparing` and
                  whose `reason` looks like `ETA: <ISO>`; if the
                  most recent ETA differs from the original
                  accepted-time ETA, show the change. Hidden once
                  the order is delivered or cancelled. */}
              {item.readyByEstimate &&
                item.status !== 'delivered' &&
                item.status !== 'cancelled' && (
                  <Text style={styles.eta}>
                    ⏰ Ready by {formatOrderTime(item.readyByEstimate)}
                    {(() => {
                      const original = findOriginalEta(item.statusHistory);
                      if (
                        original != null &&
                        Math.abs(original - item.readyByEstimate) > 30_000
                      ) {
                        return ` (updated from ${formatOrderTime(original)})`;
                      }
                      return '';
                    })()}
                  </Text>
                )}
              <Text style={styles.meta}>
                {itemCount} item{itemCount > 1 ? 's' : ''} · {formatRupees(item.total)}
              </Text>
              <Text style={styles.phone}>
                📞 {item.deliveryAddress?.phone || '—'}
              </Text>
              {/* PR-NEXT-6.1 — explicit "Paid via …" line so admins see
                  the authoritative settlement (cash / online up-front /
                  COD converted online) on every card, not just the
                  error-state alerts that PaymentStatusBanner handles.
                  Same helper the shop + customer order-detail screens
                  use, so all three audiences see consistent copy. */}
              <Text style={styles.paidVia}>
                Paid via{' '}
                {formatPaymentMethod({
                  paymentMethod: item.paymentMethod,
                  paidMethod: item.paidMethod,
                  paymentStatus: item.paymentStatus,
                })}
              </Text>
              <PaymentStatusBanner
                paymentStatus={item.paymentStatus}
                onRetryRefund={
                  item.paymentStatus === 'refund_failed'
                    ? () => setRefundTarget(item)
                    : undefined
                }
              />

              {/*
                Hotfix: delivery substate timeline. The macro `status`
                field only goes through pending → accepted → preparing
                → ready_for_pickup → delivered. The delivery partner's
                interim states live in `deliveryPersonId` and
                `pickedUpAt`, which the admin previously couldn't see
                — so an order would visibly jump from "Out for
                Delivery" to "Delivered" with no intermediate steps.
                Renders only when status is in the delivery window
                (ready_for_pickup or delivered).
              */}
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

              {/*
                Hotfix: action buttons hidden behind a "Manual override"
                disclosure. Default state is read-only — the order
                lifecycle is driven by shop owner and delivery partner
                roles; admin should only intervene when something is
                stuck (delivery partner ghosted, shop forgot to update,
                etc.). One card's disclosure expanded at a time; tapping
                another card collapses the first.
              */}
              {actions.length > 0 && (
                <View style={styles.overrideSection}>
                  <Pressable
                    onPress={() =>
                      setOverrideExpandedId(
                        overrideExpandedId === item.id ? null : item.id,
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={
                      overrideExpandedId === item.id
                        ? 'Hide manual override actions'
                        : 'Show manual override actions'
                    }
                    style={styles.disclosureRow}
                  >
                    <Text style={styles.disclosureText}>
                      {overrideExpandedId === item.id ? '▾' : '▸'}{'  '}
                      Manual override
                    </Text>
                  </Pressable>
                  {overrideExpandedId === item.id && (
                    <>
                      <Text style={styles.overrideHint}>
                        Use only if shop owner or delivery partner can't
                        update the order themselves.
                      </Text>
                      <View style={styles.actions}>
                        {actions.map(next => {
                          const isCancel = next === 'cancelled';
                          const isLoading = pendingStatus === next;
                          const anyPending = !!pendingStatus;
                          return (
                            <View key={next} style={styles.actionBtn}>
                              <Button
                                title={ACTION_LABELS[next]}
                                onPress={() => handleAction(item.id, next)}
                                variant={isCancel ? 'secondary' : 'primary'}
                                loading={isLoading}
                                disabled={anyPending && !isLoading}
                                style={isCancel ? styles.cancelBtn : undefined}
                              />
                            </View>
                          );
                        })}
                      </View>
                    </>
                  )}
                </View>
              )}

              {/*
                PR 11 — Full timeline disclosure. Shows every entry in
                statusHistory in insertion order (NOT sorted by `at`,
                so back-to-back same-ms writes like cancel +
                refund_pending land in the order the server wrote
                them). Step count in the label gives admin a hint
                without expanding. Independent of overrideExpandedId.
              */}
              <View style={styles.timelineSection}>
                <Pressable
                  onPress={() =>
                    setTimelineExpandedId(
                      timelineExpandedId === item.id ? null : item.id,
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel={
                    timelineExpandedId === item.id
                      ? 'Hide full order timeline'
                      : 'Show full order timeline'
                  }
                  style={styles.disclosureRow}
                >
                  <Text style={styles.disclosureText}>
                    {timelineExpandedId === item.id ? '▾' : '▸'}{'  '}
                    Full timeline ({item.statusHistory?.length ?? 0} steps)
                  </Text>
                </Pressable>
                {timelineExpandedId === item.id && (
                  <OrderTimeline entries={item.statusHistory ?? []} />
                )}
              </View>

              {/* PR-NEXT-6.1 — Delivery proof disclosure. Only show the
                  trigger when the order actually has a proof stamped;
                  partners can deliver without one (photo is optional in
                  PR-NEXT-6 by design) and we don't want a dead
                  disclosure row on those cards. Auth + signed-read URL
                  handled inside DeliveryProofViewer. Independent of
                  override + timeline disclosures so an admin can keep
                  the timeline open while reviewing the photo — exactly
                  the cross-reference flow dispute resolution needs. */}
              {item.deliveryProofStoragePath && (
                <View style={styles.proofSection}>
                  <Pressable
                    onPress={() =>
                      setProofExpandedId(
                        proofExpandedId === item.id ? null : item.id,
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={
                      proofExpandedId === item.id
                        ? 'Hide delivery proof photo'
                        : 'Show delivery proof photo'
                    }
                    style={styles.disclosureRow}
                  >
                    <Text style={styles.disclosureText}>
                      {proofExpandedId === item.id ? '▾' : '▸'}{'  '}
                      📸 Delivery proof
                    </Text>
                  </Pressable>
                  {proofExpandedId === item.id && (
                    <DeliveryProofViewer
                      orderId={item.id}
                      hasProof={!!item.deliveryProofStoragePath}
                    />
                  )}
                </View>
              )}
            </View>
          );
        }}
      />
      {refundTarget ? (
        <CancelAndRefundModal
          visible={!!refundTarget}
          orderId={refundTarget.id}
          orderTotal={refundTarget.total}
          onClose={() => setRefundTarget(null)}
          onDone={() => {
            // Server has flipped status → cancelled + paymentStatus →
            // refunded (or refund_failed on Razorpay error). The next
            // watchAllOrders tick (within 10s) will reflect it; the
            // banner above the card surfaces refund_failed if so.
            setRefundTarget(null);
          }}
        />
      ) : null}
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
  shopName: { ...typography.h3 },
  orderId: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  time: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  // PR 12 — Ready-by ETA line. Slightly emphasised so admin sees
  // it without scanning past the placed-time line.
  eta: {
    ...typography.caption,
    color: colors.primaryDark,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  meta: { ...typography.body, marginTop: spacing.xs },
  phone: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  // PR-NEXT-6.1 — "Paid via …" line. Same visual weight as the phone
  // row so the two meta lines stack as a single block.
  paidVia: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionBtn: { flexGrow: 1, minWidth: 140 },
  cancelBtn: { backgroundColor: '#fde2e2' },
  // Hotfix: delivery substate timeline + manual-override disclosure.
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
  // PR 11 — Full timeline disclosure section. Same visual treatment
  // as overrideSection so the two disclosures stack consistently.
  timelineSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  overrideSection: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  // PR-NEXT-6.1 — mirrors timelineSection so the three disclosures
  // (override / timeline / proof) stack with consistent rules.
  proofSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  disclosureRow: {
    paddingVertical: spacing.xs,
  },
  disclosureText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  overrideHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: 2,
    marginBottom: spacing.sm,
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
