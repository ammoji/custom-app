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
import type { Shop, UserInfo } from '../../types';
import { formatOrderTime } from '../../utils/format';

type ConfirmKind = 'shopOwner' | 'delivery' | 'suspendShop';

/**
 * Admin per-user detail page. Lets the admin revoke shopOwner /
 * delivery roles and suspend the user's shop. Self-view disables
 * every destructive action client-side; the server also enforces
 * `uid !== auth.uid` (single-admin lockout protection).
 *
 * We don't have a getUserById callable, so we re-use listAllUsers
 * and find by uid. Fine for MVP scale (≤100 users); pagination is
 * tracked in the prelaunch checklist.
 */
export default function UserDetailScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'UserDetail'>>();
  const { uid } = route.params;
  const isAdmin = useAuthStore(s => s.isAdmin);
  const myUid = useAuthStore(s => s.uid);
  const isSelf = myUid === uid;

  const [user, setUser] = useState<UserInfo | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<ConfirmKind | null>(null);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
  const [reason, setReason] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [users, shops] = await Promise.all([
        orderService.listAllUsers(),
        // listAllShops always returns; we filter to find the user's
        // shop by ownerUid below. For the (typical) case where the
        // user has no shop, this is one extra callable round-trip
        // but keeps the code simple and avoids a new endpoint.
        orderService.listAllShops().catch(() => [] as Shop[]),
      ]);
      const me = users.find(u => u.uid === uid) ?? null;
      setUser(me);
      if (me?.isShopOwner && me.shopId) {
        setShop(shops.find(s => s.id === me.shopId) ?? null);
      } else {
        setShop(null);
      }
    } catch (e) {
      console.warn('[UserDetail] fetch failed:', e);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    fetchData();
  }, [isAdmin, fetchData]);

  const openConfirm = (kind: ConfirmKind) => {
    setReason('');
    setConfirmKind(kind);
  };

  const handleConfirm = async () => {
    if (!confirmKind || !user) return;
    const trimmed = reason.trim();
    if (confirmKind === 'suspendShop' && !trimmed) {
      Alert.alert('Reason required', 'Please describe why you are suspending.');
      return;
    }
    setPending(confirmKind);
    try {
      if (confirmKind === 'shopOwner') {
        await orderService.revokeShopOwner({
          uid: user.uid,
          reason: trimmed || undefined,
        });
      } else if (confirmKind === 'delivery') {
        await orderService.revokeDelivery({
          uid: user.uid,
          reason: trimmed || undefined,
        });
      } else if (confirmKind === 'suspendShop' && shop) {
        await orderService.suspendShop({ shopId: shop.id, reason: trimmed });
      }
      setConfirmKind(null);
      Alert.alert('Done', 'Action completed.', [
        {
          text: 'OK',
          onPress: () => {
            // Refresh in place rather than goBack so the admin can
            // see the result (e.g. shopOwner chip gone).
            setLoading(true);
            fetchData();
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
        <ScreenHeader title="User" onBack={() => nav.goBack()} />
        <EmptyState title="Admin only" subtitle="" />
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="User" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="User" onBack={() => nav.goBack()} />
        <EmptyState
          title="User not found"
          subtitle="They may have been deleted, or this uid is older than the 100-user listAllUsers cap."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="User" onBack={() => nav.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.label}>Phone</Text>
          <Text style={styles.value}>
            {user.phoneNumber ?? '(no phone)'}
          </Text>
          <Detail label="UID" value={user.uid} mono />
          <Detail
            label="Created"
            value={user.createdAt ? formatOrderTime(user.createdAt) : '—'}
          />
          <Detail
            label="Last sign-in"
            value={
              user.lastSignInAt ? formatOrderTime(user.lastSignInAt) : '—'
            }
          />
          <Detail
            label="Anonymous"
            value={user.isAnonymous ? 'Yes' : 'No'}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Roles</Text>
          <View style={styles.rolesRow}>
            <RoleBadge active={user.isAdmin} label="Admin" />
            <RoleBadge active={user.isShopOwner} label="Shop owner" />
            <RoleBadge active={user.isDelivery} label="Delivery" />
            <RoleBadge active label="Customer" />
          </View>
          {/* PR 42.1 — delivery partner rolling rating, populated by
              `submitOrderRating`'s multi-write transaction. Only
              surfaced for delivery users who have at least one
              rating (count > 0) — a brand-new partner with no
              ratings yet shouldn't see a misleading "0★" badge.
              Rating count in parens gives admin context for the
              average (4.7★ from 2 ratings is much less reliable
              than 4.7★ from 200). */}
          {user.isDelivery &&
            typeof user.deliveryRatingCount === 'number' &&
            user.deliveryRatingCount > 0 && (
              /* PR-NEXT-BUNDLE-E §E — tappable → admin moderation view
                 of ALL this partner's reviews (pre-published included). */
              <Pressable
                onPress={() =>
                  nav.navigate('PartnerReviews', {
                    partnerUid: user.uid,
                    partnerName: user.phoneNumber ?? undefined,
                    mode: 'admin',
                  })
                }
                accessibilityRole="button"
                accessibilityLabel="View all delivery reviews for this partner"
              >
                <Detail
                  label="Delivery rating"
                  value={`${user.deliveryRatingAvg ?? 0} ★ (${user.deliveryRatingCount}) ›`}
                />
              </Pressable>
            )}
        </View>

        {isSelf && (
          <View style={[styles.card, styles.warningCard]}>
            <Text style={styles.warningText}>
              ⚠️ This is your own account. You cannot modify your own
              roles. To step down, grant admin to a successor via the
              `set-admin` CLI script first, then have them revoke you.
            </Text>
          </View>
        )}

        {user.isShopOwner && (
          <View style={styles.card}>
            <Text style={styles.label}>Shop owner</Text>
            {shop ? (
              <>
                <Text style={styles.value}>{shop.name}</Text>
                <Text style={styles.helper}>
                  Status: {shop.status ?? 'unknown'}
                </Text>
                {shop.suspendedReason && (
                  <Text style={styles.helper}>
                    Suspended: {shop.suspendedReason}
                  </Text>
                )}
                {shop.status === 'active' && (
                  <View style={{ marginTop: spacing.md }}>
                    <Button
                      title="Suspend shop"
                      variant="secondary"
                      onPress={() => openConfirm('suspendShop')}
                      disabled={isSelf || pending !== null}
                    />
                  </View>
                )}
              </>
            ) : (
              <Text style={styles.helper}>
                Shop record not found (may be outside the 100-shop cap).
              </Text>
            )}
            <View style={{ marginTop: spacing.md }}>
              <Button
                title={isSelf ? 'Cannot modify your own roles' : 'Revoke shop owner'}
                variant="secondary"
                onPress={() => openConfirm('shopOwner')}
                disabled={isSelf || pending !== null}
              />
            </View>
          </View>
        )}

        {user.isDelivery && (
          <View style={styles.card}>
            <Text style={styles.label}>Delivery partner</Text>
            <Text style={styles.helper}>
              Revoking will also reassign any in-flight deliveries to
              the open pool.
            </Text>
            <View style={{ marginTop: spacing.md }}>
              <Button
                title={isSelf ? 'Cannot modify your own roles' : 'Revoke delivery role'}
                variant="secondary"
                onPress={() => openConfirm('delivery')}
                disabled={isSelf || pending !== null}
              />
            </View>
          </View>
        )}

        {user.isAdmin && !isSelf && (
          <View style={[styles.card, styles.warningCard]}>
            <Text style={styles.warningText}>
              Admin role can only be revoked via the
              {' '}<Text style={styles.code}>set-admin</Text>{' '}
              CLI script. There is no callable to revoke admin — by
              design (single-admin lockout protection).
            </Text>
          </View>
        )}
      </ScrollView>

      <Modal
        visible={confirmKind !== null}
        animationType="slide"
        transparent
        onRequestClose={() => {
          if (pending === null) setConfirmKind(null);
        }}
      >
        {/*
          Keyboard handling pattern — mirrors CancelAndRefundModal.
          Backdrop tap dismisses the keyboard ONLY (does NOT close
          the modal) so a half-typed reason isn't wiped by an
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
            <Text style={styles.modalTitle}>
              {confirmKind === 'shopOwner' && 'Revoke shop owner role?'}
              {confirmKind === 'delivery' && 'Revoke delivery role?'}
              {confirmKind === 'suspendShop' && 'Suspend shop?'}
            </Text>
            <Text style={styles.modalSubtitle}>
              {confirmKind === 'shopOwner' &&
                "Their shop will be suspended; they keep delivery / admin roles if any."}
              {confirmKind === 'delivery' &&
                'In-flight deliveries are reassigned to the open pool. Customers are notified.'}
              {confirmKind === 'suspendShop' &&
                'Customers stop seeing this shop. In-flight orders continue.'}
            </Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder={
                confirmKind === 'suspendShop'
                  ? 'Reason (required)'
                  : 'Reason (optional, shown to user)'
              }
              placeholderTextColor={colors.textSecondary}
              style={styles.modalInput}
              multiline
              numberOfLines={3}
              autoFocus
            />
            <View style={{ height: spacing.md }} />
            <Button
              title={pending !== null ? 'Submitting…' : 'Confirm'}
              onPress={handleConfirm}
              loading={pending !== null}
              disabled={pending !== null}
            />
            <View style={{ height: spacing.sm }} />
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => setConfirmKind(null)}
              disabled={pending !== null}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text
        style={[
          styles.detailValue,
          mono && { fontFamily: 'monospace' as any },
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function RoleBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <View style={[styles.role, active ? styles.roleOn : styles.roleOff]}>
      <Text
        style={[
          styles.roleText,
          active ? styles.roleTextOn : styles.roleTextOff,
        ]}
      >
        {active ? '✓' : '·'} {label}
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
    backgroundColor: colors.warning + '11',
    borderColor: colors.warning,
  },
  warningText: { ...typography.body, color: colors.textPrimary },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  value: { ...typography.h3, marginBottom: spacing.xs },
  helper: { ...typography.body, color: colors.textSecondary },
  code: { fontFamily: 'monospace' as any, fontWeight: '700' },
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
  rolesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  role: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  roleOn: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  roleOff: { backgroundColor: colors.bg, borderColor: colors.border },
  roleText: { ...typography.caption, fontWeight: '700' },
  roleTextOn: { color: colors.primaryDark },
  roleTextOff: { color: colors.textSecondary },
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
