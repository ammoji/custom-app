import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';

type Props = {
  title: string;
  onPress: () => void;
  // PR-NEXT-ENH-2 — `destructive` added for the bulk-delete CTA on
  // ShopMenuScreen (red surface + white text, full-width-friendly).
  // Same activity-indicator-on-loading semantics as `primary`.
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  size?: 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
};

export default function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  fullWidth,
  style,
}: Props) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' ? styles.sizeLg : styles.sizeMd,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'ghost' && styles.ghost,
        variant === 'destructive' && styles.destructive,
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        pressed && !isDisabled && { opacity: 0.85 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={
            variant === 'primary' || variant === 'destructive'
              ? '#fff'
              : colors.primary
          }
        />
      ) : (
        <Text
          style={[
            styles.text,
            variant === 'primary' && styles.textPrimary,
            variant === 'secondary' && styles.textSecondary,
            variant === 'ghost' && styles.textGhost,
            variant === 'destructive' && styles.textDestructive,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  sizeMd: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 44 },
  sizeLg: { paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, minHeight: 52 },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.primaryLight },
  ghost: { backgroundColor: 'transparent' },
  // PR-NEXT-ENH-2 — destructive: red surface + white text. Used by
  // the bulk-delete CTA on ShopMenuScreen.
  destructive: { backgroundColor: colors.danger },
  fullWidth: { alignSelf: 'stretch' },
  disabled: { opacity: 0.4 },
  text: { ...typography.bodyBold },
  textPrimary: { color: '#fff' },
  textSecondary: { color: colors.primaryDark },
  textGhost: { color: colors.primary },
  textDestructive: { color: '#fff' },
});
