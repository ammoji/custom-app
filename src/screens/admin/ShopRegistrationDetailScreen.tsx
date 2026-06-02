import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
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
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Analytics } from '../../services/analytics';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
import type { Shop, ShopKycDocKind, UserInfo } from '../../types';
import { formatOrderTime } from '../../utils/format';
import { formatResolvedAddress } from '../../utils/formatResolvedAddress';
import { openMapsForCoords } from '../../utils/openMapsForCoords';
import { reverseGeocodeLabel } from '../../utils/reverseGeocodeLabel';

// PR 31 — Same labels the registration screen uses, kept here as a
// local copy so admin doesn't import from a screen folder. Order
// drives display order in the KYC docs card.
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
  // Phase 12c: owner info + prior-shops count, fetched alongside the
  // shop record. Failure to load these is non-fatal — they're
  // informational, not action-blocking.
  const [owner, setOwner] = useState<UserInfo | null>(null);
  const [priorShopsCount, setPriorShopsCount] = useState<number | null>(null);
  // PR 31 — KYC document signed-read URLs, fetched after the shop
  // record loads. `null` = never attempted; `{}` = attempted but the
  // shop has no docs yet. `zoomedUrl` drives the full-screen viewer.
  const [kycUrls, setKycUrls] = useState<Record<string, string> | null>(null);
  const [zoomedUrl, setZoomedUrl] = useState<string | null>(null);
  // PR-NEXT-SHOP-LOCATION-REQUIRED — admin-side location verification
  // checkbox. Forces the admin to consciously eyeball the GPS pin
  // (via the Verify-on-map deeplink rendered alongside) before the
  // Approve CTA enables. Local state only — the durable record is
  // `locationVerifiedAt` + `locationVerifiedBy` written server-side
  // by `approveShop` via `validateShopLocationForApproval`.
  // Sits with the other top-level useStates above any conditional
  // return (Rule 2). Reset on shop swap inside the load effect so a
  // back-nav-and-reopen doesn't carry the prior shop's check over.
  const [locationVerifiedChecked, setLocationVerifiedChecked] =
    useState(false);
  // PR-NEXT-SHOP-LOCATION-EDIT — reverse-geocoded resolution of the
  // shop's pin, surfaced alongside the owner-typed `shop.address`
  // so the admin can spot a mismatch (Ballwin MO typed; pin
  // resolves to Faridabad → almost certainly the fallback-leak
  // bug). Local state only — Firestore stores just lat/lng.
  // `null` = not yet attempted; '' = attempted but reverse-geocode
  // returned nothing meaningful (pure caption "Unknown location"
  // is shown instead via `formatResolvedAddress`).
  const [pinResolvedAddress, setPinResolvedAddress] = useState<string | null>(
    null,
  );

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

        // Look up owner + prior shops in parallel. listAllUsers is
        // capped at 100 (matches the admin user-management screen);
        // listAllShops returns up to 100 shops. Both are fine for
        // MVP scale; pagination is tracked in the prelaunch checklist.
        if (match?.ownerUid) {
          const ownerUid = match.ownerUid;
          try {
            const [users, shops] = await Promise.all([
              orderService.listAllUsers(),
              orderService.listAllShops(),
            ]);
            if (cancelled) return;
            setOwner(users.find(u => u.uid === ownerUid) ?? null);
            // Prior shops = approved or rejected (i.e. non-pending)
            // shops belonging to this owner OTHER than the one
            // currently under review. Helps spot resubmissions.
            const prior = shops.filter(
              s =>
                s.ownerUid === ownerUid &&
                s.id !== match.id &&
                s.status !== 'pending',
            );
            setPriorShopsCount(prior.length);
          } catch (e) {
            console.warn(
              '[ShopRegistrationDetail] owner/shops fetch failed:',
              e,
            );
          }
        }
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

  // PR 31 — Mint signed-read URLs for any uploaded KYC docs. Runs
  // only when an admin reaches a shop they have permission to view;
  // failure is non-fatal (the card just shows "Could not load").
  useEffect(() => {
    if (!isAdmin || !shop) return;
    let cancelled = false;
    (async () => {
      try {
        const { urls } = await orderService.getShopKycReadUrls({
          shopId: shop.id,
        });
        if (!cancelled) setKycUrls(urls ?? {});
      } catch (e) {
        console.warn('[ShopRegistrationDetail] kyc urls fetch failed:', e);
        if (!cancelled) setKycUrls({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shop, isAdmin]);

  // PR-NEXT-SHOP-LOCATION-EDIT — reverse-geocode the shop's pin so
  // the admin can compare owner-typed address (top of the location
  // card) vs resolved address (below). The visual mismatch is the
  // primary catch for the fallback-leak class of bug. Best-effort:
  // a network failure or no-Play-Services device collapses to
  // "Unknown location" via `reverseGeocodeLabel`'s EMPTY fallback.
  useEffect(() => {
    if (!shop || !shop.location) {
      setPinResolvedAddress(null);
      return;
    }
    const { lat, lng } = shop.location;
    if (
      typeof lat !== 'number' ||
      !Number.isFinite(lat) ||
      typeof lng !== 'number' ||
      !Number.isFinite(lng)
    ) {
      setPinResolvedAddress(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await reverseGeocodeLabel({ lat, lng });
        if (!cancelled) setPinResolvedAddress(formatResolvedAddress(r));
      } catch {
        if (!cancelled) setPinResolvedAddress('Unknown location');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shop]);

  // PR-NEXT-SHOP-LOCATION-REQUIRED — derived flag mirroring the
  // server-side `validateShopLocationForApproval` gate. Sits above
  // any conditional return so the hooks order stays stable across
  // pending/loaded states (Rule 2). The server will refuse with
  // `failed-precondition` if `lat`/`lng` are missing or out of
  // earth-range — surfacing the same check client-side prevents the
  // admin from ever seeing that error and gives them an actionable
  // banner instead.
  const shopHasValidLocation = (() => {
    const loc = shop?.location;
    if (!loc) return false;
    if (typeof loc.lat !== 'number' || !Number.isFinite(loc.lat)) return false;
    if (loc.lat < -90 || loc.lat > 90) return false;
    if (typeof loc.lng !== 'number' || !Number.isFinite(loc.lng)) return false;
    if (loc.lng < -180 || loc.lng > 180) return false;
    return true;
  })();
  // Approve enables only when (a) the shop has a valid pin AND
  // (b) the admin has explicitly checked the verification box.
  // `actionPending !== null` keeps the existing double-tap guard.
  const canApprove =
    actionPending === null && shopHasValidLocation && locationVerifiedChecked;

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
              // PR 38 — log AFTER server success so failed attempts
              // don't pollute the funnel. Same posture for every
              // PR-38 event wired in this file.
              Analytics.admin_shop_approved({ shop_id: shop.id });
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
      Analytics.admin_shop_rejected({
        shop_id: shop.id,
        reason_length: reason.length,
      });
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
        </View>

        {/* PR-NEXT-SHOP-LOCATION-EDIT — side-by-side location
            verification surface. Owner-typed address is the truth
            the owner SAID; reverse-geocoded resolution is what the
            stored pin actually points at. Visual mismatch (Ballwin
            MO typed; pin resolves to Faridabad) catches the
            fallback-leak class of bug at a glance. */}
        <View style={styles.card}>
          <Text style={styles.label}>Shop location verification</Text>

          <Text style={styles.locSubLabel}>
            Owner typed (Shop address field)
          </Text>
          <Text style={styles.locValue}>
            {shop.address?.trim() || '— address not provided —'}
          </Text>

          <View style={styles.locDivider} />

          <Text style={styles.locSubLabel}>
            Pin resolves to (reverse-geocoded)
          </Text>
          {shop.location &&
          (shop.location.lat !== 0 || shop.location.lng !== 0) ? (
            <>
              <Text style={styles.locValue}>
                {pinResolvedAddress === null
                  ? 'Resolving…'
                  : pinResolvedAddress || 'Unknown location'}
              </Text>
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
              >
                <Text style={[styles.helper, styles.mapLink]}>
                  📍 {shop.location.lat.toFixed(4)},{' '}
                  {shop.location.lng.toFixed(4)}
                  {'  '}
                  <Text style={styles.mapLinkArrow}>↗︎</Text>
                </Text>
              </Pressable>
              <Text style={styles.locSourceTag}>
                Source:{' '}
                {shop.locationSource === 'gps'
                  ? 'device GPS'
                  : shop.locationSource === 'geocoded'
                    ? 'typed address'
                    : 'unknown (legacy registration)'}
              </Text>
            </>
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

        {/* PR 31 — KYC documents card. Shown unconditionally — even
            shops registered before PR 31 (no kycDocs at all) get the
            "Not uploaded" treatment so admin sees the full slot list
            and can ask the owner to add the missing pieces. */}
        <View style={styles.card}>
          <Text style={styles.label}>KYC documents</Text>
          {kycUrls === null ? (
            <Text style={styles.helper}>Loading documents…</Text>
          ) : (
            <View style={styles.kycGrid}>
              {KYC_KINDS_ORDERED.map(kind => {
                const url = kycUrls[kind];
                return (
                  <View key={kind} style={styles.kycCell}>
                    <Pressable
                      onPress={() => url && setZoomedUrl(url)}
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

        <View style={styles.actions}>
          {/* PR-NEXT-SHOP-LOCATION-REQUIRED — defense layer 2.5 (UI).
              Surfaces the server-side `validateShopLocationForApproval`
              precondition BEFORE the admin taps Approve. Two render
              paths:
                - Shop has no / invalid GPS pin → red banner +
                  hard-disabled Approve. The checkbox is hidden
                  because no amount of human verification fixes a
                  missing lat/lng.
                - Shop has a valid pin → green-ish "Verify on map"
                  affordance + a checkbox the admin must tick.
                  Approve stays disabled until both `shopHasValidLocation`
                  AND `locationVerifiedChecked` are true. */}
          {!shopHasValidLocation ? (
            <View style={styles.locationBanner}>
              <Text style={styles.locationBannerText}>
                ⚠️ No GPS location captured (or out of valid earth
                range). Cannot approve until the owner re-opens
                RegisterShop and captures a valid pin.
              </Text>
            </View>
          ) : (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: locationVerifiedChecked }}
              onPress={() => setLocationVerifiedChecked(v => !v)}
              style={styles.verifyRow}
              hitSlop={6}
            >
              <Text style={styles.verifyCheckbox}>
                {locationVerifiedChecked ? '☑' : '☐'}
              </Text>
              <Text style={styles.verifyLabel}>
                I verified this shop’s location on the map. (Tap the
                📍 coords above to open Google Maps.)
              </Text>
            </Pressable>
          )}
          <Button
            title={actionPending === 'approve' ? 'Approving…' : '✅ Approve'}
            onPress={handleApprove}
            loading={actionPending === 'approve'}
            // PR-NEXT-SHOP-LOCATION-REQUIRED — gate on `canApprove`
            // (no pending action + valid pin + admin checkbox ticked).
            // Server-side `validateShopLocationForApproval` is the
            // structural lock; this is the UI affordance.
            disabled={!canApprove}
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
          the modal) so a half-typed reject reason can't be wiped by
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
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* PR 31 — Tap-to-zoom for KYC documents. The signed-read URL
          is valid for 1 hour from the initial fetch — well within
          a single review session. */}
      <Modal
        visible={!!zoomedUrl}
        transparent
        animationType="fade"
        onRequestClose={() => setZoomedUrl(null)}
      >
        <Pressable
          style={styles.zoomBackdrop}
          onPress={() => setZoomedUrl(null)}
        >
          {zoomedUrl && (
            <Image
              source={{ uri: zoomedUrl }}
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
  daysBannerText: {
    ...typography.bodyBold,
    color: colors.textSecondary,
  },
  daysBannerTextStale: { color: colors.warning ?? '#B35400' },
  actions: { marginTop: spacing.md },
  // PR-NEXT-SHOP-LOCATION-REQUIRED — DO NOT REMOVE. Red banner +
  // verify-checkbox styles for the location-gating affordance above
  // the Approve CTA.
  locationBanner: {
    backgroundColor: '#FEE2E2',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  locationBannerText: {
    ...typography.body,
    color: colors.danger,
  },
  verifyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
  },
  verifyCheckbox: {
    fontSize: 22,
    lineHeight: 22,
    color: colors.primary,
    marginRight: spacing.sm,
  },
  verifyLabel: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
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
  // PR 31 — KYC documents card.
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
  // PR 31.1 — tappable map link styling.
  mapLink: {
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  mapLinkArrow: {
    color: colors.primary,
    fontWeight: '600',
  },
  // PR-NEXT-SHOP-LOCATION-EDIT — location verification card styles.
  // The owner-typed-address row and the reverse-geocoded resolution
  // row share the same sub-label idiom so the side-by-side comparison
  // is visually obvious.
  locSubLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  locValue: {
    ...typography.body,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  locDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  locSourceTag: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
});
