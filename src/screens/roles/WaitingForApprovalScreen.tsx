import {
    CommonActions,
    RouteProp,
    useNavigation,
    useRoute,
} from '@react-navigation/native';
import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import Loader from '../../components/common/Loader';
import ScreenHeader from '../../components/common/ScreenHeader';
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { authService } from '../../services/authService';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
import type { Shop } from '../../types';
import { formatOrderTime } from '../../utils/format';

const POLL_MS = 30_000;

/**
 * Waiting room shown after a shop owner submits a registration. Polls
 * `getShopForOwner` every 30s — when the shop transitions out of
 * `pending`, we either auto-navigate to ShopOwnerDashboard (approved)
 * or surface the rejection reason with an Edit-and-resubmit button.
 *
 * After approval we ALSO refresh the ID token so the new `shopOwner`
 * custom claim is visible client-side; otherwise the dashboard would
 * see `isShopOwner=false` until the user signs out and back in.
 */
export default function WaitingForApprovalScreen() {
  const nav = useNavigation<any>();
  const route =
    useRoute<RouteProp<RootStackParamList, 'WaitingForApproval'>>();
  const expectedShopId = route.params?.shopId;
  const setUser = useAuthStore(s => s.setUser);

  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const navigatedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled || navigatedRef.current) return;
      try {
        const result = await orderService.getShopForOwner();
        if (cancelled) return;
        setShop(result);
        setLoading(false);
        if (!result) return;
        // Server returned a shop. If it's been approved, refresh the
        // claim and bounce to the dashboard. We replace the back stack
        // so the user can't navigate back to this waiting screen after
        // approval.
        if (result.status === 'active' && !navigatedRef.current) {
          navigatedRef.current = true;
          try {
            const refreshed = await authService.refreshClaims();
            if (refreshed) setUser(refreshed);
          } catch (e) {
            console.warn('[WaitingForApproval] refreshClaims failed:', e);
          }
          nav.dispatch(
            CommonActions.reset({
              index: 1,
              routes: [
                { name: 'Home' },
                { name: 'ShopOwnerDashboard' },
              ],
            }),
          );
        }
      } catch (e) {
        console.warn('[WaitingForApproval] poll failed:', e);
        setLoading(false);
      }
    };
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [nav, setUser]);

  const handleResubmit = () => {
    if (!shop) return;
    // Pre-fill the form with the rejected submission so the owner only
    // needs to fix the part the admin called out.
    nav.replace('RegisterShop', {
      prefill: {
        name: shop.name,
        address: shop.address,
        phone: shop.registrationData?.phone ?? '',
        hours: shop.registrationData?.hours,
        gstNumber: shop.registrationData?.gstNumber ?? undefined,
        fssaiLicense: shop.registrationData?.fssaiLicense ?? undefined,
      },
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          title="Awaiting approval"
          onBack={() => nav.goBack()}
        />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  if (!shop) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          title="Awaiting approval"
          onBack={() => nav.goBack()}
        />
        <EmptyState
          title="No registration found"
          subtitle="If you just submitted, give it a few seconds and try again."
        />
      </SafeAreaView>
    );
  }

  // Defensive: if route param expected a different shop than the one
  // returned, surface a warning rather than silently showing the wrong
  // record. Shouldn't happen — registerShop blocks duplicates.
  const wrongShop =
    expectedShopId && expectedShopId !== shop.id ? true : false;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Awaiting approval"
        onBack={() => nav.goBack()}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View
          style={[
            styles.statusBadge,
            shop.status === 'pending' && styles.badgePending,
            shop.status === 'rejected' && styles.badgeRejected,
            shop.status === 'active' && styles.badgeActive,
          ]}
        >
          <Text
            style={[
              styles.statusText,
              shop.status === 'pending' && styles.statusTextPending,
              shop.status === 'rejected' && styles.statusTextRejected,
              shop.status === 'active' && styles.statusTextActive,
            ]}
          >
            {shop.status === 'pending' && '⏳ Pending review'}
            {shop.status === 'rejected' && '❌ Rejected'}
            {shop.status === 'active' && '✅ Approved'}
          </Text>
        </View>

        {wrongShop && (
          <Text style={styles.warning}>
            Note: showing your most recent shop, not the one you just
            navigated from.
          </Text>
        )}

        <View style={styles.card}>
          <Text style={styles.shopName}>{shop.name}</Text>
          <Text style={styles.address}>{shop.address}</Text>
          {shop.registrationData && (
            <>
              <Detail label="Phone" value={shop.registrationData.phone} />
              <Detail
                label="Hours"
                value={`${shop.registrationData.hours.open} – ${shop.registrationData.hours.close}`}
              />
              {shop.registrationData.gstNumber ? (
                <Detail
                  label="GST"
                  value={shop.registrationData.gstNumber}
                />
              ) : null}
              {shop.registrationData.fssaiLicense ? (
                <Detail
                  label="FSSAI"
                  value={shop.registrationData.fssaiLicense}
                />
              ) : null}
              <Detail
                label="Submitted"
                value={formatOrderTime(
                  shop.registrationData.submittedAt,
                )}
              />
            </>
          )}
        </View>

        {shop.status === 'pending' && (
          <Text style={styles.helper}>
            We review most registrations within 24 hours. You'll get a
            push notification when this changes — feel free to close the
            app.
          </Text>
        )}

        {shop.status === 'rejected' && (
          <View
            style={[styles.card, { borderColor: colors.danger, marginTop: spacing.md }]}
          >
            <Text style={styles.rejectedTitle}>Reason</Text>
            <Text style={styles.rejectedBody}>
              {shop.rejectedReason ?? 'No reason provided.'}
            </Text>
            <View style={{ marginTop: spacing.md }}>
              <Button
                title="Edit and resubmit"
                onPress={handleResubmit}
                size="lg"
              />
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    marginBottom: spacing.md,
  },
  badgePending: { backgroundColor: colors.warning + '22' },
  badgeRejected: { backgroundColor: colors.danger + '22' },
  badgeActive: { backgroundColor: colors.primaryLight },
  statusText: { ...typography.bodyBold },
  statusTextPending: { color: colors.warning },
  statusTextRejected: { color: colors.danger },
  statusTextActive: { color: colors.primaryDark },
  warning: {
    ...typography.caption,
    color: colors.warning,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  shopName: { ...typography.h2, marginBottom: spacing.xs },
  address: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    gap: spacing.md,
  },
  detailLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  detailValue: { ...typography.body, flex: 1, textAlign: 'right' },
  helper: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
    fontStyle: 'italic',
  },
  rejectedTitle: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  rejectedBody: { ...typography.body },
});
