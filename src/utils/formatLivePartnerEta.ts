/**
 * PR-NEXT-PARTNER-CARD.2 — pure formatter for the partner sheet's
 * WHEN + Distance rows. Centralizes the edge-case copy so the sheet
 * stays declarative.
 *
 * Pinned by `tests/utils/formatLivePartnerEta.test.ts`. The async
 * polling lifecycle (`useLivePartnerEta`) and the server gate
 * (`getLivePartnerEtaPure`) are separately pinned.
 *
 * Design rules baked into the copy:
 *   - <1 min: don't show "0 min" — say "Arriving now" / "Almost there".
 *   - <50 m: don't show a distance row at all — the WHEN copy
 *     ("Arriving now") carries it.
 *   - >60 min: switch to "X.X hr" so the number stays under 3 digits.
 *   - Stale partner location (>2 min old `currentLocationUpdatedAt`):
 *     same values, but the sheet appends "~ estimated" so the
 *     customer knows we're not freshly tracking.
 */

export type LiveEtaInput = {
  distanceKm: number | null;
  etaMin: number | null;
  // True when the partner's `currentLocationUpdatedAt` is more than
  // 2 minutes old (or when the client is showing static fallback
  // values from `order.deliveryDistanceKm` / `deliveryDurationMin`
  // because the live callable rejected). Either way the customer
  // shouldn't read these as "live".
  stale: boolean;
  // Drives the WHEN label: "Picks up in" pre-pickup vs "Arriving in"
  // post-pickup. Also drives the <1 min copy ("Almost there" pre-
  // pickup vs "Arriving now" post-pickup).
  isPickedUp: boolean;
};

export type LiveEtaDisplay = {
  whenLabel: string;
  whenValue: string;
  // `null` hides the distance row entirely. Used when distance is
  // < 50 m so the customer doesn't see a meaningless "50 m" line
  // immediately followed by "Arriving now" — the WHEN copy already
  // carries the "very close" signal.
  distanceValue: string | null;
  // True → sheet renders a muted "  ~ estimated" suffix after the
  // numeric values so the customer doesn't take stale data as live.
  estimatedSuffix: boolean;
};

const DISTANCE_HIDE_THRESHOLD_KM = 0.05; // 50 m

export function formatLivePartnerEta(input: LiveEtaInput): LiveEtaDisplay {
  const whenLabel = input.isPickedUp ? 'Arriving in' : 'Picks up in';

  // Distance row
  let distanceValue: string | null = null;
  if (
    typeof input.distanceKm === 'number' &&
    Number.isFinite(input.distanceKm) &&
    input.distanceKm > DISTANCE_HIDE_THRESHOLD_KM
  ) {
    distanceValue =
      input.distanceKm < 1
        ? `${Math.round(input.distanceKm * 1000)} m`
        : `${input.distanceKm.toFixed(1)} km`;
  }

  // ETA row
  let whenValue: string;
  if (
    typeof input.etaMin !== 'number' ||
    !Number.isFinite(input.etaMin) ||
    input.etaMin < 0
  ) {
    // No usable signal — em-dash placeholder. Sheet may still render
    // the row with `~ estimated` suffix so the customer sees we're
    // not silently dropping data.
    whenValue = '—';
  } else if (input.etaMin < 1) {
    whenValue = input.isPickedUp ? 'Arriving now' : 'Almost there';
  } else if (input.etaMin < 60) {
    whenValue = `~${Math.round(input.etaMin)} min`;
  } else {
    whenValue = `~${(input.etaMin / 60).toFixed(1)} hr`;
  }

  return {
    whenLabel,
    whenValue,
    distanceValue,
    estimatedSuffix: input.stale,
  };
}
