/**
 * PR 19 — tests for the favorites pure helpers.
 *
 * Validates both the input-validation shape and the toggle-state
 * machine. The cleanup-empty-shop-key case is the one most likely
 * to silently regress in a future refactor (someone "simplifies"
 * the helper and forgets the key delete), so it gets two tests:
 * one for the actual map shape and one for the explicit
 * `favorites.shopId` undefined check.
 */
import { describe, expect, it } from '@jest/globals';
import {
    applyFavoriteToggle,
    validateToggleFavoriteInput,
} from '../../functions/src/favoritesHelpers';

describe('validateToggleFavoriteInput', () => {
  it('rejects unauthenticated callers', () => {
    const r = validateToggleFavoriteInput(null, {
      shopId: 'shop_1',
      menuItemId: 'm_1',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  it('rejects undefined auth', () => {
    const r = validateToggleFavoriteInput(undefined, {
      shopId: 'shop_1',
      menuItemId: 'm_1',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  it('rejects empty shopId', () => {
    const r = validateToggleFavoriteInput(
      { uid: 'u1' },
      { shopId: '', menuItemId: 'm_1' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('rejects non-string menuItemId', () => {
    const r = validateToggleFavoriteInput(
      { uid: 'u1' },
      { shopId: 'shop_1', menuItemId: 42 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('returns ok with valid input', () => {
    const r = validateToggleFavoriteInput(
      { uid: 'u1' },
      { shopId: 'shop_1', menuItemId: 'm_1' },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.shopId).toBe('shop_1');
      expect(r.menuItemId).toBe('m_1');
    }
  });
});

describe('applyFavoriteToggle', () => {
  it('adds first favorite to an undefined map', () => {
    const result = applyFavoriteToggle(undefined, 'shop_1', 'm_1');
    expect(result.isFavorite).toBe(true);
    expect(result.favorites).toEqual({ shop_1: ['m_1'] });
  });

  it('adds first favorite to an empty map', () => {
    const result = applyFavoriteToggle({}, 'shop_1', 'm_1');
    expect(result.isFavorite).toBe(true);
    expect(result.favorites).toEqual({ shop_1: ['m_1'] });
  });

  it('adds favorite to an existing shop array', () => {
    const result = applyFavoriteToggle(
      { shop_1: ['m_1'] },
      'shop_1',
      'm_2',
    );
    expect(result.isFavorite).toBe(true);
    expect(result.favorites).toEqual({ shop_1: ['m_1', 'm_2'] });
  });

  it('removes favorite from an existing array', () => {
    const result = applyFavoriteToggle(
      { shop_1: ['m_1', 'm_2'] },
      'shop_1',
      'm_1',
    );
    expect(result.isFavorite).toBe(false);
    expect(result.favorites).toEqual({ shop_1: ['m_2'] });
  });

  it('deletes shop key when removing the last favorite', () => {
    const result = applyFavoriteToggle({ shop_1: ['m_1'] }, 'shop_1', 'm_1');
    expect(result.isFavorite).toBe(false);
    expect(result.favorites).toEqual({});
    expect(result.favorites.shop_1).toBeUndefined();
  });

  it('does not mutate the input map', () => {
    const input = { shop_1: ['m_1'] };
    applyFavoriteToggle(input, 'shop_1', 'm_2');
    expect(input).toEqual({ shop_1: ['m_1'] });
  });

  it('does not mutate the input shop array on add', () => {
    const innerArr = ['m_1'];
    const input = { shop_1: innerArr };
    applyFavoriteToggle(input, 'shop_1', 'm_2');
    expect(innerArr).toEqual(['m_1']);
  });

  it('handles multiple shops independently', () => {
    const result = applyFavoriteToggle(
      { shop_1: ['m_1'], shop_2: ['m_a'] },
      'shop_2',
      'm_b',
    );
    expect(result.favorites).toEqual({
      shop_1: ['m_1'],
      shop_2: ['m_a', 'm_b'],
    });
  });

  it('removing the last favorite from one shop preserves other shops', () => {
    const result = applyFavoriteToggle(
      { shop_1: ['m_1'], shop_2: ['m_a'] },
      'shop_1',
      'm_1',
    );
    expect(result.isFavorite).toBe(false);
    expect(result.favorites).toEqual({ shop_2: ['m_a'] });
    expect(result.favorites.shop_1).toBeUndefined();
  });

  it('toggle is its own inverse (add then remove returns to start)', () => {
    const start = { shop_1: ['m_1'] };
    const added = applyFavoriteToggle(start, 'shop_1', 'm_2');
    const removed = applyFavoriteToggle(
      added.favorites,
      'shop_1',
      'm_2',
    );
    expect(removed.favorites).toEqual({ shop_1: ['m_1'] });
  });
});
