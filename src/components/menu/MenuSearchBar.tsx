/**
 * PR-NEXT-9 (finding #6) — search input for the in-shop menu list.
 *
 * Uncontrolled by design: parent owns the `value` + drives
 * `onChangeText`. We expose `recents` as a chip row that renders
 * only while the input is focused AND the value is empty — once the
 * user starts typing, the chips collapse to give the filtered list
 * room. Chips tap → `onRecentTap` (parent typically calls
 * `onChangeText(picked)` + dismisses keyboard + writes history).
 *
 * No debouncing. The client-side filter in §D is sub-millisecond at
 * pilot scale; debouncing would add latency without saving anything.
 * History writes happen on blur / onSubmitEditing in the parent.
 */
import React from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';

type Props = {
  value: string;
  onChangeText: (next: string) => void;
  onSubmit?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  /** Most-recent queries, position 0 = most recent. Capped upstream. */
  recents: string[];
  onRecentTap?: (query: string) => void;
};

export default function MenuSearchBar({
  value,
  onChangeText,
  onSubmit,
  onBlur,
  placeholder = 'Search this menu',
  recents,
  onRecentTap,
}: Props) {
  const [focused, setFocused] = React.useState(false);
  const showChips = focused && value.length === 0 && recents.length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.inputRow}>
        <Text style={styles.icon}>🔍</Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={() => {
            Keyboard.dismiss();
            onSubmit?.();
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search this shop's menu"
        />
        {value.length > 0 && (
          <Pressable
            onPress={() => onChangeText('')}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Text style={styles.clear}>✕</Text>
          </Pressable>
        )}
      </View>
      {showChips && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.chipRow}
        >
          {recents.map(q => (
            <Pressable
              key={q}
              onPress={() => {
                onRecentTap?.(q);
              }}
              style={({ pressed }) => [
                styles.chip,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Search again for ${q}`}
            >
              <Text style={styles.chipText} numberOfLines={1}>
                {q}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  icon: { fontSize: 14 },
  input: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
    padding: 0,
  },
  clear: {
    ...typography.body,
    color: colors.textSecondary,
    paddingHorizontal: spacing.xs,
  },
  chipRow: { gap: spacing.xs, paddingTop: spacing.sm },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 200,
  },
  chipText: { ...typography.caption, color: colors.textPrimary },
});
