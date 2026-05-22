import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../components/common/Button';
import EmptyState from '../components/common/EmptyState';
import Input from '../components/common/Input';
import ScreenHeader from '../components/common/ScreenHeader';
import { colors, radii, spacing, typography } from '../constants/theme';
import { Analytics } from '../services/analytics';
import { orderService } from '../services/orderService';
import { profileService } from '../services/profileService';
import { Sentry } from '../services/sentry';
import { useAuthStore } from '../store/useAuthStore';
import { useCartStore } from '../store/useCartStore';
import type { Address, PaymentMethod, SavedAddress, SubstitutionPreference, UserProfile } from '../types';
// PR 5 — DO NOT REMOVE. Auto-formatter stripped this import once during
// PR 5. Used in the Razorpay `prefill.email` field below.
import { deriveCheckoutEmail } from '../utils/checkoutEmail';
import { formatRupees } from '../utils/format';
import { openRazorpayCheckout } from '../utils/razorpay';
import { usePressGuard } from '../hooks/usePressGuard';

type Errors = Partial<Record<'name' | 'line1' | 'city' | 'pincode' | 'phone', string>>;

const showAlert = (title: string, message: string) => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // eslint-disable-next-line no-alert
    window.alert(`${title}\n\n${message}`);
  } else {
    // Lazy import keeps react-native-web's flaky Alert export off the web bundle path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Alert } = require('react-native');
    Alert.alert(title, message);
  }
};

export default function CheckoutScreen() {
  const nav = useNavigation<any>();
  const items = useCartStore(s => s.items);
  const shopId = useCartStore(s => s.shopId);
  const shopName = useCartStore(s => s.shopName);
  const deliveryFee = useCartStore(s => s.deliveryFee);
  const subtotal = useCartStore(s => s.subtotal());
  const total = useCartStore(s => s.total());
  const clearCart = useCartStore(s => s.clearCart);

  const [name, setName] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('New Delhi');
  const [pincode, setPincode] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [placing, setPlacing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cod');
  // PR 21 — substitution preference. Hoisted with the other useState
  // calls above any early-return per Rules-of-Hooks discipline (PR 12
  // → 17 → 19 → 20 → 21 lineage). Default 'call_me' is the safest
  // choice for first-time users; the picker below lets them switch
  // to 'auto' (shop replaces with similar) or 'refund' (shop drops
  // the item + adjusts the total) to skip the call entirely.
  const [substitutionPreference, setSubstitutionPreference] =
    useState<SubstitutionPreference>('call_me');
  // PR 22 — per-order delivery instructions. Pre-filled from the
  // selected saved address (or empty when starting from a form-mode
  // entry), and editable per-order without touching the saved
  // address book row. The override is captured on the order's
  // deliveryAddress snapshot. Hoisted with the other field state.
  const [orderInstructions, setOrderInstructions] = useState('');

  // Phase 12a-v2-iv: saved-address picker. The screen has two modes
  // distinguished by `usingForm`:
  //   - Picker mode: profile has ≥1 saved address AND user hasn't
  //     opted to enter a new one. Render selectable cards; selecting
  //     one mirrors its fields into the local state so placeOrder
  //     reads from the same form fields it always has (no special
  //     branch in the order placement path).
  //   - Form mode: profile has 0 addresses, OR user tapped "Use a
  //     different address". Same form as before.
  // `selectedAddressId !== null` means "this address came from the
  // saved book" — used after order placement to skip the save prompt.
  // Reset to default on every focus per Sudhir's UX call (cart
  // survives nav, address selection does not).
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(
    null,
  );
  const [usingForm, setUsingForm] = useState(false);
  // Phase 12a-v2-iv-followup: when getMyProfile fails the user used
  // to silently drop into form mode with no explanation. That made
  // diagnostic work impossible — we couldn't tell whether the user
  // genuinely had no saved addresses, or the call was failing. The
  // banner below renders a yellow notice with the actual error
  // message + a Retry button when this is non-null. Root cause of
  // the failure is tracked separately; this is the observability
  // surface, not a fix.
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const isAnonymous = useAuthStore(s => s.isAnonymous);

  // Hydrate from saved profile every time the screen focuses. Anonymous
  // users have no profile to hydrate from — they'll get the form. The
  // call is auth-required so we skip it cleanly.
  useFocusEffect(
    useCallback(() => {
      if (isAnonymous) {
        setProfileLoaded(true);
        return;
      }
      let cancelled = false;
      profileService
        .getMyProfile()
        .then(p => {
          if (cancelled) return;
          setProfile(p);
          // Reset selection on entry — pick the default if any.
          const def = p.defaultAddressId
            ? p.addresses.find(a => a.id === p.defaultAddressId)
            : p.addresses[0];
          if (def) {
            applySavedToForm(def);
            setSelectedAddressId(def.id);
            setUsingForm(false);
          } else {
            setSelectedAddressId(null);
            setUsingForm(true);
          }
        })
        .catch(e => {
          // Phase 12a-v2-iv-followup: keep the user moving (form mode
          // is a valid fallback) but make the failure VISIBLE — both
          // in the device console (with stack) AND on screen so the
          // user knows their saved addresses aren't being ignored on
          // purpose. The original silent fallthrough hid a real bug
          // that took a solo-test repro to catch.
          console.warn(
            '[Checkout] getMyProfile failed:',
            e?.code ?? 'no-code',
            e?.message ?? e,
            e?.stack ?? '(no stack)',
          );
          setProfileLoadError(
            e?.message
              ? `Couldn't load saved addresses (${e.message}). Enter manually below.`
              : "Couldn't load saved addresses. Enter manually below.",
          );
          setUsingForm(true);
        })
        .finally(() => {
          if (!cancelled) setProfileLoaded(true);
        });
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAnonymous]),
  );

  const applySavedToForm = (addr: SavedAddress) => {
    setName(addr.name);
    setLine1(addr.line1);
    setLine2(addr.line2 ?? '');
    setCity(addr.city);
    setPincode(addr.pincode);
    setPhone(addr.phone);
    // PR 22 — pre-fill the per-order instructions from the saved
    // address. Customer can still edit; the edit only lives on the
    // order doc.
    setOrderInstructions(addr.deliveryInstructions ?? '');
    setErrors({});
  };

  const onPickSaved = (addr: SavedAddress) => {
    applySavedToForm(addr);
    setSelectedAddressId(addr.id);
    setUsingForm(false);
  };

  const onUseDifferent = () => {
    setSelectedAddressId(null);
    setUsingForm(true);
    // Don't clear fields — let the user edit on top of the
    // selected address. They can manually clear if they want.
  };

  const validate = (): Errors => {
    const e: Errors = {};
    if (!name.trim()) e.name = 'Required';
    if (!line1.trim()) e.line1 = 'Required';
    if (!city.trim()) e.city = 'Required';
    if (!/^\d{6}$/.test(pincode)) e.pincode = '6-digit pincode';
    if (!/^\+?\d{10,13}$/.test(phone.replace(/\s/g, ''))) e.phone = 'Valid phone required';
    return e;
  };

  /**
   * After a successful order:
   *   - If the address came from the saved book, do nothing.
   *   - If the user has 0 prior saved addresses, auto-save silently
   *     (becomes their default).
   *   - Otherwise prompt "Save this address?". Crude window.confirm /
   *     Alert.alert because we don't want a custom modal in the
   *     OrderConfirmation flow.
   */
  const maybeSaveAddressAfterOrder = async (addr: Address) => {
    if (selectedAddressId) return;
    const priorCount = profile?.addresses.length ?? 0;
    const persist = async () => {
      try {
        await profileService.saveAddress({
          name: addr.name,
          phone: addr.phone,
          line1: addr.line1,
          line2: addr.line2,
          city: addr.city,
          pincode: addr.pincode,
        });
      } catch (err) {
        // Silent — order is already placed, missing a saved-address
        // sync isn't worth surfacing.
        console.warn('[Checkout] saveAddress post-order failed:', err);
      }
    };
    if (priorCount === 0) {
      await persist();
      return;
    }
    const ok = await new Promise<boolean>(resolve => {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        // eslint-disable-next-line no-alert
        resolve(window.confirm('Save this address for next time?'));
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Alert } = require('react-native');
      Alert.alert('Save this address?', 'Use it next time without re-typing.', [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Save', onPress: () => resolve(true) },
      ]);
    });
    if (ok) await persist();
  };

  const placeOrder = async () => {
    // Phone-auth gate: anonymous users must sign in before placing an
    // order so we can confirm + send delivery updates. Browsing/cart
    // still work anonymously (conversion-optimal funnel). Active on
    // both web (reCAPTCHA flow) and native (RNFB phone auth, Phase 9c).
    if (useAuthStore.getState().isAnonymous) {
      const goSignIn = () =>
        nav.navigate('Login', { returnTo: 'Checkout' });
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        // eslint-disable-next-line no-alert
        const ok = window.confirm(
          'Sign in to place order\n\n' +
            'Add your phone number so we can confirm your order and send ' +
            'delivery updates.',
        );
        if (ok) goSignIn();
      } else {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Alert } = require('react-native');
        Alert.alert(
          'Sign in to place order',
          'Add your phone number so we can confirm your order and send ' +
            'delivery updates.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign in', onPress: goSignIn },
          ],
        );
      }
      return;
    }

    Analytics.begin_checkout({ value: total, item_count: items.length });
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    if (!shopId) return;

    setPlacing(true);

    // Phase 12a-v2-iv-hotfix-1 OTA verification probe. Logs the
    // cart-line shape immediately before submission so you can
    // confirm post-OTA that menuItemId is present on every line.
    // If you see `menuItemId: undefined` here on your device after
    // pulling the OTA, the new code is NOT yet running. If you see
    // a real id like `p_008_atta` here AND placeOrder still rejects
    // with "not in this shop", the bug is elsewhere (different code
    // path adding to cart, or the menu doc genuinely missing for
    // this shop). Dev-only — stripped in release builds.
    if (__DEV__) {
      console.log(
        '[Checkout] cart shape @ placeOrder:',
        JSON.stringify(
          items.map(i => ({
            productId: i.productId,
            menuItemId: i.menuItemId ?? '<MISSING>',
            priceSnapshot: i.priceSnapshot ?? '<MISSING>',
            qty: i.quantity,
          })),
          null,
          2,
        ),
        'cart.shopId:',
        shopId,
      );
    }

    const address: Address = {
      name: name.trim(),
      line1: line1.trim(),
      line2: line2.trim() || undefined,
      city: city.trim(),
      pincode: pincode.trim(),
      phone: phone.trim(),
      // PR 22 — instructions snapshot for this order. Empty /
      // whitespace-only → undefined so the server omits the field
      // (instead of persisting a blank string). The saved-address
      // book row is NOT updated; this is per-order only.
      deliveryInstructions: orderInstructions.trim() || undefined,
    };

    try {
      const result = await orderService.placeOrder({
        shopId,
        items,
        address,
        paymentMethod,
        // PR 21 — pre-stated substitution intent. Server re-validates
        // via normalizeSubstitutionPreference + persists onto the
        // order doc. ShopOrderDetail reads this prominently so the
        // shop doesn't have to call mid-fulfillment for unavailable
        // items the customer already decided about.
        substitutionPreference,
      });
      Analytics.place_order({
        order_id: result.orderId,
        value: total,
        payment_method: paymentMethod,
      });

      if (paymentMethod === 'cod') {
        // Fire-and-forget save prompt before clearing cart, so the
        // network call gets the user's `address` snapshot intact.
        // Awaited so the OrderConfirmation nav doesn't race ahead
        // and unmount the dialog mid-prompt.
        await maybeSaveAddressAfterOrder(address);
        clearCart();
        nav.replace('OrderConfirmation', { orderId: result.orderId });
        return;
      }

      // Online path — Razorpay Checkout. openRazorpayCheckout dispatches
      // to the web overlay or the native PaymentSheet based on Platform.OS.
      // All callbacks fire with the same payload shape on both platforms.
      if (!result.razorpayOrderId || !result.razorpayKeyId) {
        throw new Error('Payment session not created');
      }
      await openRazorpayCheckout({
        key: result.razorpayKeyId,
        order_id: result.razorpayOrderId,
        amount: Math.round(result.total * 100),
        currency: 'INR',
        name: 'grocery-mvp',
        description: `Order ${result.orderId}`,
        // PR 5 — prefill email too. Razorpay shows an email field by
        // default (RBI compliance for receipt delivery); without
        // prefill the customer hits an extra mandatory input at the
        // worst moment of the flow. Real receipts go to
        // profile.email when set; otherwise a sentinel placeholder
        // on the `noemail.kiranamart.app` domain that satisfies
        // Razorpay's input validation without creating a fake real
        // email. See src/utils/checkoutEmail.ts for the rules.
        prefill: {
          name: address.name,
          contact: address.phone,
          email: deriveCheckoutEmail(profile, address.phone),
        },
        theme: { color: colors.primary },
        handler: async response => {
          // PR 2 — payment hardening, Phase B (item 4). Razorpay's
          // success callback gives us order id + payment id +
          // signature. Verify them server-side via confirmPayment so
          // the order shows paid SYNCHRONOUSLY rather than waiting
          // up to ~30s for the asynchronous webhook. The webhook is
          // still the source of truth — confirmPayment is idempotent
          // and the webhook's "already paid" branch no-ops on the
          // late arrival. If confirmPayment fails (network blip,
          // signature edge case) we navigate anyway and let the
          // webhook backstop us; OrderConfirmation polls the order
          // status so the customer sees the paid flip when it
          // arrives.
          Analytics.payment_success({
            order_id: result.orderId,
            value: result.total,
          });
          try {
            await orderService.confirmPayment({
              orderId: result.orderId,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
          } catch (e: any) {
            console.warn(
              '[CheckoutScreen] confirmPayment failed; relying on webhook:',
              e?.message ?? e,
            );
            Sentry.captureMessage(
              `confirmPayment failed for order ${result.orderId}: ${e?.message ?? 'unknown'}`,
              'warning',
            );
          }
          await maybeSaveAddressAfterOrder(address);
          clearCart();
          nav.replace('OrderConfirmation', { orderId: result.orderId });
        },
        modal: {
          ondismiss: () => {
            setPlacing(false);
            showAlert(
              'Payment cancelled',
              'Your order was created but payment was not completed. ' +
                'You can retry from your order details later.',
            );
          },
        },
        onError: (err: any) => {
          setPlacing(false);
          // Web errors come as { error: { description } }; native errors
          // come as { code, description }. Try both shapes.
          const reason: string =
            err?.error?.description ?? err?.description ?? 'unknown';
          Analytics.payment_failed({ order_id: result.orderId, reason });
          Sentry.captureMessage(
            `Payment failed for order ${result.orderId}: ${reason}`,
            'warning',
          );
          showAlert(
            'Payment failed',
            reason === 'unknown'
              ? 'Please try a different payment method.'
              : reason,
          );
        },
      });
    } catch (err: any) {
      setPlacing(false);
      const message = err?.message || 'Could not place order. Please try again.';
      showAlert('Order failed', message);
    }
  };

  // PR 27 — Re-entrancy guard for the Place Order / Pay button. The
  // existing `disabled={placing}` is paint-time defense only; a
  // double-tap fired BEFORE React re-renders the disabled state can
  // create two Razorpay sessions. usePressGuard flips a ref
  // synchronously inside the handler so the second tap is a
  // guaranteed no-op while the first is in-flight.
  const guardedPlaceOrder = usePressGuard(placeOrder);

  if (items.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Checkout" onBack={() => nav.goBack()} />
        <EmptyState
          title="Your cart is empty"
          subtitle="Add items before checking out."
          ctaLabel="Browse shops"
          onCtaPress={() => nav.navigate('ShopList')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Checkout" onBack={() => nav.goBack()} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Delivery address</Text>

          {profileLoadError && (
            <View style={styles.profileLoadBanner}>
              <Text style={styles.profileLoadBannerText}>{profileLoadError}</Text>
              <Pressable
                onPress={() => {
                  setProfileLoadError(null);
                  setProfileLoaded(false);
                  setUsingForm(false);
                  // Re-trigger the focus effect by clearing the loaded
                  // flag. The effect's cancellation guard keeps this
                  // safe even if the user spam-taps Retry.
                  profileService
                    .getMyProfile()
                    .then(p => {
                      setProfile(p);
                      const def = p.defaultAddressId
                        ? p.addresses.find(a => a.id === p.defaultAddressId)
                        : p.addresses[0];
                      if (def) {
                        applySavedToForm(def);
                        setSelectedAddressId(def.id);
                        setUsingForm(false);
                      } else {
                        setUsingForm(true);
                      }
                    })
                    .catch(err => {
                      console.warn('[Checkout] retry getMyProfile failed:', err);
                      setProfileLoadError(
                        err?.message
                          ? `Still failing (${err.message}). Enter manually.`
                          : 'Still failing. Enter manually.',
                      );
                      setUsingForm(true);
                    })
                    .finally(() => setProfileLoaded(true));
                }}
                accessibilityRole="button"
                accessibilityLabel="Retry loading saved addresses"
              >
                <Text style={styles.profileLoadBannerRetry}>Retry</Text>
              </Pressable>
            </View>
          )}

          {/* Picker mode: profile has saved addresses and user hasn't
              opted into the form. Cards are radio-selectable; the
              selected one drives the form fields invisibly so order
              placement keeps using the same code path. */}
          {profileLoaded && !usingForm && (profile?.addresses.length ?? 0) > 0 && (
            <View style={styles.formGroup}>
              {profile!.addresses.map(addr => {
                const selected = addr.id === selectedAddressId;
                return (
                  <Pressable
                    key={addr.id}
                    onPress={() => onPickSaved(addr)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={addr.label || 'Saved address'}
                    style={[
                      styles.savedCard,
                      selected && styles.savedCardSelected,
                    ]}
                  >
                    <View
                      style={[styles.radio, selected && styles.radioSelected]}
                    >
                      {selected && <View style={styles.radioDot} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={typography.bodyBold}>
                        {addr.label || 'Address'}
                        {addr.id === profile?.defaultAddressId
                          ? ' · Default'
                          : ''}
                      </Text>
                      <Text
                        style={[typography.caption, { marginTop: 2 }]}
                        numberOfLines={2}
                      >
                        {[addr.line1, addr.line2, addr.city, addr.pincode]
                          .filter(Boolean)
                          .join(', ')}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={onUseDifferent}
                accessibilityRole="button"
                accessibilityLabel="Use a different address"
                style={styles.useDifferentRow}
              >
                <Text style={styles.useDifferentText}>Use a different address</Text>
              </Pressable>
            </View>
          )}

          {/* Form mode: 0 saved addresses, or user tapped "Use a
              different address". The form is the long-standing
              checkout entry surface — unchanged behaviour. */}
          {(usingForm || (profileLoaded && (profile?.addresses.length ?? 0) === 0)) && (
          <View style={styles.formGroup}>
            <Input value={name} onChangeText={setName} placeholder="Full name" error={errors.name} />
            <Input value={line1} onChangeText={setLine1} placeholder="Address line 1 (house, street)" error={errors.line1} />
            <Input value={line2} onChangeText={setLine2} placeholder="Address line 2 (landmark, optional)" />
            <View style={styles.rowFields}>
              <View style={{ flex: 1 }}>
                <Input value={city} onChangeText={setCity} placeholder="City" error={errors.city} />
              </View>
              <View style={{ width: 130 }}>
                <Input
                  value={pincode}
                  onChangeText={setPincode}
                  placeholder="Pincode"
                  keyboardType="numeric"
                  maxLength={6}
                  error={errors.pincode}
                />
              </View>
            </View>
            <Input
              value={phone}
              onChangeText={setPhone}
              placeholder="Phone number"
              keyboardType="phone-pad"
              error={errors.phone}
            />
          </View>
          )}

          <Text style={styles.label}>Order summary</Text>
          <View style={styles.summaryCard}>
            <Text style={typography.bodyBold}>{shopName}</Text>
            <Text style={[typography.caption, { marginTop: 2 }]}>{items.length} items</Text>
            <View style={styles.divider} />
            {items.map(i => (
              <View key={i.productId} style={styles.summaryRow}>
                <Text style={[typography.body, { flex: 1 }]} numberOfLines={1}>
                  {i.name} × {i.quantity}
                </Text>
                <Text style={typography.body}>{formatRupees(i.price * i.quantity)}</Text>
              </View>
            ))}
            <View style={styles.divider} />
            <View style={styles.summaryRow}>
              <Text style={typography.body}>Item total</Text>
              <Text style={typography.body}>{formatRupees(subtotal)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={typography.body}>Delivery fee</Text>
              <Text style={typography.body}>{formatRupees(deliveryFee)}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.summaryRow}>
              <Text style={typography.bodyBold}>Total</Text>
              <Text style={typography.bodyBold}>{formatRupees(total)}</Text>
            </View>
          </View>

          {/* PR 22 — per-order delivery instructions. Sits between
              the bill summary and substitution picker so the
              customer can scan address → instructions →
              substitution → payment top-to-bottom in a single
              cognitive pass. Pre-filled from the picked address;
              edits stay on the order doc and don't mutate the
              saved address book row. */}
          <Text style={styles.label}>Delivery instructions</Text>
          <TextInput
            value={orderInstructions}
            onChangeText={t => setOrderInstructions(t.slice(0, 280))}
            placeholder="Optional — e.g. Ring twice, leave at door"
            placeholderTextColor={colors.textSecondary}
            multiline
            style={styles.instructionsInput}
          />
          <Text style={styles.charCount}>
            {orderInstructions.length}/280
          </Text>

          {/* PR 21 — substitution preference picker. Sits between
              the bill summary and the payment method so the customer
              consciously chooses BEFORE committing to pay. Default
              'call_me' covers the safe path; tapping 'auto' or
              'refund' explicitly opts out of the call. */}
          <Text style={styles.label}>If something&apos;s unavailable</Text>
          <View style={styles.subRow}>
            {([
              {
                value: 'call_me',
                label: '📞 Call me first',
                sub: 'Shop will call before changing anything',
              },
              {
                value: 'auto',
                label: '🔄 Replace with similar',
                sub: 'Shop picks an equivalent item',
              },
              {
                value: 'refund',
                label: '💰 Refund the item',
                sub: 'Skip the item; adjust the total',
              },
            ] as const).map(opt => {
              const active = substitutionPreference === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setSubstitutionPreference(opt.value)}
                  style={[
                    styles.subOption,
                    active && styles.subOptionActive,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={opt.label}
                >
                  <Text
                    style={[
                      styles.subOptionLabel,
                      active && styles.subOptionLabelActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                  <Text style={styles.subOptionSub}>{opt.sub}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Payment</Text>
          <PaymentOption
            selected={paymentMethod === 'cod'}
            onPress={() => setPaymentMethod('cod')}
            title="Cash on Delivery"
            subtitle="Pay when your order arrives"
          />
          <View style={{ height: spacing.md }} />
          <PaymentOption
            selected={paymentMethod === 'online'}
            onPress={() => setPaymentMethod('online')}
            title="Pay Online (UPI / Cards / NetBanking)"
            subtitle="Powered by Razorpay"
          />
        </ScrollView>

        <View style={styles.ctaWrap}>
          <Button
            title={
              placing
                ? 'Placing order...'
                : paymentMethod === 'cod'
                  ? `Place Order · ${formatRupees(total)}`
                  : `Pay ${formatRupees(total)}`
            }
            onPress={guardedPlaceOrder}
            loading={placing}
            fullWidth
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PaymentOption({
  selected,
  onPress,
  title,
  subtitle,
  disabled,
}: {
  selected: boolean;
  onPress: () => void;
  title: string;
  subtitle: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={title}
      style={[
        styles.payOption,
        selected && styles.payOptionSelected,
        disabled && styles.payOptionDisabled,
      ]}
    >
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected && <View style={styles.radioDot} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={typography.bodyBold}>{title}</Text>
        <Text style={[typography.caption, { marginTop: 2 }]}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  label: { ...typography.h3, marginBottom: spacing.sm },
  formGroup: { gap: spacing.md, marginBottom: spacing.xl },
  rowFields: { flexDirection: 'row', gap: spacing.md },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  payOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  payOptionSelected: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  payOptionDisabled: { opacity: 0.5 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.primary },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  ctaWrap: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  // Phase 12a-v2-iv: saved-address picker styles.
  savedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  savedCardSelected: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  useDifferentRow: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  useDifferentText: {
    ...typography.bodyBold,
    color: colors.primary,
  },
  // Phase 12a-v2-iv-followup: profile-load error banner.
  profileLoadBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FEF3C7',
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  profileLoadBannerText: {
    ...typography.caption,
    color: '#92400E',
    flex: 1,
  },
  profileLoadBannerRetry: {
    ...typography.bodyBold,
    color: colors.primary,
  },
  // PR 21 — substitution preference picker styles. Mirrors the
  // address-card visual language (border + tinted-active state) so
  // the customer instinctively recognizes it as a selection.
  subRow: { gap: spacing.sm, marginBottom: spacing.lg },
  subOption: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  subOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  subOptionLabel: { ...typography.bodyBold },
  subOptionLabelActive: { color: colors.primaryDark },
  subOptionSub: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  // PR 22 — multiline instructions input + char counter. Mirrors
  // the same styling on AddressEditScreen for consistency.
  instructionsInput: {
    ...typography.body,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 80,
    textAlignVertical: 'top',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    backgroundColor: colors.surface,
  },
  charCount: {
    ...typography.caption,
    color: colors.textSecondary,
    alignSelf: 'flex-end',
    marginBottom: spacing.lg,
  },
});
