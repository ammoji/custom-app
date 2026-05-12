import React from 'react';
import { View, Image, Text, Pressable, StyleSheet } from 'react-native';
import { CartItem } from '../../types';
import { colors, spacing, radii, typography } from '../../constants/theme';
import { formatRupees } from '../../utils/format';
import QuantityStepper from '../common/QuantityStepper';

type Props = {
  item: CartItem;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
};

export default function CartLineItem({ item, onIncrement, onDecrement, onRemove }: Props) {
  return (
    <View style={styles.row}>
      <Image source={{ uri: item.imageUrl }} style={styles.image} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
        <Text style={styles.pack}>{item.packLabel}</Text>
        <View style={styles.bottomRow}>
          <Text style={styles.price}>{formatRupees(item.price * item.quantity)}</Text>
          <QuantityStepper
            value={item.quantity}
            onIncrement={onIncrement}
            onDecrement={onDecrement}
          />
        </View>
      </View>
      <Pressable onPress={onRemove} hitSlop={8} style={styles.removeBtn}>
        <Text style={styles.removeText}>×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.md,
  },
  image: { width: 64, height: 64, borderRadius: radii.sm, backgroundColor: colors.surface },
  body: { flex: 1 },
  name: { ...typography.body, fontWeight: '600' },
  pack: { ...typography.caption, marginTop: 2 },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  price: { ...typography.bodyBold },
  removeBtn: { padding: spacing.xs, alignSelf: 'flex-start' },
  removeText: { fontSize: 22, color: colors.textMuted, lineHeight: 22 },
});
