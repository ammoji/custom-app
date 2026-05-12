import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';

type Props = {
  value: number;
  onIncrement: () => void;
  onDecrement: () => void;
};

export default function QuantityStepper({ value, onIncrement, onDecrement }: Props) {
  return (
    <View style={styles.container} accessibilityLabel={`Quantity ${value}`}>
      <Pressable
        onPress={onDecrement}
        style={styles.btn}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Decrease quantity"
      >
        <Text style={styles.btnText}>−</Text>
      </Pressable>
      <Text style={styles.value}>{value}</Text>
      <Pressable
        onPress={onIncrement}
        style={styles.btn}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Increase quantity"
      >
        <Text style={styles.btnText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.xs,
    minHeight: 32,
  },
  btn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, minWidth: 28, alignItems: 'center' },
  btnText: { ...typography.bodyBold, color: '#fff', fontSize: 18 },
  value: { ...typography.bodyBold, color: '#fff', minWidth: 20, textAlign: 'center' },
});
