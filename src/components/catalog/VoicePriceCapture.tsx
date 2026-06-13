/**
 * PR-NEXT-BUNDLE-K §D — VoicePriceCapture.
 *
 * Modal that wraps the existing VoiceInputButton (PR 34) in
 * `single_field` mode and applies `parseVoicePriceInput` to the
 * returned transcript to extract a rupee price. Three-state flow:
 *
 *   idle      → tap mic to start
 *   listening → VoiceInputButton recording / transcribing
 *   confirm   → price extracted; show "₹N — Confirm?" card
 *
 * Parent receives the confirmed price via `onConfirm(price)`.
 * "Type instead" / dismiss → `onTypeInstead()`.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';
import VoiceInputButton from '../VoiceInputButton';
import { parseVoicePriceInput } from '../../utils/voicePriceHelpers';

type Props = {
  visible: boolean;
  productName: string;
  languageCode: 'hi-IN' | 'en-IN';
  onConfirm: (price: number) => void;
  onTypeInstead: () => void;
  onDismiss: () => void;
};

type CaptureState = 'idle' | 'listening' | 'confirm' | 'error';

export default function VoicePriceCapture({
  visible,
  productName,
  languageCode,
  onConfirm,
  onTypeInstead,
  onDismiss,
}: Props) {
  const [captureState, setCaptureState] = useState<CaptureState>('idle');
  const [parsedPrice, setParsedPrice] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rawTranscript, setRawTranscript] = useState<string>('');

  const lang: 'hi' | 'en' = languageCode === 'hi-IN' ? 'hi' : 'en';
  const isHindi = languageCode === 'hi-IN';

  function resetToIdle() {
    setCaptureState('idle');
    setParsedPrice(null);
    setErrorMsg(null);
    setRawTranscript('');
  }

  function handleVoiceResult(result: { transcript: string }) {
    const transcript = result.transcript ?? '';
    setRawTranscript(transcript);
    const parsed = parseVoicePriceInput(transcript, lang);
    if (parsed.price !== null) {
      setParsedPrice(parsed.price);
      setCaptureState('confirm');
    } else {
      setErrorMsg(
        isHindi
          ? 'कीमत समझ में नहीं आई। फिर से बोलें या टाइप करें।'
          : 'Could not understand the price. Please try again or type it.',
      );
      setCaptureState('error');
    }
  }

  function handleVoiceError(_code: string, message: string) {
    setErrorMsg(message);
    setCaptureState('error');
  }

  function handleConfirm() {
    if (parsedPrice !== null) {
      onConfirm(parsedPrice);
      resetToIdle();
    }
  }

  function handleTypeInstead() {
    resetToIdle();
    onTypeInstead();
  }

  function handleTryAgain() {
    resetToIdle();
  }

  function handleDismiss() {
    resetToIdle();
    onDismiss();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleDismiss}
    >
      <Pressable style={styles.overlay} onPress={handleDismiss}>
        <Pressable style={styles.card} onPress={() => {}}>
          {/* Header */}
          <Text style={styles.title}>
            {isHindi ? 'आपकी कीमत क्या है?' : 'What is your price?'}
          </Text>
          <Text style={styles.productLabel} numberOfLines={2}>
            {productName}
          </Text>

          {/* Idle: show mic button */}
          {captureState === 'idle' && (
            <View style={styles.micArea}>
              <Text style={styles.hint}>
                {isHindi
                  ? 'माइक दबाएं और कीमत बोलें'
                  : 'Tap mic and speak the price'}
              </Text>
              <VoiceInputButton
                languageCode={languageCode}
                mode="single_field"
                size="lg"
                label={isHindi ? '🎙 कीमत बोलें' : '🎙 Speak price'}
                onResult={handleVoiceResult}
                onError={handleVoiceError}
              />
            </View>
          )}

          {/* Listening: spinner (VoiceInputButton handles its own busy state) */}
          {captureState === 'listening' && (
            <View style={styles.centerArea}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.hint}>
                {isHindi ? 'सुन रहे हैं…' : 'Listening…'}
              </Text>
            </View>
          )}

          {/* Confirm: show parsed price */}
          {captureState === 'confirm' && parsedPrice !== null && (
            <View style={styles.confirmArea}>
              <Text style={styles.rawTranscript}>"{rawTranscript}"</Text>
              <View style={styles.priceChip}>
                <Text style={styles.priceChipText}>₹{parsedPrice}</Text>
              </View>
              <Text style={styles.confirmQuestion}>
                {isHindi ? 'क्या यह सही है?' : 'Is this correct?'}
              </Text>
              <View style={styles.confirmButtons}>
                <Pressable
                  style={[styles.btn, styles.btnPrimary]}
                  onPress={handleConfirm}
                >
                  <Text style={styles.btnPrimaryText}>
                    {isHindi ? '✓ हाँ' : '✓ Yes'}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.btnSecondary]}
                  onPress={handleTryAgain}
                >
                  <Text style={styles.btnSecondaryText}>
                    {isHindi ? '↩ फिर बोलें' : '↩ Try again'}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Error */}
          {captureState === 'error' && (
            <View style={styles.centerArea}>
              <Text style={styles.errorText}>{errorMsg}</Text>
              <View style={styles.confirmButtons}>
                <Pressable
                  style={[styles.btn, styles.btnSecondary]}
                  onPress={handleTryAgain}
                >
                  <Text style={styles.btnSecondaryText}>
                    {isHindi ? '↩ फिर बोलें' : '↩ Try again'}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Always show "Type instead" footer */}
          <Pressable style={styles.typeInsteadRow} onPress={handleTypeInstead}>
            <Text style={styles.typeInsteadText}>
              {isHindi ? '⌨ टाइप करें' : '⌨ Type instead'}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  title: {
    ...typography.h2,
    marginBottom: spacing.xs,
  },
  productLabel: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  micArea: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  centerArea: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  confirmArea: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  hint: {
    ...typography.caption,
    textAlign: 'center',
  },
  rawTranscript: {
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  priceChip: {
    backgroundColor: colors.primaryLight,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  priceChipText: {
    ...typography.h1,
    color: colors.primary,
  },
  confirmQuestion: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  btn: {
    flex: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  btnPrimary: {
    backgroundColor: colors.primary,
  },
  btnPrimaryText: {
    ...typography.bodyBold,
    color: colors.bg,
  },
  btnSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnSecondaryText: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  errorText: {
    ...typography.body,
    color: colors.danger,
    textAlign: 'center',
  },
  typeInsteadRow: {
    alignItems: 'center',
    paddingTop: spacing.md,
  },
  typeInsteadText: {
    ...typography.caption,
    color: colors.info,
  },
});
