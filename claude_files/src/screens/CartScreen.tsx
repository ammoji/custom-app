import React from 'react';
import { View, FlatList, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCartStore } from '../store/useCartStore';
import CartLineItem from '../components/cart/CartLineItem';
import ScreenHeader from '../components/common/ScreenHeader';
import Button from '../components/common/Button';
import EmptyState from '../components/common/EmptyState';
import { colors, spacing, radii, typography } from '../constants/theme';
import { formatRupees } from '../utils/format';

export default function CartScreen() {
  const nav = useNavigation<any>();
  const items = useCartStore(s => s.items);
  const shopName = useCartStore(s => s.shopName);
  const deliveryFee = useCartStore(s => s.deliveryFee);
  const subtotal = useCartStore(s => s.subtotal());
  const total = useCartStore(s => s.total());
  const increment = useCartStore(s => s.increment);
  const decrement = useCartStore(s => s.decrement);
  const removeItem = useCartStore(s => s.removeItem);

  if (items.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Your Cart" onBack={() => nav.goBack()} />
        <EmptyState
          title="Your cart is empty"
          subtitle="Add items from a nearby shop to get started."
          ctaLabel="Browse shops"
          onCtaPress={() => nav.navigate('ShopList')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Your Cart" onBack={() => nav.goBack()} />

      <View style={styles.shopBanner}>
        <Text style={typography.bodyBold}>🏪  {shopName}</Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={i => i.productId}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        renderItem={({ item }) => (
          <CartLineItem
            item={item}
            onIncrement={() => increment(item.productId)}
            onDecrement={() => decrement(item.productId)}
            onRemove={() => removeItem(item.productId)}
          />
        )}
        ListFooterComponent={
          <View style={styles.summary}>
            <Text style={typography.h3}>Bill details</Text>
            <Row label="Item total" value={formatRupees(subtotal)} />
            <Row label="Delivery fee" value={formatRupees(deliveryFee)} />
            <View style={styles.divider} />
            <Row label="To pay" value={formatRupees(total)} bold />
          </View>
        }
      />

      <View style={styles.ctaWrap}>
        <Button
          title={`Proceed to Checkout · ${formatRupees(total)}`}
          onPress={() => nav.navigate('Checkout')}
          fullWidth
        />
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={bold ? typography.bodyBold : typography.body}>{label}</Text>
      <Text style={bold ? typography.bodyBold : typography.body}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  shopBanner: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.primaryLight,
  },
  list: { padding: spacing.lg },
  summary: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  ctaWrap: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
});
