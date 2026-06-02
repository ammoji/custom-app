import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import ScreenHeader from '../../components/common/ScreenHeader';
// PR 34 — DO NOT REMOVE. VoiceInputButton powers the big "Speak
// about your shop" CTA + every per-field mic icon below. If this
// import is gone the screen falls back to type-only and the
// Phase A2 accessibility gap re-opens.
import VoiceInputButton from '../../components/VoiceInputButton';
import { colors, radii, spacing, typography } from '../../constants/theme';
// PR-NEXT-SHOP-LOCATION-EDIT — DO NOT REMOVE. Replaces the previous
// `useLocationStore` read with a screen-scoped dual-mode capture
// hook (GPS or typed-address geocode). The customer-side
// `useLocationStore` is conceptually the customer's location for
// browse/checkout; reusing it for the SHOP's pin re-introduces the
// fallback-leak class of bug + would conflate the geocode result
// with the customer's saved address. Single source of truth for
// the capture flow lives in `useCaptureShopLocation`.
import { useCaptureShopLocation } from '../../hooks/useCaptureShopLocation';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
import type {
    ParsedShopFields,
    ShopKycDocKind,
    UiLanguage,
} from '../../types';

// PR 31 — One slot's upload state. The four slots (storefront, GST,
// FSSAI, owner ID) each carry an independent copy. `localPreviewUri`
// is the asset URI from `expo-image-picker` and is shown as the
// thumbnail BEFORE/AFTER the PUT — `/shop-kyc/` is read-deny for
// non-admins so we deliberately do NOT round-trip through a signed
// read URL. `storagePath` is the durable identity returned by the
// server's `getShopKycUploadUrl`.
type KycSlotState = {
  uploading: boolean;
  storagePath: string | null;
  localPreviewUri: string | null;
  error: string | null;
};

const initialSlotState: KycSlotState = {
  uploading: false,
  storagePath: null,
  localPreviewUri: null,
  error: null,
};

const KYC_LABELS: Record<ShopKycDocKind, string> = {
  // PR 42 → PR 43 — three of four slots are now MANDATORY. The
  // "(required)" suffix mirrors each `handleFinish` gate below.
  //
  // - storefront: PR 42 — drives the customer-facing shop card.
  // - gstDoc:     PR 43 — Section 24 of the CGST Act requires
  //               GST registration for all suppliers selling
  //               through an e-commerce operator (regardless of
  //               the ₹20-40 lakh threshold). HamaraSetu is an
  //               e-commerce operator; every shop must have GSTIN.
  // - ownerIdDoc: PR 43 — baseline KYC. Owner uploads either
  //               Aadhaar OR PAN (their choice; the slot stores
  //               whichever they photographed). Without proof of
  //               identity, the platform has no recourse against
  //               fraudulent listings or undelivered paid orders.
  //
  // FSSAI remains optional — relevant only for prepared-food
  // resellers and even then the free-text license number can
  // substitute. Don't gate on it.
  storefront: 'Storefront photo (required)',
  gstDoc: 'GST Certificate (required)',
  fssaiDoc: 'FSSAI license',
  ownerIdDoc: 'Owner ID — Aadhaar or PAN (required)',
};

/**
 * Phase 12a-v2-i shop registration form. Replaces the old
 * BecomeShopOwnerScreen claim-a-seeded-shop picker. Submitting puts the
 * shop in `pending` state; admin reviews via the PendingShops dashboard
 * and approves or rejects with reason.
 *
 * Optional `prefill` route param lets a rejected shop owner re-open
 * the form with their previous values from the WaitingForApproval
 * screen (rejected → "Edit and resubmit").
 */
export default function RegisterShopScreen() {
  const nav = useNavigation<any>();
  const route =
    useRoute<RouteProp<RootStackParamList, 'RegisterShop'>>();
  const prefill = route.params?.prefill;

  const isAnonymous = useAuthStore(s => s.isAnonymous);
  const phoneFromAuth = useAuthStore(s => s.phoneNumber);
  // PR-NEXT-SHOP-LOCATION-EDIT — dual-mode shop-pin capture. The
  // hook embeds HOTFIX-FALLBACK-LEAK's posture (refuse the silent
  // MOCK_USER_LOCATION) AND adds the typed-address geocode fallback
  // (lets a remote owner register a shop without being physically
  // at it). `captured` is null until the owner taps one of the two
  // CTAs below the address field; submit gates on `!!captured`.
  // Sits with the other top-level hooks above the conditional
  // `if (isAnonymous)` return per Rule 2.
  const {
    captured: capturedShopLocation,
    capturing: capturingShopLocation,
    error: captureShopError,
    captureGps: captureShopGps,
    captureFromAddress: captureShopFromAddress,
    reset: resetShopCapture,
  } = useCaptureShopLocation();

  const [name, setName] = useState(prefill?.name ?? '');
  const [address, setAddress] = useState(prefill?.address ?? '');
  const [phone, setPhone] = useState(
    prefill?.phone ?? phoneFromAuth ?? '',
  );
  // 24h "HH:mm" strings — kept as plain text so we don't drag in a
  // native time picker for MVP. Server stores whatever we send.
  const [openTime, setOpenTime] = useState(prefill?.hours?.open ?? '09:00');
  const [closeTime, setCloseTime] = useState(
    prefill?.hours?.close ?? '21:00',
  );
  const [gstNumber, setGstNumber] = useState(prefill?.gstNumber ?? '');
  const [fssaiLicense, setFssaiLicense] = useState(
    prefill?.fssaiLicense ?? '',
  );
  const [submitting, setSubmitting] = useState(false);

  // PR 31 — 2-step wizard. Step 1 collects the basic info; tapping
  // "Continue" calls `registerShop` to create the pending-shop doc
  // and stores the returned `shopId` (the upload callable needs it
  // to gate write-access). Step 2 surfaces the four KYC upload
  // slots. All state is hoisted ABOVE the `if (isAnonymous)` early
  // return per Rules-of-Hooks discipline (PR 12 lineage).
  const [step, setStep] = useState<1 | 2>(1);
  const [submittedShopId, setSubmittedShopId] = useState<string | null>(null);
  const [storefront, setStorefront] = useState<KycSlotState>(initialSlotState);
  const [gstDoc, setGstDoc] = useState<KycSlotState>(initialSlotState);
  const [fssaiDoc, setFssaiDoc] = useState<KycSlotState>(initialSlotState);
  const [ownerIdDoc, setOwnerIdDoc] = useState<KycSlotState>(initialSlotState);

  // PR 34 — Voice + Hindi onboarding state. Hindi is the default
  // because the audience that benefits the most from voice
  // assistance is non-English-fluent shopkeepers; English speakers
  // can switch with a single tap. `aiFilledFields` records which
  // fields the multi_field flow filled — the form renders a ✨ "AI"
  // chip + yellow left-border on those, signalling "review me
  // before continuing" (Trust Principle 2). The chip clears the
  // moment the user edits the field (see clearAiMark in handlers).
  // `transcript` powers the review banner shown after multi_field.
  // All four hooks sit ABOVE the `if (isAnonymous)` early return
  // — Rules-of-Hooks discipline (PR 12 / PR 27 lineage).
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>('hi-IN');
  const [aiFilledFields, setAiFilledFields] = useState<
    Set<keyof ParsedShopFields>
  >(new Set());
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(null);
  const [voiceParseError, setVoiceParseError] = useState<string | null>(null);

  if (isAnonymous) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          title="Register your shop"
          onBack={() => nav.goBack()}
        />
        <EmptyState
          title="Sign in first"
          subtitle="You need a phone-verified account to register a shop."
        />
      </SafeAreaView>
    );
  }

  const validate = (): string | null => {
    if (!name.trim()) return 'Shop name is required';
    if (!address.trim()) return 'Shop address is required';
    if (!phone.trim()) return 'Phone number is required';
    const hhmm = /^\d{2}:\d{2}$/;
    if (!hhmm.test(openTime) || !hhmm.test(closeTime)) {
      return 'Hours must be in HH:mm format (e.g. 09:00)';
    }
    // PR-NEXT-SHOP-LOCATION-EDIT — dual-mode capture gate. The
    // shared `useCaptureShopLocation` hook already refuses the
    // silent MOCK_USER_LOCATION fallback (HOTFIX-FALLBACK-LEAK
    // posture) AND validates the geocode result before populating
    // `captured`, so a non-null `capturedShopLocation` is
    // guaranteed-good. This stays as defense-in-depth on the
    // submit path: if any future refactor decouples the hook from
    // the validate() call site, this check still blocks the
    // SHOP-LOCATION-REQUIRED layer-1 gate.
    if (!capturedShopLocation) {
      return (
        'Please capture your shop\'s location before submitting. ' +
        'Tap "📍 Use my GPS" if you\'re at the shop, or ' +
        '"🔍 Find from address" to resolve the address you typed above.'
      );
    }
    return null;
  };

  // PR 31 — Step 1: create the pending shop doc, then advance the
  // wizard to step 2 (KYC document uploads). The shopId returned
  // here gates the per-slot upload callable, so the registration
  // MUST land before any document upload is attempted.
  const handleContinue = async () => {
    const err = validate();
    if (err) {
      Alert.alert('Missing info', err);
      return;
    }
    setSubmitting(true);
    try {
      const result = await orderService.registerShop({
        name: name.trim(),
        address: address.trim(),
        // PR-NEXT-SHOP-LOCATION-EDIT — captured pin from the dual-
        // mode hook. `validate()` above guarantees non-null on the
        // submit path; `?? undefined` is a TS narrowing nicety, not
        // a real fallback.
        location: capturedShopLocation
          ? {
              lat: capturedShopLocation.lat,
              lng: capturedShopLocation.lng,
            }
          : undefined,
        locationSource: capturedShopLocation?.source,
        phone: phone.trim(),
        hours: { open: openTime, close: closeTime },
        gstNumber: gstNumber.trim() || undefined,
        fssaiLicense: fssaiLicense.trim() || undefined,
      });
      setSubmittedShopId(result.shopId);
      setStep(2);
    } catch (e: any) {
      const message =
        e?.message ||
        'Could not submit registration. Please try again later.';
      Alert.alert('Registration failed', message);
    } finally {
      setSubmitting(false);
    }
  };

  // PR 31 — Pick from camera roll and upload via the signed PUT
  // URL flow. Mirrors `services/storage.ts` (PR 6.1) for menu
  // images: `getShopKycUploadUrl` mints a v4 PUT URL bound to
  // `Content-Type: image/jpeg`, client `fetch().blob()` the local
  // asset and PUTs the bytes, then `recordShopKycUpload` stamps
  // the path on the shop doc. Each step is failure-isolated — a
  // network blip surfaces in the slot's `error` field; nothing
  // throws to Sentry.
  const pickAndUpload = async (
    docKind: ShopKycDocKind,
    setSlot: (s: KycSlotState) => void,
  ) => {
    if (!submittedShopId) {
      Alert.alert(
        'Save basics first',
        'Please complete step 1 before uploading documents.',
      );
      return;
    }
    setSlot({ ...initialSlotState, uploading: true });
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        quality: 0.7,
        allowsEditing: true,
      });
      if (picked.canceled || !picked.assets?.length) {
        setSlot(initialSlotState);
        return;
      }
      const asset = picked.assets[0];

      const { uploadUrl, storagePath } =
        await orderService.getShopKycUploadUrl({
          shopId: submittedShopId,
          docKind,
        });

      const blob = await (await fetch(asset.uri)).blob();
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      });
      if (!putRes.ok) {
        const errBody = await putRes.text().catch(() => '');
        throw new Error(
          `Upload failed (HTTP ${putRes.status})${errBody ? `: ${errBody.slice(0, 120)}` : ''}`,
        );
      }

      await orderService.recordShopKycUpload({
        shopId: submittedShopId,
        docKind,
        storagePath,
      });

      setSlot({
        uploading: false,
        storagePath,
        localPreviewUri: asset.uri,
        error: null,
      });
    } catch (e: any) {
      setSlot({
        uploading: false,
        storagePath: null,
        localPreviewUri: null,
        error: e?.message ?? 'Upload failed',
      });
    }
  };

  // PR 31 → PR 42 → PR 43 — Step 2 finish. Three slots are now
  // mandatory (storefront, gstDoc, ownerIdDoc); FSSAI stays
  // optional. Order of checks is fixed so the user gets one
  // clear remediation at a time rather than a cascading wall of
  // alerts. Each check pairs with the `disabled` gate on the
  // Finish button (defensive double-guard — async upload writes
  // can race the user's tap so we both disable the button AND
  // re-validate here).
  const handleFinish = () => {
    if (!submittedShopId) return;
    // 1. Storefront — PR 42. Customer-facing shop card uses this
    //    image; without it the card shows a 🏪 placeholder which
    //    hurts Trust Principle 1 (visual quality).
    if (!storefront.storagePath) {
      Alert.alert(
        'Storefront photo required',
        'Please upload a photo of your storefront before submitting. This will be your shop\'s main image in the app.',
      );
      return;
    }
    // 2. Owner ID — PR 43. Aadhaar OR PAN satisfies the gate;
    //    the slot stores whichever the owner photographed. No
    //    distinction between the two doc types at this layer —
    //    admin reviews the uploaded image regardless.
    if (!ownerIdDoc.storagePath) {
      Alert.alert(
        'Owner ID required',
        'Please upload a photo of your Aadhaar OR PAN card. Either one works — this confirms the shop owner\'s identity.',
      );
      return;
    }
    // 3. GST Certificate — PR 43. Section 24 of the CGST Act
    //    requires GST registration for all suppliers selling
    //    through an e-commerce operator. HamaraSetu = e-commerce
    //    operator → every shop needs GSTIN. The gst.gov.in
    //    helper text under the upload tile gives the owner a
    //    self-serve unblock path (3-7 working days to register).
    if (!gstDoc.storagePath) {
      Alert.alert(
        'GST Certificate required',
        'Please upload your GST registration certificate. HamaraSetu requires GST registration for all shops per Section 24 of the CGST Act.\n\nDon\'t have GST yet? Register free at gst.gov.in (takes 3-7 working days).',
      );
      return;
    }
    nav.reset({
      index: 1,
      routes: [
        { name: 'Home' },
        {
          name: 'WaitingForApproval',
          params: { shopId: submittedShopId },
        },
      ],
    });
  };

  // PR 34 — clear the ✨ AI chip on a field as soon as the user
  // edits it. Returning a typed setter keeps the per-field handler
  // boilerplate to one line per Field below. The "user has
  // reviewed" semantics rest entirely on the chip clearing —
  // Trust Principle 2 in action.
  const clearAiMark = (field: keyof ParsedShopFields) => {
    if (!aiFilledFields.has(field)) return;
    setAiFilledFields(prev => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  };

  // PR 34 — assigner used by the big "Speak about your shop" CTA.
  // The server has already validated each field; non-null values
  // drop straight into the matching state. Track which fields got
  // a non-null value so the form can render the ✨ chip.
  const applyParsedFields = (parsed: ParsedShopFields) => {
    const filled = new Set<keyof ParsedShopFields>();
    if (parsed.name) {
      setName(parsed.name);
      filled.add('name');
    }
    if (parsed.address) {
      setAddress(parsed.address);
      filled.add('address');
    }
    if (parsed.phone) {
      setPhone(parsed.phone);
      filled.add('phone');
    }
    if (parsed.openTime) {
      setOpenTime(parsed.openTime);
      filled.add('openTime');
    }
    if (parsed.closeTime) {
      setCloseTime(parsed.closeTime);
      filled.add('closeTime');
    }
    if (parsed.gstNumber) {
      setGstNumber(parsed.gstNumber);
      filled.add('gstNumber');
    }
    if (parsed.fssaiLicense) {
      setFssaiLicense(parsed.fssaiLicense);
      filled.add('fssaiLicense');
    }
    setAiFilledFields(filled);
  };

  // PR 34 — small helper to localise headings + the review banner.
  // We deliberately do NOT swap the field labels (Shop name *,
  // Phone *, etc.) since shopkeepers picking Hindi UI may still
  // recognise the English field labels from form precedent. A
  // future PR can swap to a real i18n system; for MVP, keeping
  // the form labels in English while localising voice CTAs +
  // review messaging is the minimum viable Hindi UX.
  const t = (key: 'reviewHeading' | 'reviewHint' | 'langPickerLabel') => {
    const isHi = uiLanguage === 'hi-IN';
    if (key === 'reviewHeading') {
      return isHi ? 'मैंने सुना:' : 'I heard:';
    }
    if (key === 'reviewHint') {
      return isHi
        ? 'जो भी ग़लत हो उसे ठीक करें, फिर "Continue" दबाएँ।'
        : 'Please correct anything wrong before continuing.';
    }
    // langPickerLabel
    return isHi ? 'भाषा' : 'Language';
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Register your shop" onBack={() => nav.goBack()} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content}>
          {/* PR 31 — Step indicator. Two-step wizard: basics → docs.
              Both steps stay in the same screen so the back button on
              the screen-header still navigates "out", not between
              steps. */}
          <View style={styles.stepRow}>
            <View
              style={[
                styles.stepDot,
                step >= 1 && styles.stepDotActive,
              ]}
            >
              <Text
                style={[
                  styles.stepNumber,
                  step >= 1 && styles.stepNumberActive,
                ]}
              >
                1
              </Text>
            </View>
            <View style={styles.stepLine} />
            <View
              style={[
                styles.stepDot,
                step >= 2 && styles.stepDotActive,
              ]}
            >
              <Text
                style={[
                  styles.stepNumber,
                  step >= 2 && styles.stepNumberActive,
                ]}
              >
                2
              </Text>
            </View>
          </View>

          {step === 1 && (
            <>
          {/* PR 34 — Language picker. Hindi default for the
              audience that benefits most from voice; English speaker
              taps once to switch. Affects every voice CTA + the
              review banner + every server-side error message. */}
          <View style={styles.langPickerRow}>
            <Text style={styles.langPickerLabel}>{t('langPickerLabel')}</Text>
            <Pressable
              onPress={() => setUiLanguage('hi-IN')}
              style={[
                styles.langPill,
                uiLanguage === 'hi-IN' && styles.langPillActive,
              ]}
            >
              <Text
                style={[
                  styles.langPillText,
                  uiLanguage === 'hi-IN' && styles.langPillTextActive,
                ]}
              >
                हिंदी
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setUiLanguage('en-IN')}
              style={[
                styles.langPill,
                uiLanguage === 'en-IN' && styles.langPillActive,
              ]}
            >
              <Text
                style={[
                  styles.langPillText,
                  uiLanguage === 'en-IN' && styles.langPillTextActive,
                ]}
              >
                English
              </Text>
            </Pressable>
          </View>

          {/* PR 34 — Big "Speak about your shop" CTA. Pre-fills
              up to 7 fields in one shot. Trust Principle 2: every
              filled field is marked with a ✨ chip and the
              transcript shows in the review banner — the user
              MUST see the AI output before tapping Continue. */}
          <VoiceInputButton
            languageCode={uiLanguage}
            mode="multi_field"
            size="lg"
            onResult={r => {
              setVoiceTranscript(r.transcript);
              setVoiceParseError(r.parseError ?? null);
              if (r.fields) applyParsedFields(r.fields);
            }}
            onError={(_code, message) => {
              Alert.alert(
                uiLanguage === 'hi-IN' ? 'त्रुटि' : 'Error',
                message,
              );
            }}
          />

          {/* Review banner. Shows the raw transcript so the user
              can spot dictation errors at a glance. If Claude's
              parse fell back, surfaces the friendly hint asking
              them to use per-field mics. */}
          {voiceTranscript ? (
            <View style={styles.reviewBanner}>
              <Text style={styles.reviewBannerHeading}>
                {t('reviewHeading')}
              </Text>
              <Text style={styles.reviewBannerTranscript}>
                &ldquo;{voiceTranscript}&rdquo;
              </Text>
              <Text style={styles.reviewBannerHint}>{t('reviewHint')}</Text>
              {voiceParseError ? (
                <Text style={styles.reviewBannerError}>
                  {voiceParseError}
                </Text>
              ) : null}
            </View>
          ) : null}

          <Text style={styles.intro}>
            Tell us about your shop. An admin will review your registration
            and notify you within 24 hours.
          </Text>

          <Field
            label="Shop name *"
            value={name}
            onChangeText={v => {
              setName(v);
              clearAiMark('name');
            }}
            placeholder="e.g. Sharma Provision Store"
            aiFilled={aiFilledFields.has('name')}
            voice={{
              languageCode: uiLanguage,
              onTranscript: txt => {
                setName(txt);
                clearAiMark('name');
              },
              onError: (_c, m) =>
                Alert.alert(
                  uiLanguage === 'hi-IN' ? 'त्रुटि' : 'Error',
                  m,
                ),
            }}
          />
          <Field
            label="Shop address *"
            value={address}
            onChangeText={v => {
              setAddress(v);
              clearAiMark('address');
            }}
            placeholder="Building, street, area, city, pincode"
            multiline
            aiFilled={aiFilledFields.has('address')}
            voice={{
              languageCode: uiLanguage,
              onTranscript: txt => {
                setAddress(txt);
                clearAiMark('address');
              },
              onError: (_c, m) =>
                Alert.alert(
                  uiLanguage === 'hi-IN' ? 'त्रुटि' : 'Error',
                  m,
                ),
            }}
          />
          {/* PR-NEXT-SHOP-LOCATION-EDIT — dual-mode location capture.
              Two CTAs (GPS / typed-address geocode). Renders a
              success card when `captured` exists; an error caption
              when the most recent capture attempt failed; nothing
              when the slate is clean. The hook embeds HOTFIX-
              FALLBACK-LEAK posture (refuses silent MOCK_USER_LOCATION)
              so the bad-state warning the hotfix surfaced is now
              IMPOSSIBLE to reach — the hook returns an explicit
              error string that lands in `captureShopError` instead. */}
          <Text style={styles.captureLabel}>Shop location *</Text>
          {!capturedShopLocation && (
            <View style={styles.captureCtaRow}>
              <Pressable
                onPress={captureShopGps}
                disabled={capturingShopLocation}
                style={({ pressed }) => [
                  styles.captureCta,
                  pressed && styles.captureCtaPressed,
                  capturingShopLocation && styles.captureCtaDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Use my GPS to capture shop location"
              >
                <Text style={styles.captureCtaText}>📍 Use my GPS</Text>
              </Pressable>
              <Pressable
                onPress={() => captureShopFromAddress(address)}
                disabled={capturingShopLocation}
                style={({ pressed }) => [
                  styles.captureCta,
                  pressed && styles.captureCtaPressed,
                  capturingShopLocation && styles.captureCtaDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Find shop location from typed address"
              >
                <Text style={styles.captureCtaText}>🔍 Find from address</Text>
              </Pressable>
            </View>
          )}
          {capturingShopLocation && (
            <View style={styles.capturingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.capturingText}>Capturing location…</Text>
            </View>
          )}
          {captureShopError && (
            <Text style={styles.captureHintError}>⚠️ {captureShopError}</Text>
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
              <Pressable
                onPress={resetShopCapture}
                style={({ pressed }) => [
                  styles.captureRecaptureBtn,
                  pressed && styles.captureCtaPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Re-capture shop location"
                hitSlop={6}
              >
                <Text style={styles.captureRecaptureText}>↻ Re-capture</Text>
              </Pressable>
            </View>
          )}
          <Field
            label="Phone *"
            value={phone}
            onChangeText={v => {
              setPhone(v);
              clearAiMark('phone');
            }}
            placeholder="+91XXXXXXXXXX"
            keyboardType="phone-pad"
            aiFilled={aiFilledFields.has('phone')}
            voice={{
              languageCode: uiLanguage,
              onTranscript: txt => {
                // Strip non-digits client-side before assigning;
                // mirrors the server's phone validator. Keeps the
                // form consistent if the user dictates "nine eight
                // seven six..." with extra words.
                const digits = txt.replace(/\D/g, '');
                const ten =
                  digits.length === 12 && digits.startsWith('91')
                    ? digits.slice(2)
                    : digits.length === 11 && digits.startsWith('0')
                      ? digits.slice(1)
                      : digits;
                setPhone(ten);
                clearAiMark('phone');
              },
              onError: (_c, m) =>
                Alert.alert(
                  uiLanguage === 'hi-IN' ? 'त्रुटि' : 'Error',
                  m,
                ),
            }}
          />

          <Text style={styles.sectionLabel}>Business hours</Text>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field
                label="Opens at"
                value={openTime}
                onChangeText={v => {
                  setOpenTime(v);
                  clearAiMark('openTime');
                }}
                placeholder="09:00"
                aiFilled={aiFilledFields.has('openTime')}
              />
            </View>
            <View style={{ width: spacing.md }} />
            <View style={{ flex: 1 }}>
              <Field
                label="Closes at"
                value={closeTime}
                onChangeText={v => {
                  setCloseTime(v);
                  clearAiMark('closeTime');
                }}
                placeholder="21:00"
                aiFilled={aiFilledFields.has('closeTime')}
              />
            </View>
          </View>

          <Text style={styles.sectionLabel}>Compliance (optional)</Text>
          <Field
            label="GST number"
            value={gstNumber}
            onChangeText={v => {
              setGstNumber(v);
              clearAiMark('gstNumber');
            }}
            placeholder="22AAAAA0000A1Z5"
            autoCapitalize="characters"
            aiFilled={aiFilledFields.has('gstNumber')}
          />
          <Field
            label="FSSAI license"
            value={fssaiLicense}
            onChangeText={v => {
              setFssaiLicense(v);
              clearAiMark('fssaiLicense');
            }}
            placeholder="14-digit FSSAI number"
            keyboardType="number-pad"
            aiFilled={aiFilledFields.has('fssaiLicense')}
          />

          {/* PR-NEXT-SHOP-LOCATION-EDIT — Continue CTA helper.
              Surfaces the missing-pin precondition above the button
              so the owner sees WHY it's dim before tapping. The
              capture affordance referenced in the copy is the
              dual-mode CTA row rendered earlier in the form. */}
          {!capturedShopLocation && (
            <Text style={styles.captureHint}>
              📍 Capture your shop’s location (GPS or typed address)
              before continuing — customers won’t see your shop
              without it.
            </Text>
          )}
          <View style={{ marginTop: spacing.lg }}>
            <Button
              title={submitting ? 'Saving…' : 'Continue to documents'}
              onPress={handleContinue}
              loading={submitting}
              // PR-NEXT-SHOP-LOCATION-EDIT — gate on captured pin
              // (either GPS or geocoded). The hook guarantees a
              // non-fallback result so the HOTFIX-FALLBACK-LEAK
              // posture is preserved without a separate check.
              disabled={submitting || !capturedShopLocation}
              size="lg"
            />
          </View>

          <Text style={styles.footnote}>
            By submitting you confirm the information is accurate. Providing
            false details may result in your shop being suspended.
          </Text>
            </>
          )}

          {step === 2 && (
            <>
              <Text style={styles.intro}>
                Help us verify your shop is genuine. Three documents are
                required to submit: the storefront photo (becomes your
                shop's main image), your GST Certificate, and one Owner
                ID (Aadhaar or PAN). FSSAI is optional — only relevant
                if you sell prepared food.
              </Text>

              <KycSlotCard
                label={KYC_LABELS.storefront}
                hint="Front of your shop with the signage visible"
                state={storefront}
                onPress={() => pickAndUpload('storefront', setStorefront)}
              />
              <KycSlotCard
                label={KYC_LABELS.ownerIdDoc}
                hint="Aadhaar or PAN — either one works"
                state={ownerIdDoc}
                onPress={() => pickAndUpload('ownerIdDoc', setOwnerIdDoc)}
              />
              <KycSlotCard
                label={KYC_LABELS.gstDoc}
                hint="Photo or scan of your GST certificate"
                state={gstDoc}
                onPress={() => pickAndUpload('gstDoc', setGstDoc)}
              />
              {/* PR 43 — GST helper line. Many small kiranas don't
                  have GSTIN yet; rather than block them at the gate
                  with no remediation path, point them to gst.gov.in
                  for the (free, ~3-7 working day) registration. */}
              <Text style={styles.kycHelper}>
                Don't have GST yet? Register free at gst.gov.in.
                Takes 3-7 working days.
              </Text>
              <KycSlotCard
                label={KYC_LABELS.fssaiDoc}
                hint="Photo or scan of your FSSAI license"
                state={fssaiDoc}
                onPress={() => pickAndUpload('fssaiDoc', setFssaiDoc)}
              />

              <View style={{ marginTop: spacing.lg }}>
                <Button
                  title="Finish & wait for approval"
                  onPress={handleFinish}
                  size="lg"
                  // PR 42 → PR 43 — disable until ALL three mandatory
                  // uploads complete. The handleFinish gate above also
                  // alerts on tap if a race lets the user reach it
                  // without one of the slots populated (defence in
                  // depth — disabled state can race with the upload's
                  // `setSlot` write). FSSAI is excluded — optional.
                  disabled={
                    !storefront.storagePath ||
                    storefront.uploading ||
                    !ownerIdDoc.storagePath ||
                    ownerIdDoc.uploading ||
                    !gstDoc.storagePath ||
                    gstDoc.uploading
                  }
                />
              </View>

              <Text style={styles.footnote}>
                You can return to this step from "Waiting for approval"
                if you need to add a missing document.
              </Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// PR 31 — One KYC upload slot. Renders the label + hint, the
// thumbnail (if uploaded) or an empty placeholder, an inline
// activity indicator while uploading, and any error message. Tap
// anywhere on the card invokes the picker.
function KycSlotCard({
  label,
  hint,
  state,
  onPress,
}: {
  label: string;
  hint: string;
  state: KycSlotState;
  onPress: () => void;
}) {
  const uploaded = !!state.localPreviewUri && !!state.storagePath;
  return (
    <Pressable
      onPress={onPress}
      disabled={state.uploading}
      style={({ pressed }) => [
        styles.kycCard,
        pressed && !state.uploading && { opacity: 0.85 },
      ]}
    >
      <View style={styles.kycThumbWrap}>
        {state.localPreviewUri ? (
          <Image
            source={{ uri: state.localPreviewUri }}
            style={styles.kycThumb}
            resizeMode="cover"
          />
        ) : (
          <Text style={styles.kycThumbPlaceholder}>📷</Text>
        )}
        {state.uploading && (
          <View style={styles.kycThumbOverlay}>
            <ActivityIndicator color={colors.surface} />
          </View>
        )}
      </View>
      <View style={styles.kycCardBody}>
        <Text style={styles.kycCardLabel}>{label}</Text>
        <Text style={styles.kycCardHint}>{hint}</Text>
        {uploaded && !state.error && (
          <Text style={styles.kycCardStatusOk}>
            ✓ Uploaded — tap to replace
          </Text>
        )}
        {state.error && (
          <Text style={styles.kycCardStatusErr}>{state.error}</Text>
        )}
        {!uploaded && !state.error && !state.uploading && (
          <Text style={styles.kycCardStatusEmpty}>Tap to upload</Text>
        )}
      </View>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  autoCapitalize,
  // PR 34 — optional voice attachments. When `voice` is supplied,
  // the field renders a small mic button to the right of the
  // input + an ✨ chip beside the label when `aiFilled` is true.
  // Editing the field clears the chip via the parent's
  // `clearAiMark` handler.
  voice,
  aiFilled,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'phone-pad' | 'number-pad' | 'email-address';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  voice?: {
    languageCode: 'hi-IN' | 'en-IN';
    onTranscript: (transcript: string) => void;
    onError: (errorCode: string, message: string) => void;
  };
  aiFilled?: boolean;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {aiFilled ? (
          <View style={styles.aiChip}>
            <Text style={styles.aiChipText}>✨ AI</Text>
          </View>
        ) : null}
      </View>
      <View
        style={[
          styles.fieldInputRow,
          aiFilled && styles.fieldInputRowAiFilled,
        ]}
      >
        <TextInput
          style={[
            styles.input,
            multiline && styles.inputMultiline,
            voice ? styles.inputWithMic : null,
          ]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          multiline={multiline}
          numberOfLines={multiline ? 3 : 1}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize ?? 'sentences'}
          autoCorrect={false}
        />
        {voice ? (
          <View style={styles.fieldMicWrap}>
            <VoiceInputButton
              languageCode={voice.languageCode}
              mode="single_field"
              size="sm"
              onResult={r => voice.onTranscript(r.transcript)}
              onError={voice.onError}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  intro: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  field: { marginBottom: spacing.md },
  fieldLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
    ...typography.body,
    color: colors.textPrimary,
  },
  inputMultiline: {
    minHeight: 84,
    textAlignVertical: 'top',
    paddingTop: spacing.sm,
  },
  // PR-NEXT-SHOP-LOCATION-REQUIRED — DO NOT REMOVE. Hint above the
  // Continue CTA when the GPS pin hasn't been captured yet. Mirrors
  // the HOTFIX-9 `captureHint` style on CheckoutScreen so the
  // capture-required affordance feels consistent across the app.
  captureHint: {
    ...typography.caption,
    color: colors.warning,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  // 2026-06-02 HOTFIX-FALLBACK-LEAK — DO NOT REMOVE. Inline warning
  // shown when the shared `useCaptureShopLocation` hook returns an
  // error (e.g. locationService falls back to MOCK_USER_LOCATION on
  // permission denied / GPS off, or geocodeAsync returns no
  // results). danger-colored, multi-line.
  captureHintError: {
    ...typography.caption,
    color: colors.danger,
    marginBottom: spacing.md,
    marginTop: -spacing.xs,
  },
  // PR-NEXT-SHOP-LOCATION-EDIT — DO NOT REMOVE. Dual-mode capture
  // UI styles. `captureLabel` is the section header; `captureCtaRow`
  // sits the two CTAs side-by-side; `captureSuccessCard` renders
  // after a successful capture with the resolved address + lat/lng.
  captureLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  captureCtaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  captureCta: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  captureCtaPressed: { opacity: 0.6 },
  captureCtaDisabled: { opacity: 0.4 },
  captureCtaText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
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
  captureSuccessCard: {
    backgroundColor: '#ECFDF5',
    borderColor: colors.success,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  captureSuccessTitle: {
    ...typography.bodyBold,
    color: colors.success,
    marginBottom: spacing.xs,
  },
  captureSuccessLine: {
    ...typography.caption,
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  captureRecaptureBtn: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.success,
  },
  captureRecaptureText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '600',
  },
  helper: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    marginTop: -spacing.xs,
  },
  sectionLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  row: { flexDirection: 'row' },
  // PR 43 — small helper line under the GST upload tile pointing
  // owners without GSTIN to the free gst.gov.in registration. Tight
  // top margin (sits flush under the tile) + negative-ish bottom
  // so it doesn't push the next tile down the screen.
  kycHelper: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  footnote: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.md,
    fontStyle: 'italic',
  },
  // PR 31 — Wizard step indicator + KYC card styles.
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  stepNumber: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  stepNumberActive: { color: colors.surface },
  stepLine: {
    flex: 0,
    width: 48,
    height: 2,
    backgroundColor: colors.border,
    marginHorizontal: spacing.sm,
  },
  kycCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  kycThumbWrap: {
    width: 72,
    height: 72,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  kycThumb: { width: '100%', height: '100%' },
  kycThumbPlaceholder: { fontSize: 28 },
  kycThumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kycCardBody: { flex: 1 },
  kycCardLabel: {
    ...typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  kycCardHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  kycCardStatusOk: {
    ...typography.caption,
    color: colors.success,
    marginTop: spacing.xs,
    fontWeight: '600',
  },
  kycCardStatusErr: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
  },
  kycCardStatusEmpty: {
    ...typography.caption,
    color: colors.primary,
    marginTop: spacing.xs,
    fontWeight: '600',
  },
  // PR 34 — voice + Hindi onboarding styles.
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  fieldInputRow: { flexDirection: 'row', alignItems: 'flex-start' },
  fieldInputRowAiFilled: {
    borderLeftWidth: 3,
    borderLeftColor: '#F0B400',
    paddingLeft: spacing.sm,
    marginLeft: -spacing.sm,
  },
  inputWithMic: { flex: 1 },
  fieldMicWrap: { marginLeft: spacing.sm, paddingTop: 4 },
  aiChip: {
    backgroundColor: '#F0B400',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  aiChipText: {
    ...typography.caption,
    color: '#fff',
    fontWeight: '700',
    fontSize: 11,
  },
  langPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  langPickerLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  langPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  langPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  langPillText: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  langPillTextActive: { color: colors.surface },
  reviewBanner: {
    backgroundColor: '#FFF8E1',
    borderRadius: radii.md,
    borderLeftWidth: 4,
    borderLeftColor: '#F0B400',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  reviewBannerHeading: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    marginBottom: 2,
  },
  reviewBannerTranscript: {
    ...typography.body,
    color: colors.textPrimary,
    fontStyle: 'italic',
    marginBottom: spacing.xs,
  },
  reviewBannerHint: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  reviewBannerError: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
    fontWeight: '600',
  },
});
