import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import {
    Alert,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import Loader from '../../components/common/Loader';
import ScreenHeader from '../../components/common/ScreenHeader';
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
import type { DeliveryRequest } from '../../types';
import { daysSince, formatOrderTime } from '../../utils/format';

/**
 * PR 1 — security hardening. Admin detail/action screen for one
 * pending delivery-partner application. Mirror of
 * ShopRegistrationDetailScreen: same approve / reject modal +
 * reason flow, same idempotency guard (action buttons disable
 * during in-flight ops).
 */
export default function DeliveryRequestDetailScreen() {
  const nav = useNavigation<any>();
  const route =
    useRoute<RouteProp<RootStackParamList, 'DeliveryRequestDetail'>>();
  const { uid } = route.params;
  const isAdmin = useAuthStore(s => s.isAdmin);

  const [request, setRequest] = useState<DeliveryRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState<
    null | 'approve' | 'reject'
  >(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Same re-fetch-list-then-find posture as
        // ShopRegistrationDetailScreen. No per-uid getter on the
        // server; list cap is 50 which is plenty for MVP. If the
        // queue grows past that we'll add a getDeliveryRequest({uid})
        // callable (tracked in PRELAUNCH_CHECKLIST PR-1-followup).
        const list = await orderService.listPendingDeliveryRequests();
        if (cancelled) return;
        setRequest(list.find(r => r.uid === uid) ?? null);
      } catch (e) {
        console.warn('[DeliveryRequestDetail] fetch failed:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, isAdmin]);

  const handleApprove = () => {
    if (!request) return;
    Alert.alert(
      'Approve application?',
      `${request.name || request.phone || request.uid} will be granted the delivery-partner role and notified.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          style: 'default',
          onPress: async () => {
            setActionPending('approve');
            try {
              await orderService.approveDeliveryRole(request.uid);
              Alert.alert(
                'Approved',
                `${request.name || request.phone} is now a delivery partner.`,
                [{ text: 'OK', onPress: () => nav.goBack() }],
              );
            } catch (e: any) {
              Alert.alert(
                'Approval failed',
                e?.message || 'Please try again.',
              );
              setActionPending(null);
            }
          },
        },
      ],
    );
  };

  const handleRejectConfirm = async () => {
    if (!request) return;
    const reason = rejectReason.trim();
    if (!reason) {
      Alert.alert('Reason required', 'Please enter why you are rejecting.');
      return;
    }
    setActionPending('reject');
    try {
      await orderService.rejectDeliveryRole({ uid: request.uid, reason });
      setShowRejectModal(false);
      Alert.alert(
        'Rejected',
        'Applicant has been notified with your reason.',
        [{ text: 'OK', onPress: () => nav.goBack() }],
      );
    } catch (e: any) {
      Alert.alert('Rejection failed', e?.message || 'Please try again.');
      setActionPending(null);
    }
  };

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          title="Delivery request"
          onBack={() => nav.goBack()}
        />
        <EmptyState title="Admin only" subtitle="" />
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          title="Delivery request"
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
          title="Delivery request"
          onBack={() => nav.goBack()}
        />
        <EmptyState
          title="Not in pending queue"
          subtitle="It may have already been approved or rejected."
        />
      </SafeAreaView>
    );
  }

  const d = daysSince(request.submittedAt, Date.now());
  const stale = d > 7;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Delivery request" onBack={() => nav.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View
          style={[styles.daysBanner, stale && styles.daysBannerStale]}
        >
          <Text
            style={[
              styles.daysBannerText,
              stale && styles.daysBannerTextStale,
            ]}
          >
            {d === 0
              ? 'Submitted today'
              : `Submitted ${d} day${d === 1 ? '' : 's'} ago`}
            {stale ? ' — review overdue' : ''}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Applicant</Text>
          <Text style={styles.value}>
            {request.name || request.phone || request.uid}
          </Text>
          <View style={{ height: spacing.sm }} />
          <Detail label="Phone" value={request.phone || '—'} />
          {request.vehicleType ? (
            <Detail label="Vehicle" value={request.vehicleType} />
          ) : null}
          {request.city ? <Detail label="City" value={request.city} /> : null}
          <Detail
            label="Submitted"
            value={formatOrderTime(request.submittedAt)}
          />
          <Detail label="uid" value={request.uid} />
        </View>

        <View style={styles.actions}>
          <Button
            title={
              actionPending === 'approve' ? 'Approving…' : '✅ Approve'
            }
            onPress={handleApprove}
            loading={actionPending === 'approve'}
            disabled={actionPending !== null}
            size="lg"
          />
          <View style={{ height: spacing.md }} />
          <Button
            title="❌ Reject"
            variant="secondary"
            onPress={() => {
              setRejectReason('');
              setShowRejectModal(true);
            }}
            disabled={actionPending !== null}
            size="lg"
          />
        </View>
      </ScrollView>

      <Modal
        visible={showRejectModal}
        animationType="slide"
        transparent
        onRequestClose={() => {
          if (actionPending !== 'reject') setShowRejectModal(false);
        }}
      >
        {/*
          Keyboard handling pattern — mirrors CancelAndRefundModal.
          Backdrop tap dismisses the keyboard ONLY (does NOT close
          the modal) so a half-typed reject reason isn't wiped by an
          accidental tap. Modal closes only via the explicit Cancel
          button.
        */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kavRoot}
        >
          <Pressable
            style={styles.backdropTapZone}
            onPress={() => Keyboard.dismiss()}
            accessibilityLabel="Dismiss keyboard"
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reject application</Text>
            <Text style={styles.modalSubtitle}>
              Applicant will see this reason and can edit + resubmit.
            </Text>
            <TextInput
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="e.g. Vehicle photo missing"
              placeholderTextColor={colors.textSecondary}
              style={styles.modalInput}
              multiline
              numberOfLines={4}
              autoFocus
            />
            <View style={{ height: spacing.md }} />
            <Button
              title={
                actionPending === 'reject' ? 'Rejecting…' : 'Confirm reject'
              }
              onPress={handleRejectConfirm}
              loading={actionPending === 'reject'}
              disabled={actionPending !== null}
            />
            <View style={{ height: spacing.sm }} />
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => setShowRejectModal(false)}
              disabled={actionPending !== null}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.md,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  value: { ...typography.h3 },
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
  daysBanner: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  daysBannerStale: {
    backgroundColor: '#FEF2E5',
    borderColor: colors.warning ?? '#E89A3C',
  },
  daysBannerText: { ...typography.bodyBold, color: colors.textSecondary },
  daysBannerTextStale: { color: colors.warning ?? '#B35400' },
  actions: { marginTop: spacing.md },
  // Keyboard handling pattern — see CancelAndRefundModal.
  kavRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  backdropTapZone: { flex: 1 },
  modalCard: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  modalTitle: { ...typography.h2, marginBottom: spacing.xs },
  modalSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  modalInput: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: 96,
    textAlignVertical: 'top',
    ...typography.body,
    color: colors.textPrimary,
  },
});
