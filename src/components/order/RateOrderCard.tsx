/**
 * PR 20 / PR 42.1 — RateOrderCard.
 *
 * Renders on OrderDetailScreen for delivered orders that haven't
 * been rated yet. PR 42.1 split the single rating into two
 * independent dimensions:
 *   - **Shop** (REQUIRED) — product quality, packaging, freshness.
 *   - **Delivery** (OPTIONAL) — timeliness, courtesy, condition on
 *     arrival. Hidden entirely when the order has no
 *     `deliveryPersonId` (rare: an order delivered without a
 *     partner stamped); the shop section then sits alone.
 *
 * Industry standard (Swiggy / Zomato / Blinkit) — splits the
 * surface so a bad delivery experience doesn't tank the shop's
 * rolling average unfairly, and the delivery partner builds an
 * independent reputation.
 *
 * UX posture:
 *   - Tap a star → that star + all to its left turn filled gold.
 *     Repeated taps adjust selection; tap-to-clear isn't supported
 *     (use the 1-star option for "bad"; the delivery section
 *     left at zero stars = skip).
 *   - Each section's comment is optional, capped at 500 chars,
 *     live counter. Empty / whitespace-only collapses to
 *     undefined server-side.
 *   - Submit is disabled until shop has at least one star OR
 *     while in flight. Delivery stars = 0 means "customer
 *     skipped this dimension"; the server treats undefined
 *     deliveryRating as skip.
 *   - On success: parent flips OrderDetailScreen to a "Thanks
 *     for rating!" view via the `onRated` callback (optimistic
 *     — before the watcher tick lands the canonical fields).
 *   - On failure: inline Alert; Submit re-enables so the customer
 *     can retry.
 *
 * Hooks: 5 useState calls, all at the top of the function. No
 * conditional returns above them, so no Rules-of-Hooks risk
 * (per PR 12 lineage + `.windsurf/code-discipline.md` Rule 5).
 */
import React, { useState } from 'react';
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
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

export type RateOrderPayload = {
  shopRating: 1 | 2 | 3 | 4 | 5;
  shopComment?: string;
  deliveryRating?: 1 | 2 | 3 | 4 | 5;
  deliveryComment?: string;
};

type Props = {
  orderId: string;
  // PR 42.1 — pass `true` for orders with a `deliveryPersonId`.
  // When `false`, the delivery section is hidden and only shop
  // rating is submitted (the server still accepts the shop-only
  // payload; the gate is purely UX so the customer isn't asked
  // to rate a partner who never existed for the order).
  hasDeliveryPartner: boolean;
  // Optimistic callback fired after the server confirms the
  // submission. Parent uses the payload to render the
  // "Thanks for rating!" panel without waiting for the watcher
  // to deliver the canonical fields.
  onRated: (payload: RateOrderPayload) => void;
};

export default function RateOrderCard({
  orderId,
  hasDeliveryPartner,
  onRated,
}: Props) {
  // Hooks: all five useState calls at the top, above any
  // conditional return. The original PR 20 version had 3; PR 42.1
  // adds two for the delivery section. No early returns sit
  // between any of these or the JSX below — PR 12 ETA-modal
  // discipline preserved.
  const [shopStars, setShopStars] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [shopComment, setShopComment] = useState('');
  const [deliveryStars, setDeliveryStars] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [deliveryComment, setDeliveryComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (shopStars === 0 || submitting) return;
    setSubmitting(true);
    try {
      const trimmedShopComment = shopComment.trim();
      const trimmedDeliveryComment = deliveryComment.trim();
      // Only include the delivery dimension when the customer
      // both has a delivery partner AND actually rated them.
      // The server also defends against missing deliveryPersonId,
      // but the client gate keeps the payload minimal.
      const deliveryRating: 1 | 2 | 3 | 4 | 5 | undefined =
        hasDeliveryPartner && deliveryStars > 0
          ? (deliveryStars as 1 | 2 | 3 | 4 | 5)
          : undefined;
      await orderService.submitOrderRating({
        orderId,
        shopRating: shopStars as 1 | 2 | 3 | 4 | 5,
        shopComment: trimmedShopComment || undefined,
        deliveryRating,
        deliveryComment:
          deliveryRating && trimmedDeliveryComment
            ? trimmedDeliveryComment
            : undefined,
      });
      onRated({
        shopRating: shopStars as 1 | 2 | 3 | 4 | 5,
        shopComment: trimmedShopComment || undefined,
        deliveryRating,
        deliveryComment:
          deliveryRating && trimmedDeliveryComment
            ? trimmedDeliveryComment
            : undefined,
      });
    } catch (err: any) {
      Alert.alert(
        'Could not submit rating',
        err?.message ?? 'Please try again in a moment.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  // PR-NEXT-BUNDLE-A §D (Finding #14) — DO NOT REMOVE.
  // KeyboardAvoidingView keeps the comments TextInput visible
  // above the soft keyboard on both platforms:
  //   iOS: 'padding' mode adds bottom inset equal to keyboard height.
  //   Android: 'height' mode + ScrollView in OrderDetailScreen lets
  //   the focused field scroll into view.
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
    <View style={styles.card}>
      {/* Shop section — REQUIRED. */}
      <Text style={styles.title}>How was the shop?</Text>
      <Text style={styles.subtitle}>
        Product quality, packaging, and freshness.
      </Text>
      <StarPicker
        stars={shopStars}
        onPick={setShopStars}
        labelPrefix="Shop"
        disabled={submitting}
      />
      <TextInput
        value={shopComment}
        onChangeText={t => setShopComment(t.slice(0, MAX_COMMENT))}
        placeholder="Add a comment about the shop (optional)"
        placeholderTextColor={colors.textSecondary}
        multiline
        editable={!submitting}
        style={styles.comment}
      />
      <Text style={styles.charCount}>
        {shopComment.length}/{MAX_COMMENT}
      </Text>

      {/* Delivery section — OPTIONAL. Hidden entirely when there's
          no delivery partner on the order, so the customer isn't
          asked to rate someone who doesn't exist. The shop section
          above still submits on its own. */}
      {hasDeliveryPartner && (
        <View style={styles.deliveryBlock}>
          <Text style={styles.title}>How was your delivery?</Text>
          <Text style={styles.subtitle}>
            Timeliness, courtesy, condition on arrival. Optional — tap
            stars only if you want to rate.
          </Text>
          <StarPicker
            stars={deliveryStars}
            onPick={setDeliveryStars}
            labelPrefix="Delivery"
            disabled={submitting}
          />
          <TextInput
            value={deliveryComment}
            onChangeText={t => setDeliveryComment(t.slice(0, MAX_COMMENT))}
            placeholder="Add a comment about the delivery (optional)"
            placeholderTextColor={colors.textSecondary}
            multiline
            // Only allow comment edits when the customer has picked
            // a delivery rating — otherwise the comment is irrelevant
            // (server would drop it anyway since deliveryStars=0 → no
            // deliveryRating in the payload).
            editable={!submitting && deliveryStars > 0}
            style={[
              styles.comment,
              deliveryStars === 0 && styles.commentDisabled,
            ]}
          />
          <Text style={styles.charCount}>
            {deliveryComment.length}/{MAX_COMMENT}
          </Text>
        </View>
      )}

      <Button
        title={submitting ? 'Submitting…' : 'Submit rating'}
        onPress={onSubmit}
        disabled={shopStars === 0 || submitting}
        loading={submitting}
        fullWidth
      />
    </View>
    </KeyboardAvoidingView>
  );
}

/**
 * PR 42.1 — extracted star-picker so the shop + delivery
 * sections share rendering logic without duplicating the 5-tap
 * loop and accessibility wiring. `labelPrefix` distinguishes the
 * two sections for screen readers ("Shop 4 stars" vs.
 * "Delivery 4 stars").
 */
function StarPicker({
  stars,
  onPick,
  labelPrefix,
  disabled,
}: {
  stars: 0 | 1 | 2 | 3 | 4 | 5;
  onPick: (next: 0 | 1 | 2 | 3 | 4 | 5) => void;
  labelPrefix: string;
  disabled: boolean;
}) {
  return (
    <View style={styles.starsRow}>
      {[1, 2, 3, 4, 5].map(n => (
        <Pressable
          key={n}
          onPress={() => !disabled && onPick(n as 1 | 2 | 3 | 4 | 5)}
          accessibilityRole="button"
          accessibilityLabel={`${labelPrefix} ${n} star${n === 1 ? '' : 's'}`}
          accessibilityState={{ selected: stars >= n, disabled }}
          hitSlop={6}
          style={styles.starButton}
        >
          <Text style={[styles.star, stars >= n && styles.starFilled]}>
            {stars >= n ? '★' : '☆'}
          </Text>
        </Pressable>
      ))}
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
  // PR 42.1 — visual separator between the shop and delivery
  // sections. Top border + extra top padding so the two halves
  // read as a related pair without merging into one block.
  deliveryBlock: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    marginTop: spacing.sm,
  },
  // Dim the delivery comment box when the customer hasn't picked
  // any delivery stars yet — visual cue that comment without a
  // star rating won't persist.
  commentDisabled: { opacity: 0.5 },
});
