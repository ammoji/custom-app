/**
 * PR-NEXT-PARTNER-CARD.2 — pure formatter for the partner sheet's
 * WHO line (rating + delivery count) and vehicle glyph/label. Centralizes
 * the "new partner" fallback so the sheet renders cleanly for
 * pre-rating, pre-claim-denormalization, and unknown-vehicle orders.
 *
 * Pinned by `tests/utils/formatPartnerTrust.test.ts`.
 */

export type PartnerVehicleType = 'motorbike' | 'bicycle' | 'on_foot' | 'car';

export type PartnerTrustInput = {
  ratingAvg: number | null;
  ratingCount: number | null;
  vehicleType: PartnerVehicleType | string | null;
};

export type PartnerTrustDisplay = {
  trustLine: string;
  vehicleIcon: string;
  vehicleLabel: string;
};

const VEHICLE_ICON: Record<string, string> = {
  motorbike: '🛵',
  bicycle: '🚲',
  on_foot: '🚶',
  car: '🚗',
};

const VEHICLE_LABEL: Record<string, string> = {
  motorbike: 'motorbike',
  bicycle: 'bicycle',
  on_foot: 'on foot',
  car: 'car',
};

// Default vehicle when the partner doc has no `vehicleType` set
// (back-compat: existing partners predate the denormalization at
// `claimDelivery` time). Motorbike is the empirical pilot default —
// the onboarding form's first option AND the most common Indian
// last-mile vehicle.
const DEFAULT_VEHICLE = 'motorbike';

export function formatPartnerTrust(input: PartnerTrustInput): PartnerTrustDisplay {
  const vehicleKey =
    typeof input.vehicleType === 'string' && input.vehicleType in VEHICLE_ICON
      ? input.vehicleType
      : DEFAULT_VEHICLE;
  const vehicleIcon = VEHICLE_ICON[vehicleKey];
  const vehicleLabel = VEHICLE_LABEL[vehicleKey];

  // "New partner" fallback fires when:
  //   - ratingCount missing / zero (no completed-delivery ratings yet),
  //   - ratingAvg missing / non-finite (defensive — should not happen
  //     when count > 0 but the doc is shaped by multiple writers).
  // Showing "⭐ 0.0 · 0 deliveries" reads as broken / off-putting; the
  // welcoming copy preserves trust without lying about volume.
  if (
    typeof input.ratingCount !== 'number' ||
    !Number.isFinite(input.ratingCount) ||
    input.ratingCount <= 0 ||
    typeof input.ratingAvg !== 'number' ||
    !Number.isFinite(input.ratingAvg)
  ) {
    return {
      trustLine: '⭐ New partner · welcome them!',
      vehicleIcon,
      vehicleLabel,
    };
  }

  const stars = input.ratingAvg.toFixed(1);
  const delivLabel =
    input.ratingCount === 1 ? '1 delivery' : `${input.ratingCount} deliveries`;
  return {
    trustLine: `⭐ ${stars} · ${delivLabel}`,
    vehicleIcon,
    vehicleLabel,
  };
}
