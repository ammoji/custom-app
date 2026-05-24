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
