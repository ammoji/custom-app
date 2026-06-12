/**
 * PR-NEXT-5.1 §C — Reusable bottom-sheet modal for shop owners /
 * delivery partners to respond to a low-rating review.
 *
 * Uses BottomSheet chrome (Rule 13). 280-char limit on response.
 * KeyboardAvoidingView is handled by BottomSheet (keyboardAvoid=true).
 */
// PR-NEXT-5.1 §C — DO NOT REMOVE. BottomSheet + inputs for review response.
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import BottomSheet from '../common/BottomSheet';
import Button from '../common/Button';
import { colors, radii, spacing, typography } from '../../constants/theme';

const MAX_CHARS = 280;

type Props = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (responseText: string) => Promise<void>;
  stars: number;
  comment: string | null;
  responseBy: 'shop' | 'partner';
};

export default function ResponseModal({
  visible,
  onClose,
  onSubmit,
  stars,
  comment,
  responseBy,
}: Props) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const label = responseBy === 'shop' ? 'Shop response' : 'Partner response';

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setText('');
    } catch (e: any) {
      // HOTFIX-RATING-RESPONSE — surface server errors instead of
      // silently re-enabling the button. Parent's onSubmit may have
      // its own Alert; this is defense-in-depth so a future parent
      // miswiring doesn't reintroduce the silent-fail symptom.
      Alert.alert(
        'Could not send response',
        e?.message || 'Please try again in a moment.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    setText('');
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={handleClose} keyboardAvoid>
      <Text style={styles.title}>
        Respond to {'★'.repeat(Math.min(5, Math.max(1, stars)))} review
      </Text>
      {!!comment && (
        <View style={styles.commentBox}>
          <Text style={styles.commentLabel}>Customer wrote:</Text>
          <Text style={styles.commentText}>"{comment}"</Text>
        </View>
      )}
      <Text style={styles.inputLabel}>{label}:</Text>
      <TextInput
        value={text}
        onChangeText={t => setText(t.slice(0, MAX_CHARS))}
        placeholder="Be specific, apologise, offer a remedy…"
        placeholderTextColor={colors.textSecondary}
        multiline
        numberOfLines={4}
        style={styles.input}
        editable={!submitting}
        accessibilityLabel="Response text"
      />
      <Text style={styles.charCount}>
        {text.length}/{MAX_CHARS}
      </Text>
      <Text style={styles.hint}>
        The customer can amend their rating after seeing your response.
      </Text>
      <View style={styles.actions}>
        <View style={styles.actionBtn}>
          <Button
            title="Cancel"
            variant="secondary"
            onPress={handleClose}
            disabled={submitting}
            fullWidth
          />
        </View>
        <View style={styles.actionBtn}>
          <Button
            title="Send response"
            onPress={handleSubmit}
            loading={submitting}
            disabled={submitting || text.trim().length === 0}
            fullWidth
          />
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.h3,
    marginBottom: spacing.md,
  },
  commentBox: {
    backgroundColor: colors.bg,
    borderRadius: radii.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
  },
  commentLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  commentText: {
    ...typography.body,
    color: colors.textPrimary,
    fontStyle: 'italic',
  },
  inputLabel: {
    ...typography.bodyBold,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: spacing.sm,
    ...typography.body,
    minHeight: 100,
    textAlignVertical: 'top',
    color: colors.textPrimary,
  },
  charCount: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'right',
    marginTop: 4,
    marginBottom: spacing.xs,
  },
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionBtn: { flex: 1 },
});
