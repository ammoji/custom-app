import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../constants/theme';
import { formatRupees } from '../../utils/format';

type Props = {
  value: number;
  mrp?: number;
  size?: 'sm' | 'md' | 'lg';
};

export default function Price({ value, mrp, size = 'md' }: Props) {
  const showStrike = mrp != null && mrp > value;
  const valueStyle = size === 'lg' ? styles.lg : size === 'sm' ? styles.sm : styles.md;
  return (
    <View style={styles.row}>
      <Text style={valueStyle}>{formatRupees(value)}</Text>
      {showStrike && <Text style={styles.mrp}>{formatRupees(mrp!)}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  sm: { ...typography.bodyBold, fontSize: 13 },
  md: { ...typography.price },
  lg: { ...typography.price, fontSize: 18 },
  mrp: { ...typography.caption, color: colors.mrpStrike, textDecorationLine: 'line-through' },
});
