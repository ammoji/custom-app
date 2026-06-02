/**
 * PR-NEXT-HOTFIX-10 — bare-minimum toast primitive. Auto-dismisses
 * after `durationMs` (default 3000). Renders absolute-positioned at
 * the bottom of the screen, above the safe-area inset (matches the
 * `BottomSheet` convention from HOTFIX-7 / Rule 13 — no hardcoded
 * bottom offset that ignores Android gesture-nav pills).
 *
 * Single Toast per screen for now — the only caller is the
 * address-dedupe path in `CheckoutScreen`. If multi-toast queueing
 * becomes a need, swap in `react-native-root-toast` later.
 *
 * `pointerEvents="none"` so the toast can never block taps on the
 * Place Order CTA or anything else under it.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing, typography } from '../../constants/theme';

type Props = {
  visible: boolean;
  message: string;
  onDismiss: () => void;
  durationMs?: number;
};

export default function Toast({
  visible,
  message,
  onDismiss,
  durationMs = 3000,
}: Props) {
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    const t = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        onDismiss();
      });
    }, durationMs);
    return () => clearTimeout(t);
  }, [visible, durationMs, opacity, onDismiss]);

  if (!visible) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        { bottom: insets.bottom + spacing.xl, opacity },
      ]}
    >
      <Text style={styles.text} numberOfLines={2}>
        {message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.textPrimary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  text: { ...typography.body, color: colors.bg, textAlign: 'center' },
});
