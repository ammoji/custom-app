/**
 * PR 32 — canonical server-side `CategoryId` whitelist.
 *
 * Why: this set was previously a private constant in
 * `functions/src/index.ts` (line ~4190 pre-PR-32) used only by
 * `addCustomMenuItem`. PR 32 needs the same set in two more places:
 *
 *   - `menuExtractionHelpers.ts` — to render into Claude's system
 *     prompt (the enum the model must pick from) AND to drop any
 *     extracted item whose category isn't in the whitelist.
 *   - `extractMenuFromImage` + `addExtractedMenuItems` callables —
 *     same validation gate `addCustomMenuItem` applies.
 *
 * Duplicating the literal would mean three places to keep in sync
 * with `src/constants/categories.ts` on the client (which is the
 * source of truth for the type). One small shared module is
 * cheaper.
 *
 * Keep this list in sync with `CATEGORIES` /  `CategoryId` in
 * `src/constants/categories.ts`. If a new category is added there,
 * add it here too — the server validation will silently drop
 * extractions categorized into an unknown bucket otherwise.
 */
export const VALID_CATEGORIES = new Set<string>([
  'atta_rice_dal',
  'oil_ghee',
  'dairy_eggs',
  'bakery',
  'masala_spices',
  'snacks_biscuits',
  'beverages',
  'personal_care',
  'household',
  'fruits_vegetables',
]);

/**
 * PR-NEXT-BUNDLE-L — DO NOT REMOVE. Ordered category list + human
 * labels for the printable catalog PDF (`catalogPdfHelpers.ts`).
 * The server has no equivalent of the client's `CATEGORIES` array,
 * and the PDF needs (a) a deterministic page order and (b) a
 * readable header per page ("CATEGORY: Atta, Rice & Dal").
 *
 * MUST stay in sync with `CATEGORIES` in `src/constants/categories.ts`
 * (same source-of-truth caveat as `VALID_CATEGORIES` above). The
 * keys MUST exactly match `VALID_CATEGORIES` — the Bundle L PDF
 * tests pin parity.
 */
export const CATEGORY_LABELS_ORDERED: ReadonlyArray<{
  id: string;
  label: string;
}> = [
  { id: 'atta_rice_dal', label: 'Atta, Rice & Dal' },
  { id: 'oil_ghee', label: 'Oil & Ghee' },
  { id: 'dairy_eggs', label: 'Dairy & Eggs' },
  { id: 'bakery', label: 'Bakery' },
  { id: 'masala_spices', label: 'Masala & Spices' },
  { id: 'snacks_biscuits', label: 'Snacks & Biscuits' },
  { id: 'beverages', label: 'Beverages' },
  { id: 'personal_care', label: 'Personal Care' },
  { id: 'household', label: 'Household' },
  { id: 'fruits_vegetables', label: 'Fruits & Vegetables' },
];

export const CATEGORY_LABELS: Record<string, string> =
  Object.fromEntries(CATEGORY_LABELS_ORDERED.map(c => [c.id, c.label]));

/**
 * PR 32.1 + PR 32.2 — category-themed placeholder image URLs.
 * Used by `addExtractedMenuItems` (PR 32 scan path) and
 * `addCustomMenuItem` (PR 6 manual-add path) when the shop owner
 * adds an item without supplying an `imageUrl`. Single source of
 * truth — both callables import from here. URLs are placehold.co
 * with category emoji + a theme color so a freshly-scanned 60-SKU
 * menu looks intentionally categorized instead of uniformly
 * placeholder-gray (Trust Principle 2).
 *
 * **The `.png` segment in each URL is LOAD-BEARING.** placehold.co
 * serves SVG by default, and React Native's `<Image>` component
 * cannot render SVG natively (only PNG / JPG / GIF / WebP). Without
 * `.png` every placeholder renders as an empty box in the mobile
 * app — silent failure, no error, no Sentry breadcrumb. Discovered
 * during PR 32.1 on-device smoke testing; fixed in PR 32.2.
 *
 * **Position of `.png` matters.** placehold.co's convention is
 * `.png` at the END of the path (right before `?text=`), NOT
 * after the size segment. PR 32.2's first attempt put it after
 * size (`/400x400.png/<bg>/<fg>?text=...`) and on-device smoke
 * showed placeholders still empty — placehold.co still served
 * SVG for that path shape. The corrected form below pins `.png`
 * to the end of the path. **Do not strip `.png` from these URLs**
 * and **do not move it earlier in the path.** See Rule 7 in
 * `.windsurf/code-discipline.md`.
 *
 * Format note: placehold.co accepts `?text=...` with URL-encoded
 * characters; emoji works (UTF-8 percent-encoded). Color tuples
 * are `bgHex/textHex` in the URL path.
 *
 * If placehold.co goes down or rate-limits, the placeholder
 * images break gracefully — the `MenuItem.imageUrl` field still
 * contains a URL, the client's `<Image>` falls back to its own
 * "image failed to load" handling. Worst case: customer sees a
 * blank rectangle instead of a themed one. No crash, no data loss.
 *
 * The 10 keys MUST exactly match the 10 entries in
 * `VALID_CATEGORIES` — `tests/functions/categoryPlaceholders.test.ts`
 * pins this parity. If a future PR adds a new `CategoryId`, add
 * the new entry here too or the test fails.
 */
export const CATEGORY_PLACEHOLDER_URLS: Record<string, string> = {
  // wheat/grain — cream bg, brown text
  atta_rice_dal:
    'https://placehold.co/400x400/F5E6D3/8B4513.png?text=%F0%9F%8C%BE+Atta+%26+Rice',
  // oil bottle — yellow bg, brown text
  oil_ghee:
    'https://placehold.co/400x400/FFF3B0/8B4513.png?text=%F0%9F%AB%92+Oil+%26+Ghee',
  // dairy carton — pale blue bg, dark blue text
  dairy_eggs:
    'https://placehold.co/400x400/E3F2FD/1A237E.png?text=%F0%9F%A5%9B+Dairy+%26+Eggs',
  // bread — beige bg, brown text
  bakery:
    'https://placehold.co/400x400/F5DEB3/8B4513.png?text=%F0%9F%8D%9E+Bakery',
  // spices — light red bg, dark red text
  masala_spices:
    'https://placehold.co/400x400/FFCCBC/BF360C.png?text=%F0%9F%8C%B6+Masala',
  // snacks — light brown bg, dark brown text
  snacks_biscuits:
    'https://placehold.co/400x400/D7CCC8/4E342E.png?text=%F0%9F%8D%AA+Snacks',
  // beverages — peach bg, dark red text
  beverages:
    'https://placehold.co/400x400/FFE0B2/E64A19.png?text=%F0%9F%A5%A4+Beverages',
  // personal care — pale lavender bg, deep purple text
  personal_care:
    'https://placehold.co/400x400/E1BEE7/4A148C.png?text=%F0%9F%A7%B4+Personal+Care',
  // household — pale green bg, dark green text
  household:
    'https://placehold.co/400x400/C8E6C9/1B5E20.png?text=%F0%9F%A7%BD+Household',
  // fresh produce — bright green bg, dark green text
  fruits_vegetables:
    'https://placehold.co/400x400/AED581/1B5E20.png?text=%F0%9F%A5%95+Fruits+%26+Veg',
};

/**
 * PR 32.1 — return the category-themed placeholder URL for a
 * given `CategoryId`. Falls back to the original generic
 * placeholder for any `categoryId` not in the map (defense
 * against future schema drift where a new `CategoryId` is added
 * but the map isn't updated). Pure function, exported so both
 * callables import the same lookup.
 */
export function placeholderImageForCategory(categoryId: string): string {
  return (
    CATEGORY_PLACEHOLDER_URLS[categoryId] ??
    // PR 32.2 — generic fallback also needs `.png` at the END of
    // the path for the same RN-can't-render-SVG reason documented
    // on the map above. Pre-PR-32.2 form (no `.png`) and the
    // intermediate `/400x400.png/...` form both still served SVG.
    'https://placehold.co/400x400/e2e8f0/64748b.png?text=Custom+Item'
  );
}
