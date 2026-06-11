import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import React, { useState } from 'react';
import {
    Alert,
    Linking,
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
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { useAuthStore } from '../../store/useAuthStore';
import { formatOrderTime, formatRupees } from '../../utils/format';
// PR-NEXT-COD-UX (Case 8) — DO NOT REMOVE. Hides the Delivered
// CTA when the server's COD gate would reject it, so the partner
// never gets the dead-tap-then-error UX. Mirror of the server's
// `validateMarkDeliveredCodGate`; same matrix as the dashboard
// card's `needsCodConfirmation` derivation.
import { canShowDeliveredButton } from '../../utils/codDeliveryGate';
import { useDeliveryOrderDetail } from './DeliveryOrderDetailScreen.useDeliveryOrderDetail';
// PR-NEXT-5.1 §B — DO NOT REMOVE. Respond-to-review banner + modal for partners.
import ResponseModal from '../../components/order/ResponseModal';
import { orderService } from '../../services/orderService';

/**
 * Full delivery view of a single order. Reuses watchOrder for live
 * status changes (poll on native, snapshot on web). Three action
 * paths:
 *
 *   1. Available-for-claim   → "Accept this pickup" button (the
 *                              v2-iv-followup addition — without it
 *                              partners had to claim from the
 *                              dashboard with no item visibility).
 *   2. Assigned, not delivered → "I've picked it up" → "Delivered"
 *      (existing — same flow as the dashboard's ActiveDeliveryCard).
 *   3. Delivered             → green "Delivered" card, no actions.
 *
 * State machine + derived flags live in
 * `./DeliveryOrderDetailScreen.useDeliveryOrderDetail.ts`. Screen
 * stays a thin presenter so the watcher contract + claim race +
 * action revert can be unit-tested without RNTL.
 */
export default function DeliveryOrderDetailScreen() {
  const nav = useNavigation<any>();
  const route =
    useRoute<RouteProp<RootStackParamList, 'DeliveryOrderDetail'>>();
  const { orderId } = route.params;
  const uid = useAuthStore(s => s.uid);
  const isDelivery = useAuthStore(s => s.isDelivery);

  const {
    order,
    loading,
    error,
    isAssigned,
    isAvailableForClaim,
    isComingSoon,
    isPickedUp,
    isDelivered,
    isTerminalForOthers,
    pendingAction,
    handleClaim,
    handlePickedUp,
    handleDelivered,
    handleConfirmCodPayment,
    retry,
  } = useDeliveryOrderDetail(orderId, uid, !!isDelivery);

  // PR-NEXT-5.1 §B — review response state (declared before early returns).
  const [respondModalOpen, setRespondModalOpen] = useState(false);
  const [responseSubmitting, setResponseSubmitting] = useState(false);

  const openMaps = (query: string) => {
    const url = `https://maps.google.com/?q=${encodeURIComponent(query)}`;
    Linking.openURL(url).catch(() =>
      Alert.alert('Could not open Maps', 'Please copy the address manually.'),
    );
  };

  const callPhone = (phone: string) => {
    const url = `tel:${phone}`;
    Linking.openURL(url).catch(() =>
      Alert.alert('Could not place call', `Number: ${phone}`),
    );
  };

  const onClaim = async () => {
    const result = await handleClaim();
    if (!result.ok) {
      Alert.alert('Already taken', result.error);
      return;
    }
    // Navigate back to the dashboard so the new card appears in
    // "My Active Deliveries" via the post-claim listMyDeliveries
    // refresh path. (Dashboard owns that refresh; the detail
    // screen's watcher would also update, but going back is the
    // expected UX after a successful claim.)
    nav.goBack();
  };

  const onPickedUp = async () => {
    const result = await handlePickedUp();
    if (!result.ok) Alert.alert('Update failed', result.error);
  };

  const onDelivered = async () => {
    const result = await handleDelivered();
    if (!result.ok) Alert.alert('Update failed', result.error);
  };

  // PR-NEXT-COD-UX (Case 8) — Cash/UPI pill handler. Surfaces the
  // friendly "customer paid online" alert for the same `alreadyPaid`
  // race the dashboard's `handleConfirmCodPayment` already handles
  // (a parallel `payCodOrder` conversion landing between the
  // optimistic flip and the server response).
  const onConfirmCodPayment = async (paidMethod: 'cash' | 'online') => {
    const result = await handleConfirmCodPayment(paidMethod);
    if (!result.ok) {
      Alert.alert('Could not confirm payment', result.error);
      return;
    }
    if (result.alreadyPaid) {
      Alert.alert(
        'Customer paid online',
        'No cash to collect — the customer paid online while you were on the way.',
      );
    }
  };

  if (!isDelivery) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Delivery" onBack={() => nav.goBack()} />
        <EmptyState
          title="Delivery role required"
          subtitle="Register as a delivery partner first."
        />
      </SafeAreaView>
    );
  }

  if (loading && !order) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Delivery" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Delivery" onBack={() => nav.goBack()} />
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
            subtitle="It may have been cancelled or completed."
          />
        )}
      </SafeAreaView>
    );
  }

  // Terminal state for non-owners: claimed by someone else, OR
  // already delivered. Render an EmptyState instead of leaving
  // dead buttons that would error server-side anyway.
  if (isTerminalForOthers && isDelivered) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Pickup details" onBack={() => nav.goBack()} />
        <EmptyState
          title="Order already delivered"
          subtitle="This pickup is no longer available."
        />
      </SafeAreaView>
    );
  }
  if (isTerminalForOthers && !isDelivered) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Pickup details" onBack={() => nav.goBack()} />
        <EmptyState
          title="Already taken"
          subtitle="Another partner claimed this pickup. Check the dashboard for new ones."
        />
      </SafeAreaView>
    );
  }

  const itemCount = order.items.reduce((n, i) => n + i.quantity, 0);
  const headerTitle =
    isAvailableForClaim || isComingSoon ? 'Pickup details' : 'Delivery';
  // PR 23 — coming-soon banner copy. We surface the shop's state
  // verbatim so the partner can read intent ("the shop just
  // accepted" vs "the shop is preparing"); the ETA line below
  // adds time-to-ready when the shopkeeper has set one.
  const comingSoonState =
    order.status === 'preparing' ? 'preparing your order' : 'just accepted';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={headerTitle} onBack={() => nav.goBack()} />
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
        {/* PR 23 — coming-soon banner. Surfaced above every other
            card so a partner who tapped a HeadsUpCard on the
            dashboard immediately understands why there's no Accept
            button below: the shop hasn't signalled ready yet. Before
            PR 23 this state rendered as "Already taken" — see the
            useDeliveryOrderDetail hook's deriveDeliveryFlags. */}
        {isComingSoon && (
          <View style={styles.comingSoonCard}>
            <Text style={styles.comingSoonTitle}>⏳ Not yet ready for pickup</Text>
            <Text style={styles.comingSoonBody}>
              The shop is {comingSoonState}. You'll be able to accept this
              pickup as soon as the shop marks it ready.
            </Text>
            {order.readyByEstimate ? (
              <Text style={styles.comingSoonEta}>
                Ready by {formatOrderTime(order.readyByEstimate)}
              </Text>
            ) : null}
          </View>
        )}
        <View style={styles.card}>
          <Text style={styles.label}>Pickup from</Text>
          <Text style={styles.value}>{order.shopName}</Text>
          <Pressable onPress={() => openMaps(order.shopName)}>
            <Text style={styles.link}>📍 Directions to shop</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Deliver to</Text>
          <Text style={styles.value}>{order.deliveryAddress.name}</Text>
          {/* Phone is hidden until the partner has actually claimed
              the order — protects customer privacy from any
              delivery person merely browsing available pickups.
              Address line 1 + city + pincode are still shown so the
              partner can decide whether the area is in their range. */}
          {isAssigned && (
            <Pressable onPress={() => callPhone(order.deliveryAddress.phone)}>
              <Text style={styles.link}>📞 {order.deliveryAddress.phone}</Text>
            </Pressable>
          )}
          <Text style={styles.address}>
            {order.deliveryAddress.line1}
            {order.deliveryAddress.line2
              ? `, ${order.deliveryAddress.line2}`
              : ''}
            {'\n'}
            {order.deliveryAddress.city} {order.deliveryAddress.pincode}
          </Text>
          <Pressable
            onPress={() =>
              openMaps(
                [
                  order.deliveryAddress.line1,
                  order.deliveryAddress.line2,
                  order.deliveryAddress.city,
                  order.deliveryAddress.pincode,
                ]
                  .filter(Boolean)
                  .join(', '),
              )
            }
          >
            <Text style={styles.link}>📍 Directions to customer</Text>
          </Pressable>
        </View>

        {/* PR 22 — delivery instructions card. Most actionable
            surface in the app for this field — the delivery partner
            is the one ringing the bell / finding the door. Yellow-
            tinted with a left accent so it's impossible to miss on
            arrival. Silently omitted on legacy orders. */}
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

        <View style={styles.card}>
          <Text style={styles.label}>Items ({itemCount})</Text>
          {order.items.map(it => (
            <View key={it.productId} style={styles.itemRow}>
              <Text style={styles.itemName} numberOfLines={2}>
                {it.name}
              </Text>
              <Text style={styles.itemQty}>×{it.quantity}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatRupees(order.total)}</Text>
          </View>
          <Text style={styles.payHint}>
            {order.paymentMethod === 'online'
              ? 'Already paid online — no collection.'
              : `Collect ${formatRupees(order.total)} cash on delivery.`}
          </Text>
        </View>

        {Array.isArray(order.statusHistory) && order.statusHistory.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.label}>Timeline</Text>
            {order.statusHistory.map((h: any, idx: number) => (
              <View key={`${h.status}-${h.at}-${idx}`} style={styles.timelineRow}>
                <Text style={styles.timelineStatus}>{h.status}</Text>
                <Text style={styles.timelineTime}>{formatOrderTime(h.at)}</Text>
              </View>
            ))}
          </View>
        )}

        {isAvailableForClaim && (
          <View style={{ marginTop: spacing.md }}>
            <Button
              title={
                pendingAction === 'claim' ? 'Claiming…' : 'Accept this pickup'
              }
              onPress={onClaim}
              loading={pendingAction === 'claim'}
              disabled={pendingAction !== null}
              size="lg"
            />
          </View>
        )}

        {isAssigned && !isDelivered && (
          <View style={{ marginTop: spacing.md }}>
            {/* PR-NEXT-COD-UX (Case 8) — three-way action ladder
                mirrors the dashboard's `ActiveDeliveryCard`:
                  1. Pre-pickup            → "I've picked it up"
                  2. Picked up + COD-unpaid → Cash / UPI pills
                  3. Picked up + paid       → "Delivered"
                The gate is `canShowDeliveredButton(order)` — same
                matrix as the server's `validateMarkDeliveredCodGate`,
                so the partner never sees the dead-tap-then-error UX
                Sudhir reported. */}
            {!isPickedUp ? (
              <Button
                title="I've picked it up"
                onPress={onPickedUp}
                loading={pendingAction === 'pickedUp'}
                disabled={pendingAction !== null}
                size="lg"
              />
            ) : canShowDeliveredButton(order) ? (
              // PR-NEXT-BUNDLE-B §C — DO NOT REMOVE. Proof required.
              // Hint appears above the disabled button; disappears
              // once the proof is uploaded via the dashboard flow.
              <>
                {!order.deliveryProofStoragePath && (
                  <Text style={styles.proofHint}>
                    📷 Upload delivery proof first
                  </Text>
                )}
                <Button
                  title="Delivered"
                  onPress={onDelivered}
                  loading={pendingAction === 'delivered'}
                  disabled={pendingAction !== null || !order.deliveryProofStoragePath}
                  size="lg"
                />
              </>
            ) : (
              // COD unpaid — show the same Cash/UPI selector as
              // the dashboard. Visually mirrors `codConfirmLabel /
              // codConfirmSub / codPillRow / codPill` from
              // `DeliveryDashboardScreen` so the partner reads the
              // same affordance on either surface.
              <View>
                <Text style={styles.codConfirmLabel}>
                  Payment: Cash on Delivery — {formatRupees(order.total)}
                </Text>
                <Text style={styles.codConfirmSub}>
                  Confirm payment received:
                </Text>
                <View style={styles.codPillRow}>
                  <Pressable
                    style={[
                      styles.codPill,
                      pendingAction !== null && styles.codPillDisabled,
                    ]}
                    onPress={() => onConfirmCodPayment('cash')}
                    disabled={pendingAction !== null}
                    accessibilityRole="button"
                    accessibilityLabel="Mark cash received"
                  >
                    <Text style={styles.codPillText}>💵 Cash received</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.codPill,
                      pendingAction !== null && styles.codPillDisabled,
                    ]}
                    onPress={() => onConfirmCodPayment('online')}
                    disabled={pendingAction !== null}
                    accessibilityRole="button"
                    accessibilityLabel="Mark UPI received"
                  >
                    <Text style={styles.codPillText}>📱 UPI received</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        )}

        {isAssigned && isDelivered && (
          <View style={[styles.card, styles.doneCard]}>
            <Text style={styles.doneText}>✅ Delivered</Text>
          </View>
        )}

        {/* PR-NEXT-5.1 §B — delivery partner low-rating banner. */}
        {(order.correctionState === 'flagged_low' ||
          order.correctionState === 'responded') && (
          <View style={styles.reviewBanner}>
            <Text style={styles.reviewBannerTitle}>
              ⚠️ Customer rated delivery {order.deliveryRating ?? '?'}★
            </Text>
            {!!order.deliveryComment && (
              <Text style={styles.reviewBannerComment}>
                "{order.deliveryComment}"
              </Text>
            )}
            {order.correctionState === 'flagged_low' && (
              <Pressable
                onPress={() => setRespondModalOpen(true)}
                style={styles.respondBtn}
                accessibilityRole="button"
                accessibilityLabel="Respond to review"
                disabled={responseSubmitting}
              >
                <Text style={styles.respondBtnText}>
                  📝 Respond to review
                </Text>
              </Pressable>
            )}
            {order.correctionState === 'responded' && (
              <>
                <Text style={styles.reviewResponseLabel}>Your response:</Text>
                <Text style={styles.reviewResponseText}>{order.responseText}</Text>
                <Text style={styles.reviewWaiting}>
                  Waiting on customer to acknowledge or amend
                  {order.responseAt
                    ? ` · ${Math.max(0, 7 - Math.floor((Date.now() - order.responseAt) / 86400000))} days left`
                    : ''}
                  .
                </Text>
              </>
            )}
          </View>
        )}
        {order.correctionState === 'published' && !!order.deliveryRating && (
          <View style={[styles.reviewBanner, styles.reviewBannerDone]}>
            <Text style={styles.reviewBannerTitle}>
              ✅ Review published — {order.deliveryRating}★
              {order.responseText ? ' with your response' : ''}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* PR-NEXT-5.1 §B — review response modal for delivery partners. */}
      <ResponseModal
        visible={respondModalOpen}
        onClose={() => setRespondModalOpen(false)}
        stars={order.deliveryRating ?? 1}
        comment={order.deliveryComment ?? null}
        responseBy="partner"
        onSubmit={async (responseText) => {
          if (!order.ratingId) return;
          setResponseSubmitting(true);
          try {
            await orderService.respondToReview({
              ratingId: order.ratingId,
              responseText,
            });
            setRespondModalOpen(false);
          } catch (e: any) {
            throw e;
          } finally {
            setResponseSubmitting(false);
          }
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.md,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  value: { ...typography.h3 },
  link: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  address: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    gap: spacing.md,
  },
  itemName: { ...typography.body, flex: 1 },
  itemQty: { ...typography.bodyBold },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalLabel: { ...typography.bodyBold },
  totalValue: { ...typography.h3 },
  payHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
  timelineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  timelineStatus: { ...typography.body, textTransform: 'capitalize' },
  timelineTime: { ...typography.caption, color: colors.textSecondary },
  doneCard: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  doneText: {
    ...typography.h2,
    color: colors.primaryDark,
    textAlign: 'center',
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
  // PR 23 — coming-soon banner. Same yellow family as the
  // dashboard HeadsUpCard / dropInstructionsCard so a partner
  // reads the visual language as "informational, not actionable
  // yet".
  comingSoonCard: {
    backgroundColor: '#FEF9E7',
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#F4D03F',
    marginBottom: spacing.md,
  },
  comingSoonTitle: {
    ...typography.h3,
    color: colors.primaryDark,
    marginBottom: spacing.xs,
  },
  comingSoonBody: {
    ...typography.body,
    color: colors.textPrimary,
  },
  comingSoonEta: {
    ...typography.bodyBold,
    color: colors.primaryDark,
    marginTop: spacing.sm,
  },
  // PR 22 — yellow-tinted instructions card. Same visual language
  // as the shop's display so the field reads as "the same data" to
  // anyone seeing both screens.
  dropInstructionsCard: {
    backgroundColor: '#FEF9E7',
    borderRadius: radii.md,
    padding: spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: '#F4D03F',
    marginBottom: spacing.md,
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
  // PR-NEXT-COD-UX (Case 8) — COD payment selector. Visual tokens
  // mirror the dashboard's `ActiveDeliveryCard` (same names from
  // `DeliveryDashboardScreen.tsx`: `codConfirmLabel` / `codConfirmSub`
  // / `codPillRow` / `codPill` / `codPillDisabled` / `codPillText`)
  // so the partner reads the same affordance on either surface.
  codConfirmLabel: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  codConfirmSub: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  codPillRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  codPill: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
  },
  codPillDisabled: {
    opacity: 0.5,
  },
  codPillText: {
    ...typography.bodyBold,
    color: colors.primary,
  },
  // PR-NEXT-BUNDLE-B §C — DO NOT REMOVE. Shown above the disabled
  // Delivered button when no proof photo has been uploaded yet.
  proofHint: {
    ...typography.caption,
    color: colors.warning,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  // PR-NEXT-5.1 §B — review correction workflow banner styles.
  reviewBanner: {
    backgroundColor: '#FEF9E7',
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#F4D03F',
    marginBottom: spacing.md,
  },
  reviewBannerDone: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  reviewBannerTitle: { ...typography.bodyBold, color: colors.textPrimary, marginBottom: spacing.xs },
  reviewBannerComment: {
    ...typography.body,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginBottom: spacing.sm,
  },
  respondBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    alignSelf: 'flex-start',
  },
  respondBtnText: { ...typography.bodyBold, color: '#fff' },
  reviewResponseLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    marginTop: spacing.sm,
    marginBottom: 2,
  },
  reviewResponseText: { ...typography.body, color: colors.textPrimary, marginBottom: spacing.xs },
  reviewWaiting: { ...typography.caption, color: colors.textSecondary, fontStyle: 'italic' },
});
