import { CommonActions, useNavigation } from '@react-navigation/native';
import React, { useEffect, useRef, useState } from 'react';
import {
    Alert,
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
import { authService } from '../../services/authService';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
import type { DeliveryRequest } from '../../types';
import { formatOrderTime } from '../../utils/format';

const POLL_MS = 30_000;

// PR 1 — security hardening. Mirror of WaitingForApprovalScreen for
// delivery applicants. Polls getMyDeliveryRequest every 30s; on
// approval refreshes the ID token (so the new `delivery` custom claim
// is visible client-side) and bounces to the Delivery Dashboard. On
// rejection shows the admin's reason + an Edit & Resubmit button
// that routes back to the application form.
export default function DeliveryApprovalWaitingScreen() {
  const nav = useNavigation<any>();
  const setUser = useAuthStore(s => s.setUser);
  const [request, setRequest] = useState<DeliveryRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const navigatedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled || navigatedRef.current) return;
      try {
        const result = await orderService.getMyDeliveryRequest();
        if (cancelled) return;
        setRequest(result);
        setLoading(false);
        if (!result) return;
        if (result.status === 'approved' && !navigatedRef.current) {
          navigatedRef.current = true;
          try {
            const refreshed = await authService.refreshClaims();
            if (refreshed) setUser(refreshed);
          } catch (e) {
            console.warn(
              '[DeliveryApprovalWaiting] refreshClaims failed:',
              e,
            );
          }
          // Replace the stack so a back-press doesn't return here.
          nav.dispatch(
            CommonActions.reset({
              index: 1,
              routes: [
                { name: 'Home' },
                { name: 'DeliveryDashboard' },
              ],
            }),
          );
        }
      } catch (e) {
        console.warn('[DeliveryApprovalWaiting] poll failed:', e);
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
    // Send the user back to the form. The form's useEffect will
    // detect there's still a (rejected) request and let them re-
    // submit — requestDeliveryRole overwrites the prior doc.
    Alert.alert(
      'Edit and resubmit?',
      'Your previous application will be replaced.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Resubmit',
          onPress: () => nav.replace('BecomeDeliveryPartner'),
        },
      ],
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          title="Application status"
          onBack={() => nav.goBack()}
        />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  if (!request) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          title="Application status"
          onBack={() => nav.goBack()}
        />
        <EmptyState
          title="No application found"
          subtitle="If you just submitted, give it a few seconds and try again."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Application status"
        onBack={() => nav.goBack()}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View
          style={[
            styles.statusBadge,
            request.status === 'pending' && styles.badgePending,
            request.status === 'rejected' && styles.badgeRejected,
            request.status === 'approved' && styles.badgeApproved,
          ]}
        >
          <Text
            style={[
              styles.statusText,
              request.status === 'pending' && styles.statusTextPending,
              request.status === 'rejected' && styles.statusTextRejected,
              request.status === 'approved' && styles.statusTextApproved,
            ]}
          >
            {request.status === 'pending' && '⏳ Pending review'}
            {request.status === 'rejected' && '❌ Not approved'}
            {request.status === 'approved' && '✅ Approved'}
          </Text>
        </View>

        <View style={styles.card}>
          <Detail label="Phone" value={request.phone || '—'} />
          {request.name ? <Detail label="Name" value={request.name} /> : null}
          {request.vehicleType ? (
            <Detail label="Vehicle" value={request.vehicleType} />
          ) : null}
          {request.city ? <Detail label="City" value={request.city} /> : null}
          <Detail
            label="Submitted"
            value={formatOrderTime(request.submittedAt)}
          />
        </View>

        {request.status === 'pending' && (
          <Text style={styles.helper}>
            We review applications within 24 hours. You&apos;ll get a push
            notification when this changes — feel free to close the app.
          </Text>
        )}

        {request.status === 'rejected' && (
          <View
            style={[
              styles.card,
              { borderColor: colors.danger, marginTop: spacing.md },
            ]}
          >
            <Text style={styles.rejectedTitle}>Reason</Text>
            <Text style={styles.rejectedBody}>
              {request.rejectedReason ?? 'No reason provided.'}
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
  badgePending: { backgroundColor: (colors.warning ?? '#E89A3C') + '22' },
  badgeRejected: { backgroundColor: colors.danger + '22' },
  badgeApproved: { backgroundColor: colors.primaryLight },
  statusText: { ...typography.bodyBold },
  statusTextPending: { color: colors.warning ?? '#B35400' },
  statusTextRejected: { color: colors.danger },
  statusTextApproved: { color: colors.primaryDark },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
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
