import React, { useState } from 'react';
import { ScrollView, View, Text, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCartStore } from '../store/useCartStore';
import ScreenHeader from '../components/common/ScreenHeader';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import EmptyState from '../components/common/EmptyState';
import { colors, spacing, radii, typography } from '../constants/theme';
import { formatRupees } from '../utils/format';

type Errors = Partial<Record<'name' | 'line1' | 'city' | 'pincode' | 'phone', string>>;

export default function CheckoutScreen() {
  const nav = useNavigation<any>();
  const items = useCartStore(s => s.items);
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
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setPlacing(true);
    await new Promise(res => setTimeout(res, 600));

    const orderId = `ORD-${Date.now()}`;
    const etaMinutes = 30;
    const totalSnap = total;
    const shopNameSnap = shopName ?? '';

    nav.replace('OrderConfirmation', {
      orderId,
      total: totalSnap,
      etaMinutes,
      shopName: shopNameSnap,
    });
    clearCart();
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
          <View style={styles.paymentCard}>
            <Text style={typography.bodyBold}>Cash on Delivery</Text>
            <Text style={[typography.caption, { marginTop: 2 }]}>Pay when your order arrives</Text>
          </View>
        </ScrollView>

        <View style={styles.ctaWrap}>
          <Button
            title={placing ? 'Placing order...' : `Place Order · ${formatRupees(total)}`}
            onPress={placeOrder}
            loading={placing}
            fullWidth
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  paymentCard: {
    backgroundColor: colors.primaryLight,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  ctaWrap: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
});
