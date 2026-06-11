import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    Image,
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
import ShopRatingBadge from '../../components/shop/ShopRatingBadge';
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Analytics } from '../../services/analytics';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
import type { Shop, ShopKycDocKind } from '../../types';
// PR-NEXT-SHOP-LOCATION-EDIT — DO NOT REMOVE. Pending-location
// approval surface uses these helpers to render the side-by-side
// current vs proposed pin comparison + the human-readable distance
// label.
import { distanceBetweenPins } from '../../utils/distanceBetweenPins';
import { formatOrderTime } from '../../utils/format';
import { formatResolvedAddress } from '../../utils/formatResolvedAddress';
import { openMapsForCoords } from '../../utils/openMapsForCoords';
import { reverseGeocodeLabel } from '../../utils/reverseGeocodeLabel';

// PR 31.1 — mirror of the KYC slot ordering + labels from
// `ShopRegistrationDetailScreen`. Kept inline (instead of a shared
// component) because the duplicated block is small and the
// two surfaces' UX is expected to diverge over time (e.g. admin
// dispute view may add re-request actions). If divergence proves
// false in a future PR, lift into `src/components/shop/AdminShopKycGrid.tsx`.
const KYC_KINDS_ORDERED: ShopKycDocKind[] = [
  'storefront',
  'gstDoc',
  'fssaiDoc',
  'ownerIdDoc',
];
const KYC_LABELS_ADMIN: Record<ShopKycDocKind, string> = {
  storefront: 'Storefront',
  gstDoc: 'GST certificate',
  fssaiDoc: 'FSSAI license',
  ownerIdDoc: 'Owner ID',
};

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
  const [pending, setPending] = useState<
    | 'suspend'
    | 'unsuspend'
    | 'regenerateImage'
    | 'approveLocation'
    | 'rejectLocation'
    | null
  >(null);
  // PR-NEXT-SHOP-LOCATION-EDIT — reverse-geocoded labels for the
  // current + proposed pins shown in the pending-location card. Same
  // `null=loading / ''=unresolved` convention as ShopSettings.
  const [currentResolved, setCurrentResolved] = useState<string | null>(null);
  const [pendingResolved, setPendingResolved] = useState<string | null>(null);
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [reason, setReason] = useState('');
  // PR 31.1 — KYC docs viewer state. Mirrors the pattern PR 31
  // added to `ShopRegistrationDetailScreen`: fetch signed-read
  // URLs once the admin is verified, render a 2x2 grid, tap a
  // thumbnail to zoom. State sits ABOVE the early returns so the
  // hook order is stable on every render path (Rules-of-Hooks).
  const [kycUrls, setKycUrls] = useState<Record<string, string>>({});
  const [kycLoading, setKycLoading] = useState(true);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);

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

  // PR 31.1 — fetch KYC signed-read URLs for any uploaded docs.
  // Unlike `ShopRegistrationDetailScreen`, this runs for active /
  // suspended / rejected shops too — admin needs to be able to
  // pull the original KYC evidence post-approval for customer
  // disputes. Server-side `getShopKycReadUrls` does not gate by
  // status (admin-only check), so the data is available.
  useEffect(() => {
    if (!isAdmin || !shopId) {
      setKycLoading(false);
      return;
    }
    let cancelled = false;
    orderService
      .getShopKycReadUrls({ shopId })
      .then(({ urls }) => {
        if (!cancelled) setKycUrls(urls);
      })
      .catch(e => {
        console.warn(
          '[ShopDetailManagement] getShopKycReadUrls failed:',
          e,
        );
      })
      .finally(() => {
        if (!cancelled) setKycLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, shopId]);

  // PR-NEXT-SHOP-LOCATION-EDIT — reverse-geocode the live + proposed
  // pins so the admin sees a human-readable label alongside lat/lng
  // (mirrors the side-by-side display in
  // `ShopRegistrationDetailScreen`). Best-effort + non-fatal.
  useEffect(() => {
    let cancelled = false;
    if (!shop?.location) {
      setCurrentResolved(null);
      return;
    }
    const { lat, lng } = shop.location;
    setCurrentResolved(null);
    reverseGeocodeLabel({ lat, lng })
      .then(g => {
        if (!cancelled) setCurrentResolved(formatResolvedAddress(g));
      })
      .catch(() => {
        if (!cancelled) setCurrentResolved('');
      });
    return () => {
      cancelled = true;
    };
  }, [shop?.location?.lat, shop?.location?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    if (!shop?.pendingLocation) {
      setPendingResolved(null);
      return;
    }
    const { lat, lng } = shop.pendingLocation;
    setPendingResolved(null);
    reverseGeocodeLabel({ lat, lng })
      .then(g => {
        if (!cancelled) setPendingResolved(formatResolvedAddress(g));
      })
      .catch(() => {
        if (!cancelled) setPendingResolved('');
      });
    return () => {
      cancelled = true;
    };
  }, [shop?.pendingLocation?.lat, shop?.pendingLocation?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // PR-NEXT-SHOP-LOCATION-EDIT — admin approve/reject of a pending
  // pin. Server is atomic: approve promotes `pendingLocation` to
  // `location`, clears pending fields, and re-stamps
  // `locationVerifiedAt/By`. Reject clears pending fields with an
  // optional reason. Owner gets a push notification either way.
  const handleApproveLocation = async () => {
    if (!shop) return;
    setPending('approveLocation');
    try {
      await orderService.approvePendingShopLocation({ shopId: shop.id });
      Alert.alert(
        'Location approved',
        `${shop.name}'s new GPS pin is now live.`,
        [
          {
            text: 'OK',
            onPress: () => {
              setLoading(true);
              fetchShop();
            },
          },
        ],
      );
    } catch (e: any) {
      Alert.alert(
        'Could not approve',
        e?.message ?? 'Please try again.',
      );
    } finally {
      setPending(null);
    }
  };
  const handleRejectLocation = async () => {
    if (!shop) return;
    Alert.alert(
      'Reject location change?',
      `${shop.name}'s pending pin will be cleared. The owner will be notified and can re-submit.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject change',
          style: 'destructive',
          onPress: async () => {
            setPending('rejectLocation');
            try {
              await orderService.rejectPendingShopLocation({
                shopId: shop.id,
              });
              Alert.alert('Rejected', 'The owner has been notified.', [
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
                'Could not reject',
                e?.message ?? 'Please try again.',
              );
            } finally {
              setPending(null);
            }
          },
        },
      ],
    );
  };

  // PR 42 followup — recovery action for shops approved with
  // `imageUrl: ''` because approveShop's storefront signing failed
  // silently. Re-mints the signed URL and stamps it onto the shop
  // doc. Surfaces the actual signing error via Alert so the admin
  // sees the IAM / quota / bucket cause (opposite of approveShop's
  // swallowed warn).
  const handleRegenerateImage = async () => {
    if (!shop) return;
    setPending('regenerateImage');
    try {
      await orderService.regenerateShopImageUrl({ shopId: shop.id });
      // Refresh local state so the new imageUrl is visible without
      // a manual reload. Same fetch-then-find pattern as the rest of
      // this screen.
      const list = await orderService.listAllShops();
      const next = list.find(s => s.id === shop.id);
      if (next) setShop(next);
      Alert.alert(
        'Image refreshed',
        `${shop.name}'s storefront photo is now live on the customer card.`,
      );
    } catch (e: any) {
      Alert.alert(
        'Could not refresh image',
        e?.message ??
          'Unknown error while signing the storefront URL. Check Cloud Logs for details.',
      );
    } finally {
      setPending(null);
    }
  };

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
              Analytics.admin_shop_unsuspended({ shop_id: shop.id });
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
      Analytics.admin_shop_suspended({ shop_id: shop.id });
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
          {/* PR 20.1 fix — admin should also see the shop's rating
              stats. Customer-facing surfaces got this in PR 20 but
              the admin shop detail was missed. Admins use this to
              spot low-rated shops worth investigating. */}
          {/* PR-NEXT-BUNDLE-E §E — tappable rating → admin moderation
              view (all reviews, including pre-published flagged_low). */}
          <Pressable
            style={{ marginTop: 8 }}
            onPress={() =>
              nav.navigate('ShopReviews', {
                shopId: shop.id,
                shopName: shop.name,
                mode: 'admin',
              })
            }
            accessibilityRole="button"
            accessibilityLabel="View all reviews for this shop"
          >
            <ShopRatingBadge
              ratingAvg={shop.ratingAvg}
              ratingCount={shop.ratingCount}
              size="md"
            />
            <Text style={styles.reviewsDrillHint}>Tap to view all reviews ›</Text>
          </Pressable>
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
          {/* PR 31.1 — tappable coords. Mirrors the pattern
              in `ShopRegistrationDetailScreen`. (0,0) sentinel
              is treated as "no GPS" with a plain-text fallback. */}
          {shop.location &&
          (shop.location.lat !== 0 || shop.location.lng !== 0) ? (
            <Pressable
              onPress={() =>
                openMapsForCoords(
                  shop.location.lat,
                  shop.location.lng,
                  shop.name,
                )
              }
              accessibilityRole="link"
              accessibilityLabel={`Open ${shop.name} location in maps`}
              hitSlop={8}
              style={{ marginTop: spacing.sm }}
            >
              <Text style={[styles.helper, styles.mapLink]}>
                📍 {shop.location.lat.toFixed(4)},{' '}
                {shop.location.lng.toFixed(4)}
                {'  '}
                <Text style={styles.mapLinkArrow}>↗︎</Text>
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.helper, { marginTop: spacing.sm }]}>
              📍 No GPS provided at registration.
            </Text>
          )}
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

        {/* PR 31.1 — KYC documents card. Renders for any non-pending
            shop the admin can view (pending shops are redirected to
            `ShopRegistrationDetail`). Customer disputes post-approval
            require pulling the original KYC evidence, so the docs
            stay visible for active / suspended / rejected shops. */}
        <View style={styles.card}>
          <Text style={styles.label}>KYC documents</Text>
          {kycLoading ? (
            <Text style={styles.helper}>Loading documents…</Text>
          ) : (
            <View style={styles.kycGrid}>
              {KYC_KINDS_ORDERED.map(kind => {
                const url = kycUrls[kind];
                return (
                  <View key={kind} style={styles.kycCell}>
                    <Pressable
                      onPress={() => url && setZoomUrl(url)}
                      disabled={!url}
                      style={[
                        styles.kycCellThumb,
                        !url && styles.kycCellThumbEmpty,
                      ]}
                    >
                      {url ? (
                        <Image
                          source={{ uri: url }}
                          style={{ width: '100%', height: '100%' }}
                          resizeMode="cover"
                        />
                      ) : (
                        <Text style={styles.kycCellEmptyText}>—</Text>
                      )}
                    </Pressable>
                    <Text style={styles.kycCellLabel}>
                      {KYC_LABELS_ADMIN[kind]}
                    </Text>
                    <Text
                      style={[
                        styles.kycCellStatus,
                        url
                          ? { color: colors.success }
                          : { color: colors.textSecondary },
                      ]}
                    >
                      {url ? 'Uploaded' : 'Not uploaded'}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* PR-NEXT-SHOP-LOCATION-EDIT — pending location change.
            Surfaces only when the owner has submitted a pending pin
            via `submitPendingShopLocation`. Admin sees side-by-side
            current + proposed pin, both reverse-geocoded, plus the
            distance between them and a Verify-on-map deeplink for
            the proposed pin. Approve is atomic on the server (live
            location ← pendingLocation, pending fields cleared,
            verifiedAt/By re-stamped). Reject clears pending fields
            and notifies the owner. */}
        {shop.pendingLocationStatus === 'pending' && shop.pendingLocation ? (
          <View style={[styles.card, styles.pendingLocationCard]}>
            <Text style={styles.pendingLocationTitle}>
              ⏳ Pending location change
            </Text>

            {shop.location ? (
              <View style={styles.pendingLocationBlock}>
                <Text style={styles.pendingLocationSubLabel}>
                  Current pin (live)
                </Text>
                <Text style={styles.pendingLocationPinLine}>
                  📍 {shop.location.lat.toFixed(4)},{' '}
                  {shop.location.lng.toFixed(4)}
                </Text>
                {currentResolved && currentResolved.length > 0 && (
                  <Text style={styles.pendingLocationResolvedLine}>
                    Resolves to: {currentResolved}
                  </Text>
                )}
                {typeof shop.locationVerifiedAt === 'number' && (
                  <Text style={styles.pendingLocationMetaLine}>
                    Verified {formatOrderTime(shop.locationVerifiedAt)}
                    {shop.locationVerifiedBy
                      ? ` by ${shop.locationVerifiedBy.slice(0, 6)}…`
                      : ''}
                  </Text>
                )}
              </View>
            ) : null}

            <View style={styles.pendingLocationDivider} />

            <View style={styles.pendingLocationBlock}>
              <Text style={styles.pendingLocationSubLabel}>Proposed pin</Text>
              <Text style={styles.pendingLocationPinLine}>
                📍 {shop.pendingLocation.lat.toFixed(4)},{' '}
                {shop.pendingLocation.lng.toFixed(4)}
              </Text>
              {pendingResolved && pendingResolved.length > 0 && (
                <Text style={styles.pendingLocationResolvedLine}>
                  Resolves to: {pendingResolved}
                </Text>
              )}
              {shop.pendingLocationSource && (
                <Text style={styles.pendingLocationResolvedLine}>
                  Source:{' '}
                  {shop.pendingLocationSource === 'gps'
                    ? 'device GPS'
                    : 'typed address'}
                </Text>
              )}
              {typeof shop.pendingLocationSubmittedAt === 'number' && (
                <Text style={styles.pendingLocationMetaLine}>
                  Submitted{' '}
                  {formatOrderTime(shop.pendingLocationSubmittedAt)} by owner
                </Text>
              )}
              <Pressable
                onPress={() =>
                  shop.pendingLocation &&
                  openMapsForCoords(
                    shop.pendingLocation.lat,
                    shop.pendingLocation.lng,
                    `${shop.name} (proposed)`,
                  )
                }
                accessibilityRole="link"
                accessibilityLabel="Verify proposed pin on map"
                hitSlop={6}
                style={{ marginTop: spacing.xs }}
              >
                <Text style={[styles.helper, styles.mapLink]}>
                  Verify proposed on map ↗︎
                </Text>
              </Pressable>
            </View>

            {shop.location && (
              <Text style={styles.pendingLocationDistance}>
                Distance between pins:{' '}
                {distanceBetweenPins(shop.location, shop.pendingLocation).label}
              </Text>
            )}

            <View style={{ height: spacing.md }} />
            <Button
              title={
                pending === 'approveLocation'
                  ? 'Approving…'
                  : 'Approve change'
              }
              onPress={handleApproveLocation}
              loading={pending === 'approveLocation'}
              disabled={pending !== null}
              size="lg"
            />
            <View style={{ height: spacing.sm }} />
            <Button
              title={
                pending === 'rejectLocation'
                  ? 'Rejecting…'
                  : 'Reject change'
              }
              variant="secondary"
              onPress={handleRejectLocation}
              loading={pending === 'rejectLocation'}
              disabled={pending !== null}
              size="lg"
            />
          </View>
        ) : null}

        <View style={styles.actions}>
          {/*
            PR 5 hotfix: admin path into ShopSettings for ANY shop.
            ShopSettingsScreen reads the optional shopId route param
            and dispatches to listAllShops+find (admin) instead of
            getShopForOwner (shopOwner self-serve). Server's
            validateShopSettings allows admin callers when shopId is
            present in the request body.
          */}
          {(status === 'active' || status === 'suspended') && (
            <>
              <Button
                title="⚙️ Edit settings (delivery fee, minimum order)"
                variant="secondary"
                onPress={() => nav.navigate('ShopSettings', { shopId: shop.id })}
                disabled={pending !== null}
                size="lg"
              />
              <View style={{ height: spacing.md }} />
              {/* PR 42 followup — admin recovery for shops approved
                  with an empty imageUrl (storefront signing failed
                  silently inside approveShop). Tap to re-mint the
                  signed URL from the existing kycDocs.storefront
                  path. The server callable throws on signing failure
                  so the admin sees the actual error message rather
                  than the swallow-and-placeholder UX of approveShop. */}
              <Button
                title={
                  pending === 'regenerateImage'
                    ? 'Refreshing storefront image…'
                    : shop.imageUrl
                      ? '🖼️ Refresh storefront image'
                      : '🖼️ Generate storefront image'
                }
                variant="secondary"
                onPress={handleRegenerateImage}
                loading={pending === 'regenerateImage'}
                disabled={pending !== null}
                size="lg"
              />
              <View style={{ height: spacing.md }} />
            </>
          )}
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
            // PR 31.1 — surface the rejectedReason + rejectedAt so
            // admin has the decision history at hand (previously
            // only visible to the owner via WaitingForApprovalScreen).
            <View style={styles.rejectedCard}>
              <Text style={styles.rejectedTitle}>Rejection reason</Text>
              <Text style={styles.rejectedReason}>
                {shop.rejectedReason?.trim() || 'No reason recorded.'}
              </Text>
              {shop.rejectedAt ? (
                <Text style={styles.rejectedTimestamp}>
                  Rejected on {formatOrderTime(shop.rejectedAt)}
                </Text>
              ) : null}
              <Text style={[styles.helper, { marginTop: spacing.md }]}>
                Rejected shops have no available actions. The owner can
                re-register from the home screen, which creates a new
                shop document.
              </Text>
            </View>
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

      {/* PR 31.1 — KYC tap-to-zoom modal. Signed-read URL is valid
          for 1 hour from `getShopKycReadUrls`; well within a single
          review session. */}
      <Modal
        visible={!!zoomUrl}
        transparent
        animationType="fade"
        onRequestClose={() => setZoomUrl(null)}
      >
        <Pressable
          style={styles.zoomBackdrop}
          onPress={() => setZoomUrl(null)}
        >
          {zoomUrl && (
            <Image
              source={{ uri: zoomUrl }}
              style={styles.zoomImage}
              resizeMode="contain"
            />
          )}
        </Pressable>
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
  // PR-NEXT-BUNDLE-E §E — drill-in hint under the rating badge.
  reviewsDrillHint: {
    ...typography.caption,
    color: colors.primary,
    marginTop: spacing.xs,
  },
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
  // PR 31.1 — tappable lat/lng styling.
  mapLink: {
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  mapLinkArrow: {
    color: colors.primary,
    fontWeight: '600',
  },
  // PR 31.1 — KYC docs grid (mirrors ShopRegistrationDetailScreen).
  kycGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
    marginHorizontal: -spacing.xs,
  },
  kycCell: {
    width: '50%',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  kycCellThumb: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radii.sm,
    overflow: 'hidden',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kycCellThumbEmpty: {
    backgroundColor: colors.surface,
  },
  kycCellEmptyText: {
    ...typography.h2,
    color: colors.textMuted,
  },
  kycCellLabel: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  kycCellStatus: {
    ...typography.caption,
    fontWeight: '600',
  },
  zoomBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomImage: { width: '100%', height: '100%' },
  // PR 31.1 — rejection-reason card on rejected shops.
  rejectedCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  rejectedTitle: {
    ...typography.h3,
    marginBottom: spacing.xs,
  },
  rejectedReason: {
    ...typography.body,
    color: colors.textPrimary,
  },
  rejectedTimestamp: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  // PR-NEXT-SHOP-LOCATION-EDIT — pending location change card.
  // Warning-tinted left-border to distinguish from the normal cards;
  // matches the visual cue used by `warningCard` for suspensions.
  pendingLocationCard: {
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
  },
  pendingLocationTitle: {
    ...typography.h3,
    color: colors.warning,
    marginBottom: spacing.sm,
  },
  pendingLocationBlock: {
    marginVertical: spacing.xs,
  },
  pendingLocationSubLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  pendingLocationPinLine: {
    ...typography.body,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  pendingLocationResolvedLine: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  pendingLocationMetaLine: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  pendingLocationDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  pendingLocationDistance: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
});
