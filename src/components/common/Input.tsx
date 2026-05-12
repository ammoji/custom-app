import React from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';

type Props = TextInputProps & {
  error?: string;
};

export default function Input({ error, style, accessibilityLabel, placeholder, ...rest }: Props) {
  return (
    <View>
      <TextInput
        placeholderTextColor={colors.textMuted}
        placeholder={placeholder}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        {...rest}
        style={[styles.input, !!error && styles.inputError, style]}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 14,
    color: colors.textPrimary,
    minHeight: 44,
  },
  inputError: { borderColor: colors.danger },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.xs },
});
