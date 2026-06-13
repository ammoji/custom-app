/**
 * PR-NEXT-BUNDLE-K.1 §C — VoicePriceCapture (rewired for table view).
 *
 * Bundle K §D shipped this as a full-screen modal (one item at a time).
 * The catalog browse UX pivoted to an Excel-style table
 * (CategoryListScreen), so this is now a persistent top-bar element +
 * a small floating confirmation chip — NOT a modal.
 *
 *   active === false → renders just the [🎙 Start voice] button
 *   active === true  → renders [🎙 Stop voice] + a "Listening for X…"
 *                       status line + the underlying VoiceInputButton
 *                       (single_field STT) + a floating result chip
 *
 * Each utterance is routed through the pure `decideVoiceCapture` helper
 * (catalogBrowseHelpers): high-confidence number → onPriceCaptured;
 * "skip"/"next" → onSkipRow; "stop"/"done" → onActiveChange(false);
 * low-confidence → retry chip, no commit. The parent (CategoryListScreen)
 * owns focus + auto-advance.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';
import VoiceInputButton from '../VoiceInputButton';
import {
  decideVoiceCapture,
  type CategoryListItemRow,
} from '../../utils/catalogBrowseHelpers';

type Props = {
  active: boolean;
  onActiveChange: (active: boolean) => void;
  focusedItem: CategoryListItemRow | null;
  onPriceCaptured: (productId: string, price: number) => void;
  onSkipRow: () => void;
  languageCode?: 'hi-IN' | 'en-IN';
};

type Chip = { text: string; tone: 'success' | 'warn' } | null;

export default function VoicePriceCapture({
  active,
  onActiveChange,
  focusedItem,
  onPriceCaptured,
  onSkipRow,
  languageCode = 'hi-IN',
}: Props) {
  const [chip, setChip] = useState<Chip>(null);
  const chipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // HOTFIX-K1 §B — drives the underlying VoiceInputButton's continuous
  // loop. Flips true to stop (stop-word or stop button); reset false when
  // a fresh session starts so the next "Start voice" listens again.
  const [stopSignal, setStopSignal] = useState(false);

  const lang: 'hi' | 'en' = languageCode === 'hi-IN' ? 'hi' : 'en';
  const isHindi = languageCode === 'hi-IN';

  useEffect(() => {
    return () => {
      if (chipTimerRef.current) clearTimeout(chipTimerRef.current);
    };
  }, []);

  // HOTFIX-K1 §B — when voice mode (re)activates, clear any stale stop
  // signal so the continuous loop is free to run; when it deactivates,
  // ensure the loop is signalled to stop.
  useEffect(() => {
    setStopSignal(!active);
  }, [active]);

  function stopVoice() {
    // HOTFIX-K1 §B — latch the loop's stop signal AND collapse the UI.
    setStopSignal(true);
    onActiveChange(false);
  }

  function showChip(text: string, tone: 'success' | 'warn', ms: number) {
    setChip({ text, tone });
    if (chipTimerRef.current) clearTimeout(chipTimerRef.current);
    chipTimerRef.current = setTimeout(() => setChip(null), ms);
  }

  function handleVoiceResult(result: { transcript: string }) {
    const transcript = result.transcript ?? '';
    const decision = decideVoiceCapture(transcript, lang);
    switch (decision.action) {
      case 'commit':
        if (focusedItem) {
          onPriceCaptured(focusedItem.productId, decision.price);
          showChip(`₹${decision.price} captured`, 'success', 1500);
        }
        break;
      case 'skip':
        onSkipRow();
        break;
      case 'stop':
        stopVoice();
        break;
      case 'retry':
        showChip(
          isHindi
            ? 'फिर से बोलें — कीमत साफ़ कहें'
            : 'Try again — say the price clearly',
          'warn',
          3000,
        );
        break;
    }
  }

  function handleVoiceError(_code: string, message: string) {
    showChip(message, 'warn', 3000);
  }

  // Inactive: a single compact "Start voice" button.
  if (!active) {
    return (
      <Pressable
        style={styles.startBtn}
        onPress={() => onActiveChange(true)}
        accessibilityRole="button"
        accessibilityLabel={isHindi ? 'आवाज़ से कीमत भरें' : 'Start voice pricing'}
      >
        <Text style={styles.startBtnText}>
          {isHindi ? '🎙 आवाज़ से' : '🎙 Start voice'}
        </Text>
      </Pressable>
    );
  }

  // Active: stop button + status line + STT mic + floating chip.
  return (
    <View style={styles.activeWrap}>
      {chip && (
        <View
          style={[
            styles.chip,
            chip.tone === 'success' ? styles.chipSuccess : styles.chipWarn,
          ]}
        >
          <Text style={styles.chipText}>{chip.text}</Text>
        </View>
      )}
      <View style={styles.activeRow}>
        <Pressable
          style={styles.stopBtn}
          onPress={stopVoice}
          accessibilityRole="button"
          accessibilityLabel={isHindi ? 'आवाज़ बंद करें' : 'Stop voice pricing'}
        >
          <Text style={styles.stopBtnText}>
            {isHindi ? '🎙 बंद करें' : '🎙 Stop voice'}
          </Text>
        </Pressable>
        <View style={styles.micSlot}>
          <VoiceInputButton
            languageCode={languageCode}
            mode="single_field"
            size="sm"
            continuous={active}
            stopSignal={stopSignal}
            onResult={handleVoiceResult}
            onError={handleVoiceError}
          />
        </View>
      </View>
      <Text style={styles.statusLine} numberOfLines={1}>
        {focusedItem
          ? isHindi
            ? `सुन रहे हैं: ${focusedItem.name}…`
            : `Listening for ${focusedItem.name}…`
          : isHindi
            ? 'सभी आइटम की कीमत भर गई'
            : 'All items priced'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  startBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtnText: {
    ...typography.bodyBold,
    color: colors.bg,
  },
  activeWrap: {
    gap: spacing.xs,
  },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stopBtn: {
    flex: 1,
    backgroundColor: colors.danger,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopBtnText: {
    ...typography.bodyBold,
    color: colors.bg,
  },
  micSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusLine: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  chip: {
    position: 'absolute',
    top: -36,
    alignSelf: 'center',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    zIndex: 10,
  },
  chipSuccess: {
    backgroundColor: colors.primary,
  },
  chipWarn: {
    backgroundColor: colors.warning,
  },
  chipText: {
    ...typography.caption,
    color: colors.bg,
    fontWeight: '700',
  },
});
