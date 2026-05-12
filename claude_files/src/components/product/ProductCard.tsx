import React from 'react';
import { View, Image, Text, Pressable, StyleSheet } from 'react-native';
import { Product } from '../../types';
import { colors, spacing, radii, typography } from '../../constants/theme';
import { formatPackLabel } from '../../utils/format';
import Price from '../common/Price';
import QuantityStepper from '../common/QuantityStepper';

type Props = {
  product: Product;
  onAdd: () => void;
  quantityInCart: number;
  onIncrement?: () => void;
  onDecrement?: () => void;
  disabled?: boolean;
};

export default function ProductCard({
  product,
  onAdd,
  quantityInCart,
  onIncrement,
  onDecrement,
  disabled,
}: Props) {
  const unavailable = disabled || !product.inStock;

  return (
    <View style={[styles.card, unavailable && styles.unavailable]}>
      <Image source={{ uri: product.imageUrl }} style={styles.image} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={2}>{product.name}</Text>
        <Text style={styles.pack}>{formatPackLabel(product.packSize)}</Text>
        <View style={styles.bottomRow}>
          <Price value={product.price} mrp={product.mrp} size="sm" />
          {!product.inStock ? (
            <Text style={styles.outOfStock}>Out of stock</Text>
          ) : disabled ? (
            <Text style={styles.outOfStock}>Closed</Text>
          ) : quantityInCart === 0 ? (
            <Pressable onPress={onAdd} style={styles.addBtn} hitSlop={8}>
              <Text style={styles.addBtnText}>ADD</Text>
            </Pressable>
          ) : (
            <QuantityStepper
              value={quantityInCart}
              onIncrement={onIncrement ?? (() => {})}
              onDecrement={onDecrement ?? (() => {})}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.md,
  },
  unavailable: { opacity: 0.55 },
  image: { width: 72, height: 72, borderRadius: radii.sm, backgroundColor: colors.surface },
  body: { flex: 1, justifyContent: 'space-between' },
  name: { ...typography.body, fontWeight: '600' },
  pack: { ...typography.caption, marginTop: 2 },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  addBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 32,
    justifyContent: 'center',
  },
  addBtnText: { ...typography.bodyBold, color: colors.primary, fontSize: 13, letterSpacing: 0.5 },
  outOfStock: { ...typography.caption, color: colors.danger, fontWeight: '600' },
});
