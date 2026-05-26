/**
 * PR 32.1 — pure-helper tests for the per-category placeholder
 * lookup. Pin the parity between `VALID_CATEGORIES` (the server-
 * side whitelist used by `addCustomMenuItem` /
 * `addExtractedMenuItems` / `extractMenuFromImage`) and
 * `CATEGORY_PLACEHOLDER_URLS` (the new map the same callables
 * read from when no `imageUrl` was supplied). If a future PR
 * adds a new `CategoryId` to `VALID_CATEGORIES` without adding
 * the corresponding placeholder URL, the parity tests below
 * fail loudly.
 */
import {
  CATEGORY_PLACEHOLDER_URLS,
  VALID_CATEGORIES,
  placeholderImageForCategory,
} from '../../functions/src/categoryConstants';

describe('PR 32.1 — category placeholders', () => {
  test('CATEGORY_PLACEHOLDER_URLS has an entry for every VALID_CATEGORIES id', () => {
    for (const id of VALID_CATEGORIES) {
      expect(CATEGORY_PLACEHOLDER_URLS[id]).toBeDefined();
      expect(CATEGORY_PLACEHOLDER_URLS[id]).toMatch(
        /^https:\/\/placehold\.co\//,
      );
    }
  });

  test('CATEGORY_PLACEHOLDER_URLS has no extra ids beyond VALID_CATEGORIES', () => {
    for (const id of Object.keys(CATEGORY_PLACEHOLDER_URLS)) {
      expect(VALID_CATEGORIES.has(id)).toBe(true);
    }
  });

  test('every URL is a syntactically valid https URL', () => {
    for (const url of Object.values(CATEGORY_PLACEHOLDER_URLS)) {
      expect(() => new URL(url)).not.toThrow();
      expect(url).toMatch(/^https:\/\//);
    }
  });

  test('placeholderImageForCategory returns the right URL for each id', () => {
    for (const id of VALID_CATEGORIES) {
      expect(placeholderImageForCategory(id)).toBe(
        CATEGORY_PLACEHOLDER_URLS[id],
      );
    }
  });

  test('placeholderImageForCategory falls back to the generic placeholder for unknown ids', () => {
    expect(placeholderImageForCategory('not_a_real_category')).toMatch(
      /text=Custom\+Item/,
    );
  });

  test('placeholderImageForCategory falls back to the generic placeholder for empty string', () => {
    expect(placeholderImageForCategory('')).toMatch(/text=Custom\+Item/);
  });
});
