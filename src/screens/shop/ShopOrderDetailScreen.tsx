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
// PR-NEXT-6 (finding #13) — DO NOT REMOVE. Renders the delivery
// proof photo (if uploaded by the partner). Auto-formatter risk.
import DeliveryProofViewer from '../../components/order/DeliveryProofViewer';
import OrderStatusChip from '../../components/order/OrderStatusChip';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { useAuthStore } from '../../store/useAuthStore';
import { formatOrderTime, formatRupees } from '../../utils/format';
// PR-NEXT-6 (finding #16d) — DO NOT REMOVE. Surfaces the actual
// settlement method (cod-paid-online, cod-paid-cash, online, …).
import { formatPaymentMethod } from '../../utils/formatPaymentMethod';
import {
    ACTION_LABELS,
    nextActionsFor,
    OrderStatus,
} from '../../utils/orderStateMachine';
// PR-NEXT-BUNDLE-B §A (Finding #9) — DO NOT REMOVE. Shop owners now
// see the same live partner ETA the customer sees via useLivePartnerEta.
// The callable gate was extended to allow shopOwner claims in the
// same PR. Auto-formatter risk: if tsc complains about this import,
// re-add this block.
import { useLivePartnerEta } from '../../hooks/useLivePartnerEta';
import { useShopOrderDetail } from './ShopOrderDetailScreen.useShopOrderDetail';
// PR-NEXT-PARTNER-PHOTO §G — DO NOT REMOVE. Photo-vs-initials avatar
// for the assigned delivery partner card below.
import { formatPartnerAvatar } from '../../utils/formatPartnerAvatar';
// PR-NEXT-BUNDLE-E §A — DO NOT REMOVE. Trust line (rating + vehicle)
// for the shop-side partner card. Auto-formatter strip risk.
import { formatPartnerTrust } from '../../utils/formatPartnerTrust';
// HOTFIX-PARTNER-STATUS-DISPLAY §A — DO NOT REMOVE. Three-state subtitle
// helper (Bundle H §C) reused so the shop-side partner status label gains
// the delivered/cancelled branches; was two-state ("On the way" forever).
import { derivePartnerCardSubtitle } from '../../utils/derivePartnerCardSubtitle';
// PR-NEXT-5.1 §A — DO NOT REMOVE. Respond-to-review banner + modal.
import ResponseModal from '../../components/order/ResponseModal';
import { orderService } from '../../services/orderService';

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

  // PR-NEXT-5.1 §A — review response state. Declared above early returns
  // (Rules of Hooks). `respondModalOpen` toggles the ResponseModal.
  const [respondModalOpen, setRespondModalOpen] = useState(false);
  const [responseSubmitting, setResponseSubmitting] = useState(false);

  // PR-NEXT-BUNDLE-E §A — partner phone reveal (post-pickup only).
  // Server gate (getDeliveryPartnerContactPure) authorizes the shop
  // owner of this order's shop. Declared above early returns (Rules
  // of Hooks).
  const [partnerPhone, setPartnerPhone] = useState<string | null>(null);
  const [revealingPhone, setRevealingPhone] = useState(false);

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

  // PR-NEXT-BUNDLE-B §A (Finding #9) — DO NOT REMOVE. Live partner
  // ETA polling. Only runs when the partner is en route (status is
  // 'ready_for_pickup'). `enabled=true` here because the screen itself
  // is already open; the order status arg stops polling once delivered.
  // The callable's shopOwner gate was extended in this PR so this poll
  // is authorized for the shop owner.
  const livePartnerEta = useLivePartnerEta(
    orderId,
    order?.status === 'ready_for_pickup',
    order?.status,
  );

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
      // silent-catch-audit:allow — desktop browsers without a softphone
      // simply do nothing; there is no actionable failure to surface.
      Linking.openURL(url).catch(() => {});
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
            // PR-NEXT-BUNDLE-B §A (Finding #9) — DO NOT REMOVE. Show
            // live partner ETA when available (partner en route);
            // fall back to static at-order estimate otherwise.
            (livePartnerEta.etaMin != null
              ? <Text style={styles.eta}>
                  ETA ~{Math.max(1, Math.round(livePartnerEta.etaMin))} min{livePartnerEta.stale ? ' ~' : ''}
                </Text>
              : minutesLeft > 0 && (
                  <Text style={styles.eta}>ETA ~{minutesLeft} min</Text>
                )
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

        {/* PR-NEXT-BUNDLE-E §A — delivery partner card. Photo + name +
            tappable rating row (→ PartnerReviews) + vehicle/status +
            post-pickup Call CTA (gated server-side to this shop's
            owner). */}
        {order.deliveryPersonId && (
          <>
            <Text style={styles.sectionTitle}>Delivery partner</Text>
            {(() => {
              const av = formatPartnerAvatar(
                order.deliveryPersonName ?? null,
                order.deliveryPersonPhotoUrl ?? null,
              );
              const trust = formatPartnerTrust({
                ratingAvg: order.deliveryPersonRating ?? null,
                ratingCount: order.deliveryPersonDeliveriesCount ?? null,
                vehicleType: order.deliveryPersonVehicleType ?? null,
              });
              // HOTFIX-PARTNER-STATUS-DISPLAY §A — DO NOT REMOVE. Three-state
              // via the shared helper from Bundle H §C. Adds 'delivered' and
              // 'cancelled' branches so the partner section copy doesn't lie
              // after handoff. Helper returns customer-side phrasing; the
              // shop-side overrides the two in-flight branches but reuses the
              // finalized (role-neutral) branches.
              const pickedUp = order.pickedUpAt != null;
              const subtitle = derivePartnerCardSubtitle({
                orderStatus: order.status ?? null,
                pickedUpAt:
                  typeof order.pickedUpAt === 'number' ? order.pickedUpAt : null,
              });
              const statusLabel =
                subtitle === '🛵 On the way to you'
                  ? '🛵 On the way to the customer'
                  : subtitle === '📦 Heading to the shop'
                    ? '📦 Heading to your shop'
                    : subtitle; // delivered / cancelled — finalized copy
              return (
                <View style={styles.card}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.md,
                    }}
                  >
                    {av.kind === 'photo' ? (
                      <Image
                        source={{ uri: av.uri }}
                        style={styles.partnerAvatar}
                        accessibilityLabel={`Photo of ${order.deliveryPersonName ?? 'delivery partner'}`}
                      />
                    ) : (
                      <View style={styles.partnerAvatarPlaceholder}>
                        <Text style={styles.partnerAvatarText}>{av.text}</Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={typography.bodyBold} numberOfLines={1}>
                        {order.deliveryPersonName ?? 'Partner assigned'}
                      </Text>
                      {/* Tappable rating row → partner public reviews. */}
                      <Pressable
                        onPress={() =>
                          nav.navigate('PartnerReviews', {
                            partnerUid: order.deliveryPersonId!,
                            partnerName: order.deliveryPersonName ?? undefined,
                          })
                        }
                        accessibilityRole="button"
                        accessibilityLabel="View partner reviews"
                      >
                        <Text style={styles.partnerTrustLine}>
                          {trust.trustLine} ›
                        </Text>
                      </Pressable>
                      <Text style={styles.partnerStatusLine}>
                        {trust.vehicleIcon} {statusLabel}
                      </Text>
                    </View>
                  </View>
                  {/* Post-pickup phone reveal — pre-pickup stays hidden. */}
                  {pickedUp &&
                    (partnerPhone ? (
                      <Pressable
                        onPress={() =>
                          // silent-catch-audit:allow — tel: deep-link best-effort.
                          Linking.openURL(`tel:${partnerPhone}`).catch(() => {})
                        }
                        style={styles.partnerCallBtn}
                        accessibilityRole="button"
                        accessibilityLabel={`Call ${order.deliveryPersonName ?? 'partner'}`}
                      >
                        <Text style={styles.partnerCallText}>
                          📞 {partnerPhone}
                        </Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={async () => {
                          setRevealingPhone(true);
                          try {
                            const { phone } =
                              await orderService.getDeliveryPartnerContact(
                                orderId,
                              );
                            setPartnerPhone(phone);
                          } catch (e: any) {
                            Alert.alert(
                              'Could not get phone',
                              e?.message || 'Please try again.',
                            );
                          } finally {
                            setRevealingPhone(false);
                          }
                        }}
                        disabled={revealingPhone}
                        style={styles.partnerCallBtn}
                        accessibilityRole="button"
                        accessibilityLabel="Reveal partner phone"
                      >
                        <Text style={styles.partnerCallText}>
                          {revealingPhone ? 'Loading…' : `📞 Call ${order.deliveryPersonName ?? 'partner'}`}
                        </Text>
                      </Pressable>
                    ))}
                </View>
              );
            })()}
          </>
        )}

        {/* PR-NEXT-BUNDLE-E §B — customer's rating of this order.
            Shown once the customer has rated (any correctionState).
            Reads flat order fields; the shop's own response (if any)
            is surfaced by the PR-5.1 banner above. */}
        {order.correctionState && typeof order.shopRating === 'number' && (
          <>
            <Text style={styles.sectionTitle}>Customer rated this order</Text>
            <View style={styles.card}>
              <Text style={styles.ratingLine}>
                Shop: {'⭐'.repeat(order.shopRating)}
              </Text>
              {typeof order.deliveryRating === 'number' && (
                <Text style={styles.ratingLine}>
                  Delivery: {'⭐'.repeat(order.deliveryRating)}
                </Text>
              )}
              {!!order.shopComment && (
                <Text style={styles.ratingComment}>“{order.shopComment}”</Text>
              )}
              {!!order.responseText && (
                <View style={styles.ratingResponse}>
                  <Text style={styles.ratingResponseLabel}>Your response</Text>
                  <Text style={styles.ratingComment}>
                    “{order.responseText}”
                  </Text>
                </View>
              )}
            </View>
          </>
        )}

        {/* Delivery address */}
        <Text style={styles.sectionTitle}>Delivery address</Text>
        {/* PR-NEXT-HOTFIX-8 (bug 2 — defense in depth) — when the
            customer ordered with "Deliver to current location" the
            locked `deliveryLocation` is the source of truth, not
            the address text fields. Render a prominent GPS-pin
            banner with the coords + a one-tap maps deeplink so the
            shopkeeper sees the live pin even on legacy buggy
            orders (placed before HOTFIX-8's placeOrder fix) where
            `deliveryAddress` may still carry the customer's stale
            default-Home fields. On modern orders the address text
            is already a reverse-geocoded `📍`-prefixed line, so
            the banner reinforces rather than contradicts. */}
        {order.deliveryLocation?.type === 'current_location' && (
          <Pressable
            onPress={() => {
              const { lat, lng } = order.deliveryLocation!;
              const url = Platform.select({
                ios: `maps:0,0?q=${lat},${lng}`,
                android: `geo:0,0?q=${lat},${lng}(Delivery%20pin)`,
                default: `https://maps.google.com/?q=${lat},${lng}`,
              });
              // silent-catch-audit:allow — maps deep-link best-effort.
              Linking.openURL(url!).catch(() => {});
            }}
            style={styles.gpsPinCard}
            accessibilityRole="button"
            accessibilityLabel="Open delivery GPS pin in Maps"
          >
            <Text style={styles.gpsPinTitle}>
              📍 Customer at GPS pin
            </Text>
            <Text style={styles.gpsPinCoords}>
              {order.deliveryLocation.lat.toFixed(5)},{' '}
              {order.deliveryLocation.lng.toFixed(5)}
            </Text>
            <Text style={styles.gpsPinHint}>Tap to open in Maps</Text>
          </Pressable>
        )}
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
          {/* PR-NEXT-6 (finding #16d) — explicit "Paid via …" line.
              Today the shop sees only `paymentMethod` (the customer's
              ORIGINAL choice), so a COD order paid mid-flow via
              `payCodOrder` mislabels as "Cash on Delivery" even
              though Razorpay actually settled it. The helper picks
              the correct copy from `paymentMethod` + `paidMethod` +
              `paymentStatus`. */}
          <Row
            label="Paid via"
            value={formatPaymentMethod({
              paymentMethod: order.paymentMethod,
              paidMethod: order.paidMethod,
              paymentStatus: order.paymentStatus,
            })}
          />
        </View>
        {/* PR-NEXT-6 (finding #13) — delivery proof photo. Renders
            null when the partner hasn't uploaded one (legacy orders,
            or partner skipped the optional capture). Auth + signed-
            read URL are server-side. */}
        <DeliveryProofViewer
          orderId={order.id}
          hasProof={!!order.deliveryProofStoragePath}
        />

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

        {/* PR-NEXT-5.1 §A — low-rating review banner.
            PR-NEXT-BUNDLE-J §L — DO NOT REMOVE. Reads the SHOP dimension's
            own state + response (fallback to legacy for un-migrated orders)
            so the delivery partner responding/resolving never changes what
            the shop sees here (Sudhir 2026-06-10). */}
        {(() => {
          const shopCS = order.shopCorrectionState ?? order.correctionState;
          const shopResp = order.shopResponseText ?? order.responseText;
          const shopRespAt = order.shopRespondedAt ?? order.responseAt;
          return (
            <>
              {(shopCS === 'flagged_low' || shopCS === 'responded') && (
                <View style={styles.reviewBanner}>
                  <Text style={styles.reviewBannerTitle}>
                    ⚠️ Customer left a {order.shopRating ?? '?'}★ rating
                  </Text>
                  {!!order.shopComment && (
                    <Text style={styles.reviewBannerComment}>
                      "{order.shopComment}"
                    </Text>
                  )}
                  {shopCS === 'flagged_low' && (
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
                  {shopCS === 'responded' && (
                    <>
                      <Text style={styles.reviewResponseLabel}>
                        Your response:
                      </Text>
                      <Text style={styles.reviewResponseText}>
                        {shopResp}
                      </Text>
                      <Text style={styles.reviewWaiting}>
                        Waiting on customer to acknowledge or amend
                        {shopRespAt
                          ? ` · ${Math.max(0, 7 - Math.floor((Date.now() - shopRespAt) / 86400000))} days left`
                          : ''}
                        .
                      </Text>
                    </>
                  )}
                </View>
              )}
              {shopCS === 'published' && !!order.shopRating && (
                <View style={[styles.reviewBanner, styles.reviewBannerDone]}>
                  <Text style={styles.reviewBannerTitle}>
                    ✅ Review published — {order.shopRating}★
                    {shopResp ? ' with your response' : ''}
                  </Text>
                </View>
              )}
            </>
          );
        })()}

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

      {/* PR-NEXT-5.1 §A — review response modal. */}
      <ResponseModal
        visible={respondModalOpen}
        onClose={() => setRespondModalOpen(false)}
        stars={order.shopRating ?? 1}
        comment={order.shopComment ?? null}
        responseBy="shop"
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
            // HOTFIX-RATING-RESPONSE — Alert so the error is surfaced;
            // watcher will auto-refresh order state on success path.
            Alert.alert(
              'Could not send response',
              e?.message || 'Please try again.',
            );
          } finally {
            setResponseSubmitting(false);
          }
        }}
      />

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
  // PR-NEXT-HOTFIX-8 (bug 2) — GPS-pin banner shown above the
  // address card when the customer ordered with "current location".
  // Uses `primaryLight` background so it reads as a distinct
  // affordance (tap to open maps) rather than blending into the
  // surface-colored address card below.
  gpsPinCard: {
    backgroundColor: colors.primaryLight,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  gpsPinTitle: { ...typography.bodyBold, color: colors.primaryDark },
  gpsPinCoords: {
    ...typography.body,
    color: colors.primaryDark,
    marginTop: 2,
  },
  gpsPinHint: {
    ...typography.caption,
    color: colors.primaryDark,
    marginTop: 2,
  },
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
  // PR-NEXT-PARTNER-PHOTO §G
  partnerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  partnerAvatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  partnerAvatarText: { ...typography.bodyBold, color: colors.primaryDark },
  // PR-NEXT-BUNDLE-E §A/§B — partner trust + customer rating block.
  partnerTrustLine: {
    ...typography.caption,
    color: colors.primary,
    marginTop: 2,
  },
  partnerStatusLine: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  partnerCallBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.primaryLight,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  partnerCallText: { ...typography.bodyBold, color: colors.primaryDark },
  ratingLine: { ...typography.body, marginBottom: spacing.xs },
  ratingComment: {
    ...typography.body,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  ratingResponse: {
    marginTop: spacing.sm,
    paddingLeft: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  ratingResponseLabel: { ...typography.caption, color: colors.textSecondary },
  // PR-NEXT-5.1 §A — review correction workflow banner styles.
  reviewBanner: {
    backgroundColor: '#FEF9E7',
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#F4D03F',
    marginTop: spacing.md,
  },
  reviewBannerDone: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  reviewBannerTitle: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
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
  reviewResponseText: {
    ...typography.body,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  reviewWaiting: {
    ...typography.caption,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
});
