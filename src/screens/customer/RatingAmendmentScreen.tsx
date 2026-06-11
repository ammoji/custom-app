/**
 * PR-NEXT-REVIEW-SYSTEM §G — customer correction screen.
 *
 * Shown when a shop/partner has responded to a low-rating review.
 * Customer can either keep their original stars (acknowledgeReview)
 * or amend to new stars (amendRating). Either action publishes
 * the review with the response visible.
 */
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/common/Button';
import ScreenHeader from '../../components/common/ScreenHeader';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { orderService } from '../../services/orderService';
import type { RootStackParamList } from '../../navigation/AppNavigator';

export default function RatingAmendmentScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'RatingAmendment'>>();
  const {
    ratingId,
    shopName: shopNameParam,
    originalShopStars: originalShopStarsParam,
    responseText: responseTextParam,
    responseBy: responseByParam,
  } = route.params;

  const [responseText] = useState<string | null>(responseTextParam ?? null);
  const [responseBy] = useState<string | null>(responseByParam ?? null);
  const [originalShopStars] = useState<number>(originalShopStarsParam ?? 1);
  const [shopName] = useState<string>(shopNameParam ?? 'the shop');
  const [newStars, setNewStars] = useState<number | null>(null);
  const [loading] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleKeepOriginal = async () => {
    setSaving(true);
    try {
      await orderService.acknowledgeReview({ ratingId });
      Alert.alert(
        'Review published',
        'Your original rating and the response are now public.',
        [{ text: 'OK', onPress: () => nav.goBack() }],
      );
    } catch (e: any) {
      Alert.alert('Could not publish', e?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleAmend = async () => {
    if (newStars === null) {
      Alert.alert('Select stars', 'Tap a star rating to amend.');
      return;
    }
    setSaving(true);
    try {
      await orderService.amendRating({ ratingId, newShopStars: newStars });
      Alert.alert(
        'Rating updated',
        `Your rating has been updated to ${newStars}★ and is now public.`,
        [{ text: 'OK', onPress: () => nav.goBack() }],
      );
    } catch (e: any) {
      Alert.alert('Could not update', e?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Update your rating?" onBack={() => nav.goBack()} />
      {loading ? (
        <ActivityIndicator
          style={{ marginTop: spacing.xxl ?? spacing.xl }}
          color={colors.primary}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.intro}>
            You rated {shopName}{' '}
            <Text style={styles.bold}>{originalShopStars}★</Text> on a recent
            order.
          </Text>

          {responseText ? (
            <View style={styles.responseBox}>
              <Text style={styles.responseLabel}>
                {responseBy === 'partner' ? 'Partner response:' : 'Shop response:'}
              </Text>
              <Text style={styles.responseText}>{responseText}</Text>
            </View>
          ) : (
            <Text style={styles.noResponse}>
              No response was provided within 7 days.
            </Text>
          )}

          <Text style={styles.sectionLabel}>How do you feel now?</Text>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map(s => (
              <Pressable
                key={s}
                onPress={() => setNewStars(s)}
                style={({ pressed }) => [
                  styles.starBtn,
                  newStars === s && styles.starBtnActive,
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityLabel={`Amend to ${s} stars`}
              >
                <Text
                  style={[
                    styles.starBtnText,
                    newStars === s && styles.starBtnTextActive,
                  ]}
                >
                  {s}★
                </Text>
              </Pressable>
            ))}
          </View>
          {newStars !== null && (
            <Text style={styles.amendHint}>
              Tap "Update to {newStars}★" to publish with new stars.
            </Text>
          )}

          <Text style={styles.disclaimer}>
            Either way, your review will go public after this. You can keep
            your original {originalShopStars}★ or update to a new rating —
            the shop's response will be visible alongside it.
          </Text>

          <View style={styles.ctaRow}>
            <Button
              title={`Keep my original ${originalShopStars}★`}
              variant="secondary"
              onPress={handleKeepOriginal}
              loading={saving}
              disabled={saving}
              size="lg"
            />
          </View>
          <View style={styles.ctaRow}>
            <Button
              title={
                newStars !== null ? `Update to ${newStars}★` : 'Select stars above to update'
              }
              onPress={handleAmend}
              loading={saving}
              disabled={saving || newStars === null}
              size="lg"
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl ?? spacing.xl,
  },
  intro: {
    ...typography.body,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  bold: { fontWeight: '700' },
  responseBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  responseLabel: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  responseText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  noResponse: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
    fontStyle: 'italic',
  },
  sectionLabel: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  starsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  starBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  starBtnActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  starBtnText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  starBtnTextActive: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  amendHint: {
    ...typography.caption,
    color: colors.primary,
    marginBottom: spacing.sm,
  },
  disclaimer: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  ctaRow: {
    marginBottom: spacing.md,
  },
});
