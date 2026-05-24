import {
    AudioModule,
    IOSOutputFormat,
    RecordingPresets,
    requestRecordingPermissionsAsync,
    setAudioModeAsync,
    useAudioRecorder,
    useAudioRecorderState,
    type RecordingOptions,
} from 'expo-audio';
// PR 34 — DO NOT REMOVE. expo-file-system is not yet a project
// dependency; we read the recorded file via the global
// `fetch(uri).blob()` + FileReader path instead so we don't
// drag a new dep in just for base64 encoding. If this comment
// is gone and the imports below have been replaced with an
// `expo-file-system` import, restore the original.
import React, { useEffect, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { colors, radii, spacing, typography } from '../constants/theme';
import { usePressGuard } from '../hooks/usePressGuard';
import { Analytics } from '../services/analytics';
import { orderService } from '../services/orderService';
import { Sentry } from '../services/sentry';
import type { ParsedShopFields } from '../types';

/**
 * PR 34 — VoiceInputButton.
 *
 * Reusable mic button. Two sizes (`sm` for per-field icons, `lg`
 * for the big "🎙 Speak about your shop" CTA). Two modes:
 *
 *   - `multi_field` — single tap toggles record on/off; on stop
 *     the audio is sent to `transcribeShopOnboardingAudio` with
 *     `mode: 'multi_field'` and the parent receives both
 *     `transcript` and `fields` (or `fields: null` if Claude
 *     parse failed; the parent shows a graceful fallback).
 *
 *   - `single_field` — same record/stop UX; server returns
 *     transcript only. The parent confirms with the user before
 *     assigning to a single form input.
 *
 * Why a single tap to start AND stop, not press-and-hold:
 * press-and-hold is awkward on a 30-second recording (the user's
 * finger goes numb), and a release-by-accident loses everything.
 * Tap-to-start, tap-to-stop is the same UX as WhatsApp's voice
 * note shipped option-A flow — proven on the same audience.
 *
 * The 30s automatic stop is the safety net + cost guardrail
 * (caps each call's STT bill).
 *
 * `usePressGuard` wraps the upload-and-transcribe call so a
 * frantic re-tap during the ~5–15s server wait doesn't fire two
 * concurrent calls (which would burn two quota slots and confuse
 * the parent's state).
 */

type Props = {
  languageCode: 'hi-IN' | 'en-IN';
  mode: 'single_field' | 'multi_field';
  onResult: (result: {
    transcript: string;
    fields?: ParsedShopFields | null;
    parseError?: string;
  }) => void;
  onError?: (errorCode: string, message: string) => void;
  disabled?: boolean;
  size?: 'sm' | 'lg';
  // Lets the big CTA show its own label; sm size has no label.
  label?: string;
};

const MAX_DURATION_SEC = 30;

// expo-audio recording config tuned to produce STT-friendly
// output without per-platform forking inside the component:
//   - iOS: LINEARPCM 16-bit at 16 kHz, mono → WAV (Google STT
//          accepts as `LINEAR16`).
//   - Android: AMR_WB at 16 kHz, mono → .amr (Google STT accepts
//          as `AMR_WB`).
//   - Web: default WebM/Opus from the `web` block in `RecordingPresets`
//          (Google STT accepts as `WEBM_OPUS`).
//
// HIGH_QUALITY's 44.1 kHz / stereo is overkill for speech and
// produces 4–5x larger payloads — over the 2 MB server cap on a
// 30s recording. This config keeps a 30s clip well under 1 MB.
const RECORDING_OPTIONS: RecordingOptions = {
  extension: '.wav',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 64000,
  android: {
    extension: '.amr',
    outputFormat: 'amrwb',
    audioEncoder: 'amr_wb',
    sampleRate: 16000,
  },
  ios: {
    extension: '.wav',
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: 96,
    sampleRate: 16000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 64000,
  },
};

function encodingForPlatform(): 'WEBM_OPUS' | 'LINEAR16' | 'AMR_WB' {
  if (Platform.OS === 'web') return 'WEBM_OPUS';
  if (Platform.OS === 'android') return 'AMR_WB';
  return 'LINEAR16';
}

export default function VoiceInputButton({
  languageCode,
  mode,
  onResult,
  onError,
  disabled,
  size = 'sm',
  label,
}: Props) {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [busy, setBusy] = useState(false); // true while uploading + transcribing
  const [elapsed, setElapsed] = useState(0); // seconds
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pulse animation while recording — communicates "actively
  // listening" without requiring a Lottie file or extra dep.
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (recorderState.isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1,
            duration: 700,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 0,
            duration: 700,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ).start();
    } else {
      pulse.stopAnimation();
      pulse.setValue(0);
    }
  }, [recorderState.isRecording, pulse]);

  // Cleanup any pending timers on unmount — prevents the screen
  // from being torn down with a setInterval still firing into a
  // dead component.
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    };
  }, []);

  const startRecording = async () => {
    if (disabled || busy || recorderState.isRecording) return;

    Analytics.voice_onboarding_started({ language: languageCode, mode });

    // Permission gate.
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      const code = 'permission_denied';
      const message =
        languageCode === 'hi-IN'
          ? 'माइक की अनुमति चाहिए। फ़ोन की सेटिंग्स में जाकर अनुमति दें।'
          : 'Microphone permission is required. Please enable it in your device settings.';
      Analytics.voice_onboarding_error({
        language: languageCode,
        mode,
        error_code: code,
      });
      onError?.(code, message);
      return;
    }

    // Required on iOS so the system routes the mic correctly. On
    // Android this is a no-op but cheap to call.
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      });
    } catch {
      // Non-fatal — older Expo Go builds don't ship the new
      // audio mode keys; the recorder still works in most cases.
    }

    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      const code = 'record_start_failed';
      Sentry.addBreadcrumb({
        category: 'voice-onboarding',
        level: 'error',
        message: `prepareToRecordAsync failed: ${message}`,
      });
      Analytics.voice_onboarding_error({
        language: languageCode,
        mode,
        error_code: code,
      });
      onError?.(
        code,
        languageCode === 'hi-IN'
          ? 'रिकॉर्डिंग शुरू नहीं हो सकी। फिर से कोशिश करें।'
          : 'Could not start recording. Please try again.',
      );
      return;
    }

    setElapsed(0);
    tickRef.current = setInterval(() => {
      setElapsed(prev => prev + 1);
    }, 1000);
    stopTimerRef.current = setTimeout(() => {
      // Best-effort auto-stop after the 30s cap.
      void stopAndTranscribe();
    }, MAX_DURATION_SEC * 1000);
  };

  // Wrap the stop+upload+callable path in usePressGuard so a
  // double-tap on "stop" can't fire two transcribe calls in
  // parallel.
  const stopAndTranscribe = usePressGuard(async () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }

    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      Sentry.addBreadcrumb({
        category: 'voice-onboarding',
        level: 'error',
        message: `recorder.stop failed: ${message}`,
      });
    }

    if (!uri) {
      const code = 'no_audio';
      Analytics.voice_onboarding_error({
        language: languageCode,
        mode,
        error_code: code,
      });
      onError?.(
        code,
        languageCode === 'hi-IN'
          ? 'रिकॉर्डिंग नहीं मिली। फिर से कोशिश करें।'
          : 'Recording was not saved. Please try again.',
      );
      return;
    }

    setBusy(true);
    try {
      // Read the recorded file and base64-encode without an
      // extra `expo-file-system` dependency. fetch() works for
      // both `file://...` (native) and `blob:` (web) URIs.
      const blob = await (await fetch(uri)).blob();
      const audioBase64 = await blobToBase64(blob);

      const result = await orderService.transcribeShopOnboardingAudio({
        audioBase64,
        encoding: encodingForPlatform(),
        sampleRateHertz: 16000,
        languageCode,
        mode,
      });

      const fieldsFilled = result.fields
        ? Object.values(result.fields).filter(v => v !== null).length
        : mode === 'single_field' && result.transcript
          ? 1
          : 0;
      Analytics.voice_onboarding_filled({
        language: languageCode,
        mode,
        fields_filled: fieldsFilled,
        transcript_length: result.transcript.length,
      });
      onResult({
        transcript: result.transcript,
        fields: result.fields,
        parseError: result.parseError,
      });
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : 'Please try again.';
      const code =
        // Errors from Firebase callables include a `code` like
        // 'functions/resource-exhausted'. Strip the prefix for
        // analytics so quota-exhausted vs internal errors group
        // cleanly.
        ((e as { code?: string })?.code?.split('/').pop() ??
          'transcribe_failed') as string;
      Sentry.addBreadcrumb({
        category: 'voice-onboarding',
        level: 'warning',
        message: `transcribeShopOnboardingAudio failed: ${message}`,
      });
      Analytics.voice_onboarding_error({
        language: languageCode,
        mode,
        error_code: code,
      });
      onError?.(code, message);
    } finally {
      setBusy(false);
      setElapsed(0);
    }
  });

  const isActive = recorderState.isRecording || busy;
  const remainingSec = Math.max(0, MAX_DURATION_SEC - elapsed);

  const handlePress = () => {
    if (recorderState.isRecording) {
      void stopAndTranscribe();
    } else {
      void startRecording();
    }
  };

  if (size === 'lg') {
    return (
      <Pressable
        onPress={handlePress}
        disabled={disabled || busy}
        style={({ pressed }) => [
          styles.lgButton,
          isActive && styles.lgButtonActive,
          pressed && !disabled && { opacity: 0.85 },
          (disabled || busy) && styles.lgButtonDisabled,
        ]}
      >
        <View style={styles.lgRow}>
          <Animated.View
            style={[
              styles.lgDot,
              isActive && styles.lgDotActive,
              {
                opacity: pulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.5, 1],
                }),
              },
            ]}
          />
          <View style={styles.lgTextWrap}>
            <Text style={styles.lgTitle}>
              {busy
                ? languageCode === 'hi-IN'
                  ? 'सुन रहे हैं…'
                  : 'Transcribing…'
                : recorderState.isRecording
                  ? languageCode === 'hi-IN'
                    ? `रिकॉर्ड हो रहा है — ${remainingSec}s`
                    : `Recording — ${remainingSec}s`
                  : (label ??
                    (languageCode === 'hi-IN'
                      ? '🎙 अपनी दुकान के बारे में बोलें'
                      : '🎙 Speak about your shop'))}
            </Text>
            {!isActive && (
              <Text style={styles.lgSubtitle}>
                {languageCode === 'hi-IN'
                  ? 'नाम, पता, खुलने का समय'
                  : 'Name, address, opening hours'}
              </Text>
            )}
          </View>
        </View>
      </Pressable>
    );
  }

  // Small per-field mic.
  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled || busy}
      hitSlop={8}
      style={({ pressed }) => [
        styles.smButton,
        isActive && styles.smButtonActive,
        pressed && !disabled && { opacity: 0.7 },
        (disabled || busy) && styles.smButtonDisabled,
      ]}
    >
      <Animated.Text
        style={[
          styles.smIcon,
          {
            opacity: isActive
              ? pulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.5, 1],
                })
              : 1,
          },
        ]}
      >
        {recorderState.isRecording ? '⏹' : busy ? '…' : '🎙'}
      </Animated.Text>
    </Pressable>
  );
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

/**
 * Read a Blob as a base64 string without the `data:...;base64,`
 * prefix. Works on both web (FileReader is built-in) and native
 * (`react-native` polyfills FileReader).
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('blob read failed'));
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

// Static reference to AudioModule keeps the import from being
// stripped in unused-import sweeps even if expo-audio happens
// to expose `AudioModule` only as a type alias in some SDKs.
// (Defensive — same posture as PR 6's `validateMenuImageUrl`
// import comment.)
void AudioModule;

const styles = StyleSheet.create({
  // Large CTA — the "🎙 Speak about your shop" surface.
  lgButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  lgButtonActive: { backgroundColor: colors.danger },
  lgButtonDisabled: { opacity: 0.5 },
  lgRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  lgDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.surface,
  },
  lgDotActive: { backgroundColor: colors.surface },
  lgTextWrap: { flex: 1 },
  lgTitle: {
    ...typography.body,
    color: colors.surface,
    fontWeight: '700',
  },
  lgSubtitle: {
    ...typography.caption,
    color: colors.surface,
    opacity: 0.85,
    marginTop: 2,
  },
  // Per-field mic.
  smButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smButtonActive: {
    backgroundColor: colors.danger + '22',
    borderColor: colors.danger,
  },
  smButtonDisabled: { opacity: 0.4 },
  smIcon: { fontSize: 16 },
});
