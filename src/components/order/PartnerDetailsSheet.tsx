/**
 * PR-NEXT-PARTNER-CARD.2 — full sheet redesign driven by the
 * customer's five questions when they tap "Your delivery partner":
 *
 *   1. Who's bringing my groceries?  → avatar + name + trust line
 *   2. Where are they?               → live distance (30s polled)
 *   3. When will they get here?      → live ETA in minutes from now
 *   4. How do I reach them?          → tap-to-call (post-pickup)
 *   5. What will they look like?     → vehicle icon next to state
 *
 * Sequence of prior shipments:
 *   - PR-NEXT-PARTNER-CARD (Case 6): static read-only sheet, sparse.
 *   - PR-NEXT-PARTNER-CARD.1 (retest): added phone reveal + static
 *     ETA rows, but the reveal callable used `order.customerId`
 *     (non-existent) — every customer reveal failed silently.
 *   - PR-NEXT-PARTNER-CARD.2 (this PR): live distance/ETA via
 *     30s-polling callable, trust signals (rating + count +
 *     vehicle), phone reveal bug fixed, BottomSheet chrome.
 *
 * Fallback ladder (top to bottom = most → least preferred source):
 *   - LIVE: `live.distanceKm` + `live.etaMin` from
 *     `useLivePartnerEta` (server-side haversine + 20 km/h).
 *   - STATIC: `deliveryDistanceKm` + `deliveryDurationMin`
 *     (PR 46-stamped at order placement) — used when the live
 *     callable rejects (no partner GPS yet, legacy order). The
 *     formatter is forced into `stale: true` mode so the "~
 *     estimated" suffix renders.
 *   - NONE: pre-PR-46 orders without static estimates → row shows
 *     em-dash. No alert, no crash.
 *
 * Why this sheet uses scalar props instead of the full `Order`
 * object: parent (`OrderDetailScreen`) already has the order
 * snapshot in memory and passes the handful of fields the sheet
 * actually reads. Keeps the prop surface explicit + easy to grep
 * for callers vs accidentally widening the sheet's read footprint.
 *
 * Privacy posture (unchanged from PARTNER-CARD.1): partner phone
 * is NEVER on the order doc. The `onRevealPhone` prop owns the
 * server round-trip; the sheet only renders the resulting state.
 */
import React from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
// PR-NEXT-5.1 §E — DO NOT REMOVE. Navigation to PartnerReviewsScreen
// from the tappable trust line.
import { useNavigation } from '@react-navigation/native';
// PR-NEXT-PARTNER-PHOTO §F — DO NOT REMOVE. formatPartnerAvatar drives
// the photo-vs-initials avatar branch below (R9 truthy guard is inside
// the helper via kind === 'photo').
import { formatPartnerAvatar } from '../../utils/formatPartnerAvatar';
// PR-NEXT-HOTFIX-7 — DO NOT REMOVE. Shared bottom-sheet chrome
// (Modal + backdrop + safe-area-aware paddingBottom). Replaces the
// hand-rolled per-modal scaffolding that under-padded the gesture-
// nav pill on tall-pill Androids.
import BottomSheet from '../common/BottomSheet';
import { colors, radii, spacing, typography } from '../../constants/theme';
// PR-NEXT-PARTNER-CARD — DO NOT REMOVE. Reuses the same pure
// initials helper that `PartnerIdentityCard` uses, so the sheet's
// avatar glyph stays in lockstep with the card's.
import { initialsFor } from '../../utils/partnerInitials';
// PR-NEXT-PARTNER-CARD.2 — DO NOT REMOVE. The two pure formatters
// own all of the sheet's edge-case copy (under-1min, under-50m,
// new-partner fallback, unknown-vehicle default). The sheet stays
// declarative; any future copy tweak lands in their tests.
import { formatLivePartnerEta } from '../../utils/formatLivePartnerEta';
import {
  formatPartnerTrust,
  type PartnerVehicleType,
} from '../../utils/formatPartnerTrust';
import type { LivePartnerEtaState } from '../../hooks/useLivePartnerEta';
// PR-NEXT-STATIC-MAP-PREVIEW §C — DO NOT REMOVE. Pure URL builder +
// API key accessor for the static map preview slot.
import { buildStaticMapUrl, type LatLng } from '../../utils/buildStaticMapUrl';
import { getGoogleMapsApiKey } from '../../constants/maps';

type Props = {
  visible: boolean;
  onClose: () => void;
  partnerName?: string | null;
  pickedUpAt: number | null;
  shopName?: string | null;
  orderShortId?: string;
  // Static at-order estimates (PR 46). Used as the fallback row
  // value when `live.distanceKm` / `live.etaMin` are null
  // (`failed-precondition` from the server gate, or no fetch yet).
  deliveryDistanceKm?: number | null;
  deliveryDurationMin?: number | null;
  // PR-NEXT-PARTNER-CARD.2 — trust signals denormalized at claim
  // time. All three optional + nullable; the `formatPartnerTrust`
  // helper handles the "new partner / unknown vehicle" fallbacks.
  partnerRating?: number | null;
  partnerDeliveriesCount?: number | null;
  partnerVehicleType?: PartnerVehicleType | null;
  // PR-NEXT-PARTNER-PHOTO §F — denormalized partner face photo URL.
  // Optional: absent on legacy orders / partners who pre-date this PR.
  // Falls back to initials avatar via formatPartnerAvatar.
  partnerPhotoUrl?: string | null;
  // PR-NEXT-BUNDLE-B §B (Finding #10) — one-tap call. `partnerPhone`
  // is still cached in the parent (no change) but the two-step
  // reveal-then-call button is collapsed to a single "Call partner"
  // CTA. `onCallPartner` is the async handler in the parent; it
  // fetches the phone if not yet cached, then opens the dialer in
  // the same tap. `revealing` gates the spinner on the button.
  partnerPhone?: string | null;
  onCallPartner?: () => void;
  revealing?: boolean;
  // Kept for back-compat — the prop is no longer read in the sheet.
  // Parent (OrderDetailScreen) still passes it; we just ignore it.
  onRevealPhone?: () => void;
  // Live polling state — parent owns the hook (so polling lifecycle
  // is tied to the parent's mount-lifecycle, not the sheet's open
  // state alone).
  live: LivePartnerEtaState;
  // PR-NEXT-BUNDLE-A §C (Finding #12a) — DO NOT REMOVE. When
  // order is finalized, the sheet shows static copy instead of a
  // stale live ETA (which would say "Arriving now" because
  // partner→drop distance is ~0 after delivery).
  orderStatus?: string | null;
  // PR-NEXT-STATIC-MAP-PREVIEW §C — shop + drop coords for the map
  // preview. Both optional: absent on legacy orders (pre-PR-49/46).
  // Null → map slot hidden. Parent passes order.shopLocation and
  // order.deliveryLocation directly (no extra callable).
  shopLocation?: LatLng | null;
  dropLocation?: LatLng | null;
  // PR-NEXT-5.1 §E — partner uid for the tappable trust line that
  // opens PartnerReviewsScreen. Optional/nullable: legacy orders or
  // pre-claim states omit it, in which case the trust line is static.
  partnerUid?: string | null;
};

export default function PartnerDetailsSheet({
  visible,
  onClose,
  partnerName,
  pickedUpAt,
  shopName,
  orderShortId,
  deliveryDistanceKm,
  deliveryDurationMin,
  partnerRating,
  partnerDeliveriesCount,
  partnerVehicleType,
  partnerPhotoUrl,
  onCallPartner,
  revealing,
  // onRevealPhone is kept in Props for back-compat but not used here.
  live,
  orderStatus,
  shopLocation,
  dropLocation,
  partnerUid,
}: Props) {
  const nav = useNavigation<any>();
  const isPickedUp = pickedUpAt != null;
  const displayName =
    typeof partnerName === 'string' && partnerName.trim().length > 0
      ? partnerName.trim()
      : 'Your delivery partner';
  const firstName = displayName.split(' ')[0];
  // PR-NEXT-PARTNER-PHOTO §F — discriminated avatar result.
  // `initialsFor` still imported (used by PartnerIdentityCard) — DO NOT REMOVE.
  const avatar = formatPartnerAvatar(partnerName, partnerPhotoUrl ?? null);

  // PR-NEXT-STATIC-MAP-PREVIEW §C — build static map URL. Returns
  // null when shopLocation / dropLocation are absent (legacy orders)
  // or apiKey is not provisioned. JSX branch below guards on null.
  const mapUrl = buildStaticMapUrl({
    shopPin: shopLocation ?? null,
    dropPin: dropLocation ?? null,
    apiKey: getGoogleMapsApiKey(),
  });

  const trust = formatPartnerTrust({
    ratingAvg: partnerRating ?? null,
    ratingCount: partnerDeliveriesCount ?? null,
    vehicleType: partnerVehicleType ?? null,
  });

  // Live values take precedence; static fallbacks kick in when the
  // live callable rejected. `stale: true` is forced for the static
  // path so the "~ estimated" suffix renders — the customer should
  // never read an at-order estimate as "live."
  const liveDistance = live.distanceKm;
  const liveEta = live.etaMin;
  const usingStaticFallback = liveDistance == null && liveEta == null;
  const eta = formatLivePartnerEta({
    distanceKm:
      liveDistance ?? (typeof deliveryDistanceKm === 'number' ? deliveryDistanceKm : null),
    etaMin:
      liveEta ?? (typeof deliveryDurationMin === 'number' ? deliveryDurationMin : null),
    stale: live.stale || usingStaticFallback,
    isPickedUp,
  });

  // PR-NEXT-BUNDLE-A §C — detect finalized order so we can show
  // static copy instead of live ETA rows.
  const isDelivered = orderStatus === 'delivered';
  const isCancelled = orderStatus === 'cancelled';
  const isFinalized = isDelivered || isCancelled;

  // HOTFIX-PARTNER-STATUS-DISPLAY §B — DO NOT REMOVE. Header text now
  // reads its own isFinalized state. The body row below already branches
  // correctly via the same flag; the header was the divergent surface
  // showing "On the way to you" even after delivery. Vehicle icon stays
  // only in the in-flight branches (matches the body row's emoji-only
  // finalized treatment).
  const stateText = isFinalized
    ? isDelivered
      ? `✅ Delivered`
      : `❌ Order cancelled`
    : isPickedUp
      ? `${trust.vehicleIcon} On the way to you`
      : `${trust.vehicleIcon} Heading to the shop`;
  const shopRowLabel = isPickedUp ? 'Picked up from' : 'Picking up at';
  const shopRowValue =
    typeof shopName === 'string' && shopName.trim().length > 0
      ? shopName.trim()
      : 'the shop';

  return (
    // PR-NEXT-HOTFIX-7 — `keyboardAvoid={false}` (no text inputs).
    <BottomSheet visible={visible} onClose={onClose} keyboardAvoid={false}>
      {/* WHO — avatar + name + trust line */}
      <View style={styles.header}>
        {avatar.kind === 'photo' ? (
          // R9: uri is non-empty (formatPartnerAvatar guarantees it for 'photo')
          <Image
            source={{ uri: avatar.uri }}
            style={styles.avatarPhoto}
            accessibilityLabel={`Photo of ${displayName}`}
          />
        ) : (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{avatar.text}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {displayName}
          </Text>
          {/* PR-NEXT-5.1 §E — tappable trust line → PartnerReviewsScreen.
              Only tappable when partnerUid is present (claimed order). */}
          {partnerUid ? (
            <Pressable
              onPress={() => {
                onClose();
                nav.navigate('PartnerReviews', {
                  partnerUid,
                  partnerName: displayName,
                });
              }}
              accessibilityRole="button"
              accessibilityLabel={`View reviews for ${firstName}`}
            >
              <Text style={styles.trust}>{trust.trustLine} ›</Text>
            </Pressable>
          ) : (
            <Text style={styles.trust}>{trust.trustLine}</Text>
          )}
        </View>
      </View>
      <Text style={styles.state}>{stateText}</Text>

      {/* PR-NEXT-STATIC-MAP-PREVIEW §C — static map preview slot.
          Hidden when mapUrl is null (missing coords or key). */}
      {mapUrl && (
        <View style={styles.mapWrap}>
          {/* R9: mapUrl is non-empty (buildStaticMapUrl guarantees) */}
          <Image
            source={{ uri: mapUrl }}
            style={styles.mapImage}
            accessibilityLabel="Map showing shop and delivery location"
          />
          <Text style={styles.mapCaption}>
            <Text style={styles.shopDot}>{'\u25cf '}</Text>
            {'Shop  ·  '}
            <Text style={styles.dropDot}>{'\u25cf '}</Text>
            {'You'}
          </Text>
        </View>
      )}

      <View style={styles.divider} />

      {/* PR-NEXT-BUNDLE-A §C — finalized-order footer replaces the
          live ETA rows. Polling has already been stopped by the
          hook; rendering static copy avoids "Arriving now" on a
          delivered order (partner→drop distance is ~0). */}
      {isFinalized ? (
        <Row
          label="Status"
          value={isDelivered ? '✅ Delivered' : '❌ Order cancelled'}
        />
      ) : (
        <>
          {/* WHEN — live ETA (with em-dash fallback if formatter rejects) */}
          <Row
            label={eta.whenLabel}
            value={eta.whenValue}
            estimated={eta.estimatedSuffix}
          />
          {/* WHERE — live distance; row hides itself when <50m (the WHEN
              copy "Arriving now" carries the signal). */}
          {eta.distanceValue && (
            <Row
              label="Distance"
              value={eta.distanceValue}
              estimated={eta.estimatedSuffix}
            />
          )}
        </>
      )}
      {/* Static context rows */}
      <Row label={shopRowLabel} value={shopRowValue} />
      {typeof orderShortId === 'string' && orderShortId.length > 0 && (
        <Row label="Order" value={`#${orderShortId}`} />
      )}

      <View style={styles.divider} />

      {/* REACH — PR-NEXT-BUNDLE-B §B single one-tap call CTA.
          Pre-pickup: muted copy (unchanged privacy posture).
          Post-pickup: single "Call partner" button — parent
          handler fetches phone if not yet cached, then dials. */}
      {!isPickedUp ? (
        <Text style={styles.phoneMuted}>
          📞 Phone shared once the order is picked up
        </Text>
      ) : onCallPartner ? (
        <Pressable
          onPress={onCallPartner}
          disabled={revealing === true}
          style={({ pressed }) => [
            styles.callBtn,
            pressed && { opacity: 0.85 },
            revealing === true && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Call ${displayName}`}
        >
          <Text style={styles.callBtnText}>
            {revealing === true ? 'Connecting…' : `📞 Call ${firstName}`}
          </Text>
        </Pressable>
      ) : null}

      <Pressable
        onPress={onClose}
        style={({ pressed }) => [
          styles.closeBtn,
          pressed && { opacity: 0.85 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Close partner details"
      >
        <Text style={styles.closeBtnText}>Close</Text>
      </Pressable>
    </BottomSheet>
  );
}

function Row({
  label,
  value,
  estimated,
}: {
  label: string;
  value: string;
  estimated?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
        {estimated ? (
          <Text style={styles.estimatedSuffix}>  ~ estimated</Text>
        ) : null}
      </Text>
    </View>
  );
}

const AVATAR_SIZE = 56;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typography.h2, color: colors.primaryDark },
  // PR-NEXT-PARTNER-PHOTO §F — same circular dimensions as initials avatar.
  avatarPhoto: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  title: { ...typography.h2 },
  trust: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  state: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    marginTop: spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  rowLabel: { ...typography.body, color: colors.textSecondary },
  rowValue: {
    ...typography.bodyBold,
    flex: 1,
    textAlign: 'right',
    marginLeft: spacing.md,
  },
  estimatedSuffix: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '400',
  },
  phoneMuted: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  // Tap-to-call — primary-tinted block button so it reads as the
  // active CTA (vs the phone-link inline style PARTNER-CARD.1 used,
  // which got lost between the rows).
  callBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  callBtnText: { ...typography.bodyBold, color: colors.bg },
  revealBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  revealBtnText: { ...typography.bodyBold, color: colors.primary },
  closeBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.primaryLight,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  closeBtnText: { ...typography.bodyBold, color: colors.primaryDark },
  // PR-NEXT-STATIC-MAP-PREVIEW §C
  mapWrap: { marginVertical: spacing.md },
  mapImage: {
    width: '100%',
    aspectRatio: 2,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  mapCaption: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  shopDot: { color: '#0F9D58' },
  dropDot: { color: '#4285F4' },
});
