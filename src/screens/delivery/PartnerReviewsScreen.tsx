/**
 * PR-NEXT-5.1 §D — published reviews for a delivery partner.
 *
 * Paginated FlatList via listPartnerReviews callable.
 * Entry point: PartnerDetailsSheet trust line tap.
 */
// PR-NEXT-5.1 §D — DO NOT REMOVE.
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import EmptyState from '../../components/common/EmptyState';
import ScreenHeader from '../../components/common/ScreenHeader';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { orderService } from '../../services/orderService';
import type { RootStackParamList } from '../../navigation/AppNavigator';
// PR-NEXT-BUNDLE-G §D — DO NOT REMOVE. Partner photo header.
import { buildPartnerHeaderViewModel } from '../../utils/partnerHeaderViewModel';

type Review = {
  ratingId: string;
  correctionState?: string | null;
  deliveryStars: number;
  deliveryComment: string | null;
  customerName: string | null;
  publishedAt: number;
  responseText: string | null;
  responseBy: string | null;
};

// PR-NEXT-BUNDLE-E §E — human-readable state pill for admin mode.
function stateLabel(state?: string | null): string | null {
  switch (state) {
    case 'flagged_low':
      return 'Flagged (low)';
    case 'responded':
      return 'Responded';
    case 'amended':
      return 'Amended';
    default:
      return null;
  }
}

function StarRow({ count }: { count: number }) {
  return (
    <Text style={styles.stars}>
      {'★'.repeat(Math.min(5, Math.max(1, count)))}
      {'☆'.repeat(Math.max(0, 5 - count))}
    </Text>
  );
}

function ReviewCard({ item }: { item: Review }) {
  const ago = Math.floor((Date.now() - item.publishedAt) / (1000 * 60 * 60 * 24));
  const agoStr =
    !item.publishedAt || Number.isNaN(ago)
      ? 'Pending'
      : ago === 0
      ? 'Today'
      : ago === 1
      ? '1 day ago'
      : `${ago} days ago`;
  const pill = stateLabel(item.correctionState);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <StarRow count={item.deliveryStars} />
        <Text style={styles.cardMeta}>
          {item.customerName ?? 'Customer'} · {agoStr}
        </Text>
      </View>
      {pill && (
        <View style={styles.statePill}>
          <Text style={styles.statePillText}>{pill}</Text>
        </View>
      )}
      {!!item.deliveryComment && (
        <Text style={styles.commentText}>{item.deliveryComment}</Text>
      )}
      {!!item.responseText && (
        <View style={styles.responseBox}>
          <Text style={styles.responseLabel}>Partner response:</Text>
          <Text style={styles.responseText}>{item.responseText}</Text>
        </View>
      )}
    </View>
  );
}

export default function PartnerReviewsScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'PartnerReviews'>>();
  const { partnerUid, partnerName, mode } = route.params;
  const isAdmin = mode === 'admin';
  const isOwn = mode === 'own';
  const vm = buildPartnerHeaderViewModel({
    name: partnerName,
    photoUrl: null,
    ratingAvg: null,
    ratingCount: null,
  });
  const [photoLoadError, setPhotoLoadError] = useState(false);

  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const loadReviews = useCallback(
    async (reset: boolean) => {
      if (reset) {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }
      try {
        const res = await orderService.listPartnerReviews({
          partnerUid,
          limit: 20,
          cursor: reset ? undefined : cursor,
          adminScope: isAdmin,
          mode: isOwn ? 'own' : undefined,
        });
        const next = res.reviews as Review[];
        setReviews(prev => (reset ? next : [...prev, ...next]));
        setHasMore(res.hasMore);
        if (!isAdmin && next.length > 0) setCursor(next[next.length - 1].publishedAt);
      } catch (e: any) {
        setError(e?.message ?? 'Could not load reviews');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [partnerUid, cursor, isAdmin],
  );

  useEffect(() => {
    loadReviews(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerUid]);

  const title = isOwn ? 'Your reviews' : (partnerName ? `${partnerName} · Reviews` : 'Partner Reviews');

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title={title} onBack={() => nav.goBack()} />
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title={title} onBack={() => nav.goBack()} />
        <EmptyState title="Could not load reviews" subtitle={error} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={title} onBack={() => nav.goBack()} />
      {/* PR-NEXT-BUNDLE-G §D — partner identity header (40×40 avatar + name) */}
      {!isOwn && (
        <View style={styles.partnerHeader}>
          {vm.avatar.kind === 'photo' && !photoLoadError ? (
            <Image
              source={{ uri: vm.avatar.uri }}
              style={styles.partnerAvatar}
              onError={() => setPhotoLoadError(true)}
            />
          ) : (
            <View style={[styles.partnerAvatar, styles.partnerAvatarInitials]}>
              <Text style={styles.partnerAvatarText}>
                {vm.avatar.kind === 'initials' ? vm.avatar.text : '?'}
              </Text>
            </View>
          )}
          <Text style={styles.partnerName}>{vm.displayName}</Text>
        </View>
      )}
      <FlatList
        data={reviews}
        keyExtractor={item => item.ratingId}
        renderItem={({ item }) => <ReviewCard item={item} />}
        contentContainerStyle={
          reviews.length === 0 ? styles.emptyContent : styles.listContent
        }
        ListEmptyComponent={
          <EmptyState
            title="No reviews yet"
            subtitle="Published delivery reviews will appear here."
          />
        }
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator style={{ margin: spacing.lg }} color={colors.primary} />
          ) : null
        }
        onEndReached={() => {
          if (hasMore && !loadingMore) loadReviews(false);
        }}
        onEndReachedThreshold={0.3}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xl },
  emptyContent: { flex: 1 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  stars: { fontSize: 16, color: '#F59E0B', letterSpacing: 1 },
  cardMeta: { ...typography.caption, color: colors.textSecondary },
  // PR-NEXT-BUNDLE-E §E — admin-mode state pill.
  statePill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.warning,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginBottom: spacing.xs,
  },
  statePillText: { ...typography.caption, color: '#fff', fontWeight: '700' },
  commentText: { ...typography.body, color: colors.textPrimary, marginTop: spacing.xs },
  responseBox: {
    backgroundColor: colors.bg,
    borderRadius: radii.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  responseLabel: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    marginBottom: 2,
  },
  responseText: { ...typography.body, color: colors.textPrimary },
  partnerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  partnerAvatar: { width: 40, height: 40, borderRadius: 20 },
  partnerAvatarInitials: {
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  partnerAvatarText: { ...typography.caption, color: colors.primaryDark, fontWeight: '700' },
  partnerName: { ...typography.bodyBold, color: colors.textPrimary, flex: 1 },
});
