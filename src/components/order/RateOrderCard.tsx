/**
 * PR 20 — RateOrderCard.
 *
 * Renders on OrderDetailScreen for delivered orders that haven't
 * been rated yet. 5-star tap picker + optional comment + Submit.
 *
 * UX posture:
 *   - Tap a star → that star + all to its left turn filled gold.
 *     Repeated taps adjust selection; we don't support tap-to-clear
 *     (use the 1-star option for "bad").
 *   - Comment is optional, capped at 500 chars, with a live counter.
 *   - Submit is disabled until at least one star is picked OR while
 *     in flight.
 *   - On success: parent flips OrderDetailScreen to a "Thanks for
 *     rating!" view via the `onRated` callback (optimistic — before
 *     the watcher tick lands the canonical rating field).
 *   - On failure: inline Alert; Submit re-enables so the customer
 *     can retry.
 *
 * Hooks: 3 useState calls, all at the top of the function. No
 * conditional returns above them, so no Rules-of-Hooks risk.
 */
import React, { useState } from 'react';
import {
    Alert,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { orderService } from '../../services/orderService';
import Button from '../common/Button';

const MAX_COMMENT = 500;

type Props = {
  orderId: string;
  onRated: (stars: 1 | 2 | 3 | 4 | 5, comment?: string) => void;
};

export default function RateOrderCard({ orderId, onRated }: Props) {
  const [stars, setStars] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (stars === 0 || submitting) return;
    setSubmitting(true);
    try {
      const trimmed = comment.trim();
      await orderService.submitOrderRating({
        orderId,
        stars,
        comment: trimmed || undefined,
      });
      onRated(stars, trimmed || undefined);
    } catch (err: any) {
      Alert.alert(
        'Could not submit rating',
        err?.message ?? 'Please try again in a moment.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>How was your order?</Text>
      <Text style={styles.subtitle}>
        Your rating helps other customers find good shops.
      </Text>
      <View style={styles.starsRow}>
        {[1, 2, 3, 4, 5].map(n => (
          <Pressable
            key={n}
            onPress={() => setStars(n as 1 | 2 | 3 | 4 | 5)}
            accessibilityRole="button"
            accessibilityLabel={`${n} star${n === 1 ? '' : 's'}`}
            accessibilityState={{ selected: stars >= n }}
            hitSlop={6}
            style={styles.starButton}
          >
            <Text
              style={[styles.star, stars >= n && styles.starFilled]}
            >
              {stars >= n ? '★' : '☆'}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={comment}
        onChangeText={t => setComment(t.slice(0, MAX_COMMENT))}
        placeholder="Add a comment (optional)"
        placeholderTextColor={colors.textSecondary}
        multiline
        editable={!submitting}
        style={styles.comment}
      />
      <Text style={styles.charCount}>
        {comment.length}/{MAX_COMMENT}
      </Text>
      <Button
        title={submitting ? 'Submitting…' : 'Submit rating'}
        onPress={onSubmit}
        disabled={stars === 0 || submitting}
        loading={submitting}
        fullWidth
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { ...typography.h3, marginBottom: spacing.xs },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  starsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  starButton: { padding: 4 },
  star: { fontSize: 40, color: colors.border, lineHeight: 46 },
  // Tailwind amber-500 — matches the badge gold below for visual
  // continuity between "you rated" and "shop has been rated".
  starFilled: { color: '#F59E0B' },
  comment: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: spacing.sm,
    minHeight: 80,
    textAlignVertical: 'top',
    ...typography.body,
    marginBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  charCount: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'right',
    marginBottom: spacing.sm,
  },
});
