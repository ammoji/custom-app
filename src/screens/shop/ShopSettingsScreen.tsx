import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
// PR-NEXT-SHOP-LOCATION-EDIT — DO NOT REMOVE. Shared dual-mode
// (GPS / typed-address geocode) capture hook used by both
// RegisterShopScreen and the ShopSettings edit surface below. Single
// source of truth for the fallback-leak posture (HOTFIX-FALLBACK-
// LEAK) — refusing the silent MOCK_USER_LOCATION pin lives inside
// the hook so neither surface can drift.
import { useCaptureShopLocation } from '../../hooks/useCaptureShopLocation';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { orderService } from '../../services/orderService';
import type { DeliveryChargeTier, Shop } from '../../types';
import {
  DEFAULT_DELIVERY_CHARGE_TIERS,
  validateDeliveryChargeTiers,
} from '../../utils/deliveryChargeHelpers';
// PR-NEXT-SHOP-LOCATION-EDIT — DO NOT REMOVE. Reverse-geocodes the
// current and pending pins so the owner sees a human-readable
// "Resolves to: …" line under each lat/lng. Mirrors the admin
// verification surface (`ShopRegistrationDetailScreen`) so the two
// stay in lockstep.
import { formatResolvedAddress } from '../../utils/formatResolvedAddress';
import { reverseGeocodeLabel } from '../../utils/reverseGeocodeLabel';
// PR 48 — service-radius default. Pre-fills the new "Service area"
// field for legacy shops that haven't been re-approved post-PR-48
// (and therefore have no `serviceRadiusKm` on their doc yet).
import { DEFAULT_SERVICE_RADIUS_KM } from '../../utils/geoVisibilityHelpers';

/**
 * PR 5 — Shop owner settings screen.
 *
 * Minimal by design (per the prompt's "Resist adding hours / GST /
 * FSSAI" note). Two numeric inputs that map 1:1 to the
 * `updateShopSettings` callable's whitelisted fields.
 *
 * Dirty-field pattern mirrors `ShopMenuItemEditScreen`: parse strings
 * to numbers on save, build the payload from changed fields only,
 * send. The callable's helper rejects ranges + types server-side, so
 * the client validation here is friendly (highlight + inline error)
 * rather than strict.
 *
 * Keyboard handling: wrap in `KeyboardAvoidingView` per the canonical
 * `CancelAndRefundModal` pattern. Two sequential numeric inputs are
 * exactly the case where the keyboard otherwise covers the Save
 * button on shorter Android devices.
 */
export default function ShopSettingsScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'ShopSettings'>>();
  // Admin path: route.params.shopId targets a specific shop.
  // Shop owner path: no params → falls back to getShopForOwner (their
  // own shop, scoped by their claim).
  const targetShopId = route.params?.shopId;
  const isAdminPath = typeof targetShopId === 'string' && targetShopId.length > 0;

  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // PR 48 — the flat `deliveryFee` input is removed from this
  // screen (the tier table in the lower card is what customers
  // actually pay; the flat field was confusing). The data field
  // `shop.deliveryFee` is INTENTIONALLY KEPT in the schema as the
  // legacy fallback for `chargeForDistance` + the back-compat shim
  // placeOrder stamps onto the order doc — we just no longer let
  // owners edit it via UI. See PR 48 section J.
  const [minOrderStr, setMinOrderStr] = useState('');
  // PR 48 — service radius (km). Owner sets how far they'll
  // deliver; `listShopsPublic` hides their shop from customers
  // farther than this. Integer-only / 1–50 km on the server
  // (`shopSettingsHelpers`).
  const [serviceRadiusStr, setServiceRadiusStr] = useState('');

  // PR 47 — distance-based delivery charge tiers. The editor uses
  // string-typed `kmStr` / `chargeStr` so the owner can type freely
  // (empty / partial values). The catch-all band is pinned to the
  // end of the array; its `kmStr` is unused (maxKm is null) so we
  // store '' for it. Numeric parsing happens at save time.
  type DraftTier = { kmStr: string; chargeStr: string; isCatchAll: boolean };
  const [tierDrafts, setTierDrafts] = useState<DraftTier[]>([]);
  const [tiersError, setTiersError] = useState<string | null>(null);
  const [tiersSaving, setTiersSaving] = useState(false);
  // Snapshot of the loaded tier table — used to compute `tiersDirty`
  // so the Save button only enables when something actually changed.
  const [loadedTiers, setLoadedTiers] = useState<DeliveryChargeTier[] | null>(
    null,
  );
  // Per-field inline errors (client-side, friendly). The server's
  // tighter validation runs on Save; if it fires, we surface that
  // through the Alert below.
  const [errors, setErrors] = useState<{
    minOrder?: string;
    // PR 48 — service-radius inline error.
    serviceRadiusKm?: string;
  }>({});

  // PR-NEXT-SHOP-LOCATION-EDIT — DO NOT REMOVE. Owner-facing edit
  // surface for the shop's GPS pin. Captures via the shared
  // `useCaptureShopLocation` hook (same fallback-leak posture as
  // RegisterShop). On Save, the new pin lands in `pendingLocation*`
  // server-side and the live `location` stays authoritative until
  // an admin runs `approvePendingShopLocation`. Customers keep
  // seeing the verified pin throughout review.
  const {
    captured: capturedShopLocation,
    capturing: capturingShopLocation,
    error: captureShopError,
    captureGps: captureShopGps,
    captureFromAddress: captureShopFromAddress,
    reset: resetShopCapture,
  } = useCaptureShopLocation();
  // Reverse-geocoded labels for the live + pending pins so the
  // section header reads "Resolves to: …" the same way the success
  // card reads after a fresh capture. `null` while loading; '' if
  // the lookup fell through to the empty fallback (rare —
  // reverseGeocodeLabel never throws).
  const [currentResolved, setCurrentResolved] = useState<string | null>(null);
  const [pendingResolved, setPendingResolved] = useState<string | null>(null);
  const [submittingLocation, setSubmittingLocation] = useState(false);
  const [cancellingLocation, setCancellingLocation] = useState(false);
  // PR-NEXT-LOW-RATING-PUSH §D — notification threshold settings.
  const [alertThreshold, setAlertThreshold] = useState<number>(3);
  const [alertEnabled, setAlertEnabled] = useState<boolean>(true);
  const [savingAlert, setSavingAlert] = useState(false);

  // Wrapped so post-submit and post-cancel can refetch through the
  // same code path the initial load takes. Keeps `shop` in sync with
  // the canonical server doc (handles the pending-status flip and
  // re-clear without a manual screen reload).
  const refetchShop = useCallback(async (): Promise<Shop | null> => {
    if (isAdminPath) {
      const allShops = await orderService.listAllShops();
      return allShops.find(s => s.id === targetShopId) ?? null;
    }
    return await orderService.getShopForOwner();
  }, [isAdminPath, targetShopId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Two fetch paths:
        //   - Admin path: route param shopId is set → fetch all shops
        //     (admin-only callable) and find by id. No per-id getter
        //     yet; matches the posture of UserDetailScreen and
        //     ShopDetailManagementScreen which also do list+find.
        //   - Shop owner path: no param → use getShopForOwner which
        //     reads the caller's claim's shopId server-side.
        const resolved: Shop | null = await refetchShop();
        if (cancelled) return;
        setShop(resolved);
        if (resolved) {
          setMinOrderStr(String(resolved.minOrder ?? 0));
          // PR 48 — pre-fill the radius field. Legacy shops without
          // the field show the default so the input is never blank
          // for an approved shop.
          setServiceRadiusStr(
            String(
              typeof resolved.serviceRadiusKm === 'number' &&
                resolved.serviceRadiusKm > 0
                ? resolved.serviceRadiusKm
                : DEFAULT_SERVICE_RADIUS_KM,
            ),
          );
          // PR-NEXT-LOW-RATING-PUSH §D — hydrate alert settings from shop doc.
          if (typeof resolved.lowRatingThreshold === 'number') {
            setAlertThreshold(resolved.lowRatingThreshold);
          }
          if (typeof resolved.lowRatingNotificationsEnabled === 'boolean') {
            setAlertEnabled(resolved.lowRatingNotificationsEnabled);
          }
          // PR 47 — hydrate the tier editor. Use the stored tiers
          // when present; otherwise seed from the admin defaults so
          // a legacy shop owner sees a sensible starting table they
          // can edit + save (rather than an empty editor that
          // refuses to validate without a catch-all).
          const tiersToShow =
            Array.isArray(resolved.deliveryChargeTiers) &&
            resolved.deliveryChargeTiers.length > 0
              ? resolved.deliveryChargeTiers
              : DEFAULT_DELIVERY_CHARGE_TIERS;
          setLoadedTiers(
            Array.isArray(resolved.deliveryChargeTiers)
              ? resolved.deliveryChargeTiers
              : null,
          );
          setTierDrafts(
            tiersToShow.map(t => ({
              kmStr: t.maxKm === null ? '' : String(t.maxKm),
              chargeStr: String(t.charge),
              isCatchAll: t.maxKm === null,
            })),
          );
        }
      } catch (e: any) {
        if (cancelled) return;
        console.warn('[ShopSettings] load failed:', e);
        setLoadError(e?.message ?? 'Could not load shop settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdminPath, targetShopId, refetchShop]);

  // PR-NEXT-SHOP-LOCATION-EDIT — reverse-geocode the live and
  // pending pins so the location card can render "Resolves to: …"
  // alongside lat/lng. Best-effort + non-fatal: failure collapses
  // to '' (the fallback inside `reverseGeocodeLabel`) and the
  // line just doesn't show.
  useEffect(() => {
    let cancelled = false;
    if (!shop?.location) {
      setCurrentResolved(null);
      return () => {
        cancelled = true;
      };
    }
    const { lat, lng } = shop.location;
    setCurrentResolved(null);
    reverseGeocodeLabel({ lat, lng })
      .then(g => {
        if (!cancelled) setCurrentResolved(formatResolvedAddress(g));
      })
      .catch(e => {
        // HOTFIX-SILENT-CATCH-GUARD — DO NOT REMOVE. Reverse-geocode is
        // a display nicety; fall back to blank but log so a broken
        // geocoder isn't invisible.
        if (!cancelled) setCurrentResolved('');
        console.warn('[ShopSettings] resolve current address failed:', e);
      });
    return () => {
      cancelled = true;
    };
  }, [shop?.location?.lat, shop?.location?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    if (!shop?.pendingLocation) {
      setPendingResolved(null);
      return () => {
        cancelled = true;
      };
    }
    const { lat, lng } = shop.pendingLocation;
    setPendingResolved(null);
    reverseGeocodeLabel({ lat, lng })
      .then(g => {
        if (!cancelled) setPendingResolved(formatResolvedAddress(g));
      })
      .catch(e => {
        // HOTFIX-SILENT-CATCH-GUARD — DO NOT REMOVE. See note above.
        if (!cancelled) setPendingResolved('');
        console.warn('[ShopSettings] resolve pending address failed:', e);
      });
    return () => {
      cancelled = true;
    };
  }, [shop?.pendingLocation?.lat, shop?.pendingLocation?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // PR-NEXT-SHOP-LOCATION-EDIT — submit the captured pin as a
  // pending change. Server enforces ownership + coord-range +
  // identical-pin gates (see `pendingShopLocationHelpers.ts`); the
  // client just surfaces the helper's user-friendly error message.
  async function handleSubmitPendingLocation() {
    if (!shop || !capturedShopLocation) return;
    setSubmittingLocation(true);
    try {
      await orderService.submitPendingShopLocation({
        shopId: shop.id,
        newLocation: {
          lat: capturedShopLocation.lat,
          lng: capturedShopLocation.lng,
        },
        newLocationSource: capturedShopLocation.source,
      });
      const fresh = await refetchShop();
      if (fresh) setShop(fresh);
      resetShopCapture();
      Alert.alert(
        'Submitted for review',
        'An admin will review your new pin shortly. Customers keep seeing your current pin until the change is approved.',
      );
    } catch (e: any) {
      Alert.alert(
        'Could not submit',
        e?.message ?? 'Please try again. If the problem persists, contact support.',
      );
    } finally {
      setSubmittingLocation(false);
    }
  }

  async function handleCancelPendingLocation() {
    if (!shop) return;
    Alert.alert(
      'Cancel pending change?',
      'Your current verified pin stays live. You can submit a new change any time.',
      [
        { text: 'Keep pending change', style: 'cancel' },
        {
          text: 'Cancel change',
          style: 'destructive',
          onPress: async () => {
            setCancellingLocation(true);
            try {
              await orderService.cancelPendingShopLocation({ shopId: shop.id });
              const fresh = await refetchShop();
              if (fresh) setShop(fresh);
            } catch (e: any) {
              Alert.alert(
                'Could not cancel',
                e?.message ?? 'Please try again.',
              );
            } finally {
              setCancellingLocation(false);
            }
          },
        },
      ],
    );
  }

  // Build the changed-fields payload. Numbers parse with Number()
  // (rejects empty strings via NaN check below). Integer-only enforced
  // here for friendlier client feedback; server re-validates.
  // PR 48 — dirty-payload composition. `deliveryFee` is no longer
  // user-editable (removed from this screen; see section J), so the
  // payload now only carries `minOrder` and `serviceRadiusKm`. The
  // server's `validateShopSettings` accepts partial updates so
  // submitting only one of the two is fine.
  const { dirty, payload } = useMemo(() => {
    if (!shop)
      return {
        dirty: false,
        payload: {} as { minOrder?: number; serviceRadiusKm?: number },
      };
    const next: { minOrder?: number; serviceRadiusKm?: number } = {};
    const moNum = Number(minOrderStr);
    const srNum = Number(serviceRadiusStr);
    if (
      Number.isFinite(moNum) &&
      Number.isInteger(moNum) &&
      moNum !== shop.minOrder
    ) {
      next.minOrder = moNum;
    }
    // Compare against the persisted value if present, else against
    // the default (which is what the field pre-filled to). This way
    // a legacy shop owner who taps Save without changing anything
    // explicitly writes the default to Firestore — same posture as
    // the existing minOrder behavior.
    const currentRadius =
      typeof shop.serviceRadiusKm === 'number' && shop.serviceRadiusKm > 0
        ? shop.serviceRadiusKm
        : DEFAULT_SERVICE_RADIUS_KM;
    if (
      Number.isFinite(srNum) &&
      Number.isInteger(srNum) &&
      srNum !== currentRadius
    ) {
      next.serviceRadiusKm = srNum;
    }
    return { dirty: Object.keys(next).length > 0, payload: next };
  }, [shop, minOrderStr, serviceRadiusStr]);

  // Light client-side validation — kept loose to avoid double-pinning
  // the server's policy. We only refuse obviously-broken inputs
  // (empty, NaN, negative). The hard range caps live on the server.
  function validateClient(): boolean {
    const next: { minOrder?: string; serviceRadiusKm?: string } = {};
    const moNum = Number(minOrderStr);
    if (minOrderStr.trim() === '' || !Number.isFinite(moNum)) {
      next.minOrder = 'Enter a number';
    } else if (!Number.isInteger(moNum)) {
      next.minOrder = 'Whole rupees only';
    } else if (moNum < 0) {
      next.minOrder = 'Cannot be negative';
    }
    // PR 48 — service-radius client-side mirror of the server's
    // `shopSettingsHelpers` range (1–50 km, integer). Friendly
    // inline error before the round-trip; server re-validates.
    const srNum = Number(serviceRadiusStr);
    if (serviceRadiusStr.trim() === '' || !Number.isFinite(srNum)) {
      next.serviceRadiusKm = 'Enter a number';
    } else if (!Number.isInteger(srNum)) {
      next.serviceRadiusKm = 'Whole kilometers only';
    } else if (srNum < 1 || srNum > 50) {
      next.serviceRadiusKm = 'Must be between 1 and 50 km';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  // PR 47 — tier editor mutators. All operate on the `tierDrafts`
  // array; numeric parsing happens at save time so the user can
  // type intermediate values like '1.' without the field rejecting.
  function updateDraftKm(idx: number, value: string) {
    setTierDrafts(prev =>
      prev.map((d, i) => (i === idx ? { ...d, kmStr: value } : d)),
    );
    setTiersError(null);
  }
  function updateDraftCharge(idx: number, value: string) {
    setTierDrafts(prev =>
      prev.map((d, i) => (i === idx ? { ...d, chargeStr: value } : d)),
    );
    setTiersError(null);
  }
  function addTierBand() {
    // Insert a new numbered band BEFORE the catch-all (which is
    // always the last entry). Default values are blank so the
    // owner consciously fills both fields.
    setTierDrafts(prev => {
      const lastNumberedIdx = prev.findIndex(d => d.isCatchAll) - 1;
      const next = [...prev];
      next.splice(lastNumberedIdx + 1, 0, {
        kmStr: '',
        chargeStr: '',
        isCatchAll: false,
      });
      return next;
    });
    setTiersError(null);
  }
  function removeTierBand(idx: number) {
    setTierDrafts(prev => {
      // Don't allow removing the catch-all — it's the price floor
      // for far-away customers and the validator requires it.
      if (prev[idx]?.isCatchAll) return prev;
      return prev.filter((_, i) => i !== idx);
    });
    setTiersError(null);
  }

  // Compose the parsed tier table from the drafts. Returns null on
  // a parse error (empty / non-numeric); returns the parsed array
  // otherwise. Used by both the dirty-flag computation and save.
  function parseDrafts(): DeliveryChargeTier[] | null {
    const out: DeliveryChargeTier[] = [];
    for (const d of tierDrafts) {
      const charge = Number(d.chargeStr);
      if (!Number.isFinite(charge)) return null;
      if (d.isCatchAll) {
        out.push({ maxKm: null, charge });
      } else {
        const km = Number(d.kmStr);
        if (!Number.isFinite(km)) return null;
        out.push({ maxKm: km, charge });
      }
    }
    return out;
  }

  // Tier editor dirty flag — only enable the Save button when the
  // current drafts differ from `loadedTiers`. Compared via JSON
  // string equality on the parsed shape (cheap; tier tables are
  // tiny — typically 4 entries).
  const tiersDirty = useMemo(() => {
    const parsed = parseDrafts();
    if (!parsed) return true; // unparseable drafts are "dirty" so
    // the user can hit Save to see the inline error.
    return JSON.stringify(parsed) !== JSON.stringify(loadedTiers ?? []);
  }, [tierDrafts, loadedTiers]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSaveTiers() {
    setTiersError(null);
    const parsed = parseDrafts();
    if (!parsed) {
      setTiersError(
        'Each band needs a numeric distance and charge (the catch-all only needs a charge)',
      );
      return;
    }
    const validation = validateDeliveryChargeTiers(parsed);
    if (!validation.ok) {
      setTiersError(validation.message);
      return;
    }
    setTiersSaving(true);
    try {
      const result = await orderService.updateShopDeliveryTiers({
        tiers: validation.tiers,
      });
      // Server normalizes the tier shape (validator returns
      // `cleaned`); re-hydrate from server response so the editor
      // reflects exactly what was persisted.
      setLoadedTiers(result.tiers);
      setTierDrafts(
        result.tiers.map(t => ({
          kmStr: t.maxKm === null ? '' : String(t.maxKm),
          chargeStr: String(t.charge),
          isCatchAll: t.maxKm === null,
        })),
      );
      Alert.alert('Saved', 'Delivery charges updated.');
    } catch (e: any) {
      const msg = e?.message ?? 'Could not save delivery charges.';
      setTiersError(msg);
      Alert.alert('Could not save', msg);
    } finally {
      setTiersSaving(false);
    }
  }

  // Helper for the catch-all label — "More than X km" reads better
  // than "Beyond the last band" once the owner sees their own
  // numbers in place.
  const catchAllLabel = useMemo(() => {
    const last = [...tierDrafts]
      .filter(d => !d.isCatchAll)
      .map(d => Number(d.kmStr))
      .filter(n => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b)
      .pop();
    if (last === undefined) return 'Beyond the last band';
    return `More than ${last} km`;
  }, [tierDrafts]);

  async function handleSave() {
    if (!validateClient()) return;
    if (!dirty) {
      Alert.alert('No changes', 'Nothing to update.');
      return;
    }
    setSaving(true);
    try {
      // Admin path passes shopId (required by helper). Shop owner
      // path omits it (helper ignores; uses claim's shopId).
      await orderService.updateShopSettings({
        ...payload,
        ...(isAdminPath ? { shopId: targetShopId } : {}),
      });
      // Refetch to confirm the write took (and to display the
      // canonical server value if any normalization happened). Use
      // the same path as the initial load.
      const fresh = await refetchShop();
      if (fresh) {
        setShop(fresh);
        setMinOrderStr(String(fresh.minOrder ?? 0));
        // PR 48 — re-hydrate the radius field from the canonical
        // server value (handles the legacy-shop default-write case
        // gracefully).
        setServiceRadiusStr(
          String(
            typeof fresh.serviceRadiusKm === 'number' &&
              fresh.serviceRadiusKm > 0
              ? fresh.serviceRadiusKm
              : DEFAULT_SERVICE_RADIUS_KM,
          ),
        );
      }
      Alert.alert('Saved', 'Shop settings updated.', [
        { text: 'OK', onPress: () => nav.goBack() },
      ]);
    } catch (e: any) {
      // The server's helper returns helpful messages — surface them
      // directly. e.message is already the helper's string (Firebase
      // wraps it as the HttpsError message).
      const msg =
        e?.message ?? 'Could not save settings. Please try again.';
      Alert.alert('Could not save', msg);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Shop Settings" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  if (loadError || !shop) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Shop Settings" onBack={() => nav.goBack()} />
        <EmptyState
          title="Could not load shop"
          subtitle={
            loadError ??
            (isAdminPath
              ? "Shop not found. It may have been deleted or is outside the 100-shop listAllShops cap."
              : "You don't seem to own a shop. Contact support if this is wrong.")
          }
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Shop Settings" onBack={() => nav.goBack()} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kavRoot}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <Text style={styles.shopName}>{shop.name}</Text>
            <Text style={styles.shopMeta}>{shop.address}</Text>
          </View>

          {/* PR-NEXT-SHOP-LOCATION-EDIT — Shop location card.
              Two states:
                1. STABLE — no `pendingLocation`. Show current pin +
                   resolved address + verified-on date, then the
                   dual-mode capture CTAs. Submitting flips to (2).
                2. PENDING — `pendingLocationStatus === 'pending'`.
                   Show current pin (still live to customers) AND
                   the proposed pin awaiting admin review, plus a
                   Cancel button. Capture CTAs hidden — only one
                   pending change at a time per the spec.
              The dual-mode CTAs come from `useCaptureShopLocation`,
              same hook RegisterShop uses (single source of truth
              for fallback-leak posture). */}
          <View style={styles.card}>
            <Text style={styles.locationTitle}>Shop location</Text>

            {shop.location ? (
              <View style={styles.locationCurrentBlock}>
                <Text style={styles.locationSubLabel}>
                  {shop.pendingLocationStatus === 'pending'
                    ? 'Current pin (visible to customers)'
                    : 'Current pin'}
                </Text>
                <Text style={styles.locationPinLine}>
                  📍 {shop.location.lat.toFixed(4)},{' '}
                  {shop.location.lng.toFixed(4)}
                </Text>
                {currentResolved && currentResolved.length > 0 && (
                  <Text style={styles.locationResolvedLine}>
                    Resolves to: {currentResolved}
                  </Text>
                )}
                {typeof shop.locationVerifiedAt === 'number' && (
                  <Text style={styles.locationVerifiedLine}>
                    ✓ Verified by admin on{' '}
                    {new Date(shop.locationVerifiedAt).toLocaleDateString()}
                  </Text>
                )}
              </View>
            ) : (
              <Text style={styles.locationEmptyLine}>
                No GPS pin on file. Capture one below.
              </Text>
            )}

            {shop.pendingLocationStatus === 'pending' && shop.pendingLocation ? (
              <>
                <View style={styles.locationDivider} />
                <View style={styles.locationPendingBlock}>
                  <Text style={styles.locationPendingTitle}>
                    ⏳ Pending admin approval
                  </Text>
                  <Text style={styles.locationSubLabel}>Proposed pin</Text>
                  <Text style={styles.locationPinLine}>
                    📍 {shop.pendingLocation.lat.toFixed(4)},{' '}
                    {shop.pendingLocation.lng.toFixed(4)}
                  </Text>
                  {pendingResolved && pendingResolved.length > 0 && (
                    <Text style={styles.locationResolvedLine}>
                      Resolves to: {pendingResolved}
                    </Text>
                  )}
                  {shop.pendingLocationSource && (
                    <Text style={styles.locationResolvedLine}>
                      Source:{' '}
                      {shop.pendingLocationSource === 'gps'
                        ? 'device GPS'
                        : 'typed address'}
                    </Text>
                  )}
                  {typeof shop.pendingLocationSubmittedAt === 'number' && (
                    <Text style={styles.locationVerifiedLine}>
                      Submitted{' '}
                      {new Date(
                        shop.pendingLocationSubmittedAt,
                      ).toLocaleString()}
                    </Text>
                  )}
                  <View style={{ height: spacing.sm }} />
                  <Button
                    title={
                      cancellingLocation
                        ? 'Cancelling…'
                        : 'Cancel pending change'
                    }
                    variant="ghost"
                    onPress={handleCancelPendingLocation}
                    loading={cancellingLocation}
                    disabled={cancellingLocation || submittingLocation}
                  />
                </View>
              </>
            ) : (
              <>
                <View style={styles.locationDivider} />
                <Text style={styles.locationSubLabel}>Update location</Text>
                {!capturedShopLocation && (
                  <View style={styles.captureCtaRow}>
                    <Pressable
                      onPress={captureShopGps}
                      disabled={capturingShopLocation || submittingLocation}
                      style={({ pressed }) => [
                        styles.captureCta,
                        pressed && styles.captureCtaPressed,
                        (capturingShopLocation || submittingLocation) &&
                          styles.captureCtaDisabled,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Use my GPS to capture shop location"
                    >
                      <Text style={styles.captureCtaText}>📍 Use my GPS</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => captureShopFromAddress(shop.address)}
                      disabled={capturingShopLocation || submittingLocation}
                      style={({ pressed }) => [
                        styles.captureCta,
                        pressed && styles.captureCtaPressed,
                        (capturingShopLocation || submittingLocation) &&
                          styles.captureCtaDisabled,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Find shop location from typed address"
                    >
                      <Text style={styles.captureCtaText}>
                        🔍 Find from address
                      </Text>
                    </Pressable>
                  </View>
                )}
                {capturingShopLocation && (
                  <View style={styles.capturingRow}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.capturingText}>
                      Capturing location…
                    </Text>
                  </View>
                )}
                {captureShopError && (
                  <Text style={styles.captureHintError}>
                    ⚠️ {captureShopError}
                  </Text>
                )}
                {capturedShopLocation && (
                  <View style={styles.captureSuccessCard}>
                    <Text style={styles.captureSuccessTitle}>
                      ✅ Pin set (
                      {capturedShopLocation.source === 'gps'
                        ? 'device GPS'
                        : 'typed address'}
                      )
                    </Text>
                    <Text style={styles.captureSuccessLine}>
                      Resolves to: {capturedShopLocation.resolvedAddress}
                    </Text>
                    <Text style={styles.captureSuccessLine}>
                      📍 {capturedShopLocation.lat.toFixed(4)},{' '}
                      {capturedShopLocation.lng.toFixed(4)}
                    </Text>
                    <View style={styles.captureSuccessActions}>
                      <Pressable
                        onPress={resetShopCapture}
                        disabled={submittingLocation}
                        style={({ pressed }) => [
                          styles.captureRecaptureBtn,
                          pressed && styles.captureCtaPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Re-capture shop location"
                        hitSlop={6}
                      >
                        <Text style={styles.captureRecaptureText}>
                          ↻ Re-capture
                        </Text>
                      </Pressable>
                    </View>
                    <View style={{ height: spacing.sm }} />
                    <Button
                      title={
                        submittingLocation
                          ? 'Submitting…'
                          : 'Submit for admin review'
                      }
                      onPress={handleSubmitPendingLocation}
                      loading={submittingLocation}
                      disabled={submittingLocation}
                    />
                  </View>
                )}
                <Text style={styles.locationHelpFootnote}>
                  ⓘ Location changes need admin approval before going live.
                  Customers keep seeing your current pin until then.
                </Text>
              </>
            )}
          </View>

          <View style={styles.card}>
            {/* PR 48 — the flat "Delivery fee" input was removed.
                Since PR 47, the per-distance tier table in the
                lower card is what customers actually pay; an editable
                flat field on top of it was confusing (owners changed
                it expecting checkout pricing to follow, but it never
                did). The DATA field `shop.deliveryFee` is intentionally
                kept as the legacy fallback for `chargeForDistance` and
                the placeOrder back-compat shim — we just hide the
                control. See section J of the PR 48 prompt. */}
            <View style={styles.field}>
              <Text style={styles.label}>Minimum order (₹)</Text>
              <TextInput
                value={minOrderStr}
                onChangeText={setMinOrderStr}
                placeholder="0"
                keyboardType="number-pad"
                style={[
                  styles.input,
                  errors.minOrder ? styles.inputError : null,
                ]}
                placeholderTextColor={colors.textSecondary}
                accessibilityLabel="Minimum order amount in rupees"
              />
              <Text
                style={errors.minOrder ? styles.errorText : styles.helpText}
              >
                {errors.minOrder ??
                  'Customers must order at least this amount.'}
              </Text>
            </View>

            {/* PR 48 — Service area (km). Owner-controlled gate that
                feeds `listShopsPublic`'s filter. Coarse / integer-only
                because sub-km service areas aren't meaningful for
                kirana delivery. */}
            <View style={styles.field}>
              <Text style={styles.label}>Service area (km)</Text>
              <TextInput
                value={serviceRadiusStr}
                onChangeText={setServiceRadiusStr}
                placeholder={String(DEFAULT_SERVICE_RADIUS_KM)}
                keyboardType="number-pad"
                style={[
                  styles.input,
                  errors.serviceRadiusKm ? styles.inputError : null,
                ]}
                placeholderTextColor={colors.textSecondary}
                accessibilityLabel="Service area in kilometers"
              />
              <Text
                style={
                  errors.serviceRadiusKm ? styles.errorText : styles.helpText
                }
              >
                {errors.serviceRadiusKm ??
                  "Customers farther than this won't see your shop."}
              </Text>
            </View>
          </View>

          <Button
            title={saving ? 'Saving…' : 'Save changes'}
            onPress={handleSave}
            loading={saving}
            disabled={saving || !dirty}
            size="lg"
          />

          {/* PR 47 — distance-based delivery charge tier editor.
              Separate card + separate Save button from the flat-fee
              card above so the two surfaces can be saved
              independently (different callables, different
              validation semantics). The flat `deliveryFee` field
              above stays as a back-compat fallback for legacy reads
              and for any band a tier table somehow doesn't cover. */}
          <View style={{ height: spacing.lg }} />
          <View style={styles.card}>
            <Text style={styles.tiersTitle}>Delivery charges (by distance)</Text>
            <Text style={styles.tiersHelpTop}>
              Customers are charged based on how far they are from your
              shop. Set your own distance bands and prices.
            </Text>

            {tierDrafts.map((draft, idx) => (
              <View key={`tier-${idx}`} style={styles.tierRow}>
                <View style={styles.tierKmCol}>
                  <Text style={styles.tierColLabel}>Up to (km)</Text>
                  {draft.isCatchAll ? (
                    <View
                      style={[styles.input, styles.tierKmReadonly]}
                      accessible
                      accessibilityLabel={catchAllLabel}
                    >
                      <Text
                        style={styles.tierKmReadonlyText}
                        numberOfLines={1}
                      >
                        {catchAllLabel}
                      </Text>
                    </View>
                  ) : (
                    <TextInput
                      value={draft.kmStr}
                      onChangeText={v => updateDraftKm(idx, v)}
                      placeholder="km"
                      keyboardType="decimal-pad"
                      style={styles.input}
                      placeholderTextColor={colors.textSecondary}
                      accessibilityLabel={`Tier ${idx + 1} maximum distance in km`}
                    />
                  )}
                </View>
                <View style={styles.tierChargeCol}>
                  <Text style={styles.tierColLabel}>Charge (₹)</Text>
                  <TextInput
                    value={draft.chargeStr}
                    onChangeText={v => updateDraftCharge(idx, v)}
                    placeholder="0"
                    keyboardType="number-pad"
                    style={styles.input}
                    placeholderTextColor={colors.textSecondary}
                    accessibilityLabel={`Tier ${idx + 1} charge in rupees`}
                  />
                </View>
                <Pressable
                  onPress={() => removeTierBand(idx)}
                  disabled={draft.isCatchAll}
                  accessibilityRole="button"
                  accessibilityLabel={
                    draft.isCatchAll
                      ? 'Catch-all band cannot be removed'
                      : `Remove tier ${idx + 1}`
                  }
                  style={[
                    styles.tierRemoveBtn,
                    draft.isCatchAll && styles.tierRemoveBtnDisabled,
                  ]}
                >
                  <Text
                    style={[
                      styles.tierRemoveText,
                      draft.isCatchAll && styles.tierRemoveTextDisabled,
                    ]}
                  >
                    ✕
                  </Text>
                </Pressable>
              </View>
            ))}

            <Pressable
              onPress={addTierBand}
              accessibilityRole="button"
              accessibilityLabel="Add a delivery charge band"
              style={styles.tierAddBtn}
            >
              <Text style={styles.tierAddText}>+ Add band</Text>
            </Pressable>

            {tiersError && (
              <Text style={styles.tiersError}>{tiersError}</Text>
            )}

            <View style={{ height: spacing.md }} />
            <Button
              title={tiersSaving ? 'Saving…' : 'Save delivery charges'}
              onPress={handleSaveTiers}
              loading={tiersSaving}
              disabled={tiersSaving || !tiersDirty}
              size="lg"
            />
          </View>
          {/* PR-NEXT-LOW-RATING-PUSH §D — low-rating notification settings card. */}
          <View style={{ height: spacing.lg }} />
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Notifications</Text>
            <Text style={styles.helpText}>
              Get notified when a customer rates your shop at or below this
              many ★
            </Text>
            <View style={[styles.field, { marginTop: spacing.sm }]}>
              <Text style={styles.label}>Alert threshold (stars)</Text>
              <View style={styles.ratingRow}>
                {[1, 2, 3, 4, 5].map(s => (
                  <Pressable
                    key={s}
                    onPress={() => setAlertThreshold(s)}
                    style={[
                      styles.starBtn,
                      alertThreshold === s && styles.starBtnActive,
                    ]}
                    accessibilityLabel={`Alert threshold ${s} stars`}
                  >
                    <Text
                      style={[
                        styles.starBtnText,
                        alertThreshold === s && styles.starBtnTextActive,
                      ]}
                    >
                      {s}★
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.helpText}>
                You’ll be notified for ratings of {alertThreshold}★ or lower.
              </Text>
            </View>
            <View style={styles.field}>
              <Pressable
                onPress={() => setAlertEnabled(v => !v)}
                style={styles.checkRow}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: alertEnabled }}
                accessibilityLabel="Enable low-rating notifications"
              >
                <View
                  style={[
                    styles.checkbox,
                    alertEnabled && styles.checkboxChecked,
                  ]}
                >
                  {alertEnabled && (
                    <Text style={styles.checkMark}>✓</Text>
                  )}
                </View>
                <Text style={styles.label}>Enabled</Text>
              </Pressable>
            </View>
            <Button
              title={savingAlert ? 'Saving…' : 'Save notification settings'}
              onPress={async () => {
                setSavingAlert(true);
                try {
                  await orderService.updateShopRatingAlertSettings({
                    threshold: alertThreshold,
                    enabled: alertEnabled,
                  });
                  Alert.alert('Saved', 'Notification settings updated.');
                } catch (e: any) {
                  Alert.alert('Could not save', e?.message ?? 'Please try again.');
                } finally {
                  setSavingAlert(false);
                }
              }}
              loading={savingAlert}
              disabled={savingAlert}
              size="lg"
            />
          </View>

          <View style={{ height: spacing.md }} />
          <Button
            title="Cancel"
            variant="ghost"
            onPress={() => nav.goBack()}
            disabled={saving}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  kavRoot: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl ?? spacing.xl },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  shopName: { ...typography.h3, color: colors.textPrimary },
  shopMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 4,
  },

  field: { marginBottom: spacing.md },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.bg,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: colors.textPrimary,
  },
  inputError: { borderColor: colors.danger },
  helpText: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  errorText: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
  },
  // PR 47 — tier editor styles. Each row is a horizontal flex with
  // a km column, a charge column, and a remove button. The
  // catch-all row swaps its km TextInput for a read-only View
  // showing "More than X km".
  tiersTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  tiersHelpTop: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  tierKmCol: { flex: 1 },
  tierChargeCol: { flex: 1 },
  tierColLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  tierKmReadonly: {
    justifyContent: 'center',
    backgroundColor: colors.bg,
    opacity: 0.85,
  },
  tierKmReadonlyText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  tierRemoveBtn: {
    width: 36,
    height: 40,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierRemoveBtnDisabled: {
    opacity: 0.3,
  },
  tierRemoveText: {
    ...typography.body,
    color: colors.danger,
  },
  tierRemoveTextDisabled: {
    color: colors.textMuted,
  },
  tierAddBtn: {
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  tierAddText: {
    ...typography.bodyBold,
    color: colors.primary,
  },
  tiersError: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.sm,
  },
  // PR-NEXT-SHOP-LOCATION-EDIT — location card styles. Mirrors the
  // visual idiom used by RegisterShop's capture success card so the
  // owner sees the same affordances before AND after registration.
  locationTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  locationCurrentBlock: {
    marginBottom: spacing.xs,
  },
  locationPendingBlock: {
    marginTop: spacing.xs,
  },
  locationPendingTitle: {
    ...typography.bodyBold,
    color: colors.warning,
    marginBottom: spacing.xs,
  },
  locationSubLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  locationPinLine: {
    ...typography.body,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  locationResolvedLine: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  locationVerifiedLine: {
    ...typography.caption,
    color: colors.success,
    marginTop: 2,
  },
  locationEmptyLine: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  locationDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  locationHelpFootnote: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  // Capture-flow styles — mirror RegisterShopScreen so the success
  // card and CTA row look identical across the two surfaces.
  captureCtaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  captureCta: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureCtaPressed: {
    opacity: 0.7,
  },
  captureCtaDisabled: {
    opacity: 0.4,
  },
  captureCtaText: {
    ...typography.bodyBold,
    color: colors.primary,
  },
  capturingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  capturingText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  captureHintError: {
    ...typography.caption,
    color: colors.danger,
    marginBottom: spacing.sm,
  },
  captureSuccessCard: {
    backgroundColor: '#ECFDF5',
    borderColor: colors.success,
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  captureSuccessTitle: {
    ...typography.bodyBold,
    color: colors.success,
    marginBottom: spacing.xs,
  },
  captureSuccessLine: {
    ...typography.caption,
    color: colors.textPrimary,
    marginTop: 2,
  },
  captureSuccessActions: {
    marginTop: spacing.sm,
  },
  captureRecaptureBtn: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  captureRecaptureText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
  },
  // PR-NEXT-LOW-RATING-PUSH §D
  sectionTitle: {
    ...typography.h3,
    marginBottom: spacing.xs,
  },
  ratingRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
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
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: spacing.xs,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  checkMark: {
    color: colors.bg,
    fontWeight: '700',
    fontSize: 14,
  },
});
