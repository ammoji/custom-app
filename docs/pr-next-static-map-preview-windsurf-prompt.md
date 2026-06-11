# PR-NEXT-STATIC-MAP-PREVIEW — Static map preview on PartnerDetailsSheet

**Source:** Sudhir's 2026-06-09 e2e finding #12b: *"would like to see the live navigation to know where is my order right now."* Scope locked via pre-design check: **static map preview only** — free Google Static Maps API tier, no recurring cost, no native rebuild. Live moving partner pin deferred until pilot signal demands sub-10m precision.

**Design lens — spatial context the live text can't give:** the customer reads "Arriving in ~7 min · 1.2 km away" and gets a number, but no sense of WHERE 1.2km is from them. A small static map showing shop pin + their drop pin + a straight line gives instant context — they can see their food's coming from "two blocks over" without zooming into a real navigation app.

**Deploy class:** pure client OTA. No callable changes, no schema changes. **Operational prereq before deploy:** enable Static Maps API on `grocery-mvp-dev` GCP project + generate a bundle-ID-restricted API key (5-minute one-time setup by Sudhir).

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root and `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `npm run lint`, `npx eslint`
- `cd functions && npm run build` (compiles TS → lib/, does NOT deploy)
- File edits to files explicitly named in §A–§C below
- New file creation in directories explicitly named in the plan
- Re-running any of the above to verify after fixing an error

You MUST stop and ask before:

- Deploy commands: `firebase deploy …`, `eas update`, `eas build`, `gcloud run …`
- File deletes
- Force-push, rebase, branch ops
- Editing files NOT named in §A–§C
- Adding NEW dependencies not listed in the plan
- Editing `app.config.js` plugin block (native config)
- Storing the API key anywhere except via `expo-constants` from EAS env vars

Default posture: **execute, report at end.** Final summary should include: files changed, test count delta, tsc clean confirmation, any decisions made autonomously, any items deferred.

## Schema audit-grep (Rule 5)

```
grep -rn "PartnerDetailsSheet\|partner sheet" src/components src/screens
grep -rn "order.shopLocation\|order.deliveryLocation" src/types src/screens
grep -rn "GOOGLE_MAPS\|EXPO_PUBLIC\|process.env\|Constants.expoConfig" src
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `order.shopLocation` | `src/types/index.ts:471` | `{ lat, lng }`, stamped at order time by PR 49. Available on every order placed after PR 49. |
| `order.deliveryLocation` | `src/types/index.ts:450` | `{ lat, lng, type, label, addressId? }`, stamped at order time by PR 46. |
| `PartnerDetailsSheet` | `src/components/order/PartnerDetailsSheet.tsx` | Already on BottomSheet chrome (HOTFIX-7) + has photo / trust / ETA layout. PR adds map preview between WHO line and WHEN row. |
| API key strategy | `app.config.js` `extra` block, sourced from `EXPO_PUBLIC_GOOGLE_MAPS_KEY` EAS env var | Same pattern as existing AI feature secrets. Static-Maps-API-restricted key — separate from Distance Matrix key (which stays dormant). |

## Plan

### §A — Pure helper: `buildStaticMapUrl`

`src/utils/buildStaticMapUrl.ts`:

```ts
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
    !shopPin || !Number.isFinite(shopPin.lat) || !Number.isFinite(shopPin.lng) ||
    !dropPin || !Number.isFinite(dropPin.lat) || !Number.isFinite(dropPin.lng) ||
    typeof apiKey !== 'string' || apiKey.length === 0
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
```

Pin with **8 test cases**: full inputs returns URL with expected params; missing shopPin returns null; missing dropPin returns null; missing apiKey returns null; non-finite lat returns null; non-finite lng returns null; default dimensions applied; custom dimensions applied.

### §B — API key wiring

1. **EAS env var:** add `EXPO_PUBLIC_GOOGLE_MAPS_KEY` to `eas.json`'s `production` profile env section. Document in deploy plan that Sudhir must run `eas secret:create --scope project --name EXPO_PUBLIC_GOOGLE_MAPS_KEY --value <key>` before the first build that uses it.
2. **app.config.js:** extend the `extra` block:
   ```js
   extra: {
     // ...existing entries...
     googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? null,
   }
   ```
3. **`src/constants/secrets.ts`** (or wherever existing secret accessors live; grep first): add a getter `getGoogleMapsApiKey(): string | null` that reads `Constants.expoConfig?.extra?.googleMapsApiKey ?? null`.

**No native module changes.** `expo-constants` is already in the dependency tree. The key just needs to be present in `extra` at build time.

### §C — Render the map in PartnerDetailsSheet

In `src/components/order/PartnerDetailsSheet.tsx`, between the WHO line and the WHEN row:

```tsx
import { Image } from 'react-native';
import { buildStaticMapUrl } from '../../utils/buildStaticMapUrl';
import { getGoogleMapsApiKey } from '../../constants/secrets';

// inside the component:
const mapUrl = buildStaticMapUrl({
  shopPin: order.shopLocation ?? null,
  dropPin: order.deliveryLocation
    ? { lat: order.deliveryLocation.lat, lng: order.deliveryLocation.lng }
    : null,
  apiKey: getGoogleMapsApiKey(),
});

// in the JSX, between WHO and WHEN:
{mapUrl && (
  <View style={styles.mapWrap}>
    <Image
      source={{ uri: mapUrl }}
      style={styles.mapImage}
      accessibilityLabel="Map showing shop and delivery location"
    />
    <Text style={styles.mapCaption}>
      <Text style={styles.shopDot}>● </Text>Shop  ·  
      <Text style={styles.dropDot}>● </Text>You
    </Text>
  </View>
)}
```

Styles:
```ts
mapWrap: { marginVertical: spacing.md },
mapImage: {
  width: '100%',
  aspectRatio: 2, // 320x160 ratio
  borderRadius: radii.md,
  backgroundColor: colors.surface, // shows while image loads
},
mapCaption: {
  ...typography.caption,
  color: colors.textSecondary,
  textAlign: 'center',
  marginTop: spacing.xs,
},
shopDot: { color: '#0F9D58' }, // Google green
dropDot: { color: '#4285F4' }, // Google blue
```

**Fallback:** when `mapUrl` is null (missing shopLocation, missing deliveryLocation, missing apiKey, or any malformed input) → map block omitted entirely. Sheet renders the live text ETA + distance row as today — graceful degradation.

### §D — Sheet layout updated

```
┌───────────────────────────────────────┐
│   ━━━━                                │
│                                       │
│   [photo]   Rahul Bhat                │ ← WHO
│            ⭐ 4.8 · 142 deliveries     │
│                                       │
│   🛵 On the way to you                │ ← STATE
│                                       │
│   ┌─────────────────────────────────┐ │ ← NEW: STATIC MAP
│   │     [Static map preview]        │ │
│   │     S ────────── D              │ │
│   └─────────────────────────────────┘ │
│   ● Shop  ·  ● You                    │
│                                       │
│   Arriving in           ~6 min        │ ← WHEN (live)
│   Distance              1.2 km        │ ← WHERE (live)
│   Picking up at      US Shoppers      │
│   Order              #5677-714        │
│                                       │
│   [ 📞 Call Rahul ]                   │ ← REACH (Bundle B)
│   [        Close        ]             │
└───────────────────────────────────────┘
```

Map slot only renders when all inputs available. Order doesn't change otherwise.

---

## Discipline checklist

1. **Rule 1** — all new imports + state reads carry "PR-NEXT-STATIC-MAP-PREVIEW — DO NOT REMOVE" comments.
2. **Rule 2** — N/A (no new hooks).
3. **Rule 5** — schema audit-grep table in header. `order.shopLocation` + `order.deliveryLocation` confirmed at the line numbers cited.
4. **Rule 7** — test fixtures use realistic LatLng values (Faridabad / Ballwin coords, not made-up); fake API key string `'TEST_KEY_DO_NOT_USE'` for tests.
5. **Rule 11** — N/A (no Cloud Run changes).
6. **Rule 13** — N/A (no new modals; map renders inside existing BottomSheet).
7. **Schema-additive only** — no schema changes. The PR reads existing fields.
8. **Test discipline:** **+8 tests** (buildStaticMapUrl pure helper). Suite trajectory 1371 → ~1379 (assuming PARTNER-PHOTO landed first).

## Acceptance checklist

1. Order with both `shopLocation` and `deliveryLocation` set. Customer opens PartnerDetailsSheet. **Map slot renders** between WHO and WHEN sections.
2. Map shows green S marker (shop), blue D marker (drop), blue line between. Two coords visually plausible relative to each other.
3. Caption row reads `● Shop  ·  ● You` with matching colors.
4. **Legacy order** without `shopLocation` (pre-PR 49). Map slot HIDDEN. Sheet renders WHEN/WHERE rows as today. No red box.
5. **Missing API key** (e.g. EAS secret not set during build). Map slot HIDDEN. Sheet otherwise normal. No red box, no Image fetch error.
6. **Image load failure** (e.g. Google Static Maps quota hit, network drop). `<Image>` renders the surface-color background; no broken-image placeholder. Caption row still visible.
7. **Bonus visual check:** the map's straight line gives the customer immediate spatial sense — "shop is northeast of me" or "shop is right next door."
8. Bundle B's "📞 Call Rahul" button remains below the WHEN/WHERE section, unaffected.
9. `npx tsc --noEmit` clean. `npm run test:unit` clean. Suite +8.

## Out of scope

- **Interactive map** (`react-native-maps`). Defer to post-pilot if real customers demand pan/zoom.
- **Live moving partner pin.** Same — defer.
- **Recentering / clustering** when shop and drop are far apart. Google Static Maps auto-fits the path → markers are visible by default. Manual zoom override not needed.
- **Cache the map image** on disk to save quota when sheet is reopened. React Native's `Image` does HTTP-level caching automatically; no extra work needed for pilot scale.
- **Distance Matrix fallback** when the line should follow roads, not "as the crow flies." Stays dormant per PR 46 cost decision.

## Deploy

**Operational prereq (Sudhir, one-time, 5 min):**
1. GCP Console → grocery-mvp-dev → APIs & Services → Library → enable **Maps Static API**
2. Credentials → Create credentials → API key
3. Restrict the key:
   - Application restrictions: Android apps + iOS apps + bundle IDs `com.sudhirdavim.grocerymvp`
   - API restrictions: Maps Static API only (do NOT include Distance Matrix — keep that separate per PR 46)
4. Copy the key value
5. `eas secret:create --scope project --name EXPO_PUBLIC_GOOGLE_MAPS_KEY --value <key>`
6. Verify: `eas secret:list`

**Deploy:**
```
# Native rebuild required — `extra.googleMapsApiKey` is baked at build time
eas build --profile production --platform all

# After build distributes, the OTA is technically optional if Devin's
# changes are all in the bundle. If you need to ship a JS-only patch
# after the build:
eas update --branch production --message "PR-NEXT-STATIC-MAP-PREVIEW map preview on partner sheet"
```

**Note: this PR requires a native build** because `app.config.js extra` is baked at build time, not OTA-overridable. The existing app on the device doesn't have the API key. Plan for a TestFlight + Play Internal Testing distribution cycle.

## Doc trail (Cowork handles post-ship, per Rule W)

- Append finding #12b to `docs/TESTING-FINDINGS-2026-05-30.md` with `✅ SHIPPED in PR-NEXT-STATIC-MAP-PREVIEW`
- Update `CLAUDE.md` In-flight work
- Append `docs/SESSION_LOG.md` paragraph
- Note in PRELAUNCH_CHECKLIST that GCP Maps Static API is now enabled + the key is in EAS secrets
