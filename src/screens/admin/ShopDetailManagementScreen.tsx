import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
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
import type { Shop } from '../../types';
import { formatOrderTime } from '../../utils/format';

/**
 * Admin shop detail with suspend/unsuspend actions. Pending shops
 * are redirected to ShopRegistrationDetail (the dedicated approve/
 * reject flow with full registrationData). Rejected shops show no
 * actions — re-registration creates a new shop document.
 */
export default function ShopDetailManagementScreen() {
  const nav = useNavigation<any>();
  const route =
    useRoute<RouteProp<RootStackParamList, 'ShopDetailManagement'>>();
  const { shopId } = route.params;
  const isAdmin = useAuthStore(s => s.isAdmin);

  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<'suspend' | 'unsuspend' | null>(null);
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [reason, setReason] = useState('');

  const fetchShop = useCallback(async () => {
    try {
      const list = await orderService.listAllShops();
      setShop(list.find(s => s.id === shopId) ?? null);
    } catch (e) {
      console.warn('[ShopDetailManagement] fetch failed:', e);
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    fetchShop();
  }, [isAdmin, fetchShop]);

  // If we got a pending shop here, route the admin to the proper
  // review flow rather than render half-actions.
  useEffect(() => {
    if (shop && shop.status === 'pending') {
      nav.replace('ShopRegistrationDetail', { shopId: shop.id });
    }
  }, [shop, nav]);

  const handleUnsuspend = async () => {
    if (!shop) return;
    Alert.alert(
      'Unsuspend shop?',
      `${shop.name} will become visible to customers again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unsuspend',
          onPress: async () => {
            setPending('unsuspend');
            try {
              await orderService.unsuspendShop({ shopId: shop.id });
              Alert.alert('Done', `${shop.name} is active again.`, [
                {
                  text: 'OK',
                  onPress: () => {
                    setLoading(true);
                    fetchShop();
                  },
                },
              ]);
            } catch (e: any) {
              Alert.alert(
                'Action failed',
                e?.message || 'Please try again.',
              );
            } finally {
              setPending(null);
            }
          },
        },
      ],
    );
  };

  const handleSuspendConfirm = async () => {
    if (!shop) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      Alert.alert('Reason required', 'Please describe why you are suspending.');
      return;
    }
    setPending('suspend');
    try {
      await orderService.suspendShop({ shopId: shop.id, reason: trimmed });
      setShowSuspendModal(false);
      Alert.alert('Suspended', `${shop.name} has been suspended.`, [
        {
          text: 'OK',
          onPress: () => {
            setLoading(true);
            fetchShop();
          },
        },
      ]);
    } catch (e: any) {
      Alert.alert('Action failed', e?.message || 'Please try again.');
    } finally {
      setPending(null);
    }
  };

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Shop" onBack={() => nav.goBack()} />
        <EmptyState title="Admin only" subtitle="" />
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Shop" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  if (!shop) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Shop" onBack={() => nav.goBack()} />
        <EmptyState
          title="Shop not found"
          subtitle="It may be outside the 100-shop listAllShops cap."
        />
      </SafeAreaView>
    );
  }

  const status = shop.status ?? 'active';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Shop" onBack={() => nav.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.name}>{shop.name}</Text>
          <Text style={styles.address}>{shop.address}</Text>
          <View style={[styles.badge, styles[`badge_${status}`]]}>
            <Text style={[styles.badgeText, styles[`badgeText_${status}`]]}>
              {status}
            </Text>
          </View>
          <Detail label="Owner uid" value={shop.ownerUid ?? '—'} />
          {shop.approvedAt ? (
            <Detail
              label="Approved"
              value={formatOrderTime(shop.approvedAt)}
            />
          ) : null}
        </View>

        {shop.registrationData && (
          <View style={styles.card}>
            <Text style={styles.label}>Registration data</Text>
            <Detail
              label="Phone"
              value={shop.registrationData.phone}
            />
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
          </View>
        )}

        {status === 'suspended' && shop.suspendedReason ? (
          <View style={[styles.card, styles.warningCard]}>
            <Text style={styles.label}>Suspension</Text>
            <Detail
              label="Reason"
              value={shop.suspendedReason}
            />
            {shop.suspendedAt ? (
              <Detail
                label="At"
                value={formatOrderTime(shop.suspendedAt)}
              />
            ) : null}
            {shop.suspendedBy ? (
              <Detail label="By" value={shop.suspendedBy} />
            ) : null}
          </View>
        ) : null}

        <View style={styles.actions}>
          {status === 'active' && (
            <Button
              title="Suspend shop"
              variant="secondary"
              onPress={() => {
                setReason('');
                setShowSuspendModal(true);
              }}
              disabled={pending !== null}
              size="lg"
            />
          )}
          {status === 'suspended' && (
            <Button
              title={pending === 'unsuspend' ? 'Unsuspending…' : 'Unsuspend shop'}
              onPress={handleUnsuspend}
              loading={pending === 'unsuspend'}
              disabled={pending !== null}
              size="lg"
            />
          )}
          {status === 'rejected' && (
            <Text style={styles.helper}>
              Rejected shops have no available actions. The owner can
              re-register from the home screen, which creates a new
              shop document.
            </Text>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={showSuspendModal}
        animationType="slide"
        transparent
        onRequestClose={() => {
          if (pending === null) setShowSuspendModal(false);
        }}
      >
        {/*
          Keyboard handling pattern — mirrors CancelAndRefundModal.
          Backdrop tap dismisses the keyboard ONLY (does NOT close
          the modal) so a half-typed suspend reason isn't wiped by
          an accidental tap. Modal closes only via the explicit
          Cancel button.
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
            <Text style={styles.modalTitle}>Suspend shop</Text>
            <Text style={styles.modalSubtitle}>
              The owner will be notified with this reason. Existing
              orders will continue but new customers won't see this shop.
            </Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Reason (required)"
              placeholderTextColor={colors.textSecondary}
              style={styles.modalInput}
              multiline
              numberOfLines={3}
              autoFocus
            />
            <View style={{ height: spacing.md }} />
            <Button
              title={pending === 'suspend' ? 'Suspending…' : 'Confirm suspend'}
              onPress={handleSuspendConfirm}
              loading={pending === 'suspend'}
              disabled={pending !== null}
            />
            <View style={{ height: spacing.sm }} />
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => setShowSuspendModal(false)}
              disabled={pending !== null}
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
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
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
  warningCard: {
    backgroundColor: colors.danger + '11',
    borderColor: colors.danger,
  },
  name: { ...typography.h2 },
  address: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.sm,
    marginBottom: spacing.sm,
  },
  badgeText: { ...typography.caption, fontWeight: '700' },
  badge_active: { backgroundColor: colors.primaryLight },
  badgeText_active: { color: colors.primaryDark },
  badge_pending: { backgroundColor: colors.warning + '22' },
  badgeText_pending: { color: colors.warning },
  badge_suspended: { backgroundColor: colors.danger + '22' },
  badgeText_suspended: { color: colors.danger },
  badge_rejected: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  badgeText_rejected: { color: colors.textSecondary },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  helper: { ...typography.body, color: colors.textSecondary },
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
    minHeight: 80,
    textAlignVertical: 'top',
    ...typography.body,
    color: colors.textPrimary,
  },
});
