import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../components/common/Button';
import Input from '../components/common/Input';
import Loader from '../components/common/Loader';
import ScreenHeader from '../components/common/ScreenHeader';
import { colors, radii, spacing, typography } from '../constants/theme';
import type { ConfirmationResult } from '../services/authService';
import { authService } from '../services/authService';
import { useAuthStore } from '../store/useAuthStore';

type Phase = 'enter_phone' | 'enter_otp' | 'verifying';

export default function LoginScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const returnTo: string | undefined = route.params?.returnTo;

  const [phase, setPhase] = useState<Phase>('enter_phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Phone auth dispatches inside authService:
  //   - web: Firebase web SDK + invisible reCAPTCHA (mounted below)
  //   - native: @react-native-firebase/auth via APNs (iOS) / Play Integrity (Android)
  // The recaptcha-container View below is harmless on native (no DOM).

  const onSendOtp = async () => {
    setError(null);
    setPhase('verifying');
    try {
      const conf = await authService.startPhoneAuth(`+91${phone}`);
      setConfirmation(conf);
      setPhase('enter_otp');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to send OTP');
      setPhase('enter_phone');
    }
  };

  const onConfirmOtp = async () => {
    if (!confirmation) return;
    setError(null);
    setPhase('verifying');
    try {
      const refreshed = await authService.confirmOtp(confirmation, otp);
      // linkWithCredential doesn't reliably trigger onAuthStateChanged,
      // so push the refreshed user into the store directly. uid stays
      // the same; isAnonymous flips to false; phoneNumber is populated.
      if (refreshed) useAuthStore.getState().setUser(refreshed);
      if (returnTo) nav.replace(returnTo as any);
      else nav.goBack();
    } catch {
      setError('Invalid OTP. Try again.');
      setPhase('enter_otp');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Sign in" onBack={() => nav.goBack()} />
      <View style={styles.body}>
        {phase === 'verifying' && <Loader fullScreen />}

        {phase === 'enter_phone' && (
          <>
            <Text style={styles.heading}>Enter your phone number</Text>
            <Text style={styles.subtext}>
              We&apos;ll send a 6-digit code to verify it&apos;s you
            </Text>
            <View style={styles.phoneRow}>
              <View style={styles.prefix}>
                <Text style={styles.prefixText}>+91</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Input
                  value={phone}
                  onChangeText={(v: string) => setPhone(v.replace(/\D/g, '').slice(0, 10))}
                  placeholder="10-digit phone"
                  keyboardType="number-pad"
                  maxLength={10}
                />
              </View>
            </View>
            {error && <Text style={styles.errorText}>{error}</Text>}
            <Button
              title="Send OTP"
              onPress={onSendOtp}
              disabled={phone.length !== 10}
            />
          </>
        )}

        {phase === 'enter_otp' && (
          <>
            <Text style={styles.heading}>Enter the OTP</Text>
            <Text style={styles.subtext}>Sent to +91 {phone}</Text>
            <Input
              value={otp}
              onChangeText={(v: string) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-digit code"
              keyboardType="number-pad"
              maxLength={6}
            />
            {error && <Text style={styles.errorText}>{error}</Text>}
            <Button
              title="Verify"
              onPress={onConfirmOtp}
              disabled={otp.length !== 6}
            />
            <Pressable
              onPress={() => {
                setPhase('enter_phone');
                setOtp('');
                setError(null);
              }}
            >
              <Text style={styles.link}>Change phone number</Text>
            </Pressable>
          </>
        )}

        {/* Invisible reCAPTCHA mount point. RecaptchaVerifier injects an
            iframe into this div on first use. Must always be in the DOM
            so the verifier can find it even after re-renders. RN Web maps
            `nativeID` to the underlying div's `id` attribute. */}
        <View nativeID="recaptcha-container" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, padding: spacing.lg, gap: spacing.md },
  heading: { ...typography.h2 },
  subtext: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  phoneRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  prefix: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  prefixText: { ...typography.body },
  errorText: { ...typography.caption, color: colors.danger },
  link: {
    ...typography.body,
    color: colors.primary,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
});
