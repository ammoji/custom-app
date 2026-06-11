/**
 * PR-NEXT-STATIC-MAP-PREVIEW — pure URL builder for Google Static
 * Maps API. Composes a URL displaying shop pin + drop pin + a
 * straight line between them, sized for the PartnerDetailsSheet's
 * map slot.
 *
 * Free tier: 1000 image requests / day under the $200/month free
 * Google Maps credit. Pilot scale (~20 sheet opens/day) is well
 * within free; documented cost trajectory in the prompt header.
 *
 * Returns `null` when ANY required input is missing — caller
 * renders the existing text-only ETA row as fallback. Never throws.
 *
 * Pinned by tests/utils/buildStaticMapUrl.test.ts.
 */

export type LatLng = { lat: number; lng: number };

export type StaticMapInput = {
  shopPin: LatLng | null | undefined;
  dropPin: LatLng | null | undefined;
  apiKey: string | null | undefined;
  /** Pixel dimensions. Defaults tuned for the sheet's map slot. */
  width?: number;
  height?: number;
  /** Display density. Google supports 1 or 2. */
  scale?: 1 | 2;
};

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 160;

export function buildStaticMapUrl(input: StaticMapInput): string | null {
  const { shopPin, dropPin, apiKey } = input;
  if (
    !shopPin ||
    !Number.isFinite(shopPin.lat) ||
    !Number.isFinite(shopPin.lng) ||
    !dropPin ||
    !Number.isFinite(dropPin.lat) ||
    !Number.isFinite(dropPin.lng) ||
    typeof apiKey !== 'string' ||
    apiKey.length === 0
  ) {
    return null;
  }
  const width = input.width ?? DEFAULT_WIDTH;
  const height = input.height ?? DEFAULT_HEIGHT;
  const scale = input.scale ?? 2;
  // markers=color:green|label:S|<lat>,<lng>  → shop pin (green, S)
  // markers=color:blue|label:D|<lat>,<lng>   → drop pin (blue, D)
  // path=color:0x4285F4|weight:3|<lat1>,<lng1>|<lat2>,<lng2>  → straight line
  const params = new URLSearchParams({
    size: `${width}x${height}`,
    scale: String(scale),
    maptype: 'roadmap',
    key: apiKey,
  });
  params.append('markers', `color:green|label:S|${shopPin.lat},${shopPin.lng}`);
  params.append('markers', `color:blue|label:D|${dropPin.lat},${dropPin.lng}`);
  params.append(
    'path',
    `color:0x4285F4|weight:3|${shopPin.lat},${shopPin.lng}|${dropPin.lat},${dropPin.lng}`,
  );
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}
