import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
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
import type { Shop } from '../../types';
import { formatOrderTime } from '../../utils/format';

/**
 * Admin detail/action page for one pending registration. Loads via
 * the same listPendingShops cache path (we re-fetch the whole list
 * and find by id) — fine for the small queue size we expect at MVP
 * scale; if the queue grows, switch to a per-id getShopById callable.
 *
 * Approve and Reject are guarded so accidental double-taps don't
 * fire two callables. Reject opens a modal that requires a non-empty
 * reason — matches the rejectShop server-side validation.
 */
export default function ShopRegistrationDetailScreen() {
  const nav = useNavigation<any>();
  const route =
    useRoute<RouteProp<RootStackParamList, 'ShopRegistrationDetail'>>();
  const { shopId } = route.params;
  const isAdmin = useAuthStore(s => s.isAdmin);

  const [shop, setShop] = useState<Shop | null>(null);
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
        const list = await orderService.listPendingShops();
        if (cancelled) return;
        const match = list.find(s => s.id === shopId) ?? null;
        setShop(match);
      } catch (e) {
        console.warn('[ShopRegistrationDetail] fetch failed:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopId, isAdmin]);

  const handleApprove = async () => {
    if (!shop) return;
    Alert.alert(
      'Approve shop?',
      `${shop.name} will go live and the owner will be notified.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          style: 'default',
          onPress: async () => {
            setActionPending('approve');
            try {
              await orderService.approveShop({ shopId: shop.id });
              Alert.alert('Approved', `${shop.name} is now live.`, [
                { text: 'OK', onPress: () => nav.goBack() },
              ]);
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
    if (!shop) return;
    const reason = rejectReason.trim();
    if (!reason) {
      Alert.alert('Reason required', 'Please enter why you are rejecting.');
      return;
    }
    setActionPending('reject');
    try {
      await orderService.rejectShop({ shopId: shop.id, reason });
      setShowRejectModal(false);
      Alert.alert(
        'Rejected',
        `${shop.name} was rejected. Owner has been notified.`,
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
          title="Registration"
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
          title="Registration"
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
          title="Registration"
          onBack={() => nav.goBack()}
        />
        <EmptyState
          title="Not in pending queue"
          subtitle="It may have already been approved or rejected."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Registration" onBack={() => nav.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.label}>Shop</Text>
          <Text style={styles.value}>{shop.name}</Text>
          <Text style={styles.address}>{shop.address}</Text>
          {shop.location &&
          (shop.location.lat !== 0 || shop.location.lng !== 0) ? (
            <Text style={styles.helper}>
              📍 {shop.location.lat.toFixed(4)},{' '}
              {shop.location.lng.toFixed(4)}
            </Text>
          ) : (
            <Text style={styles.helper}>
              📍 No GPS provided at registration.
            </Text>
          )}
        </View>

        {shop.registrationData && (
          <View style={styles.card}>
            <Text style={styles.label}>Registration data</Text>
            <Detail label="Phone" value={shop.registrationData.phone} />
            <Detail
              label="Hours"
              value={`${shop.registrationData.hours.open} – ${shop.registrationData.hours.close}`}
            />
            <Detail
              label="GST"
              value={shop.registrationData.gstNumber || '—'}
            />
            <Detail
              label="FSSAI"
              value={shop.registrationData.fssaiLicense || '—'}
            />
            <Detail
              label="Submitted"
              value={formatOrderTime(shop.registrationData.submittedAt)}
            />
            <Detail label="Owner uid" value={shop.ownerUid ?? '—'} />
          </View>
        )}

        <View style={styles.actions}>
          <Button
            title={actionPending === 'approve' ? 'Approving…' : '✅ Approve'}
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
        onRequestClose={() => setShowRejectModal(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => {
            if (actionPending !== 'reject') setShowRejectModal(false);
          }}
        >
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Reject registration</Text>
            <Text style={styles.modalSubtitle}>
              Owner will see this reason and can edit + resubmit.
            </Text>
            <TextInput
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="e.g. Address incomplete — missing pincode"
              placeholderTextColor={colors.textSecondary}
              style={styles.modalInput}
              multiline
              numberOfLines={4}
              autoFocus
            />
            <View style={{ height: spacing.md }} />
            <Button
              title={actionPending === 'reject' ? 'Rejecting…' : 'Confirm reject'}
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
          </Pressable>
        </Pressable>
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
  address: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  helper: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.sm,
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
  actions: { marginTop: spacing.md },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
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
