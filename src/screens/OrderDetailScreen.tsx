import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../components/common/Button';
import EmptyState from '../components/common/EmptyState';
import Loader from '../components/common/Loader';
import ScreenHeader from '../components/common/ScreenHeader';
import OrderStatusChip from '../components/order/OrderStatusChip';
import RateOrderCard from '../components/order/RateOrderCard';
import { colors, radii, spacing, typography } from '../constants/theme';
import { Analytics } from '../services/analytics';
import { orderService } from '../services/orderService';
import { Sentry } from '../services/sentry';
import { shopService } from '../services/shopService';
import type { Order, Shop } from '../types';
import { formatOrderTime, formatRupees } from '../utils/format';
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

const confirmAlert = (
  title: string,
  message: string,
  onConfirm: () => void,
  confirmLabel = 'Confirm',
) => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // eslint-disable-next-line no-alert
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Alert } = require('react-native');
    Alert.alert(title, message, [
      { text: 'Keep order', style: 'cancel' },
      { text: confirmLabel, style: 'destructive', onPress: onConfirm },
    ]);
  }
};

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

  // PR 20 — local optimistic rating state. Once the customer
  // submits a rating, we want the UI to flip immediately to a
  // "Thanks for rating!" view without waiting for the watcher
  // tick. The watcher will eventually deliver the canonical
  // `order.rating` field and both code paths render the same
  // confirmation. Hoisted here above the screen's early returns,
  // mirroring the PR 7 / PR 17 / PR 19 lineage in this file.
  const [optimisticRating, setOptimisticRating] = useState<{
    stars: number;
    comment?: string;
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
      .catch(() => {
        if (!cancelled) setShop(null);
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

  const minutesLeft = Math.max(0, Math.round((order.estimatedDeliveryAt - Date.now()) / 60_000));

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
      >
        {/* Status header */}
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            {/* PR 12 — customer audience: chip says "Out for
                delivery" when the internal status is
                ready_for_pickup. Familiar phrasing; matches what
                every other delivery app shows. */}
            <OrderStatusChip status={order.status} audience="customer" />
            <Text style={styles.orderId}>{order.id}</Text>
          </View>
          <Text style={styles.placedAt}>Placed {formatOrderTime(order.createdAt)}</Text>
          {/* PR 12 — ETA copy varies by status:
              - accepted / preparing with readyByEstimate: surface
                the shopkeeper's "Ready by HH:MM" so the customer
                sees the same time the shop committed to.
              - other in-flight states (incl. ready_for_pickup):
                fall back to the existing minutes-left estimate.
              - delivered / cancelled: hidden. */}
          {order.status !== 'delivered' &&
            order.status !== 'cancelled' &&
            (order.readyByEstimate &&
            (order.status === 'accepted' || order.status === 'preparing') ? (
              <Text style={styles.eta}>
                Ready by {formatOrderTime(order.readyByEstimate)} at the
                shop. Delivery partner will pick up and bring it to you.
              </Text>
            ) : (
              minutesLeft > 0 && (
                <Text style={styles.eta}>Arriving in ~{minutesLeft} min</Text>
              )
            ))}
        </View>

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
        </View>

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
              onPress={handleWindowCancel}
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
                onPress={handleRetryPayment}
                loading={paying}
                disabled={paying || cancelling}
                fullWidth
              />
              <View style={{ height: spacing.sm }} />
              <Button
                title="Cancel order"
                onPress={handleCancel}
                variant="secondary"
                loading={cancelling}
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
              onPress={handleCancel}
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
          !optimisticRating && (
            <View style={styles.rateCardWrap}>
              <RateOrderCard
                orderId={order.id}
                onRated={(stars, comment) =>
                  setOptimisticRating({ stars, comment })
                }
              />
            </View>
          )}
        {order.status === 'delivered' &&
          (order.rating || optimisticRating) &&
          (() => {
            const stars =
              order.rating?.stars ?? optimisticRating?.stars ?? 0;
            const comment =
              order.rating?.comment ?? optimisticRating?.comment;
            return (
              <View style={styles.ratedCard}>
                <Text style={styles.ratedTitle}>Thanks for rating!</Text>
                <Text style={styles.ratedStars}>
                  {'★'.repeat(stars)}
                  {'☆'.repeat(5 - stars)}
                </Text>
                {comment && (
                  <Text style={styles.ratedComment}>"{comment}"</Text>
                )}
              </View>
            );
          })()}
      </ScrollView>
    </SafeAreaView>
  );

  function handleRetryPayment() {
    if (!order) return;
    setPaying(true);
    (async () => {
      try {
        const session = await orderService.retryPayment(order.id);
        await openRazorpayCheckout({
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
          },
          modal: {
            ondismiss: () => {
              setPaying(false);
              showAlert(
                'Payment cancelled',
                'Your order is still pending. You can retry any time before it expires.',
              );
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
          },
        });
      } catch (err: any) {
        setPaying(false);
        showAlert(
          'Could not retry payment',
          err?.message ?? 'Try again in a moment.',
        );
      }
    })();
  }

  function handleCancel() {
    if (!order) return;
    confirmAlert(
      'Cancel this order?',
      'This will release the order. You can place a new one anytime.',
      async () => {
        setCancelling(true);
        try {
          await orderService.cancelMyPendingOrder(order.id);
          // watchOrder snapshot/poll will reflect status='cancelled'.
        } catch (err: any) {
          showAlert(
            'Could not cancel',
            err?.message ?? 'Please try again.',
          );
        } finally {
          setCancelling(false);
        }
      },
      'Cancel order',
    );
  }

  // PR 7 — In-window paid-order cancel handler. Server is the gate;
  // we just optimistically reflect the refund_pending state so the
  // UI doesn't briefly show the countdown card again before the
  // watcher repolls. On error, leave the card in place so the user
  // can retry.
  function handleWindowCancel() {
    if (!order) return;
    confirmAlert(
      'Cancel this order?',
      `You'll be refunded ${formatRupees(order.total)} to your original payment method (5–7 business days).`,
      async () => {
        setWindowCancelling(true);
        try {
          await orderService.cancelMyRecentPaidOrder({
            orderId: order.id,
          });
          // Optimistic local update — the watcher will overwrite
          // with the server's canonical doc within 5s.
          setOrder({
            ...order,
            status: 'cancelled',
            paymentStatus: 'refund_pending',
          });
        } catch (err: any) {
          showAlert(
            'Could not cancel',
            err?.message ?? 'Please try again.',
          );
        } finally {
          setWindowCancelling(false);
        }
      },
      'Cancel & refund',
    );
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
