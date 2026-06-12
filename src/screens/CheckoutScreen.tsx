import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../components/common/Button';
import EmptyState from '../components/common/EmptyState';
import Input from '../components/common/Input';
import ScreenHeader from '../components/common/ScreenHeader';
import { colors, radii, spacing, typography } from '../constants/theme';
import { Analytics } from '../services/analytics';
import { orderService } from '../services/orderService';
import { profileService } from '../services/profileService';
import { Sentry } from '../services/sentry';
import { useAuthStore } from '../store/useAuthStore';
import { useCartStore } from '../store/useCartStore';
import { locationService } from '../services/locationService';
import type {
  Address,
  DeliveryLocation,
  PaymentMethod,
  SavedAddress,
  SubstitutionPreference,
  UserProfile,
} from '../types';
// PR 47 — preview tiered delivery charge from the shop's snapshot
// tier table + the live distance estimate. Pure helper; the server
// re-computes authoritatively at placeOrder time.
import { chargeForDistance } from '../utils/deliveryChargeHelpers';
// PR 5 — DO NOT REMOVE. Auto-formatter stripped this import once during
// PR 5. Used in the Razorpay `prefill.email` field below.
import { deriveCheckoutEmail } from '../utils/checkoutEmail';
import { formatRupees } from '../utils/format';
import { openRazorpayCheckout } from '../utils/razorpay';
import { usePressGuard } from '../hooks/usePressGuard';
// PR-NEXT-ADDRESS-UX.1 (Case 10 retest) — DO NOT REMOVE. Post-order
// modal that asks the customer to NAME the current-location pin so
// it becomes a reusable saved address (Sudhir wanted "Office",
// "Uncle's house", "Sector 10 Home" etc. instead of one-off pins).
import SaveCurrentLocationModal from '../components/address/SaveCurrentLocationModal';
// PR-NEXT-HOTFIX-10 — DO NOT REMOVE. Pure helper that intercepts
// the current-location save flow when an existing saved address
// already pins within 25m of the GPS reading. Skips the modal
// entirely + lets the caller fire a toast confirming which address
// matched. Closes Sudhir's June 2 dedupe gap ("saved exact 2
// addresses in the profile" from same-spot orders).
import { findAddressNearby } from '../utils/findAddressNearby';
// PR-NEXT-HOTFIX-10 — DO NOT REMOVE. Bare-minimum toast primitive
// used by the address-dedupe silent-skip path. Renders
// absolute-positioned above the safe-area inset (Rule 13).
import Toast from '../components/common/Toast';
// PR-NEXT-ADDRESS-UX.1 — DO NOT REMOVE. Best-effort reverse-geocode
// of the GPS pin to (label, line1, city, pincode) suggestions for
// the modal's pre-filled defaults. Failure is non-fatal — helper
// returns sensible empty defaults.
import {
  reverseGeocodeLabel,
  type GeocodeSuggestion,
} from '../utils/reverseGeocodeLabel';

type Errors = Partial<Record<'name' | 'line1' | 'city' | 'pincode' | 'phone', string>>;

const showAlert = (title: string, message: string) => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // eslint-disable-next-line no-alert
    window.alert(`${title}\n\n${message}`);
  } else {
    // Lazy import keeps react-native-web's flaky Alert export off the web bundle path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Alert } = require('react-native');
    Alert.alert(title, message);
  }
};

export default function CheckoutScreen() {
  const nav = useNavigation<any>();
  const items = useCartStore(s => s.items);
  const shopId = useCartStore(s => s.shopId);
  const shopName = useCartStore(s => s.shopName);
  const deliveryFee = useCartStore(s => s.deliveryFee);
  // PR 47 — read the snapshot tier table that addItem/addMenuItem
  // stamped onto the cart. Null on legacy shops + on carts persisted
  // from a pre-PR-47 build → falls back to the flat `deliveryFee`
  // via `chargeForDistance`'s legacy branch.
  const deliveryChargeTiers = useCartStore(s => s.deliveryChargeTiers);
  const subtotal = useCartStore(s => s.subtotal());
  const clearCart = useCartStore(s => s.clearCart);

  // PR 47 — preview tiered delivery charge. Computed locally from
  // the cart's tier snapshot + the live distance estimate (set
  // further down by the getDeliveryEstimate effect). When the
  // estimate hasn't resolved yet we pass `0` km, which lands in
  // the cheapest tier — slight visual flicker is preferable to
  // hiding the line entirely. The server re-derives at placeOrder
  // time so a stale or under-estimated preview can never under-charge
  // the customer.
  // (Value computed below, after `deliveryEstimate` state is declared.)

  const [name, setName] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('New Delhi');
  const [pincode, setPincode] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [placing, setPlacing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cod');
  // PR 21 — substitution preference. Hoisted with the other useState
  // calls above any early-return per Rules-of-Hooks discipline (PR 12
  // → 17 → 19 → 20 → 21 lineage). Default 'call_me' is the safest
  // choice for first-time users; the picker below lets them switch
  // to 'auto' (shop replaces with similar) or 'refund' (shop drops
  // the item + adjusts the total) to skip the call entirely.
  const [substitutionPreference, setSubstitutionPreference] =
    useState<SubstitutionPreference>('call_me');
  // PR 22 — per-order delivery instructions. Pre-filled from the
  // selected saved address (or empty when starting from a form-mode
  // entry), and editable per-order without touching the saved
  // address book row. The override is captured on the order's
  // deliveryAddress snapshot. Hoisted with the other field state.
  const [orderInstructions, setOrderInstructions] = useState('');

  // Phase 12a-v2-iv: saved-address picker. The screen has two modes
  // distinguished by `usingForm`:
  //   - Picker mode: profile has ≥1 saved address AND user hasn't
  //     opted to enter a new one. Render selectable cards; selecting
  //     one mirrors its fields into the local state so placeOrder
  //     reads from the same form fields it always has (no special
  //     branch in the order placement path).
  //   - Form mode: profile has 0 addresses, OR user tapped "Use a
  //     different address". Same form as before.
  // `selectedAddressId !== null` means "this address came from the
  // saved book" — used after order placement to skip the save prompt.
  // Reset to default on every focus per Sudhir's UX call (cart
  // survives nav, address selection does not).
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(
    null,
  );
  const [usingForm, setUsingForm] = useState(false);
  // Phase 12a-v2-iv-followup: when getMyProfile fails the user used
  // to silently drop into form mode with no explanation. That made
  // diagnostic work impossible — we couldn't tell whether the user
  // genuinely had no saved addresses, or the call was failing. The
  // banner below renders a yellow notice with the actual error
  // message + a Retry button when this is non-null. Root cause of
  // the failure is tracked separately; this is the observability
  // surface, not a fix.
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const isAnonymous = useAuthStore(s => s.isAnonymous);

  // PR 46 — locked delivery location target. Three logical states
  // tracked together as a small discriminated union:
  //   - { mode: 'saved' }: customer picked a saved address. The
  //     coords come from the address row IF it has lat/lng, else
  //     we fall back to live GPS at order time and surface a note.
  //   - { mode: 'current' }: customer tapped "Deliver to my current
  //     location". coords come straight from useLocationStore /
  //     locationService. addressId is omitted on the locked
  //     DeliveryLocation server-side.
  //   - null: nothing chosen yet (e.g. picker hasn't loaded).
  const [deliveryTargetMode, setDeliveryTargetMode] = useState<
    'saved' | 'current' | null
  >(null);
  // Live-captured coords for the 'current' branch AND the
  // saved-address-without-coords fallback. Captured lazily on
  // first need so we don't hit GPS just because the user opened
  // the screen.
  const [liveCoords, setLiveCoords] = useState<{
    lat: number;
    lng: number;
    source: 'gps' | 'fallback';
  } | null>(null);
  const [liveCoordsError, setLiveCoordsError] = useState<string | null>(null);
  const [capturingLive, setCapturingLive] = useState(false);
  // PR-NEXT-ADDRESS-UX.1 (Case 10 retest) — state for the post-
  // order "Save this location?" modal. Mounted unconditionally
  // (Rule 2: above any conditional return); `visible` gate keeps
  // the tree zero-cost when closed. `pendingSaveCoords` carries
  // the lat/lng + (name, phone) snapshot from the just-placed
  // order so the save round-trip doesn't depend on still-mounted
  // form state. `geocodeSuggestion` is the reverse-geocode result;
  // null until we have one (modal not opened yet).
  const [saveLocationModalVisible, setSaveLocationModalVisible] =
    useState(false);
  const [geocodeSuggestion, setGeocodeSuggestion] =
    useState<GeocodeSuggestion | null>(null);
  const [pendingSaveCoords, setPendingSaveCoords] = useState<
    { lat: number; lng: number; phone: string; name: string } | null
  >(null);
  // PR-NEXT-HOTFIX-10 — DO NOT REMOVE. Toast state for the address-
  // dedupe silent-skip path. Above any conditional return (Rule 2)
  // so React's hook ordering stays stable across renders. Mounted
  // unconditionally at the SafeAreaView root with `visible` gating.
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  // PR-NEXT-ADDRESS-UX.1 — resolver for the promise that
  // `maybeSaveAddressAfterOrder` awaits while the modal is up.
  // Without this the function would resolve immediately (opening the
  // modal is just a `setState`) and the post-await `nav.replace
  // ('OrderConfirmation', …)` would unmount CheckoutScreen — taking
  // the modal with it — before the customer could Save or Skip.
  // Cleared whenever the modal dismisses (either path).
  const saveLocationPromiseRef = useRef<(() => void) | null>(null);
  // Estimate preview returned by getDeliveryEstimate — cleared
  // whenever the target changes, recomputed when target + coords
  // resolve. `null` means "haven't computed yet"; an explicit
  // `{ failed: true }` shape would be over-engineering since we
  // gracefully render "Estimating…" while loading and just hide
  // the line if the call rejects (server already falls back to
  // haversine, so a hard failure means the shop has no `location`
  // — rare and expected to be handled at the listing-filter level
  // in PR 48).
  const [deliveryEstimate, setDeliveryEstimate] = useState<{
    distanceKm: number;
    durationMin: number;
  } | null>(null);
  const [estimating, setEstimating] = useState(false);

  // PR 47 — derived preview charge. Pure function over (tiers,
  // distance, fallback); recomputed every render which is cheap.
  // The shown bill total uses this value, NOT the legacy flat
  // `deliveryFee` — so a customer 0.5km away really sees the
  // ≤1km tier price, and a customer 7km away sees the catch-all.
  // When `deliveryEstimate` is null (form-mode-no-target, or the
  // estimate call failed) we fall back to 0km which lands in the
  // cheapest band; the server's authoritative re-derivation at
  // placeOrder time fixes any under-estimate. Acceptable because
  // (a) this is preview, (b) the placeOrder doc is the source of
  // truth, (c) hiding the line entirely is worse UX.
  const previewDeliveryCharge = chargeForDistance(
    deliveryChargeTiers,
    deliveryEstimate?.distanceKm ?? 0,
    deliveryFee,
  );
  const total = subtotal + previewDeliveryCharge;

  // Hydrate from saved profile every time the screen focuses. Anonymous
  // users have no profile to hydrate from — they'll get the form. The
  // call is auth-required so we skip it cleanly.
  useFocusEffect(
    useCallback(() => {
      if (isAnonymous) {
        setProfileLoaded(true);
        return;
      }
      let cancelled = false;
      profileService
        .getMyProfile()
        .then(p => {
          if (cancelled) return;
          setProfile(p);
          // Reset selection on entry — pick the default if any.
          const def = p.defaultAddressId
            ? p.addresses.find(a => a.id === p.defaultAddressId)
            : p.addresses[0];
          if (def) {
            applySavedToForm(def);
            setSelectedAddressId(def.id);
            setUsingForm(false);
            // PR 46 — default to 'saved' mode when we autoselected
            // a default address. Customer can still tap "current
            // location" to override.
            setDeliveryTargetMode('saved');
          } else {
            setSelectedAddressId(null);
            setUsingForm(true);
          }
        })
        .catch(e => {
          // Phase 12a-v2-iv-followup: keep the user moving (form mode
          // is a valid fallback) but make the failure VISIBLE — both
          // in the device console (with stack) AND on screen so the
          // user knows their saved addresses aren't being ignored on
          // purpose. The original silent fallthrough hid a real bug
          // that took a solo-test repro to catch.
          console.warn(
            '[Checkout] getMyProfile failed:',
            e?.code ?? 'no-code',
            e?.message ?? e,
            e?.stack ?? '(no stack)',
          );
          setProfileLoadError(
            e?.message
              ? `Couldn't load saved addresses (${e.message}). Enter manually below.`
              : "Couldn't load saved addresses. Enter manually below.",
          );
          setUsingForm(true);
        })
        .finally(() => {
          if (!cancelled) setProfileLoaded(true);
        });
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAnonymous]),
  );

  const applySavedToForm = (addr: SavedAddress) => {
    setName(addr.name);
    setLine1(addr.line1);
    setLine2(addr.line2 ?? '');
    setCity(addr.city);
    setPincode(addr.pincode);
    setPhone(addr.phone);
    // PR 22 — pre-fill the per-order instructions from the saved
    // address. Customer can still edit; the edit only lives on the
    // order doc.
    setOrderInstructions(addr.deliveryInstructions ?? '');
    setErrors({});
  };

  const onPickSaved = (addr: SavedAddress) => {
    applySavedToForm(addr);
    setSelectedAddressId(addr.id);
    setUsingForm(false);
    // PR 46 — picking a saved address makes 'saved' the active
    // delivery target (overrides any prior 'current location' tap).
    setDeliveryTargetMode('saved');
  };

  const onUseDifferent = () => {
    setSelectedAddressId(null);
    setUsingForm(true);
    // Don't clear fields — let the user edit on top of the
    // selected address. They can manually clear if they want.
  };

  // PR 46 — set the picker mode AND, when switching back to
  // saved-address mode after the user previously tapped "current
  // location", auto-restore the default saved address selection.
  // Centralized so the option-card press handlers stay short.
  const onPickCurrentLocation = useCallback(async () => {
    setDeliveryTargetMode('current');
    setSelectedAddressId(null);
    // Capture live coords IF we don't already have a fresh capture.
    // Re-tapping the option re-runs the GPS prompt so the customer
    // can refresh stale coords if they're in the middle of moving.
    setLiveCoordsError(null);
    setCapturingLive(true);
    try {
      const result = await locationService.getCurrentLocation();
      setLiveCoords({
        lat: result.location.lat,
        lng: result.location.lng,
        source: result.source,
      });
    } catch (err: any) {
      setLiveCoords(null);
      setLiveCoordsError(err?.message ?? 'Could not get current location');
    } finally {
      setCapturingLive(false);
    }
  }, []);

  // Build the locked DeliveryLocation that will ride along with
  // placeOrder. Returns null when no decision can be made (e.g.
  // 'current' mode with no live coords yet) — caller decides
  // whether that's a hard block (place-order) or a noop (estimate
  // preview).
  //
  // Decision matrix:
  //   - mode 'saved' + selected address has lat/lng → use them.
  //   - mode 'saved' + selected address has NO lat/lng → fall
  //     back to liveCoords if captured. We surface a yellow note
  //     in the UI so the customer knows the saved address has no
  //     pin and we're using live GPS for distance only — the
  //     order's deliveryLocation still records type='saved_address'
  //     + addressId so analytics can trace the source.
  //   - mode 'current' + liveCoords set → use them with type='current_location'.
  //   - any other combination → null (display blocks until resolved).
  const resolveDeliveryLocation = useCallback((): DeliveryLocation | null => {
    if (deliveryTargetMode === 'current') {
      if (!liveCoords) return null;
      return {
        lat: liveCoords.lat,
        lng: liveCoords.lng,
        type: 'current_location',
        label: 'Current location',
      };
    }
    if (deliveryTargetMode === 'saved') {
      const picked = profile?.addresses.find(a => a.id === selectedAddressId);
      if (!picked) return null;
      // saved with coords on row → primary path
      if (
        typeof picked.lat === 'number' &&
        typeof picked.lng === 'number' &&
        Number.isFinite(picked.lat) &&
        Number.isFinite(picked.lng)
      ) {
        return {
          lat: picked.lat,
          lng: picked.lng,
          type: 'saved_address',
          addressId: picked.id,
          label: picked.label?.trim() || picked.line1 || 'Saved address',
        };
      }
      // saved without coords — fall back to live GPS if we have it
      if (liveCoords) {
        return {
          lat: liveCoords.lat,
          lng: liveCoords.lng,
          type: 'saved_address',
          addressId: picked.id,
          label: picked.label?.trim() || picked.line1 || 'Saved address',
        };
      }
      return null;
    }
    return null;
  }, [deliveryTargetMode, liveCoords, profile?.addresses, selectedAddressId]);

  // PR 46 — derived flag: the picked saved address has no GPS pin
  // AND we haven't yet captured live fallback coords. UI uses this
  // to (a) auto-trigger a one-time live capture and (b) show a
  // "we'll use your current location" note next to the picker.
  const savedAddressMissingCoords = (() => {
    if (deliveryTargetMode !== 'saved') return false;
    const picked = profile?.addresses.find(a => a.id === selectedAddressId);
    if (!picked) return false;
    const hasCoords =
      typeof picked.lat === 'number' &&
      typeof picked.lng === 'number' &&
      Number.isFinite(picked.lat) &&
      Number.isFinite(picked.lng);
    return !hasCoords;
  })();

  // PR-NEXT-HOTFIX-9 — DO NOT REMOVE. Gate Place Order during the
  // GPS-capture race window. HOTFIX-8 relaxed validate() in
  // current-location mode so the form-stale-fields don't block
  // submit, but that exposed a window where the customer can submit
  // BEFORE `liveCoords` arrives. The submitted order would then have
  // no `deliveryLocation` (resolveDeliveryLocation returns null when
  // liveCoords missing) AND the reverse-geocode branch in placeOrder
  // skips (it requires liveCoords) → the order falls through to the
  // legacy `applySavedToForm` form-stale path → Bug 2 returns. This
  // flag locks the CTA until the GPS fix arrives OR the customer
  // switches back to a saved address.
  //
  //   - mode='current' + capturingLive          → block (in flight)
  //   - mode='current' + liveCoords == null     → block (never captured
  //                                                or error)
  //   - mode='saved' (any state)                → allow (saved branch
  //                                                already validated)
  //   - mode=null (initial)                     → allow (form-mode
  //                                                customer; validate()
  //                                                rejects empty fields)
  const blockingOnCurrentCapture =
    deliveryTargetMode === 'current' && (capturingLive || !liveCoords);
  const canPlaceOrder = !placing && !blockingOnCurrentCapture;

  // Auto-capture live coords once when a coordless saved address
  // is picked. Idempotent — guarded on capturingLive + liveCoords
  // so re-renders don't spam GPS. The customer can re-trigger by
  // explicitly switching to "current location".
  useEffect(() => {
    if (
      savedAddressMissingCoords &&
      !liveCoords &&
      !capturingLive &&
      !liveCoordsError
    ) {
      setCapturingLive(true);
      locationService
        .getCurrentLocation()
        .then(result => {
          setLiveCoords({
            lat: result.location.lat,
            lng: result.location.lng,
            source: result.source,
          });
        })
        .catch(err => {
          setLiveCoordsError(err?.message ?? 'Could not get current location');
        })
        .finally(() => setCapturingLive(false));
    }
  }, [savedAddressMissingCoords, liveCoords, capturingLive, liveCoordsError]);

  // PR 46 — fetch the delivery estimate whenever the resolved
  // location changes. Debounced to a single in-flight call by
  // tracking a request id; stale completions are dropped. The call
  // is purely for the display preview — placeOrder re-derives
  // server-side for the authoritative stamp, so a missed/stale
  // preview here is safe (worst case the estimate line briefly
  // shows the previous value before refreshing).
  useEffect(() => {
    if (!shopId) return;
    const dl = resolveDeliveryLocation();
    if (!dl) {
      setDeliveryEstimate(null);
      setEstimating(false);
      return;
    }
    let cancelled = false;
    setEstimating(true);
    orderService
      .getDeliveryEstimate({
        shopId,
        dest: { lat: dl.lat, lng: dl.lng },
      })
      .then(res => {
        if (cancelled) return;
        setDeliveryEstimate({
          distanceKm: res.distanceKm,
          durationMin: res.durationMin,
        });
      })
      // HOTFIX-SILENT-CATCH-GUARD — DO NOT REMOVE. The estimate line is
      // hidden on failure (best-effort), but the failure (no shop.location
      // / IAM problem) is reported so it's not invisible.
      .catch(e => {
        if (cancelled) return;
        setDeliveryEstimate(null);
        Sentry.captureException(e, { tags: { area: 'Checkout.deliveryEstimate' } });
      })
      .finally(() => {
        if (!cancelled) setEstimating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, resolveDeliveryLocation]);

  const validate = (): Errors => {
    const e: Errors = {};
    if (!name.trim()) e.name = 'Required';
    if (!/^\+?\d{10,13}$/.test(phone.replace(/\s/g, ''))) e.phone = 'Valid phone required';
    // PR-NEXT-HOTFIX-8 (bug 2) — line1 / city / pincode are only
    // required for saved-address / form modes. In current-location
    // mode the address text is rebuilt from reverse-geocode +
    // coords sentinels inside `placeOrder`, so the form's stale
    // values (typically the auto-selected default's Home fields)
    // would only block the order pointlessly. Recipient name +
    // phone still required — those are contact details the
    // shopkeeper actually uses.
    if (deliveryTargetMode !== 'current') {
      if (!line1.trim()) e.line1 = 'Required';
      if (!city.trim()) e.city = 'Required';
      if (!/^\d{6}$/.test(pincode)) e.pincode = '6-digit pincode';
    }
    return e;
  };

  /**
   * After a successful order:
   *   - If the address came from the saved book, do nothing.
   *   - PR-NEXT-ADDRESS-UX (Case 10) — if the customer used
   *     "Deliver to my current location", DO NOT auto-save. Sudhir's
   *     repro: customer picks Home as default → order screen pre-
   *     fills form fields from Home → customer switches to current-
   *     location for THIS order → places order. The form state is
   *     still the Home fields (not the customer's actual current
   *     location), so the silent auto-save below was creating a
   *     duplicate saved address with no label and Home's address
   *     details. Current-location mode is a one-shot; if the
   *     customer wants their current location saved, they should
   *     use AddressEditScreen's explicit "📍 Use my current
   *     location" button (which only stamps coords onto a form
   *     they're actively typing — no copy-from-Home bug).
   *   - If the user has 0 prior saved addresses AND used form
   *     mode, auto-save silently (becomes their default). Stamp a
   *     contextual default label so the customer can distinguish
   *     it from any future entry rather than seeing the bare
   *     "Address" fallback.
   *   - Otherwise prompt "Save this address?". Crude window.confirm /
   *     Alert.alert because we don't want a custom modal in the
   *     OrderConfirmation flow.
   */
  const maybeSaveAddressAfterOrder = async (addr: Address) => {
    if (selectedAddressId) return;
    // PR-NEXT-ADDRESS-UX (Case 10) — original posture: skip silent
    // auto-save on current-location orders so the customer doesn't
    // end up with duplicate unlabelled "Address" rows that copied
    // stale Home fields. PR-NEXT-ADDRESS-UX.1 layers on top: instead
    // of completely silent, open the "Save this location?" modal so
    // the customer can OPT IN with a meaningful name (Sudhir's
    // retest intent — building a reusable address library from
    // current-location orders). Skip-on-Cancel preserves the pre-PR
    // behaviour (no save).
    if (deliveryTargetMode === 'current') {
      if (!liveCoords) return;
      // PR-NEXT-HOTFIX-10 — dedupe gate. Skip the modal entirely
      // when the customer already has an address pin within 25m of
      // the current GPS reading. Toast confirms which existing
      // address matched, so the customer feels acknowledged rather
      // than wondering whether their save fired silently. Threshold
      // tuned to typical urban GPS accuracy (5-20m outdoor /
      // 30-50m indoor) — see `findAddressNearby` for rationale.
      const existing = findAddressNearby(profile?.addresses ?? [], {
        lat: liveCoords.lat,
        lng: liveCoords.lng,
      });
      if (existing) {
        const labelForToast = existing.label?.trim() || 'an existing address';
        setToastMessage(
          `Saved as ${labelForToast} (already in your address book)`,
        );
        setToastVisible(true);
        return; // skip modal entirely
      }
      // Snapshot the (lat, lng, phone, name) tuple BEFORE the
      // modal opens so the persist round-trip doesn't depend on
      // CheckoutScreen still being mounted — the user is about to
      // navigate to OrderConfirmation once we resolve.
      const coordsForSave = {
        lat: liveCoords.lat,
        lng: liveCoords.lng,
        phone: addr.phone,
        name: addr.name,
      };
      setPendingSaveCoords(coordsForSave);
      // Reverse-geocode is best-effort; the helper falls back to
      // "Current location" + empty fields if it throws (no Google
      // Play Services, no network, permission revoke mid-flow).
      const suggestion = await reverseGeocodeLabel({
        lat: liveCoords.lat,
        lng: liveCoords.lng,
      });
      setGeocodeSuggestion(suggestion);
      // Open the modal AND wait for the customer to dismiss it
      // (Save or Skip both resolve via `saveLocationPromiseRef`).
      // Caller (`placeOrder`) awaits this whole function before
      // `nav.replace('OrderConfirmation', …)` runs, so the modal
      // sits on top of CheckoutScreen until the user is done.
      await new Promise<void>(resolve => {
        saveLocationPromiseRef.current = resolve;
        setSaveLocationModalVisible(true);
      });
      return;
    }
    const priorCount = profile?.addresses.length ?? 0;
    const persist = async (label?: string) => {
      try {
        await profileService.saveAddress({
          // PR-NEXT-ADDRESS-UX — pass an explicit label when the
          // caller wants the auto-saved row distinguishable. Server
          // accepts an empty/undefined label too (back-compat).
          ...(label ? { label } : {}),
          name: addr.name,
          phone: addr.phone,
          line1: addr.line1,
          line2: addr.line2,
          city: addr.city,
          pincode: addr.pincode,
        });
      } catch (err) {
        // Silent — order is already placed, missing a saved-address
        // sync isn't worth surfacing.
        console.warn('[Checkout] saveAddress post-order failed:', err);
      }
    };
    if (priorCount === 0) {
      // PR-NEXT-ADDRESS-UX — first-address auto-save. The customer
      // never got a chance to label this; pick a sensible default
      // (their entered city or "Home") so the address book doesn't
      // start with a blank-label entry rendering as the generic
      // "Address" fallback. Customer can rename via the address
      // book later.
      const defaultLabel = addr.city.trim() || 'Home';
      await persist(defaultLabel);
      return;
    }
    const ok = await new Promise<boolean>(resolve => {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        // eslint-disable-next-line no-alert
        resolve(window.confirm('Save this address for next time?'));
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Alert } = require('react-native');
      Alert.alert('Save this address?', 'Use it next time without re-typing.', [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Save', onPress: () => resolve(true) },
      ]);
    });
    if (ok) await persist();
  };

  const placeOrder = async () => {
    // Phone-auth gate: anonymous users must sign in before placing an
    // order so we can confirm + send delivery updates. Browsing/cart
    // still work anonymously (conversion-optimal funnel). Active on
    // both web (reCAPTCHA flow) and native (RNFB phone auth, Phase 9c).
    if (useAuthStore.getState().isAnonymous) {
      const goSignIn = () =>
        nav.navigate('Login', { returnTo: 'Checkout' });
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        // eslint-disable-next-line no-alert
        const ok = window.confirm(
          'Sign in to place order\n\n' +
            'Add your phone number so we can confirm your order and send ' +
            'delivery updates.',
        );
        if (ok) goSignIn();
      } else {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Alert } = require('react-native');
        Alert.alert(
          'Sign in to place order',
          'Add your phone number so we can confirm your order and send ' +
            'delivery updates.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign in', onPress: goSignIn },
          ],
        );
      }
      return;
    }

    // PR-NEXT-HOTFIX-9 — defensive guard (belt + suspenders). The
    // CTA is disabled via `canPlaceOrder` so this branch shouldn't
    // be reachable from the UI, but a stale ref-fired tap (e.g.
    // usePressGuard releasing right as state flips) or a future
    // refactor that loosens the disable could re-expose Bug 2. Cost
    // of the in-function check is zero and it locks the structural
    // invariant. Rule 1 spirit: button-disable is the user-facing
    // fix, this is the lock so a regression can't ship Bug 2 again.
    if (deliveryTargetMode === 'current' && (!liveCoords || capturingLive)) {
      console.warn(
        '[Checkout] placeOrder fired during GPS capture; ignoring.',
      );
      return;
    }

    Analytics.begin_checkout({ value: total, item_count: items.length });
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    if (!shopId) return;

    setPlacing(true);

    // Phase 12a-v2-iv-hotfix-1 OTA verification probe. Logs the
    // cart-line shape immediately before submission so you can
    // confirm post-OTA that menuItemId is present on every line.
    // If you see `menuItemId: undefined` here on your device after
    // pulling the OTA, the new code is NOT yet running. If you see
    // a real id like `p_008_atta` here AND placeOrder still rejects
    // with "not in this shop", the bug is elsewhere (different code
    // path adding to cart, or the menu doc genuinely missing for
    // this shop). Dev-only — stripped in release builds.
    if (__DEV__) {
      console.log(
        '[Checkout] cart shape @ placeOrder:',
        JSON.stringify(
          items.map(i => ({
            productId: i.productId,
            menuItemId: i.menuItemId ?? '<MISSING>',
            priceSnapshot: i.priceSnapshot ?? '<MISSING>',
            qty: i.quantity,
          })),
          null,
          2,
        ),
        'cart.shopId:',
        shopId,
      );
    }

    // PR-NEXT-HOTFIX-8 (bug 2 root cause) — when the customer
    // picked "Deliver to current location" we MUST NOT ship the
    // stale form fields as the address text. Repro: customer has a
    // default Home saved → screen pre-fills form via
    // `applySavedToForm(def)` → customer taps "current location" →
    // places order → `deliveryLocation` is the correct GPS pin BUT
    // `deliveryAddress.{line1,city,pincode}` is still Home. The
    // shopkeeper's order detail (which only reads `deliveryAddress`)
    // shows the WRONG ADDRESS while the GPS pin tells a different
    // story. Sudhir's June 1 retest: *"on shopkeeper side, on order
    // detail, Delivery address is showed as one of my saved dummy
    // address. That is for sure wrong."*
    //
    // Fix: reverse-geocode the live coords NOW and use the result.
    // Cached in `geocodeSuggestion` so the post-order modal reuses
    // it without a second round-trip. Fallback ladder for each
    // field is documented inline so a future reader knows the
    // server-validation reasoning behind each choice.
    let address: Address;
    if (deliveryTargetMode === 'current' && liveCoords) {
      const geocode = await reverseGeocodeLabel({
        lat: liveCoords.lat,
        lng: liveCoords.lng,
      });
      // Pre-stash for the post-order "Save this location?" modal.
      setGeocodeSuggestion(geocode);
      const coordsMarker = `(${liveCoords.lat.toFixed(5)}, ${liveCoords.lng.toFixed(5)})`;
      const geocodedLine1 = geocode.line1.trim();
      const geocodedCity = geocode.city.trim();
      const geocodedPincode = geocode.pincode.trim();
      address = {
        // Recipient name/phone are still the customer's contact
        // details — those are pre-filled from profile/form and stay
        // accurate (they don't change with location choice).
        name: name.trim() || 'Customer',
        phone: phone.trim(),
        // `line1`: geocoded street if we got one, otherwise an
        // explicit "at GPS pin" marker. Either way the leading 📍
        // tells the shopkeeper this is a live-pin order, not a
        // typed address.
        line1:
          geocodedLine1.length > 0
            ? `📍 ${geocodedLine1}`
            : `📍 At GPS pin ${coordsMarker}`,
        // `line2`: always carry the raw coords so the shopkeeper can
        // tap into maps if the geocoded street is generic. If the
        // form had a line2 (rare in current-location mode) it gets
        // overridden — the coords are more useful than stale text.
        line2: coordsMarker,
        // `city`: prefer geocoded city; never fall back to the form's
        // city because that's the source of the original bug (Home's
        // city stamped onto a different-city pin). Sentinel "—"
        // satisfies the non-empty server check while clearly
        // signalling "no city resolved" to the shopkeeper.
        city: geocodedCity.length > 0 ? geocodedCity : '—',
        // `pincode`: prefer geocoded 6-digit; sentinel "000000"
        // otherwise (still 6 digits → passes the server's
        // `/^\d{6}$/` validator, clearly a placeholder visually).
        // Form pincode is intentionally NOT used as fallback for
        // the same wrong-city reason as `city`.
        pincode: /^\d{6}$/.test(geocodedPincode)
          ? geocodedPincode
          : '000000',
        // PR 22 — instructions still come from the order form
        // regardless of address source.
        deliveryInstructions: orderInstructions.trim() || undefined,
      };
    } else {
      address = {
        name: name.trim(),
        line1: line1.trim(),
        line2: line2.trim() || undefined,
        city: city.trim(),
        pincode: pincode.trim(),
        phone: phone.trim(),
        // PR 22 — instructions snapshot for this order. Empty /
        // whitespace-only → undefined so the server omits the field
        // (instead of persisting a blank string). The saved-address
        // book row is NOT updated; this is per-order only.
        deliveryInstructions: orderInstructions.trim() || undefined,
      };
    }

    // PR 46 — resolve the locked delivery location. May be null if
    // the user opened checkout, never picked a saved address, never
    // tapped "current location", and is in form mode (entering a
    // brand-new address). In that case we still place the order but
    // without the locked-fields stamp — back-compat clean. This is
    // the primary place we surface "current location" to: when the
    // user is in form mode without saved addresses.
    const lockedDl = resolveDeliveryLocation();

    try {
      const result = await orderService.placeOrder({
        shopId,
        items,
        address,
        paymentMethod,
        // PR 21 — pre-stated substitution intent. Server re-validates
        // via normalizeSubstitutionPreference + persists onto the
        // order doc. ShopOrderDetail reads this prominently so the
        // shop doesn't have to call mid-fulfillment for unavailable
        // items the customer already decided about.
        substitutionPreference,
        // PR 46 — locked delivery location. Server validates,
        // re-derives the distance/duration estimate authoritatively,
        // and stamps all three fields onto the order doc. Skipped
        // entirely when null — the order doc stays back-compat-clean.
        ...(lockedDl ? { deliveryLocation: lockedDl } : {}),
      });
      Analytics.place_order({
        order_id: result.orderId,
        value: total,
        payment_method: paymentMethod,
      });

      if (paymentMethod === 'cod') {
        // Fire-and-forget save prompt before clearing cart, so the
        // network call gets the user's `address` snapshot intact.
        // Awaited so the OrderConfirmation nav doesn't race ahead
        // and unmount the dialog mid-prompt.
        await maybeSaveAddressAfterOrder(address);
        clearCart();
        nav.replace('OrderConfirmation', { orderId: result.orderId });
        return;
      }

      // Online path — Razorpay Checkout. openRazorpayCheckout dispatches
      // to the web overlay or the native PaymentSheet based on Platform.OS.
      // All callbacks fire with the same payload shape on both platforms.
      if (!result.razorpayOrderId || !result.razorpayKeyId) {
        throw new Error('Payment session not created');
      }
      await openRazorpayCheckout({
        key: result.razorpayKeyId,
        order_id: result.razorpayOrderId,
        amount: Math.round(result.total * 100),
        currency: 'INR',
        name: 'grocery-mvp',
        description: `Order ${result.orderId}`,
        // PR 5 — prefill email too. Razorpay shows an email field by
        // default (RBI compliance for receipt delivery); without
        // prefill the customer hits an extra mandatory input at the
        // worst moment of the flow. Real receipts go to
        // profile.email when set; otherwise a sentinel placeholder
        // on the `noemail.kiranamart.app` domain that satisfies
        // Razorpay's input validation without creating a fake real
        // email. See src/utils/checkoutEmail.ts for the rules.
        prefill: {
          name: address.name,
          contact: address.phone,
          email: deriveCheckoutEmail(profile, address.phone),
        },
        theme: { color: colors.primary },
        handler: async response => {
          // PR 2 — payment hardening, Phase B (item 4). Razorpay's
          // success callback gives us order id + payment id +
          // signature. Verify them server-side via confirmPayment so
          // the order shows paid SYNCHRONOUSLY rather than waiting
          // up to ~30s for the asynchronous webhook. The webhook is
          // still the source of truth — confirmPayment is idempotent
          // and the webhook's "already paid" branch no-ops on the
          // late arrival. If confirmPayment fails (network blip,
          // signature edge case) we navigate anyway and let the
          // webhook backstop us; OrderConfirmation polls the order
          // status so the customer sees the paid flip when it
          // arrives.
          Analytics.payment_success({
            order_id: result.orderId,
            value: result.total,
          });
          try {
            await orderService.confirmPayment({
              orderId: result.orderId,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
          } catch (e: any) {
            console.warn(
              '[CheckoutScreen] confirmPayment failed; relying on webhook:',
              e?.message ?? e,
            );
            Sentry.captureMessage(
              `confirmPayment failed for order ${result.orderId}: ${e?.message ?? 'unknown'}`,
              'warning',
            );
          }
          await maybeSaveAddressAfterOrder(address);
          clearCart();
          nav.replace('OrderConfirmation', { orderId: result.orderId });
        },
        modal: {
          ondismiss: () => {
            setPlacing(false);
            showAlert(
              'Payment cancelled',
              'Your order was created but payment was not completed. ' +
                'You can retry from your order details later.',
            );
          },
        },
        onError: (err: any) => {
          setPlacing(false);
          // Web errors come as { error: { description } }; native errors
          // come as { code, description }. Try both shapes.
          const reason: string =
            err?.error?.description ?? err?.description ?? 'unknown';
          Analytics.payment_failed({ order_id: result.orderId, reason });
          Sentry.captureMessage(
            `Payment failed for order ${result.orderId}: ${reason}`,
            'warning',
          );
          showAlert(
            'Payment failed',
            reason === 'unknown'
              ? 'Please try a different payment method.'
              : reason,
          );
        },
      });
    } catch (err: any) {
      setPlacing(false);
      const message = err?.message || 'Could not place order. Please try again.';
      showAlert('Order failed', message);
    }
  };

  // PR 27 — Re-entrancy guard for the Place Order / Pay button. The
  // existing `disabled={placing}` is paint-time defense only; a
  // double-tap fired BEFORE React re-renders the disabled state can
  // create two Razorpay sessions. usePressGuard flips a ref
  // synchronously inside the handler so the second tap is a
  // guaranteed no-op while the first is in-flight.
  const guardedPlaceOrder = usePressGuard(placeOrder);

  if (items.length === 0) {
    return (
      // HOTFIX-3 — include the 'bottom' edge so the Android
      // gesture-nav pill doesn't overlap the in-flow "Pay" /
      // "Place Order" CTA below. Same reasoning as CartScreen —
      // see that file's HOTFIX-3 comment for the floating-vs-in-flow
      // distinction with PR-NEXT-2.
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ScreenHeader title="Checkout" onBack={() => nav.goBack()} />
        <EmptyState
          title="Your cart is empty"
          subtitle="Add items before checking out."
          ctaLabel="Browse shops"
          onCtaPress={() => nav.navigate('ShopList')}
        />
      </SafeAreaView>
    );
  }

  return (
    // HOTFIX-3 — see comment on the empty-cart branch above. Both
    // branches need the bottom edge so the bottom CTA clears the
    // Android gesture-nav pill.
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title="Checkout" onBack={() => nav.goBack()} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Delivery address</Text>

          {profileLoadError && (
            <View style={styles.profileLoadBanner}>
              <Text style={styles.profileLoadBannerText}>{profileLoadError}</Text>
              <Pressable
                onPress={() => {
                  setProfileLoadError(null);
                  setProfileLoaded(false);
                  setUsingForm(false);
                  // Re-trigger the focus effect by clearing the loaded
                  // flag. The effect's cancellation guard keeps this
                  // safe even if the user spam-taps Retry.
                  profileService
                    .getMyProfile()
                    .then(p => {
                      setProfile(p);
                      const def = p.defaultAddressId
                        ? p.addresses.find(a => a.id === p.defaultAddressId)
                        : p.addresses[0];
                      if (def) {
                        applySavedToForm(def);
                        setSelectedAddressId(def.id);
                        setUsingForm(false);
                        setDeliveryTargetMode('saved');
                      } else {
                        setUsingForm(true);
                      }
                    })
                    .catch(err => {
                      console.warn('[Checkout] retry getMyProfile failed:', err);
                      setProfileLoadError(
                        err?.message
                          ? `Still failing (${err.message}). Enter manually.`
                          : 'Still failing. Enter manually.',
                      );
                      setUsingForm(true);
                    })
                    .finally(() => setProfileLoaded(true));
                }}
                accessibilityRole="button"
                accessibilityLabel="Retry loading saved addresses"
              >
                <Text style={styles.profileLoadBannerRetry}>Retry</Text>
              </Pressable>
            </View>
          )}

          {/* PR 46 — "Deliver to my current location" option.
              Renders above the saved-address picker so it's the
              first thing the customer sees in their address
              section. Tapping captures live GPS via expo-location
              and switches the delivery target to live coords; the
              saved-address picker visually unselects but the form
              fields stay populated so an order placed in this
              mode still has an Address (street/pincode/etc.) for
              the delivery partner to navigate to.
              When the customer hasn't filled the form (form mode
              with empty fields) the form's pincode/phone validation
              will reject Place Order — they must complete the
              physical address even if delivery distance comes from
              live GPS. */}
          {profileLoaded && (
            <Pressable
              onPress={onPickCurrentLocation}
              accessibilityRole="radio"
              accessibilityState={{
                selected: deliveryTargetMode === 'current',
              }}
              accessibilityLabel="Deliver to my current location"
              style={[
                styles.savedCard,
                deliveryTargetMode === 'current' && styles.savedCardSelected,
                { marginBottom: spacing.md },
              ]}
            >
              <View
                style={[
                  styles.radio,
                  deliveryTargetMode === 'current' && styles.radioSelected,
                ]}
              >
                {deliveryTargetMode === 'current' && (
                  <View style={styles.radioDot} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={typography.bodyBold}>
                  📍 Deliver to my current location
                </Text>
                <Text
                  style={[typography.caption, { marginTop: 2 }]}
                  numberOfLines={2}
                >
                  {capturingLive && deliveryTargetMode === 'current'
                    ? 'Getting your location…'
                    : deliveryTargetMode === 'current' && liveCoords
                      ? liveCoords.source === 'gps'
                        ? `Live GPS captured (${liveCoords.lat.toFixed(4)}, ${liveCoords.lng.toFixed(4)})`
                        : "Couldn't get GPS — using approximate location"
                      : 'Use live GPS for delivery distance'}
                </Text>
              </View>
            </Pressable>
          )}

          {/* Picker mode: profile has saved addresses and user hasn't
              opted into the form. Cards are radio-selectable; the
              selected one drives the form fields invisibly so order
              placement keeps using the same code path. */}
          {profileLoaded && !usingForm && (profile?.addresses.length ?? 0) > 0 && (
            <View style={styles.formGroup}>
              {profile!.addresses.map(addr => {
                const selected = addr.id === selectedAddressId;
                return (
                  <Pressable
                    key={addr.id}
                    onPress={() => onPickSaved(addr)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={addr.label || 'Saved address'}
                    style={[
                      styles.savedCard,
                      selected && styles.savedCardSelected,
                    ]}
                  >
                    <View
                      style={[styles.radio, selected && styles.radioSelected]}
                    >
                      {selected && <View style={styles.radioDot} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={typography.bodyBold}>
                        {addr.label || 'Address'}
                        {addr.id === profile?.defaultAddressId
                          ? ' · Default'
                          : ''}
                      </Text>
                      <Text
                        style={[typography.caption, { marginTop: 2 }]}
                        numberOfLines={2}
                      >
                        {[addr.line1, addr.line2, addr.city, addr.pincode]
                          .filter(Boolean)
                          .join(', ')}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={onUseDifferent}
                accessibilityRole="button"
                accessibilityLabel="Use a different address"
                style={styles.useDifferentRow}
              >
                <Text style={styles.useDifferentText}>Use a different address</Text>
              </Pressable>
              {/* PR 46 — saved address has no GPS pin. We surface a
                  note explaining we'll use the customer's live
                  location for the delivery distance estimate (the
                  street address still drives navigation). The fix
                  is: open the address in AddressEdit and tap
                  "Use my current location" to backfill the pin —
                  surfaced here as a soft prompt rather than a hard
                  block to keep the checkout flow moving. */}
              {savedAddressMissingCoords && (
                <View style={styles.coordsFallbackBanner}>
                  <Text style={styles.coordsFallbackText}>
                    📍 This saved address has no map pin. We&apos;ll use
                    your current location to estimate delivery distance
                    for this order. To save a pin, edit the address.
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Form mode: 0 saved addresses, or user tapped "Use a
              different address". The form is the long-standing
              checkout entry surface — unchanged behaviour. */}
          {(usingForm || (profileLoaded && (profile?.addresses.length ?? 0) === 0)) && (
          <View style={styles.formGroup}>
            <Input value={name} onChangeText={setName} placeholder="Full name" error={errors.name} />
            <Input value={line1} onChangeText={setLine1} placeholder="Address line 1 (house, street)" error={errors.line1} />
            <Input value={line2} onChangeText={setLine2} placeholder="Address line 2 (landmark, optional)" />
            <View style={styles.rowFields}>
              <View style={{ flex: 1 }}>
                <Input value={city} onChangeText={setCity} placeholder="City" error={errors.city} />
              </View>
              <View style={{ width: 130 }}>
                <Input
                  value={pincode}
                  onChangeText={setPincode}
                  placeholder="Pincode"
                  keyboardType="numeric"
                  maxLength={6}
                  error={errors.pincode}
                />
              </View>
            </View>
            <Input
              value={phone}
              onChangeText={setPhone}
              placeholder="Phone number"
              keyboardType="phone-pad"
              error={errors.phone}
            />
          </View>
          )}

          <Text style={styles.label}>Order summary</Text>
          <View style={styles.summaryCard}>
            <Text style={typography.bodyBold}>{shopName}</Text>
            <Text style={[typography.caption, { marginTop: 2 }]}>{items.length} items</Text>
            <View style={styles.divider} />
            {items.map(i => (
              <View key={i.productId} style={styles.summaryRow}>
                <Text style={[typography.body, { flex: 1 }]} numberOfLines={1}>
                  {i.name} × {i.quantity}
                </Text>
                <Text style={typography.body}>{formatRupees(i.price * i.quantity)}</Text>
              </View>
            ))}
            <View style={styles.divider} />
            <View style={styles.summaryRow}>
              <Text style={typography.body}>Item total</Text>
              <Text style={typography.body}>{formatRupees(subtotal)}</Text>
            </View>
            {/* PR 47 — distance-based delivery charge replaces the
                flat fee row. When we have a resolved estimate we
                also show the matched distance band ("Delivery
                (2.3 km)") so the customer can see WHY the charge
                is what it is — same UX shape as the design doc.
                When no estimate is resolved yet we render the row
                without the (… km) suffix; the value still updates
                live as the customer picks a target. */}
            <View style={styles.summaryRow}>
              <Text style={typography.body}>
                {deliveryEstimate
                  ? `Delivery (${deliveryEstimate.distanceKm.toFixed(1)} km)`
                  : 'Delivery'}
              </Text>
              <Text style={typography.body}>
                {formatRupees(previewDeliveryCharge)}
              </Text>
            </View>
            {/* PR 46 — estimated delivery time. Only renders when we
                have a resolved estimate; deliberately silent when
                we don't (saves a "—" placeholder line that adds
                visual noise in the form-mode-no-target case). The
                charge stays flat at `deliveryFee` until PR 47
                flips it to distance-tiered. */}
            {estimating && (
              <View style={styles.summaryRow}>
                <Text style={[typography.body, { color: colors.textSecondary }]}>
                  Estimated delivery
                </Text>
                <Text style={[typography.body, { color: colors.textSecondary }]}>
                  Estimating…
                </Text>
              </View>
            )}
            {!estimating && deliveryEstimate && (
              <View style={styles.summaryRow}>
                <Text style={typography.body}>Estimated delivery</Text>
                <Text style={typography.body}>
                  ~{Math.max(1, Math.round(deliveryEstimate.durationMin))} min
                  {' · '}
                  {deliveryEstimate.distanceKm.toFixed(1)} km
                </Text>
              </View>
            )}
            <View style={styles.divider} />
            <View style={styles.summaryRow}>
              <Text style={typography.bodyBold}>Total</Text>
              <Text style={typography.bodyBold}>{formatRupees(total)}</Text>
            </View>
          </View>

          {/* PR 22 — per-order delivery instructions. Sits between
              the bill summary and substitution picker so the
              customer can scan address → instructions →
              substitution → payment top-to-bottom in a single
              cognitive pass. Pre-filled from the picked address;
              edits stay on the order doc and don't mutate the
              saved address book row. */}
          <Text style={styles.label}>Delivery instructions</Text>
          <TextInput
            value={orderInstructions}
            onChangeText={t => setOrderInstructions(t.slice(0, 280))}
            placeholder="Optional — e.g. Ring twice, leave at door"
            placeholderTextColor={colors.textSecondary}
            multiline
            style={styles.instructionsInput}
          />
          <Text style={styles.charCount}>
            {orderInstructions.length}/280
          </Text>

          {/* PR 21 — substitution preference picker. Sits between
              the bill summary and the payment method so the customer
              consciously chooses BEFORE committing to pay. Default
              'call_me' covers the safe path; tapping 'auto' or
              'refund' explicitly opts out of the call. */}
          <Text style={styles.label}>If something&apos;s unavailable</Text>
          <View style={styles.subRow}>
            {([
              {
                value: 'call_me',
                label: '📞 Call me first',
                sub: 'Shop will call before changing anything',
              },
              {
                value: 'auto',
                label: '🔄 Replace with similar',
                sub: 'Shop picks an equivalent item',
              },
              {
                value: 'refund',
                label: '💰 Refund the item',
                sub: 'Skip the item; adjust the total',
              },
            ] as const).map(opt => {
              const active = substitutionPreference === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setSubstitutionPreference(opt.value)}
                  style={[
                    styles.subOption,
                    active && styles.subOptionActive,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={opt.label}
                >
                  <Text
                    style={[
                      styles.subOptionLabel,
                      active && styles.subOptionLabelActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                  <Text style={styles.subOptionSub}>{opt.sub}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Payment</Text>
          <PaymentOption
            selected={paymentMethod === 'cod'}
            onPress={() => setPaymentMethod('cod')}
            title="Cash on Delivery"
            subtitle="Pay when your order arrives"
          />
          <View style={{ height: spacing.md }} />
          <PaymentOption
            selected={paymentMethod === 'online'}
            onPress={() => setPaymentMethod('online')}
            title="Pay Online (UPI / Cards / NetBanking)"
            subtitle="Powered by Razorpay"
          />
        </ScrollView>

        <View style={styles.ctaWrap}>
          {/* PR-NEXT-HOTFIX-9 — capture-state hint above the CTA.
              Only renders while `blockingOnCurrentCapture` is true
              (mode='current' + GPS not yet resolved) so it's
              invisible in saved/form modes. The error variant nudges
              the customer to re-tap the radio (we intentionally do
              NOT auto-retry — auto-retry can mask permission denials
              and feels invisible to the customer). */}
          {blockingOnCurrentCapture && (
            <Text style={styles.captureHint}>
              {liveCoordsError
                ? '⚠️ Couldn’t get your location. Tap "Deliver to current location" again to retry.'
                : '📍 Capturing your location…'}
            </Text>
          )}
          <Button
            title={
              placing
                ? 'Placing order...'
                : paymentMethod === 'cod'
                  ? `Place Order · ${formatRupees(total)}`
                  : `Pay ${formatRupees(total)}`
            }
            onPress={guardedPlaceOrder}
            loading={placing}
            disabled={!canPlaceOrder}
            fullWidth
          />
        </View>
      </KeyboardAvoidingView>
      {/* PR-NEXT-ADDRESS-UX.1 (Case 10 retest) — post-order "Save
          this location?" modal. Mounted at the SafeAreaView root
          (outside the KeyboardAvoidingView's main scroll) so the
          slide-up animation isn't clipped. `Modal`'s own `visible`
          gate keeps the tree zero-cost when closed. Pre-fill
          defaults come from `geocodeSuggestion`; `pendingSaveCoords`
          carries the lat/lng + (name, phone) tuple captured BEFORE
          the modal opened so the persist call is independent of
          any still-mounted form state.

          Save → fires `profileService.saveAddress` with the live
          coords + chosen label + fields, then resolves the awaited
          promise so `placeOrder` can navigate to OrderConfirmation.
          Skip → resolves the promise without saving (same posture
          as the pre-modal silent-skip behaviour). */}
      {pendingSaveCoords != null && geocodeSuggestion != null && (
        <SaveCurrentLocationModal
          visible={saveLocationModalVisible}
          defaultLabel={geocodeSuggestion.label}
          defaultLine1={geocodeSuggestion.line1}
          defaultCity={geocodeSuggestion.city}
          defaultPincode={geocodeSuggestion.pincode}
          onSkip={() => {
            setSaveLocationModalVisible(false);
            setPendingSaveCoords(null);
            setGeocodeSuggestion(null);
            const resolve = saveLocationPromiseRef.current;
            saveLocationPromiseRef.current = null;
            resolve?.();
          }}
          onSave={async input => {
            try {
              await profileService.saveAddress({
                label: input.label,
                name: pendingSaveCoords.name,
                phone: pendingSaveCoords.phone,
                line1: input.line1,
                city: input.city,
                pincode: input.pincode,
                lat: pendingSaveCoords.lat,
                lng: pendingSaveCoords.lng,
              });
            } catch (e) {
              // Same posture as the existing
              // `maybeSaveAddressAfterOrder` persist catch — order
              // is already placed; a missing saved-address sync
              // isn't worth a hard alert in the OrderConfirmation
              // flow. Surfaces in Sentry / console for diagnostics.
              console.warn(
                '[Checkout] saveAddress (current location) failed:',
                e,
              );
            } finally {
              setSaveLocationModalVisible(false);
              setPendingSaveCoords(null);
              setGeocodeSuggestion(null);
              const resolve = saveLocationPromiseRef.current;
              saveLocationPromiseRef.current = null;
              resolve?.();
            }
          }}
        />
      )}
      {/* PR-NEXT-HOTFIX-10 — address-dedupe toast. Mounted at the
          SafeAreaView root so it floats above the entire screen
          (including the CTA + the SaveCurrentLocationModal slot
          when that's closed). `pointerEvents="none"` inside the
          Toast component prevents it from intercepting taps on
          anything below. Auto-dismisses after 3s; the dismiss
          callback flips `toastVisible` so subsequent dedupe hits
          re-mount the animation cleanly. */}
      <Toast
        visible={toastVisible}
        message={toastMessage}
        onDismiss={() => setToastVisible(false)}
      />
    </SafeAreaView>
  );
}

function PaymentOption({
  selected,
  onPress,
  title,
  subtitle,
  disabled,
}: {
  selected: boolean;
  onPress: () => void;
  title: string;
  subtitle: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={title}
      style={[
        styles.payOption,
        selected && styles.payOptionSelected,
        disabled && styles.payOptionDisabled,
      ]}
    >
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected && <View style={styles.radioDot} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={typography.bodyBold}>{title}</Text>
        <Text style={[typography.caption, { marginTop: 2 }]}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  label: { ...typography.h3, marginBottom: spacing.sm },
  formGroup: { gap: spacing.md, marginBottom: spacing.xl },
  rowFields: { flexDirection: 'row', gap: spacing.md },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  payOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  payOptionSelected: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  payOptionDisabled: { opacity: 0.5 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.primary },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  // PR-NEXT-HOTFIX-9 — DO NOT REMOVE. Style for the capture-state
  // hint rendered above the Place Order / Pay CTA while the
  // current-location GPS fix is in flight (or errored out).
  captureHint: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  ctaWrap: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  // Phase 12a-v2-iv: saved-address picker styles.
  savedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  savedCardSelected: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  useDifferentRow: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  useDifferentText: {
    ...typography.bodyBold,
    color: colors.primary,
  },
  // Phase 12a-v2-iv-followup: profile-load error banner.
  profileLoadBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FEF3C7',
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  profileLoadBannerText: {
    ...typography.caption,
    color: '#92400E',
    flex: 1,
  },
  profileLoadBannerRetry: {
    ...typography.bodyBold,
    color: colors.primary,
  },
  // PR 21 — substitution preference picker styles. Mirrors the
  // address-card visual language (border + tinted-active state) so
  // the customer instinctively recognizes it as a selection.
  subRow: { gap: spacing.sm, marginBottom: spacing.lg },
  subOption: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  subOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  subOptionLabel: { ...typography.bodyBold },
  subOptionLabelActive: { color: colors.primaryDark },
  subOptionSub: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  // PR 22 — multiline instructions input + char counter. Mirrors
  // the same styling on AddressEditScreen for consistency.
  instructionsInput: {
    ...typography.body,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 80,
    textAlignVertical: 'top',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    backgroundColor: colors.surface,
  },
  charCount: {
    ...typography.caption,
    color: colors.textSecondary,
    alignSelf: 'flex-end',
    marginBottom: spacing.lg,
  },
  // PR 46 — yellow note shown under the saved-address picker when
  // the picked address has no GPS pin AND we'll be substituting
  // live GPS for the delivery distance estimate. Distinct visual
  // weight from the address row itself so the customer parses it
  // as informational rather than a selection.
  coordsFallbackBanner: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: '#FEF3C7', // amber-100
  },
  coordsFallbackText: {
    ...typography.caption,
    color: '#92400E', // amber-700
  },
});
