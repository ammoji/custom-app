import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radii, typography } from '../../constants/theme';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

type Props = {
  label: string;
  tone?: Tone;
};

const TONE: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: '#DCFCE7', fg: colors.success },
  warning: { bg: '#FEF3C7', fg: colors.warning },
  danger: { bg: '#FEE2E2', fg: colors.danger },
  info: { bg: '#DBEAFE', fg: colors.info },
  neutral: { bg: colors.surface, fg: colors.textSecondary },
};

export default function Badge({ label, tone = 'neutral' }: Props) {
  const { bg, fg } = TONE[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  text: { ...typography.caption, fontWeight: '600' },
});
