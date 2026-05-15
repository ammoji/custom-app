import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../components/common/Button';
import EmptyState from '../components/common/EmptyState';
import Input from '../components/common/Input';
import ScreenHeader from '../components/common/ScreenHeader';
import { colors, radii, spacing, typography } from '../constants/theme';
import { Analytics } from '../services/analytics';
import { orderService } from '../services/orderService';
import { Sentry } from '../services/sentry';
import { useAuthStore } from '../store/useAuthStore';
import { useCartStore } from '../store/useCartStore';
import type { Address, PaymentMethod } from '../types';
import { formatRupees } from '../utils/format';
import { openRazorpayCheckout } from '../utils/razorpay';

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

  const [name, setName] = useState('Sudhir Davim');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('New Delhi');
  const [pincode, setPincode] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [placing, setPlacing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cod');

  const validate = (): Errors => {
    const e: Errors = {};
    if (!name.trim()) e.name = 'Required';
    if (!line1.trim()) e.line1 = 'Required';
    if (!city.trim()) e.city = 'Required';
    if (!/^\d{6}$/.test(pincode)) e.pincode = '6-digit pincode';
    if (!/^\+?\d{10,13}$/.test(phone.replace(/\s/g, ''))) e.phone = 'Valid phone required';
    return e;
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

    const address: Address = {
      name: name.trim(),
      line1: line1.trim(),
      line2: line2.trim() || undefined,
      city: city.trim(),
      pincode: pincode.trim(),
      phone: phone.trim(),
    };

    try {
      const result = await orderService.placeOrder({
        shopId,
        items,
        address,
        paymentMethod,
      });
      Analytics.place_order({
        order_id: result.orderId,
        value: total,
        payment_method: paymentMethod,
      });

      if (paymentMethod === 'cod') {
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
        prefill: { name: address.name, contact: address.phone },
        theme: { color: colors.primary },
        handler: () => {
          // Payment success — the razorpayWebhook Function flips
          // paymentStatus to 'paid' asynchronously; OrderConfirmation
          // picks it up via watchOrder (web SDK snapshot or native poll).
          Analytics.payment_success({ order_id: result.orderId, value: result.total });
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
            onPress={placeOrder}
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
});
