import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../components/common/Button';
import Input from '../components/common/Input';
import Loader from '../components/common/Loader';
import ScreenHeader from '../components/common/ScreenHeader';
import { APP_NAME, TAGLINE } from '../constants/branding';
import { colors, radii, spacing, typography } from '../constants/theme';
import type { ConfirmationResult } from '../services/authService';
import { authService } from '../services/authService';
import { useAuthStore } from '../store/useAuthStore';
import { openPrivacy, openTerms } from '../utils/openLegal';

type Phase = 'enter_phone' | 'enter_otp' | 'verifying';

// Seconds the Resend OTP button is disabled after each send. Matches
// the rough lower bound of Firebase's per-phone send-rate throttle and
// is generous enough that real SMS routing has time to deliver the
// previous one before the user retries. Bump if Indian carriers show
// >30s delays in practice.
const RESEND_COOLDOWN_SECS = 30;

export default function LoginScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const returnTo: string | undefined = route.params?.returnTo;

  const [phase, setPhase] = useState<Phase>('enter_phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Seconds remaining on the resend-OTP cooldown. 0 means resend is
  // allowed; >0 means button disabled with a countdown.
  const [resendCooldown, setResendCooldown] = useState(0);
  // Used to avoid leaking the interval when the screen unmounts.
  const cooldownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tick the cooldown timer once per second while >0. Clear when it
  // reaches 0 so the interval doesn't keep firing forever.
  useEffect(() => {
    if (resendCooldown <= 0) {
      if (cooldownIntervalRef.current) {
        clearInterval(cooldownIntervalRef.current);
        cooldownIntervalRef.current = null;
      }
      return;
    }
    if (cooldownIntervalRef.current) return;
    cooldownIntervalRef.current = setInterval(() => {
      setResendCooldown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => {
      if (cooldownIntervalRef.current) {
        clearInterval(cooldownIntervalRef.current);
        cooldownIntervalRef.current = null;
      }
    };
  }, [resendCooldown]);

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
      setResendCooldown(RESEND_COOLDOWN_SECS);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to send OTP');
      setPhase('enter_phone');
    }
  };

  // Resend the OTP using the same phone number. Re-creates the
  // confirmation result (and a fresh reCAPTCHA verifier on web —
  // authService.startPhoneAuth handles that internally). Old OTP is
  // invalidated server-side as soon as Firebase issues the new one,
  // so users should always enter the most recent code.
  //
  // Cooldown enforced client-side via resendCooldown; if the user
  // somehow bypasses it (e.g. browser console), Firebase still
  // throttles server-side and returns auth/too-many-requests.
  const onResendOtp = async () => {
    if (resendCooldown > 0) return;
    setError(null);
    setOtp('');
    setPhase('verifying');
    try {
      const conf = await authService.startPhoneAuth(`+91${phone}`);
      setConfirmation(conf);
      setPhase('enter_otp');
      setResendCooldown(RESEND_COOLDOWN_SECS);
    } catch (e: any) {
      console.error('[LoginScreen] resend OTP failed:', {
        code: e?.code,
        message: e?.message,
      });
      // Common case: Firebase rate-limited the number. Surface a
      // clear message so the user knows to wait rather than retrying
      // immediately (which makes the rate limit worse).
      if (e?.code === 'auth/too-many-requests') {
        setError(
          'Too many OTP requests for this number. Wait a few minutes and try again.',
        );
      } else {
        setError(e?.message ?? 'Could not resend OTP. Try again in a moment.');
      }
      setPhase('enter_otp');
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
    } catch (err: any) {
      // Diagnostic — surface the actual Firebase error code so we can
      // distinguish "wrong OTP" from "test-phone link limitation" from
      // "verificationId expired" etc. Without this, the catch swallowed
      // everything as a generic "Invalid OTP" message regardless of
      // the real cause.
      console.error('[LoginScreen] confirmOtp failed:', {
        code: err?.code,
        message: err?.message,
        full: err,
      });
      setError('Invalid OTP. Try again.');
      setPhase('enter_otp');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* PR 39 — brand block: first visual contact with the app.
          Centered wordmark + tagline, no background, sits above the
          Sign-in ScreenHeader and below the SafeArea top inset. */}
      <View style={styles.brandBlock}>
        <Text style={styles.brandName}>{APP_NAME}</Text>
        <Text style={styles.brandTagline}>{TAGLINE}</Text>
      </View>
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
            {/* PR 25 — legal footer. Only shown on the enter_phone
                phase; once the user taps Send OTP they have already
                accepted (per Terms of Service §2). Keeping it off the
                OTP screen avoids visual clutter while typing. */}
            <View style={styles.legalFooter}>
              <Text style={styles.legalText}>
                By continuing, you agree to our{' '}
                <Text style={styles.legalLink} onPress={openTerms}>
                  Terms of Service
                </Text>
                {' '}and{' '}
                <Text style={styles.legalLink} onPress={openPrivacy}>
                  Privacy Policy
                </Text>
                .
              </Text>
            </View>
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
            {/* Resend OTP — visible always but disabled during cooldown.
                Indian SMS routing can take 30s–2min; this gives users
                a clear "I can retry" affordance without spamming
                Firebase's per-phone rate limiter. */}
            <Pressable
              onPress={onResendOtp}
              disabled={resendCooldown > 0}
            >
              <Text
                style={[
                  styles.link,
                  resendCooldown > 0 && styles.linkDisabled,
                ]}
              >
                {resendCooldown > 0
                  ? `Resend OTP in ${resendCooldown}s`
                  : "Didn't get the code? Resend OTP"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setPhase('enter_phone');
                setOtp('');
                setError(null);
                setResendCooldown(0);
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
  // PR 39 — brand block. Two stacked text lines, centered. No box.
  brandBlock: {
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  brandName: {
    ...typography.h1,
    textAlign: 'center',
  },
  brandTagline: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
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
  linkDisabled: {
    color: colors.textSecondary,
  },
  // PR 25 — legal footer (Terms / Privacy links) on the enter_phone phase.
  legalFooter: {
    marginTop: spacing.lg,
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  legalText: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  legalLink: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
