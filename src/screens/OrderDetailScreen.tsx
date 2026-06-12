import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../components/common/Button';
import EmptyState from '../components/common/EmptyState';
import Loader from '../components/common/Loader';
import ScreenHeader from '../components/common/ScreenHeader';
// PR-NEXT-6 (finding #13) — DO NOT REMOVE. Renders the delivery
// proof photo on a delivered order so the customer has independent
// visual confirmation. Auto-formatter risk per code-discipline.
import DeliveryProofViewer from '../components/order/DeliveryProofViewer';
import OrderStatusChip from '../components/order/OrderStatusChip';
// PR-NEXT-13a (finding #13 sub-(a)) — DO NOT REMOVE. Renders the
// assigned delivery partner's display name + initials avatar the
// moment they claim the pickup (not waiting for actual pickup).
// Auto-formatter risk per code-discipline Rule 1.
import PartnerIdentityCard from '../components/order/PartnerIdentityCard';
// PR-NEXT-PARTNER-CARD (Case 6) — DO NOT REMOVE. Bottom-sheet
// modal triggered by the now-tappable PartnerIdentityCard.
import PartnerDetailsSheet from '../components/order/PartnerDetailsSheet';
import RateOrderCard from '../components/order/RateOrderCard';
// PR-NEXT-BUNDLE-H §A — DO NOT REMOVE. Customer-side review correction
// panel. Closes the loop where the customer had no in-app surface for
// the shop/partner response — previously only reachable via push deep-link.
import CustomerReviewResponsePanel from '../components/order/CustomerReviewResponsePanel';
// PR-NEXT-BUNDLE-H §A — DO NOT REMOVE. Pure view-model derivation for
// CustomerReviewResponsePanel. Keeps the screen logic testable.
// PR-NEXT-BUNDLE-J §H — DO NOT REMOVE. deriveCustomerReviewPanels splits the
// single panel into independent shop + delivery panels.
import { deriveCustomerReviewPanels } from '../utils/deriveCustomerReviewResponseView';
import { colors, radii, spacing, typography } from '../constants/theme';
import { Analytics } from '../services/analytics';
import { orderService } from '../services/orderService';
import { Sentry } from '../services/sentry';
import { shopService } from '../services/shopService';
import type { Order, Shop } from '../types';
import { usePressGuard } from '../hooks/usePressGuard';
// PR-NEXT-PARTNER-CARD.2 — DO NOT REMOVE. 30s-polling hook that
// feeds `PartnerDetailsSheet`'s WHEN + Distance rows. Auto-pauses
// when the sheet is closed (passes `enabled=false`) so we don't
// burn callable invocations or battery while not visible.
import { useLivePartnerEta } from '../hooks/useLivePartnerEta';
import { formatOrderTime, formatRupees } from '../utils/format';
// PR-NEXT-6 (finding #16d) — DO NOT REMOVE. Surfaces the actual
// settlement method (cod-paid-online, cod-paid-cash, online, …).
import { formatPaymentMethod } from '../utils/formatPaymentMethod';
import { formatRelativeTime } from '../utils/formatRelativeTime';
import { orderEtaDisplay } from '../utils/orderEtaDisplay';
import { openRazorpayCheckout } from '../utils/razorpay';

const showAlert = (title: string, message: string) => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // eslint-disable-next-line no-alert
    window.alert(`${title}\n\n${message}`);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Alert } = require('react-native');
    Alert.alert(title, message);
  }
};

// PR 27 — Promise-returning confirm dialog. The original
// `confirmAlert` (callback shape) is preserved below for any
// non-guarded call sites; the cancel/refund/retry handlers now go
// through `confirmAlertAsync` so the wrapped handler can `await`
// the user's choice and `usePressGuard` can hold its busy flag for
// the full lifetime of the operation (not just until the dialog
// pops up).
const confirmAlertAsync = (
  title: string,
  message: string,
  confirmLabel = 'Confirm',
): Promise<boolean> =>
  new Promise(resolve => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // eslint-disable-next-line no-alert
      resolve(window.confirm(`${title}\n\n${message}`));
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Alert } = require('react-native');
    Alert.alert(
      title,
      message,
      [
        { text: 'Keep order', style: 'cancel', onPress: () => resolve(false) },
        {
          text: confirmLabel,
          style: 'destructive',
          onPress: () => resolve(true),
        },
      ],
      // Android back-button / outside-tap dismissal also resolves
      // false. iOS ignores onDismiss but always routes through one
      // of the two button onPress callbacks, so it's safe.
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });

export default function OrderDetailScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const orderId: string = route.params.orderId;
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // PR 7 — DO NOT REMOVE. Auto-formatter stripped this once during
  // PR 7 development. windowCancelling drives the in-window cancel
  // button's loading state; nowMs ticks once per second to drive the
  // countdown display. If lint complains "nowMs not used / not
  // defined", re-add both lines.
  const [windowCancelling, setWindowCancelling] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [error, setError] = useState<string | null>(null);
  // PR 17 — shop info for the customer "Call shop" button + the
  // pull-to-refresh retry nonce + spinner. State declared HERE,
  // above the early returns (`if (loading && !order)`, `if (!order)`)
  // — same Rules-of-Hooks discipline that PRs 12 / 13 / 14 / 15 / 16
  // enshrined across the codebase. Adding state below those returns
  // crashes the screen the moment the watcher's first callback
  // flips `loading` to false.
  //
  // `shop` is null until the post-load fetch resolves; the Call
  // shop button is gated on `shop?.registrationData?.phone` so a
  // missing phone (legacy seed shops) just hides the button — no
  // broken layout, no "Call shop ()" text.
  //
  // `refreshNonce` bumps on pull-to-refresh: the watcher useEffect
  // depends on it, so a bump re-subscribes and forces the first
  // post-resubscribe callback to clear `refreshing`. Same posture
  // as AdminOrders / ShopOwner dashboards (PR 7).
  const [shop, setShop] = useState<Shop | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  // PR-NEXT-PARTNER-CARD (Case 6) — controls the partner-details
  // bottom sheet triggered by tapping `PartnerIdentityCard`.
  const [partnerSheetOpen, setPartnerSheetOpen] = useState(false);
  // PR-NEXT-PARTNER-CARD.1 (Case 6 retest) — phone-reveal state for
  // `PartnerDetailsSheet`. Phone is NEVER on the order doc; we fetch
  // it on-demand via `getDeliveryPartnerContact` and cache here for
  // the lifetime of this screen instance. `revealingPhone` gates the
  // CTA spinner so re-taps are no-ops during the round-trip.
  const [partnerPhone, setPartnerPhone] = useState<string | null>(null);
  const [revealingPhone, setRevealingPhone] = useState(false);
  // PR-NEXT-PARTNER-CARD.2 — live-ETA polling hook. The `enabled`
  // arg is `partnerSheetOpen` so polling only runs while the sheet
  // is visible. Hook returns `{ distanceKm, etaMin, stale, loading }`
  // and the sheet picks the static `order.deliveryDistanceKm` /
  // `deliveryDurationMin` fallback when the live fields are null
  // (server rejected with `failed-precondition`).
  // PR-NEXT-BUNDLE-A §C (Finding #12a) — DO NOT REMOVE. Third arg
  // passes order status so the hook stops polling and clears state
  // when the order is delivered/cancelled (avoids stale "Arriving
  // now" from partner→drop ~0 distance after delivery).
  const livePartnerEta = useLivePartnerEta(
    orderId,
    partnerSheetOpen,
    order?.status,
  );

  // PR 20 — local optimistic rating state. Once the customer
  // submits a rating, we want the UI to flip immediately to a
  // "Thanks for rating!" view without waiting for the watcher
  // tick. The watcher will eventually deliver the canonical
  // `order.rating` field and both code paths render the same
  // confirmation. Hoisted here above the screen's early returns,
  // mirroring the PR 7 / PR 17 / PR 19 lineage in this file.
  // PR 42.1 — optimistic state extended to capture BOTH dimensions
  // (shop required, delivery optional) so the post-rating panel can
  // render the full dual-rating summary without waiting for the
  // watcher tick. Legacy single-rating orders (pre-PR-42.1) read
  // from `order.rating.stars` instead — handled in the JSX below.
  const [optimisticRating, setOptimisticRating] = useState<{
    shopRating: 1 | 2 | 3 | 4 | 5;
    shopComment?: string;
    deliveryRating?: 1 | 2 | 3 | 4 | 5;
    deliveryComment?: string;
  } | null>(null);

  // PR 19 fix — the cancel countdown ("Cancel order (1:32 left)")
  // is computed from (paidAt + 2min - nowMs). Without an interval
  // bumping nowMs, the label is frozen at the value it had when the
  // screen mounted. This was a real regression caught in family
  // testing. 1-second cadence so the mm:ss display ticks visibly.
  //
  // The interval runs always while the screen is mounted — even
  // when there's no countdown to show. The state update is cheap
  // (just a number) and the conditional render below decides
  // whether to actually show the countdown UI. Cleanup on unmount
  // prevents leaked intervals.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let firstLoad = true;
    const unsub = orderService.watchOrder(orderId, (o, err) => {
      if (err) {
        setError(err.message || 'Could not load order. Pull back later.');
        // Keep `order` as-is so any previously-displayed data stays
        // on screen; just show the error banner above it.
      } else {
        setError(null);
        setOrder(o);
        if (firstLoad && o) {
          firstLoad = false;
          Analytics.view_order({ order_id: o.id, status: o.status });
        }
      }
      // ALWAYS — see watcher contract refactor.
      setLoading(false);
      // PR 17 — clear the pull-to-refresh spinner on the first
      // callback after a refresh bump, regardless of success/error.
      setRefreshing(false);
    });
    return unsub;
    // refreshNonce is in deps so the pull-to-refresh handler can
    // force a re-subscribe by bumping it.
  }, [orderId, refreshNonce]);

  // PR 36.1 — fire `customer_pickup_countdown_viewed` once per
  // (order_id, readyByEstimate) pair when there's a future ETA
  // to display. Deps include `order?.readyByEstimate` so a shop
  // bumping the ETA mid-flight re-fires. Skipped entirely when
  // the ETA is null or already past.
  useEffect(() => {
    const ready = order?.readyByEstimate;
    if (!ready || ready <= Date.now()) return;
    Analytics.customer_pickup_countdown_viewed({
      order_id: order.id,
      minutes_until_ready: Math.round((ready - Date.now()) / 60_000),
    });
    // We deliberately don't depend on `nowMs` — that would re-
    // fire every second. The (orderId, readyByEstimate) tuple
    // is the right grain for "this is a new countdown surface".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, order?.readyByEstimate]);

  // PR 17 — fetch the shop doc so the Call shop button has a
  // phone number to dial. Runs once per shopId; failures are
  // silent (the button just stays hidden). The hard-coded
  // GeoPoint is fine because the shopService.getById signature
  // requires one but we don't need distance here — the Shop doc's
  // identity fields (name, phone) are all we read.
  useEffect(() => {
    if (!order?.shopId) {
      setShop(null);
      return;
    }
    let cancelled = false;
    shopService
      .getById(order.shopId, { lat: 0, lng: 0 })
      .then(s => {
        if (!cancelled) setShop(s);
      })
      // HOTFIX-SILENT-CATCH-GUARD — DO NOT REMOVE. Report the fetch
      // failure; the screen still degrades gracefully to no-shop.
      .catch(e => {
        if (!cancelled) setShop(null);
        Sentry.captureException(e, { tags: { area: 'OrderDetail.getShop' } });
      });
    return () => {
      cancelled = true;
    };
  }, [order?.shopId]);

  // PR 17 — pull-to-refresh handler. Bumps the nonce so the
  // watcher effect tears down + re-subscribes (which forces an
  // immediate fresh fetch); spinner clears in the watcher callback
  // above. Same pattern as AdminOrdersScreen / ShopOwnerDashboard
  // from PR 7.
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshNonce(n => n + 1);
  }, []);

  // PR-NEXT-PARTNER-CARD.1 (Case 6 retest) — invalidate the cached
  // partner phone whenever the orderId changes (e.g. user navigated
  // back and opened a different order). Without this a stale phone
  // from order A would leak into the sheet for order B until the
  // user explicitly tapped "Show partner phone" again. Closing the
  // sheet does NOT clear the phone — the customer often closes and
  // re-opens the sheet during a delivery and the cached number lets
  // them re-tap-to-call without a second round-trip.
  useEffect(() => {
    setPartnerPhone(null);
    setRevealingPhone(false);
  }, [orderId]);

  // PR-NEXT-BUNDLE-B §B (Finding #10) — one-tap call handler.
  // Collapses the previous two-step reveal-then-call UX into a
  // single "Call partner" CTA. If the phone is already cached in
  // `partnerPhone` state, open the dialer immediately. Otherwise
  // fetch via `getDeliveryPartnerContact`, cache, then dial —
  // all in one tap. `revealingPhone` gates the button spinner.
  const onCallPartner = useCallback(async () => {
    if (!order) return;
    if (partnerPhone) {
      // silent-catch-audit:allow — tel: deep-link; OS handles the no-op
      // when no dialer exists. Nothing actionable to log or surface.
      Linking.openURL(`tel:${partnerPhone}`).catch(() => {});
      return;
    }
    setRevealingPhone(true);
    try {
      const { phone } = await orderService.getDeliveryPartnerContact(order.id);
      setPartnerPhone(phone);
      // silent-catch-audit:allow — tel: deep-link best-effort, see above.
      Linking.openURL(`tel:${phone}`).catch(() => {});
    } catch (e: any) {
      showAlert(
        'Could not load phone',
        e?.message ?? 'Please try again in a moment.',
      );
    } finally {
      setRevealingPhone(false);
    }
  }, [order, partnerPhone]);

  // PR 17 — customer-side "Call shop" handler. Mirror of the
  // shopkeeper's `onCallCustomer` flow on ShopOrderDetailScreen
  // (PR 12). Hidden in the render branch below when there's no
  // phone, so this handler is only reachable with a valid number.
  const onCallShop = useCallback(() => {
    const phone = shop?.registrationData?.phone;
    if (!phone) return;
    const url = `tel:${phone}`;
    Linking.openURL(url).catch(err => {
      showAlert(
        'Could not place call',
        err?.message || 'Your device does not support phone calls.',
      );
    });
  }, [shop?.registrationData?.phone]);

  // PR 27 — Re-entrancy guards for the order-flow buttons. Each
  // hook returns a wrapper that swallows a re-entrant call while
  // its handler is still in-flight, closing the
  // double-tap-creates-duplicate-Razorpay race. The handlers
  // themselves are hoisted `async function` declarations below the
  // JSX `return`, so they're in scope here despite appearing later
  // in the source. Each `usePressGuard` allocates its OWN ref, so
  // the cancel and retry-pay guards do NOT share state — pressing
  // Cancel then Pay-Now in quick succession remains possible (the
  // server-side handler rejects the impossible second one).
  const guardedRetryPayment = usePressGuard(handleRetryPayment);
  // PR-NEXT-3 — Pay-online-now button on COD orders. Separate guard
  // from `guardedRetryPayment` because the underlying callable
  // (`payCodOrder` vs `retryPayment`) and preconditions differ, but
  // both flip `paying` so the in-flight Razorpay overlay can't be
  // re-triggered from either button.
  const guardedPayCodOrder = usePressGuard(handlePayCodOrder);
  const guardedCancel = usePressGuard(handleCancel);
  const guardedWindowCancel = usePressGuard(handleWindowCancel);

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
        <EmptyState
          title="Order not found"
          subtitle="It may have been cleared. Check Orders."
          ctaLabel="My Orders"
          onCtaPress={() => nav.navigate('Orders')}
        />
      </SafeAreaView>
    );
  }

  // PR 43 — single source of truth for the customer ETA copy.
  // Replaces the inline `minutesLeft` + nested-ternary block at the
  // status card below. The helper hides the pre-acceptance minute
  // count entirely (status === 'pending' → 'awaiting_confirmation')
  // so the customer doesn't anchor expectation on a number the
  // shop hasn't committed to yet.
  const etaDisplay = orderEtaDisplay(order, nowMs);

  // PR 7 — eligibility for the in-window cancel button. Mirrors the
  // server's canCustomerCancelPaidOrder rules (kept in sync; server
  // is still the gate on actual call). The constant must match
  // CUSTOMER_CANCEL_WINDOW_MS in functions/src/customerCancelWindowHelpers.ts;
  // changing one requires changing the other.
  const cancelWindowMs = 2 * 60 * 1000;
  const cancelEligibleNow =
    order.paymentMethod === 'online' &&
    order.paymentStatus === 'paid' &&
    order.status === 'pending' &&
    typeof order.paidAt === 'number' &&
    Number.isFinite(order.paidAt);
  const remainingMs = cancelEligibleNow
    ? Math.max(0, (order.paidAt as number) + cancelWindowMs - nowMs)
    : 0;
  const inWindow = cancelEligibleNow && remainingMs > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Order details" onBack={() => nav.goBack()} />
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        // PR 43.1 hotfix — RateOrderCard's TextInput at the bottom of
        // OrderDetailScreen was being covered by the iOS keyboard
        // (especially the delivery feedback box, which sits second on
        // the screen). `automaticallyAdjustKeyboardInsets` is iOS
        // 14+'s native solution: the ScrollView automatically adds
        // bottom inset equal to the keyboard height when an input
        // becomes focused, so the focused field scrolls into view.
        // Android relies on `adjustResize` (Expo's default) which
        // handles the same case without an explicit prop.
        // `keyboardShouldPersistTaps="handled"` lets buttons (e.g. the
        // star pickers, Submit) be tappable even while keyboard is
        // open — without this, the first tap just dismisses the
        // keyboard and the action requires a second tap.
        automaticallyAdjustKeyboardInsets={true}
        keyboardShouldPersistTaps="handled"
      >
        {/* Status header */}
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            {/* PR 12 — customer audience: chip says "Out for
                delivery" when the internal status is
                ready_for_pickup. Familiar phrasing; matches what
                every other delivery app shows. */}
            <OrderStatusChip
              status={order.status}
              pickedUpAt={order.pickedUpAt}
              deliveredAt={order.deliveredAt}
              audience="customer"
            />
            <Text style={styles.orderId}>{order.id}</Text>
          </View>
          <Text style={styles.placedAt}>Placed {formatOrderTime(order.createdAt)}</Text>
          {/* PR 12 → PR 36.1 → PR 43 — customer-facing ETA copy
              varies by status:
              - pending: hide minute count, show "Awaiting shop
                confirmation" (PR 43 — anchors customer expectation
                only after shop commits, not on shop.etaMinutes).
              - accepted / preparing / ready_for_pickup with
                readyByEstimate: PR 36.1 two-line countdown.
              - accepted+ without readyByEstimate (legacy /
                defensive): legacy "Arriving in ~N min" fallback.
              - delivered / cancelled: hidden.
              State machine logic centralised in
              `src/utils/orderEtaDisplay.ts`. */}
          {etaDisplay.kind === 'awaiting_confirmation' && (
            <View style={styles.pickupRow}>
              <Text style={styles.pickupPrimary}>
                Awaiting shop confirmation
              </Text>
              <Text style={styles.pickupSecondary}>
                {order.shopName ?? 'The shop'} will confirm shortly
              </Text>
            </View>
          )}
          {/* PR-NEXT-BUNDLE-A §B (Finding #6) — DO NOT REMOVE.
              Show readyByEstimate block ONLY during accepted/preparing.
              Finding #17 already suppressed the ETA countdown on
              ready_for_pickup via orderEtaDisplay returning 'hidden';
              this explicit status gate also suppresses the sub-message
              text ("by HH:MM · delivery partner brings it to you") so
              the two-line pickup row can't appear after the order has
              moved beyond the preparation phase. */}
          {etaDisplay.kind === 'ready_by' &&
            (order.status === 'accepted' || order.status === 'preparing') && (
            <View style={styles.pickupRow}>
              <Text style={styles.pickupPrimary}>
                {formatRelativeTime(
                  etaDisplay.readyByEstimate,
                  nowMs,
                  { label: 'Pickup ready' },
                ).primary}
              </Text>
              <Text style={styles.pickupSecondary}>
                by {formatOrderTime(etaDisplay.readyByEstimate)} · delivery
                partner brings it to you
              </Text>
            </View>
          )}
          {etaDisplay.kind === 'eta_fallback' && (
            <Text style={styles.eta}>
              Arriving in ~{etaDisplay.minutesLeft} min
            </Text>
          )}
          {etaDisplay.kind === 'arriving_soon' && (
            <Text style={styles.eta}>Arriving soon</Text>
          )}
        </View>

        {/* PR-NEXT-13a (finding #13 sub-(a)) — partner identity
            surfaces the moment the partner claims the pickup, not
            waiting for actual pickup. Render only when
            `deliveryPersonId` is set AND the order isn't cancelled;
            falls back to "Your delivery partner" copy when
            `deliveryPersonName` is absent (legacy orders pre-PR or
            partners without a `displayName` on their user doc).
            Phone number is NOT shown here — that stays gated to
            post-pickup as it was pre-PR. */}
        {typeof order.deliveryPersonId === 'string' &&
          order.deliveryPersonId.length > 0 &&
          order.status !== 'cancelled' && (
            <PartnerIdentityCard
              name={order.deliveryPersonName}
              photoUrl={order.deliveryPersonPhotoUrl ?? null}
              pickedUpAt={
                typeof order.pickedUpAt === 'number' ? order.pickedUpAt : null
              }
              orderStatus={order.status ?? null}
              onPress={() => setPartnerSheetOpen(true)}
            />
          )}

        {/* Delivery address */}
        <Text style={styles.sectionTitle}>Delivery address</Text>
        <View style={styles.card}>
          <Text style={typography.bodyBold}>{order.deliveryAddress.name}</Text>
          <Text style={styles.addressLine}>{order.deliveryAddress.line1}</Text>
          {!!order.deliveryAddress.line2 && (
            <Text style={styles.addressLine}>{order.deliveryAddress.line2}</Text>
          )}
          <Text style={styles.addressLine}>
            {order.deliveryAddress.city} - {order.deliveryAddress.pincode}
          </Text>
          <Text style={styles.addressLine}>📞 {order.deliveryAddress.phone}</Text>
        </View>

        {/* PR 22 — read-only delivery-instructions confirmation.
            Silently omitted on legacy orders (no field). Lets the
            customer verify the instructions they sent. */}
        {order.deliveryAddress.deliveryInstructions && (
          <View style={styles.subInfoCard}>
            <Text style={styles.subInfoLabel}>Delivery instructions</Text>
            <Text style={styles.subInfoValue}>
              {order.deliveryAddress.deliveryInstructions}
            </Text>
          </View>
        )}

        {/* PR 21 — read-only substitution preference confirmation.
            Silently omitted on legacy orders (no field). Lets the
            customer verify the shop saw their choice. */}
        {order.substitutionPreference && (
          <View style={styles.subInfoCard}>
            <Text style={styles.subInfoLabel}>If unavailable</Text>
            <Text style={styles.subInfoValue}>
              {order.substitutionPreference === 'call_me'
                ? '📞 Shop will call you first'
                : order.substitutionPreference === 'auto'
                  ? '🔄 Shop will replace with similar'
                  : '💰 Shop will refund the item'}
            </Text>
          </View>
        )}

        {/* Items */}
        <Text style={styles.sectionTitle}>{order.shopName}</Text>
        {/* PR 17 — customer "Call shop" button. Mirror of the
            shopkeeper-side "Call customer" affordance from PR 12.
            Gated on `shop.registrationData?.phone` because the
            phone lives on the registration sub-object, not the
            top-level Shop doc — legacy seed shops without
            registrationData get no button (clean no-op, not a
            broken "Call shop ()" string). */}
        {shop?.registrationData?.phone && (
          <Pressable
            onPress={onCallShop}
            style={styles.callShopRow}
            accessibilityRole="button"
            accessibilityLabel={`Call ${order.shopName} at ${shop.registrationData.phone}`}
          >
            <Text style={styles.callShopText}>
              📞 Call shop ({shop.registrationData.phone})
            </Text>
          </Pressable>
        )}
        <View style={styles.card}>
          {order.items.map((it, idx) => (
            <View
              key={it.productId}
              style={[styles.itemRow, idx !== 0 && styles.itemDivider]}
            >
              <Image source={{ uri: it.imageUrl }} style={styles.itemImage} />
              <View style={{ flex: 1 }}>
                <Text style={typography.body} numberOfLines={2}>{it.name}</Text>
                <Text style={styles.itemMeta}>
                  {it.packLabel} · Qty {it.quantity}
                </Text>
              </View>
              <Text style={typography.bodyBold}>
                {formatRupees(it.price * it.quantity)}
              </Text>
            </View>
          ))}
        </View>

        {/* Bill summary */}
        <Text style={styles.sectionTitle}>Bill details</Text>
        <View style={styles.card}>
          <Row label="Item total" value={formatRupees(order.subtotal)} />
          <Row label="Delivery fee" value={formatRupees(order.deliveryFee)} />
          <View style={styles.divider} />
          <Row label="Total" value={formatRupees(order.total)} bold />
        </View>

        {/* Payment */}
        <Text style={styles.sectionTitle}>Payment</Text>
        <View style={styles.card}>
          <Row
            label="Method"
            value={order.paymentMethod === 'online' ? 'Online (Razorpay)' : 'Cash on Delivery'}
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
                      : order.paymentStatus === 'refunded'
                        ? 'Refunded ✓'
                        : order.paymentStatus === 'refund_pending'
                          ? 'Refund pending'
                          : order.paymentStatus === 'refund_failed'
                            ? 'Refund failed — contact support'
                            : 'Processing…'
              }
              valueColor={
                order.paymentStatus === 'paid' ||
                order.paymentStatus === 'refunded'
                  ? colors.success
                  : order.paymentStatus === 'failed' ||
                      order.paymentStatus === 'expired' ||
                      order.paymentStatus === 'refund_failed'
                    ? colors.danger
                    : colors.textSecondary
              }
            />
          )}
          {/* PR 7 hotfix — refund state context lines. Before, all
              three refund states fell through to "Processing…" which
              left the user wondering what was happening. */}
          {order.paymentMethod === 'online' && order.paymentStatus === 'refunded' && (
            <Text style={styles.paymentNote}>
              Refund of {formatRupees(order.total)} processed by Razorpay.
              Funds typically reach your account in 5–7 business days.
            </Text>
          )}
          {order.paymentMethod === 'online' && order.paymentStatus === 'refund_pending' && (
            <Text style={styles.paymentNote}>
              Refund of {formatRupees(order.total)} is being processed.
              This page will update once Razorpay confirms.
            </Text>
          )}
          {order.paymentMethod === 'online' && order.paymentStatus === 'refund_failed' && (
            <Text style={styles.paymentNote}>
              We couldn't process your refund automatically. Our team has
              been notified and will reach out within 24 hours.
            </Text>
          )}
          {order.paymentMethod === 'online' && order.paymentStatus === 'failed' && (
            <Text style={styles.paymentNote}>
              Payment didn't complete. Contact support to retry.
            </Text>
          )}
          {order.paymentMethod === 'online' && order.paymentStatus === 'expired' && (
            <Text style={styles.paymentNote}>
              Payment session expired and the order was auto-cancelled.
              Place a new order to try again.
            </Text>
          )}
          {/* PR-NEXT-6 (finding #16d) — explicit "Paid via …" line.
              For COD orders converted mid-flow via `payCodOrder` the
              method label above still says "Cash on Delivery"
              (customer's original choice); this line names the
              actual settlement so the customer's record matches
              what their bank statement will show. */}
          <Row
            label="Paid via"
            value={formatPaymentMethod({
              paymentMethod: order.paymentMethod,
              paidMethod: order.paidMethod,
              paymentStatus: order.paymentStatus,
            })}
          />
        </View>
        {/* PR-NEXT-6 (finding #13) — delivery proof photo. Customers
            benefit from seeing "yes, my order was delivered to the
            door" both for transparency and for backing their own
            disputes. Renders nothing when the partner skipped the
            optional capture. */}
        <DeliveryProofViewer
          orderId={order.id}
          hasProof={!!order.deliveryProofStoragePath}
        />

        {/* PR 7 — Customer in-window cancel for paid orders. Visible
            ONLY when the order is paid + still pending + within the
            2-min window. Server is the gate (canCustomerCancelPaidOrder)
            but we mirror the eligibility check here for an honest UI:
            no point showing a button that's about to fail. The
            countdown re-renders every second via the nowMs interval. */}
        {cancelEligibleNow && inWindow && (
          <View style={styles.cancelWindowCard}>
            <Text style={styles.cancelWindowTitle}>Changed your mind?</Text>
            <Text style={styles.cancelWindowSubtitle}>
              Cancel within {formatMmSs(remainingMs)} for an automatic refund of {formatRupees(order.total)}.
              {'\n'}
              After that you'll need to contact support.
            </Text>
            <View style={{ height: spacing.md }} />
            {/* PR 7 hotfix — was variant="secondary" but the secondary
                button's background (colors.primaryLight) is identical
                to this card's background, so the button looked like
                plain text. Switched to variant="primary" so the green
                fill makes it unambiguously tappable. See Button.tsx —
                secondary bg = colors.primaryLight = card bg. */}
            <Button
              title={
                windowCancelling
                  ? 'Cancelling…'
                  : `Cancel order (${formatMmSs(remainingMs)} left)`
              }
              variant="primary"
              onPress={guardedWindowCancel}
              loading={windowCancelling}
              disabled={windowCancelling}
              fullWidth
            />
          </View>
        )}
        {cancelEligibleNow && !inWindow && order.status === 'pending' && (
          <View style={styles.cancelWindowCardExpired}>
            <Text style={styles.cancelWindowTitleExpired}>
              Cancellation window expired
            </Text>
            <Text style={styles.cancelWindowSubtitle}>
              Contact support if you still need to cancel this order.
            </Text>
          </View>
        )}

        {/* Stuck-payment recovery: if the customer dismissed Razorpay
            without paying, the order sits in paymentStatus='pending'
            until the 24h cleanup. Surface Pay Now / Cancel here so they
            can act immediately. Only shown while the shop hasn't
            accepted yet — once status moves past 'pending', the order
            belongs to the shop and admin handles cancellation. */}
        {order.paymentMethod === 'online' &&
          order.paymentStatus === 'pending' &&
          order.status === 'pending' && (
            <View style={styles.recoveryCard}>
              <Text style={styles.recoveryTitle}>Payment incomplete</Text>
              <Text style={styles.recoverySubtitle}>
                Your order is on hold. Complete payment to confirm it, or
                cancel if you've changed your mind.
              </Text>
              <View style={{ height: spacing.md }} />
              <Button
                title={
                  paying
                    ? 'Opening payment…'
                    : `Pay ${formatRupees(order.total)} now`
                }
                onPress={guardedRetryPayment}
                loading={paying}
                disabled={paying || cancelling}
                fullWidth
              />
              <View style={{ height: spacing.sm }} />
              <Button
                title="Cancel order"
                onPress={guardedCancel}
                variant="secondary"
                loading={cancelling}
                disabled={paying || cancelling}
                fullWidth
              />
            </View>
          )}

        {/* PR-NEXT-3 §G (finding #12 Part A) — customer-initiated
            COD → online conversion. Gated on:
              - paymentMethod === 'cod' (original choice was cash)
              - paymentStatus !== 'paid' (race-guard with Part B —
                the partner may have just confirmed cash)
              - status not in delivered/cancelled (terminal states)
            Server enforces every gate too; this client check just
            keeps the affordance invisible when it's pointless. The
            button reuses the `paying` state hoist + the existing
            `guardedPayCodOrder` press guard so a re-entrant tap
            while Razorpay is opening is a no-op.

            On Razorpay success the screen calls `confirmPayment`
            with the signature triple, which on the server stamps
            `paidMethod: 'online'` and fans out the COD-conversion
            push to shop / admin / delivery. */}
        {order.paymentMethod === 'cod' &&
          order.paymentStatus !== 'paid' &&
          order.status !== 'delivered' &&
          order.status !== 'cancelled' && (
            <View style={styles.recoveryCard}>
              <Text style={styles.recoveryTitle}>Prefer to pay online?</Text>
              <Text style={styles.recoverySubtitle}>
                Switch this order to online payment — UPI, card, or
                wallet. No need to find cash when the partner arrives.
              </Text>
              <View style={{ height: spacing.md }} />
              <Button
                title={
                  paying
                    ? 'Opening payment…'
                    : `💳 Pay ${formatRupees(order.total)} online now`
                }
                onPress={guardedPayCodOrder}
                loading={paying}
                disabled={paying || cancelling}
                fullWidth
              />
            </View>
          )}

        {/* PR 19 fix — COD cancel. COD orders had NO cancel UI until
            this fix. The 2-min window above is online-paid-only
            (because there's a refund to handle). For COD there's no
            refund — the customer can cancel any pending COD order
            until the shop accepts it. Once accepted, customer must
            contact admin (same as the post-2min online flow). */}
        {order.paymentMethod === 'cod' && order.status === 'pending' && (
          <View style={styles.codCancelCard}>
            <Text style={styles.codCancelTitle}>Cancel this order?</Text>
            <Text style={styles.codCancelSubtitle}>
              You can cancel until the shop accepts. After that, contact
              support if you still need to cancel.
            </Text>
            <View style={{ height: spacing.md }} />
            <Button
              title={cancelling ? 'Cancelling…' : 'Cancel order'}
              onPress={guardedCancel}
              variant="secondary"
              loading={cancelling}
              disabled={cancelling}
              fullWidth
            />
          </View>
        )}
        {order.paymentMethod === 'cod' &&
          order.status !== 'pending' &&
          order.status !== 'delivered' &&
          order.status !== 'cancelled' && (
            <View style={styles.cancelWindowCardExpired}>
              <Text style={styles.cancelWindowTitleExpired}>
                Shop has accepted this order
              </Text>
              <Text style={styles.cancelWindowSubtitle}>
                Contact support if you still need to cancel this order.
              </Text>
            </View>
          )}

        {/* PR 20 — rating prompt for delivered orders. Two
            mutually-exclusive branches:
              1. delivered + no rating yet (and no optimistic flip
                 in progress) → show RateOrderCard.
              2. delivered + has rating (canonical OR optimistic) →
                 show "Thanks for rating!" confirmation.
            Both branches read the same display values from
            `order.rating ?? optimisticRating` so the watcher's
            eventual canonical write doesn't visually flicker. */}
        {order.status === 'delivered' &&
          !order.rating &&
          !order.shopRating &&
          !optimisticRating && (
            <View style={styles.rateCardWrap}>
              <RateOrderCard
                orderId={order.id}
                // PR 42.1 — only render the delivery section when a
                // partner actually exists on the order. Defensive
                // truthy check (string presence) so the empty-string
                // edge from older write paths doesn't surface a
                // pointless delivery section.
                hasDeliveryPartner={
                  typeof order.deliveryPersonId === 'string' &&
                  order.deliveryPersonId.length > 0
                }
                onRated={payload => setOptimisticRating(payload)}
              />
            </View>
          )}
        {order.status === 'delivered' &&
          (order.rating || order.shopRating || optimisticRating) &&
          (() => {
            // PR 42.1 — three render paths converge on the same
            // panel:
            //   1. New dual rating from server (`order.shopRating`)
            //   2. Optimistic dual rating (just-submitted, watcher
            //      not yet ticked)
            //   3. Legacy single rating (`order.rating.stars`) for
            //      pre-PR-42.1 orders — read-only historical.
            // The variables below pick whichever source has data.
            const shopStars =
              order.shopRating ??
              optimisticRating?.shopRating ??
              order.rating?.stars ??
              0;
            const shopComment =
              order.shopComment ??
              optimisticRating?.shopComment ??
              order.rating?.comment;
            const deliveryStars =
              order.deliveryRating ?? optimisticRating?.deliveryRating;
            const deliveryComment =
              order.deliveryComment ?? optimisticRating?.deliveryComment;
            return (
              <View style={styles.ratedCard}>
                <Text style={styles.ratedTitle}>Thanks for rating!</Text>
                {/* Shop dimension — always present (either the new
                    flat field, optimistic, or legacy nested). */}
                <Text style={styles.ratedSubtitle}>You rated the shop</Text>
                <Text style={styles.ratedStars}>
                  {'★'.repeat(shopStars)}
                  {'☆'.repeat(5 - shopStars)}
                </Text>
                {shopComment && (
                  <Text style={styles.ratedComment}>"{shopComment}"</Text>
                )}
                {/* Delivery dimension — only when the customer
                    actually rated it. Legacy single-rating orders
                    never have this; new dual orders may have it
                    if the customer didn't skip. */}
                {deliveryStars && deliveryStars > 0 ? (
                  <View style={styles.ratedDeliveryBlock}>
                    <Text style={styles.ratedSubtitle}>
                      You rated your delivery
                    </Text>
                    <Text style={styles.ratedStars}>
                      {'★'.repeat(deliveryStars)}
                      {'☆'.repeat(5 - deliveryStars)}
                    </Text>
                    {deliveryComment && (
                      <Text style={styles.ratedComment}>
                        "{deliveryComment}"
                      </Text>
                    )}
                  </View>
                ) : null}
              </View>
            );
          })()}

        {/* PR-NEXT-BUNDLE-H §A — customer-side review correction loop.
            Mirror of the shop / delivery response sections; closes the
            UX gap where the customer had no in-app surface for the
            response. Gated on delivered + ratingId + correctionState so
            unrated orders and legacy orders without the denorm fields
            render nothing (safe no-op). */}
        {order.status === 'delivered' &&
          order.ratingId &&
          (order.correctionState ||
            order.shopCorrectionState ||
            order.deliveryCorrectionState) &&
          (() => {
            // PR-NEXT-BUNDLE-J §H/§L — render the shop + delivery panels
            // independently. Each carries its own dimension so amend/ack hit
            // the correct side (Sudhir 2026-06-10: one side resolving must not
            // close the other). Falls back to a single shop panel for legacy
            // orders without per-dimension fields.
            const panels = deriveCustomerReviewPanels(order);
            const baseParams = {
              ratingId: order.ratingId!,
              orderId: order.id,
              shopName: order.shopName,
              originalShopStars: order.shopRating ?? 0,
              originalDeliveryStars: order.deliveryRating ?? 0,
              deliveryPersonName: order.deliveryPersonName ?? null,
              deliveryPersonPhotoUrl: order.deliveryPersonPhotoUrl ?? null,
            };
            const shopParams = {
              ...baseParams,
              dimension: 'shop' as const,
              responseText: order.shopResponseText ?? order.responseText ?? null,
              responseBy: 'shop' as const,
            };
            const deliveryParams = {
              ...baseParams,
              dimension: 'delivery' as const,
              responseText: order.partnerResponseText ?? order.responseText ?? null,
              responseBy: 'partner' as const,
            };
            return (
              <>
                <CustomerReviewResponsePanel
                  view={panels.shop}
                  dimensionLabel="shop"
                  onAmendPress={() => nav.navigate('RatingAmendment', shopParams)}
                  onAcknowledgePress={() => nav.navigate('RatingAmendment', shopParams)}
                />
                <CustomerReviewResponsePanel
                  view={panels.delivery}
                  dimensionLabel="delivery"
                  onAmendPress={() => nav.navigate('RatingAmendment', deliveryParams)}
                  onAcknowledgePress={() => nav.navigate('RatingAmendment', deliveryParams)}
                />
              </>
            );
          })()}
      </ScrollView>
      {/* PR-NEXT-PARTNER-CARD (Case 6) — partner-details bottom
          sheet. Mounts at the SafeAreaView root (outside the
          ScrollView) so the slide-up animation covers the whole
          screen and isn't clipped by the scroll viewport. Modal's
          own `visible` gate keeps the tree zero-cost when closed. */}
      <PartnerDetailsSheet
        visible={partnerSheetOpen}
        onClose={() => setPartnerSheetOpen(false)}
        partnerName={order.deliveryPersonName}
        pickedUpAt={
          typeof order.pickedUpAt === 'number' ? order.pickedUpAt : null
        }
        shopName={order.shopName}
        // PR-NEXT-PARTNER-CARD.1 (Case 6 retest) — richer rows.
        // `orderShortId` is the trailing 8 chars uppercased; matches
        // the readable handle the customer already sees on the
        // OrderConfirmation toast.
        orderShortId={order.id.slice(-8).toUpperCase()}
        deliveryDistanceKm={
          typeof order.deliveryDistanceKm === 'number'
            ? order.deliveryDistanceKm
            : null
        }
        deliveryDurationMin={
          typeof order.deliveryDurationMin === 'number'
            ? order.deliveryDurationMin
            : null
        }
        // PR-NEXT-PARTNER-CARD.2 — denormalized trust signals
        // (claim-time snapshot). Optional/nullable on the order
        // doc; the formatter falls back to "New partner" copy +
        // motorbike default glyph when any are missing.
        partnerRating={
          typeof order.deliveryPersonRating === 'number'
            ? order.deliveryPersonRating
            : null
        }
        partnerDeliveriesCount={
          typeof order.deliveryPersonDeliveriesCount === 'number'
            ? order.deliveryPersonDeliveriesCount
            : null
        }
        partnerVehicleType={order.deliveryPersonVehicleType ?? null}
        // PR-NEXT-PARTNER-PHOTO §F — DO NOT REMOVE. Null on legacy
        // orders; sheet falls back to initials avatar automatically.
        partnerPhotoUrl={order.deliveryPersonPhotoUrl ?? null}
        // PR-NEXT-BUNDLE-B §B — DO NOT REMOVE. Single one-tap call;
        // fetch + dial in one handler (see onCallPartner above).
        revealing={revealingPhone}
        onCallPartner={onCallPartner}
        // PR-NEXT-PARTNER-CARD.2 — live-ETA polling state. Hook
        // auto-pauses when `partnerSheetOpen` is false so the 30s
        // interval doesn't fire while the sheet is closed.
        live={livePartnerEta}
        // PR-NEXT-BUNDLE-A §C (Finding #12a) — DO NOT REMOVE. Sheet
        // shows static Delivered/Cancelled copy when order is
        // finalized, replacing the stale live-ETA rows.
        orderStatus={order.status}
        // PR-NEXT-STATIC-MAP-PREVIEW §C — DO NOT REMOVE. Null on
        // legacy orders (pre-PR-49/46); map slot hides automatically.
        shopLocation={order.shopLocation ?? null}
        dropLocation={
          order.deliveryLocation
            ? { lat: order.deliveryLocation.lat, lng: order.deliveryLocation.lng }
            : null
        }
        // PR-NEXT-5.1 §E — DO NOT REMOVE. Drives the tappable trust
        // line → PartnerReviewsScreen. Null on unclaimed orders.
        partnerUid={order.deliveryPersonId ?? null}
      />
    </SafeAreaView>
  );

  // PR 27 — Async + Promise-returning so `usePressGuard` can hold
  // its busy flag for the entire Razorpay round-trip. The Promise
  // resolves when Razorpay's `handler` / `ondismiss` / `onError`
  // fires, so a re-entrant tap on "Pay X now" while the overlay is
  // open is a guaranteed no-op.
  async function handleRetryPayment(): Promise<void> {
    if (!order) return;
    setPaying(true);
    try {
      const session = await orderService.retryPayment(order.id);
      await new Promise<void>(resolve => {
        openRazorpayCheckout({
          key: session.razorpayKeyId,
          order_id: session.razorpayOrderId,
          amount: Math.round(session.total * 100),
          currency: 'INR',
          name: 'grocery-mvp',
          description: `Order ${order.id}`,
          prefill: {
            name: order.deliveryAddress.name,
            contact: order.deliveryAddress.phone,
          },
          theme: { color: colors.primary },
          handler: () => {
            // Webhook will flip paymentStatus to 'paid'; watchOrder
            // picks it up within 5s on native or instantly on web.
            Analytics.payment_success({
              order_id: order.id,
              value: session.total,
            });
            setPaying(false);
            resolve();
          },
          modal: {
            ondismiss: () => {
              setPaying(false);
              showAlert(
                'Payment cancelled',
                'Your order is still pending. You can retry any time before it expires.',
              );
              resolve();
            },
          },
          onError: (err: any) => {
            setPaying(false);
            const reason: string =
              err?.error?.description ?? err?.description ?? 'unknown';
            Analytics.payment_failed({ order_id: order.id, reason });
            Sentry.captureMessage(
              `Payment retry failed for order ${order.id}: ${reason}`,
              'warning',
            );
            showAlert(
              'Payment failed',
              reason === 'unknown' ? 'Please try again.' : reason,
            );
            resolve();
          },
        });
      });
    } catch (err: any) {
      setPaying(false);
      showAlert(
        'Could not retry payment',
        err?.message ?? 'Try again in a moment.',
      );
    }
  }

  // PR-NEXT-3 §G (finding #12 Part A) — customer-initiated COD →
  // online conversion. Mirrors `handleRetryPayment` above, with
  // two key differences:
  //   1. Calls `payCodOrder` (not `retryPayment`) — different
  //      server-side preconditions (COD-only, race-guard against
  //      partner Part B).
  //   2. On Razorpay success calls `confirmPayment` explicitly
  //      (the same pattern `CheckoutScreen` uses on first-time
  //      online checkout). `retryPayment` above relies on the
  //      webhook backstop; for COD conversion we want immediate
  //      confirmation because the COD-conversion fan-out push
  //      fires from inside `confirmPayment`, not from the
  //      webhook. Without this explicit call the shop owner /
  //      admin / delivery partner wouldn't see the "paid online"
  //      push for ~30 seconds, which is enough time for the
  //      partner to call the customer asking for cash. Failure
  //      of `confirmPayment` falls back to the webhook so the
  //      order eventually flips to paid regardless.
  async function handlePayCodOrder(): Promise<void> {
    if (!order) return;
    setPaying(true);
    try {
      const session = await orderService.payCodOrder(order.id);
      await new Promise<void>(resolve => {
        openRazorpayCheckout({
          key: session.razorpayKeyId,
          order_id: session.razorpayOrderId,
          amount: Math.round(session.total * 100),
          currency: 'INR',
          name: 'grocery-mvp',
          description: `Order ${order.id} (COD → online)`,
          prefill: {
            name: order.deliveryAddress.name,
            contact: order.deliveryAddress.phone,
          },
          theme: { color: colors.primary },
          handler: async response => {
            Analytics.payment_success({
              order_id: order.id,
              value: session.total,
            });
            // PR-NEXT-3 — explicit confirmPayment so the server's
            // COD-conversion fan-out fires immediately (see
            // `confirmPayment` post-write block in
            // `functions/src/index.ts`). Webhook backstop is the
            // safety net if this call fails (network blip /
            // signature edge case) — the order still flips to
            // paid via `razorpayWebhook → payment.captured`.
            try {
              await orderService.confirmPayment({
                orderId: order.id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              });
            } catch (e: any) {
              console.warn(
                '[OrderDetail] confirmPayment after payCodOrder failed; relying on webhook:',
                e?.message ?? e,
              );
              Sentry.captureMessage(
                `confirmPayment-after-payCodOrder failed for order ${order.id}: ${e?.message ?? 'unknown'}`,
                'warning',
              );
            }
            setPaying(false);
            resolve();
          },
          modal: {
            ondismiss: () => {
              setPaying(false);
              showAlert(
                'Payment cancelled',
                'Your order is still set to Cash on Delivery. You can try paying online again any time.',
              );
              resolve();
            },
          },
          onError: (err: any) => {
            setPaying(false);
            const reason: string =
              err?.error?.description ?? err?.description ?? 'unknown';
            Analytics.payment_failed({ order_id: order.id, reason });
            Sentry.captureMessage(
              `payCodOrder Razorpay failed for order ${order.id}: ${reason}`,
              'warning',
            );
            showAlert(
              'Payment failed',
              reason === 'unknown' ? 'Please try again.' : reason,
            );
            resolve();
          },
        });
      });
    } catch (err: any) {
      setPaying(false);
      showAlert(
        'Could not start online payment',
        err?.message ?? 'Try again in a moment.',
      );
    }
  }

  // PR 27 — Async so `usePressGuard` holds across the confirm
  // dialog AND the cancel callable. Returns early (`ok=false`) if
  // the user dismisses; the guard then clears via `finally` and
  // the button is tappable again.
  async function handleCancel(): Promise<void> {
    if (!order) return;
    const ok = await confirmAlertAsync(
      'Cancel this order?',
      'This will release the order. You can place a new one anytime.',
      'Cancel order',
    );
    if (!ok) return;
    setCancelling(true);
    try {
      await orderService.cancelMyPendingOrder(order.id);
      // watchOrder snapshot/poll will reflect status='cancelled'.
    } catch (err: any) {
      showAlert('Could not cancel', err?.message ?? 'Please try again.');
    } finally {
      setCancelling(false);
    }
  }

  // PR 7 — In-window paid-order cancel handler. Server is the gate;
  // we just optimistically reflect the refund_pending state so the
  // UI doesn't briefly show the countdown card again before the
  // watcher repolls. On error, leave the card in place so the user
  // can retry.
  async function handleWindowCancel(): Promise<void> {
    if (!order) return;
    const ok = await confirmAlertAsync(
      'Cancel this order?',
      `You'll be refunded ${formatRupees(order.total)} to your original payment method (5–7 business days).`,
      'Cancel & refund',
    );
    if (!ok) return;
    setWindowCancelling(true);
    try {
      await orderService.cancelMyRecentPaidOrder({ orderId: order.id });
      // Optimistic local update — the watcher will overwrite with
      // the server's canonical doc within 5s.
      setOrder({
        ...order,
        status: 'cancelled',
        paymentStatus: 'refund_pending',
      });
    } catch (err: any) {
      showAlert('Could not cancel', err?.message ?? 'Please try again.');
    } finally {
      setWindowCancelling(false);
    }
  }
}

// PR 7 — pure formatter for the live countdown. `1:23` style. Kept
// inline (not in utils/format) because it's specific to the cancel
// window's mm:ss display; if a second use site appears, promote it.
function formatMmSs(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
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
      <Text style={bold ? typography.bodyBold : [typography.body, { color: colors.textSecondary }]}>
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
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  statusCard: {
    backgroundColor: colors.primaryLight,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  orderId: { ...typography.caption, color: colors.textSecondary },
  placedAt: { ...typography.caption, marginTop: spacing.sm },
  eta: { ...typography.bodyBold, color: colors.primaryDark, marginTop: spacing.xs },
  // PR 36.1 — two-line pickup countdown. Primary line is bold +
  // primaryDark (matches the existing `eta` style). Secondary is
  // smaller / muted so the relative time remains the visual anchor.
  pickupRow: { marginTop: spacing.xs },
  pickupPrimary: { ...typography.bodyBold, color: colors.primaryDark },
  pickupSecondary: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  sectionTitle: { ...typography.h3, marginTop: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  addressLine: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  itemDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  itemImage: { width: 48, height: 48, borderRadius: radii.sm, backgroundColor: colors.bg },
  itemMeta: { ...typography.caption, marginTop: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  paymentNote: { ...typography.caption, color: colors.danger, marginTop: spacing.sm },
  // PR 19 fix — COD cancel card styles. Same shape as recoveryCard
  // but neutral surface instead of danger-tinted because COD cancel
  // is a normal customer action, not an "incomplete payment" alarm.
  codCancelCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  codCancelTitle: { ...typography.h3 },
  codCancelSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  recoveryCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  recoveryTitle: { ...typography.h3, color: colors.danger },
  recoverySubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  errorBanner: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: '#FEF2F2',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  errorText: { ...typography.body, color: colors.danger },
  // PR 17 — Call shop button styles. Primary-tinted pill that
  // sits flush under the shop-name section title; mirrors the
  // visual weight of PR 7's cancelWindowCard but at row scale.
  callShopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primaryLight,
    borderRadius: radii.md,
    alignSelf: 'flex-start',
  },
  callShopText: {
    ...typography.bodyBold,
    color: colors.primaryDark,
  },
  // PR 7 — in-window cancel card styles. Distinct from the
  // recoveryCard (which is danger-colored for "payment incomplete")
  // — this one is informational/primary-tinted because the customer
  // is on the happy path and just exercising a self-service option.
  cancelWindowCard: {
    backgroundColor: colors.primaryLight,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  cancelWindowTitle: { ...typography.h3, color: colors.primaryDark },
  cancelWindowSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  cancelWindowCardExpired: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelWindowTitleExpired: {
    ...typography.bodyBold,
    color: colors.textSecondary,
  },
  // PR 20 — rating prompt + post-rating confirmation styles. The
  // wrap is just a margin spacer so the card visually breathes
  // from the cancel-window block above; the card itself owns its
  // border + padding via `RateOrderCard`'s internal styles.
  rateCardWrap: { marginTop: spacing.sm },
  ratedCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  ratedTitle: { ...typography.bodyBold, marginBottom: spacing.xs },
  // Tailwind amber-500 to match RateOrderCard's `starFilled`.
  ratedStars: {
    fontSize: 28,
    color: '#F59E0B',
    letterSpacing: 2,
  },
  ratedComment: {
    ...typography.body,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  // PR 42.1 — dual-rating panel additions. Subtitle precedes each
  // star row to distinguish shop vs. delivery; the delivery block
  // sits below the shop block with extra top spacing so the two
  // ratings read as related but separate.
  ratedSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  ratedDeliveryBlock: {
    marginTop: spacing.md,
    alignItems: 'center',
  },
  // PR 21 — customer-side read-only confirmation card. Subdued
  // styling (surface bg, no accent) — this is a confirmation of
  // a choice already made, not a call-to-action.
  subInfoCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  subInfoLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  subInfoValue: { ...typography.bodyBold },
});
