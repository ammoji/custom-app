/**
 * PR-NEXT-ENH-1 (finding #4 follow-up) — tests for the smart-label
 * helper that drives `ShopMenuScreen`'s bulk action bar. Pinning
 * here means the screen can rely on the helper without re-asserting
 * the count math via render tests.
 */
import { computeBulkAvailabilityCounts } from '../../src/utils/bulkAvailabilityCounts';
import type { MenuItem } from '../../src/types';

const make = (id: string, available: boolean): MenuItem =>
  ({
    id,
    available,
    // Other MenuItem fields are not read by the helper; cast through.
  } as MenuItem);

describe('computeBulkAvailabilityCounts', () => {
  test('empty selection → both counts 0', () => {
    const items = [make('a', true), make('b', false)];
    const result = computeBulkAvailabilityCounts(items, new Set());
    expect(result).toEqual({ availableCount: 0, unavailableCount: 0 });
  });

  test('all selected available → availableCount = N, unavailableCount = 0', () => {
    const items = [make('a', true), make('b', true), make('c', true)];
    const selected = new Set(['a', 'b', 'c']);
    expect(computeBulkAvailabilityCounts(items, selected)).toEqual({
      availableCount: 3,
      unavailableCount: 0,
    });
  });

  test('all selected unavailable → availableCount = 0, unavailableCount = N', () => {
    const items = [make('a', false), make('b', false), make('c', false)];
    const selected = new Set(['a', 'b', 'c']);
    expect(computeBulkAvailabilityCounts(items, selected)).toEqual({
      availableCount: 0,
      unavailableCount: 3,
    });
  });

  test('mixed selection counts each bucket correctly', () => {
    const items = [make('a', true), make('b', true), make('c', false)];
    const selected = new Set(['a', 'b', 'c']);
    expect(computeBulkAvailabilityCounts(items, selected)).toEqual({
      availableCount: 2,
      unavailableCount: 1,
    });
  });

  test('selected id not present in items list → silently ignored', () => {
    const items = [make('a', true)];
    const selected = new Set(['a', 'phantom']);
    expect(computeBulkAvailabilityCounts(items, selected)).toEqual({
      availableCount: 1,
      unavailableCount: 0,
    });
  });

  test('items present but not in selection → not counted', () => {
    const items = [make('a', true), make('b', false), make('c', true)];
    const selected = new Set(['b']);
    expect(computeBulkAvailabilityCounts(items, selected)).toEqual({
      availableCount: 0,
      unavailableCount: 1,
    });
  });

  test('available is not exactly true (undefined / null / 0) → counts as unavailable (defensive)', () => {
    const items = [
      { id: 'a', available: undefined } as unknown as MenuItem,
      { id: 'b', available: null } as unknown as MenuItem,
      { id: 'c', available: 0 } as unknown as MenuItem,
    ];
    const selected = new Set(['a', 'b', 'c']);
    expect(computeBulkAvailabilityCounts(items, selected)).toEqual({
      availableCount: 0,
      unavailableCount: 3,
    });
  });

  test('empty items list → both counts 0', () => {
    const result = computeBulkAvailabilityCounts([], new Set(['phantom']));
    expect(result).toEqual({ availableCount: 0, unavailableCount: 0 });
  });

  test('order of items does not affect counts', () => {
    const a = [make('a', true), make('b', false)];
    const b = [make('b', false), make('a', true)];
    const selected = new Set(['a', 'b']);
    expect(computeBulkAvailabilityCounts(a, selected)).toEqual(
      computeBulkAvailabilityCounts(b, selected),
    );
  });

  test('returns plain numbers (no NaN / Infinity leaks)', () => {
    const items = [make('a', true), make('b', false)];
    const selected = new Set(['a', 'b']);
    const result = computeBulkAvailabilityCounts(items, selected);
    expect(Number.isFinite(result.availableCount)).toBe(true);
    expect(Number.isFinite(result.unavailableCount)).toBe(true);
  });
});
