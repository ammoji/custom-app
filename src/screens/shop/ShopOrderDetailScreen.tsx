import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useState } from 'react';
import {
    Alert,
    Image,
    Linking,
    Modal,
    TextInput,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import Loader from '../../components/common/Loader';
import ScreenHeader from '../../components/common/ScreenHeader';
import OrderStatusChip from '../../components/order/OrderStatusChip';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { useAuthStore } from '../../store/useAuthStore';
import { formatOrderTime, formatRupees } from '../../utils/format';
import {
    ACTION_LABELS,
    nextActionsFor,
    OrderStatus,
} from '../../utils/orderStateMachine';
import { useShopOrderDetail } from './ShopOrderDetailScreen.useShopOrderDetail';

/**
 * Per-order detail screen for shop owners. Mirrors the customer
 * OrderDetailScreen layout but adds:
 *   - tap-to-call on the customer's phone number (the most-used
 *     fulfilment action: "are you home?", "which floor?", "is the
 *     gate open?")
 *   - the same action buttons as the dashboard card so the owner
 *     can advance the order without going back
 *
 * Removes (vs. customer OrderDetailScreen):
 *   - Cancel order — that's a customer/admin action
 *   - Retry payment — customer-only flow
 *
 * Data + state machine live in
 * `./ShopOrderDetailScreen.useShopOrderDetail.ts`. The screen is a
 * thin presenter so the watcher contract + revert behaviour can be
 * unit-tested without RNTL.
 */

// Same allow-list as the dashboard. Kept in sync intentionally —
// extracting to a shared module would hide the cross-screen
// coupling we want reviewers to notice.
const SHOP_OWNER_ALLOWED_ACTIONS: OrderStatus[] = [
  'accepted',
  'preparing',
  'ready_for_pickup',
];

export default function ShopOrderDetailScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const orderId: string = route.params.orderId;

  const isShopOwner = useAuthStore(s => s.isShopOwner);
  const ownedShopId = useAuthStore(s => s.shopId);

  const {
    order,
    loading,
    error,
    pendingStatus,
    handleAction,
    retry,
  } = useShopOrderDetail(orderId);

  // PR 12 — ETA prompt state. MUST be declared HERE (before any
  // conditional early returns below) because React's Rules of Hooks
  // require the same hook call order on every render. Previously this
  // useState was declared after the early returns at the bottom,
  // which crashed the screen the moment `order` transitioned from
  // null → loaded (the render path suddenly had +1 hook compared to
  // the loading render). Captured in Sentry as a ShopOrderDetailScreen
  // throw on first data load. Fixed in PR 12 hotfix.
  //
  // `etaPrompt.action` is the OrderStatus we'll dispatch to once the
  // user confirms the minutes input.
  const [etaPrompt, setEtaPrompt] = useState<{
    action: OrderStatus;
    minutes: string;
  } | null>(null);

  // Role guard: if the caller isn't a shop owner at all, the
  // navigation entry point shouldn't have been visible — but in
  // case of a stale stack or a deep-link, fall through cleanly.
  //
  // We DO NOT cross-check `order.shopId !== ownedShopId` here.
  // The dashboard already filters by shopId server-side, and the
  // Firestore rules independently reject reads from non-owners.
  // An extra UI guard here was producing false negatives for real
  // orders whenever the auth claim's shopId drifted from the
  // order's shopId field (stale claim after a re-grant, token
  // refresh race, etc.) — Sudhir hit this on his own placed-then-
  // owned order. Trust the dashboard + rules; if the watcher
  // genuinely can't read, the error banner shows.
  if (!isShopOwner || !ownedShopId) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Order" onBack={() => nav.goBack()} />
        <EmptyState
          title="Shop owner access required"
          subtitle="Your account isn't registered as a shop owner."
        />
      </SafeAreaView>
    );
  }

  if (loading && !order) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Order" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Order" onBack={() => nav.goBack()} />
        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              onPress={retry}
              style={styles.retryBtn}
              accessibilityRole="button"
              accessibilityLabel="Retry loading order"
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <EmptyState
            title="Order not found"
            subtitle="It may have been cleared or moved."
          />
        )}
      </SafeAreaView>
    );
  }

  const minutesLeft = Math.max(
    0,
    Math.round((order.estimatedDeliveryAt - Date.now()) / 60_000),
  );
  const itemCount = order.items.reduce((n, i) => n + i.quantity, 0);
  const actions = nextActionsFor(order.status).filter(s =>
    SHOP_OWNER_ALLOWED_ACTIONS.includes(s),
  );

  // (etaPrompt state was moved to the top of the component to satisfy
  // Rules of Hooks — see comment near useShopOrderDetail above.)

  const ETA_REQUIRED: OrderStatus[] = ['accepted'];
  const ETA_OPTIONAL: OrderStatus[] = ['preparing'];

  const onActionPress = async (newStatus: OrderStatus) => {
    // Accept transition: mandatory ETA. Open prompt instead of
    // dispatching directly.
    if (ETA_REQUIRED.includes(newStatus)) {
      setEtaPrompt({ action: newStatus, minutes: '20' });
      return;
    }
    // Preparing transition: open the prompt with the existing ETA
    // pre-filled (so the shop can keep it OR update). Pre-fill
    // computed from order.readyByEstimate when present, else 20.
    if (ETA_OPTIONAL.includes(newStatus)) {
      const remaining = order.readyByEstimate
        ? Math.max(
            1,
            Math.round((order.readyByEstimate - Date.now()) / 60_000),
          )
        : 20;
      setEtaPrompt({ action: newStatus, minutes: String(remaining) });
      return;
    }
    const result = await handleAction(newStatus);
    if (!result.ok) {
      Alert.alert('Update failed', result.error);
    }
  };

  const onConfirmEta = async () => {
    if (!etaPrompt) return;
    const n = parseInt(etaPrompt.minutes, 10);
    if (!Number.isFinite(n) || n < 1 || n > 240) {
      Alert.alert(
        'Invalid ETA',
        'Enter a number of minutes between 1 and 240.',
      );
      return;
    }
    const readyByEstimate = Date.now() + n * 60_000;
    const action = etaPrompt.action;
    setEtaPrompt(null);
    const result = await handleAction(action, readyByEstimate);
    if (!result.ok) {
      Alert.alert('Update failed', result.error);
    }
  };

  const onCallCustomer = () => {
    const phone = order.deliveryAddress?.phone;
    if (!phone) return;
    const url = `tel:${phone}`;
    // Web has no useful tel: handler; only attempt on native to
    // avoid a "no app to handle this" toast on the web preview.
    if (Platform.OS === 'web') {
      Linking.openURL(url).catch(() => {
        /* ignore — desktop browsers without softphones do nothing */
      });
      return;
    }
    Linking.openURL(url).catch(err => {
      Alert.alert(
        'Could not place call',
        err?.message || 'Your device does not support phone calls.',
      );
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Order details" onBack={() => nav.goBack()} />
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            onPress={retry}
            style={styles.retryBtn}
            accessibilityRole="button"
            accessibilityLabel="Retry loading order"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.content}>
        {/* Status header */}
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <OrderStatusChip
              status={order.status}
              pickedUpAt={order.pickedUpAt}
              deliveredAt={order.deliveredAt}
              audience="shopkeeper"
            />
            <Text style={styles.orderId}>#{order.id}</Text>
          </View>
          <Text style={styles.placedAt}>
            Placed {formatOrderTime(order.createdAt)}
          </Text>
          {order.status !== 'delivered' &&
            order.status !== 'cancelled' &&
            minutesLeft > 0 && (
              <Text style={styles.eta}>ETA ~{minutesLeft} min</Text>
            )}
        </View>

        {/* Customer */}
        <Text style={styles.sectionTitle}>Customer</Text>
        <View style={styles.card}>
          <Text style={typography.bodyBold}>{order.deliveryAddress.name}</Text>
          <Pressable
            onPress={onCallCustomer}
            style={styles.callRow}
            accessibilityRole="button"
            accessibilityLabel={`Call customer at ${order.deliveryAddress.phone}`}
          >
            <Text style={styles.callText}>
              📞 {order.deliveryAddress.phone}
            </Text>
            <Text style={styles.callHint}>Tap to call</Text>
          </Pressable>
        </View>

        {/* Delivery address */}
        <Text style={styles.sectionTitle}>Delivery address</Text>
        <View style={styles.card}>
          <Text style={styles.addressLine}>{order.deliveryAddress.line1}</Text>
          {!!order.deliveryAddress.line2 && (
            <Text style={styles.addressLine}>
              {order.deliveryAddress.line2}
            </Text>
          )}
          <Text style={styles.addressLine}>
            {order.deliveryAddress.city} - {order.deliveryAddress.pincode}
          </Text>
        </View>

        {/* PR 22 — customer-supplied delivery instructions (e.g.
            "Ring second bell", "Gate locked after 9 PM"). Renders
            above items + substitution preference so the shop owner
            can read the access details while picking — and so the
            delivery partner sees them after pickup. Silently
            omitted when no instructions were given. */}
        {order.deliveryAddress.deliveryInstructions && (
          <View style={styles.dropInstructionsCard}>
            <Text style={styles.dropInstructionsLabel}>
              📝 Delivery instructions
            </Text>
            <Text style={styles.dropInstructionsValue}>
              {order.deliveryAddress.deliveryInstructions}
            </Text>
          </View>
        )}

        {/* PR 21 — customer's substitution preference. Rendered
            BEFORE items because it dictates how the shop handles an
            unavailable line item. Legacy orders (missing field)
            render the 'call_me' default explicitly — the safest
            assumption when we don't know the customer's intent. */}
        <View style={styles.customerPrefCard}>
          <Text style={styles.customerPrefLabel}>
            Customer&apos;s preference
          </Text>
          <Text style={styles.customerPrefValue}>
            {!order.substitutionPreference ||
            order.substitutionPreference === 'call_me'
              ? '📞 Call before substituting or refunding'
              : order.substitutionPreference === 'auto'
                ? '🔄 Replace with similar items (shop picks)'
                : '💰 Refund unavailable items — skip and adjust total'}
          </Text>
        </View>

        {/* Items — the section that motivated this PR */}
        <Text style={styles.sectionTitle}>
          Items ({itemCount})
        </Text>
        <View style={styles.card}>
          {order.items.map((it, idx) => (
            <View
              key={it.productId}
              style={[styles.itemRow, idx !== 0 && styles.itemDivider]}
            >
              {!!it.imageUrl && (
                <Image source={{ uri: it.imageUrl }} style={styles.itemImage} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={typography.body} numberOfLines={2}>
                  {it.name}
                </Text>
                {!!it.packLabel && (
                  <Text style={styles.itemMeta}>
                    {it.packLabel} · × {it.quantity}
                  </Text>
                )}
                {!it.packLabel && (
                  <Text style={styles.itemMeta}>× {it.quantity}</Text>
                )}
              </View>
              <Text style={typography.bodyBold}>
                {formatRupees(it.price * it.quantity)}
              </Text>
            </View>
          ))}
        </View>

        {/* Bill summary */}
        <Text style={styles.sectionTitle}>Bill</Text>
        <View style={styles.card}>
          <Row label="Subtotal" value={formatRupees(order.subtotal)} />
          <Row label="Delivery fee" value={formatRupees(order.deliveryFee)} />
          <View style={styles.divider} />
          <Row label="Total" value={formatRupees(order.total)} bold />
        </View>

        {/* Payment */}
        <Text style={styles.sectionTitle}>Payment</Text>
        <View style={styles.card}>
          <Row
            label="Method"
            value={
              order.paymentMethod === 'online'
                ? 'Online (Razorpay)'
                : 'Cash on Delivery'
            }
          />
          {order.paymentMethod === 'online' && (
            <Row
              label="Status"
              value={
                order.paymentStatus === 'paid'
                  ? 'Paid ✓'
                  : order.paymentStatus === 'failed'
                    ? 'Failed'
                    : order.paymentStatus === 'expired'
                      ? 'Expired'
                      : 'Processing…'
              }
              valueColor={
                order.paymentStatus === 'paid'
                  ? colors.success
                  : order.paymentStatus === 'failed' ||
                      order.paymentStatus === 'expired'
                    ? colors.danger
                    : colors.textSecondary
              }
            />
          )}
        </View>

        {/* PR 12 — surface the current ETA so the shop knows what
            the customer is seeing before tapping any action. */}
        {order.readyByEstimate && order.status !== 'delivered' &&
          order.status !== 'cancelled' && (
          <View style={styles.etaCard}>
            <Text style={styles.etaLabel}>Ready by</Text>
            <Text style={styles.etaValue}>
              {formatOrderTime(order.readyByEstimate)}
            </Text>
          </View>
        )}

        {/* Action buttons */}
        {actions.length > 0 && (
          <View style={styles.actionsRow}>
            {actions.map(next => {
              const isLoading = pendingStatus === next;
              const anyPending = !!pendingStatus;
              return (
                <View key={next} style={styles.actionBtn}>
                  <Button
                    title={ACTION_LABELS[next]}
                    onPress={() => onActionPress(next)}
                    loading={isLoading}
                    disabled={anyPending && !isLoading}
                    fullWidth
                  />
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* PR 12 — ETA prompt modal. Opens when the shopkeeper taps
          Accept (mandatory) or Start Preparing (optional update).
          Validates 1–240 minutes; on confirm, dispatches
          handleAction with readyByEstimate = now + minutes * 60_000.
          Option A from the prompt: simple numeric input. Track
          quick-pick chips (Option B) as a follow-up if shops ask. */}
      <Modal
        visible={!!etaPrompt}
        transparent
        animationType="fade"
        onRequestClose={() => setEtaPrompt(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {etaPrompt?.action === 'accepted'
                ? 'Accept order'
                : 'Update ETA'}
            </Text>
            <Text style={styles.modalBody}>
              How many minutes until this order is ready for pickup?
            </Text>
            <View style={styles.modalInputRow}>
              <Text style={styles.modalInputPrefix}>Ready in</Text>
              <TextInput
                value={etaPrompt?.minutes ?? ''}
                onChangeText={v =>
                  setEtaPrompt(prev =>
                    prev ? { ...prev, minutes: v.replace(/\D/g, '').slice(0, 3) } : prev,
                  )
                }
                keyboardType="number-pad"
                style={styles.modalInput}
                accessibilityLabel="Minutes until ready"
                autoFocus
              />
              <Text style={styles.modalInputSuffix}>min</Text>
            </View>
            <View style={styles.modalActions}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Cancel"
                  variant="secondary"
                  onPress={() => setEtaPrompt(null)}
                  fullWidth
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Button
                  title={
                    etaPrompt?.action === 'accepted'
                      ? 'Accept'
                      : 'Start preparing'
                  }
                  onPress={onConfirmEta}
                  fullWidth
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  bold,
  valueColor,
}: {
  label: string;
  value: string;
  bold?: boolean;
  valueColor?: string;
}) {
  return (
    <View style={styles.row}>
      <Text
        style={
          bold
            ? typography.bodyBold
            : [typography.body, { color: colors.textSecondary }]
        }
      >
        {label}
      </Text>
      <Text
        style={[
          bold ? typography.bodyBold : typography.body,
          valueColor ? { color: valueColor } : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  statusCard: {
    backgroundColor: colors.primaryLight,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  orderId: { ...typography.caption, color: colors.textSecondary },
  placedAt: { ...typography.caption, marginTop: spacing.sm },
  eta: {
    ...typography.bodyBold,
    color: colors.primaryDark,
    marginTop: spacing.xs,
  },
  sectionTitle: { ...typography.h3, marginTop: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  callRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  callText: { ...typography.bodyBold, color: colors.primary },
  callHint: { ...typography.caption, color: colors.textSecondary },
  addressLine: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  itemDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  itemImage: {
    width: 48,
    height: 48,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
  },
  itemMeta: { ...typography.caption, marginTop: 2 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionBtn: { flexGrow: 1, minWidth: 140 },
  // PR 12 — ETA card + modal styles.
  etaCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.primaryLight,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  etaLabel: { ...typography.caption, color: colors.primaryDark },
  etaValue: { ...typography.bodyBold, color: colors.primaryDark },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  modalTitle: { ...typography.h2, marginBottom: spacing.sm },
  modalBody: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  modalInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  modalInputPrefix: { ...typography.body },
  modalInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    textAlign: 'center',
  },
  modalInputSuffix: { ...typography.body, color: colors.textSecondary },
  modalActions: {
    flexDirection: 'row',
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
  // PR 21 — shop-side substitution preference card. Tinted +
  // accent-bordered so the shop owner can't miss it before they
  // start fulfilling the order. Stronger visual treatment than the
  // customer-side confirmation card by design — for the shop this
  // is actionable; for the customer it's just a receipt.
  customerPrefCard: {
    backgroundColor: colors.primaryLight,
    borderRadius: radii.md,
    padding: spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    marginTop: spacing.md,
  },
  customerPrefLabel: {
    ...typography.caption,
    color: colors.primaryDark,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  customerPrefValue: {
    ...typography.bodyBold,
    color: colors.primaryDark,
  },
  // PR 22 — soft-yellow tinted card. Different hue from the
  // primary-tinted substitution-preference card so the shop owner
  // can visually distinguish the two information types at a glance.
  dropInstructionsCard: {
    backgroundColor: '#FEF9E7',
    borderRadius: radii.md,
    padding: spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: '#F4D03F',
    marginTop: spacing.md,
  },
  dropInstructionsLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  dropInstructionsValue: {
    ...typography.body,
    color: colors.textPrimary,
  },
});
