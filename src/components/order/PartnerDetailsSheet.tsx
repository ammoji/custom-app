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
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
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
  // Phone-reveal state (unchanged from PARTNER-CARD.1).
  partnerPhone?: string | null;
  onRevealPhone?: () => void;
  revealing?: boolean;
  // Live polling state — parent owns the hook (so polling lifecycle
  // is tied to the parent's mount-lifecycle, not the sheet's open
  // state alone).
  live: LivePartnerEtaState;
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
  partnerPhone,
  onRevealPhone,
  revealing,
  live,
}: Props) {
  const isPickedUp = pickedUpAt != null;
  const displayName =
    typeof partnerName === 'string' && partnerName.trim().length > 0
      ? partnerName.trim()
      : 'Your delivery partner';
  const initials = initialsFor(partnerName);
  const firstName = displayName.split(' ')[0];

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

  const stateText = isPickedUp
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
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.trust}>{trust.trustLine}</Text>
        </View>
      </View>
      <Text style={styles.state}>{stateText}</Text>

      <View style={styles.divider} />

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
      {/* Static context rows */}
      <Row label={shopRowLabel} value={shopRowValue} />
      {typeof orderShortId === 'string' && orderShortId.length > 0 && (
        <Row label="Order" value={`#${orderShortId}`} />
      )}

      <View style={styles.divider} />

      {/* REACH — phone reveal / call link / muted pre-pickup copy */}
      {!isPickedUp ? (
        <Text style={styles.phoneMuted}>
          📞 Phone shared once the order is picked up
        </Text>
      ) : typeof partnerPhone === 'string' && partnerPhone.length > 0 ? (
        <Pressable
          onPress={() => {
            Linking.openURL(`tel:${partnerPhone}`).catch(() => {
              // Best-effort — silent on rejection (web preview /
              // no-SIM dev devices) is preferable to a confusing
              // alert. The number text is still visible.
            });
          }}
          style={({ pressed }) => [
            styles.callBtn,
            pressed && { opacity: 0.85 },
          ]}
          accessibilityRole="link"
          accessibilityLabel={`Call ${displayName} at ${partnerPhone}`}
        >
          <Text style={styles.callBtnText}>📞 Call {firstName}</Text>
        </Pressable>
      ) : onRevealPhone ? (
        <Pressable
          onPress={onRevealPhone}
          disabled={revealing === true}
          style={({ pressed }) => [
            styles.revealBtn,
            pressed && { opacity: 0.85 },
            revealing === true && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Show ${displayName}'s phone number`}
        >
          <Text style={styles.revealBtnText}>
            {revealing === true ? 'Loading…' : `📞 Show ${firstName}'s phone`}
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
});
