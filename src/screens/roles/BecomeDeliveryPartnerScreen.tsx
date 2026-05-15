import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import ScreenHeader from '../../components/common/ScreenHeader';
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
import { authService } from '../../services/authService';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';

/**
 * One-tap opt-in to the delivery-partner role. Setting the claim now
 * (Phase 12a) means existing partners are pre-flagged when the actual
 * delivery dashboard ships in Phase 12b — no re-onboarding needed.
 *
 * Production will gate this behind an admin KYC approval (tracked in
 * PRELAUNCH_CHECKLIST). For MVP it's self-service.
 */
export default function BecomeDeliveryPartnerScreen() {
  const nav = useNavigation<any>();
  const isAnonymous = useAuthStore(s => s.isAnonymous);
  const isDelivery = useAuthStore(s => s.isDelivery);
  const setUser = useAuthStore(s => s.setUser);
  const [submitting, setSubmitting] = useState(false);

  const handleBecome = async () => {
    setSubmitting(true);
    try {
      await orderService.becomeDelivery();
      const refreshed = await authService.refreshClaims();
      if (refreshed) setUser(refreshed);
      Alert.alert(
        "You're in 🚚",
        'Your account is now flagged as a delivery partner. The delivery dashboard will be available in the next update.',
        [{ text: 'OK', onPress: () => nav.goBack() }],
      );
    } catch (e: any) {
      const message =
        e?.message || 'Failed to register. Please try again later.';
      Alert.alert('Could not register', message);
      setSubmitting(false);
    }
  };

  if (isAnonymous) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Become a delivery partner" onBack={() => nav.goBack()} />
        <EmptyState
          title="Sign in first"
          subtitle="You need a phone-verified account to register as a delivery partner."
        />
      </SafeAreaView>
    );
  }
  if (isDelivery) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Become a delivery partner" onBack={() => nav.goBack()} />
        <EmptyState
          title="You're already registered"
          subtitle="The delivery dashboard will appear on your Home screen once it ships."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Become a delivery partner" onBack={() => nav.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Earn flexibly with Kirana Mart</Text>
        <Text style={styles.body}>
          Deliver groceries from local kirana shops to customers within a
          1 km radius. Choose your own hours. Get paid per delivery.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>What happens next</Text>
          <Bullet text="Tap the button below to register your interest." />
          <Bullet text="Your account is flagged as a delivery partner." />
          <Bullet text="Once the delivery dashboard ships (next update), you'll see incoming pickup requests on your Home screen." />
          <Bullet text="No app changes needed when that happens — same login, same phone." />
        </View>

        <Text style={styles.disclaimer}>
          We&apos;ll add admin verification (ID, address, vehicle) before
          launch. For now this is a soft sign-up so we know who&apos;s
          interested.
        </Text>

        <View style={{ marginTop: spacing.lg }}>
          <Button
            title="I want to be a delivery partner"
            onPress={handleBecome}
            loading={submitting}
            disabled={submitting}
          />
        </View>
        <View style={{ marginTop: spacing.sm }}>
          <Button
            title="Cancel"
            variant="secondary"
            onPress={() => nav.goBack()}
            disabled={submitting}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bullet}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  heading: { ...typography.h2, marginBottom: spacing.sm },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  card: {
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.lg,
  },
  cardTitle: { ...typography.bodyBold, marginBottom: spacing.sm },
  bullet: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  bulletDot: { ...typography.body, color: colors.primary, fontWeight: '700' },
  bulletText: { ...typography.body, flex: 1 },
  disclaimer: {
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
});
