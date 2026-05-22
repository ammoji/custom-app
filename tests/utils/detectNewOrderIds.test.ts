/**
 * Pure-helper tests for `detectNewOrderIds` (PR 16 — shop owner
 * new-order alert).
 *
 * Pinned because the picker drives the visual + haptic alert that
 * makes new orders impossible-to-miss. False positives (showing
 * orders as "new" that weren't) erode shopkeeper trust; false
 * negatives (missing genuine new orders) defeat the purpose of the
 * feature entirely.
 */
import { detectNewOrderIds } from '../../src/utils/detectNewOrderIds';

describe('detectNewOrderIds', () => {
  test('returns empty set on first tick (previouslySeen=null)', () => {
    // First-tick baseline: ALL existing orders are already known
    // implicitly. Surfacing 20 "new" orders the second the
    // dashboard opens is the wrong UX.
    const result = detectNewOrderIds(['o1', 'o2', 'o3'], null);
    expect(result.size).toBe(0);
  });

  test('returns empty set when no new orders since last tick', () => {
    const seen = new Set(['o1', 'o2']);
    const result = detectNewOrderIds(['o1', 'o2'], seen);
    expect(result.size).toBe(0);
  });

  test('returns the new orders since last tick', () => {
    const seen = new Set(['o1', 'o2']);
    const result = detectNewOrderIds(['o1', 'o2', 'o3', 'o4'], seen);
    expect(result.size).toBe(2);
    expect(result.has('o3')).toBe(true);
    expect(result.has('o4')).toBe(true);
  });

  test('does not include disappeared orders as new', () => {
    const seen = new Set(['o1', 'o2', 'o3']);
    const result = detectNewOrderIds(['o1', 'o2'], seen);
    // o3 vanished from current — not "new", just gone (cancelled
    // server-side, archived, or moved out of the visible window).
    expect(result.size).toBe(0);
  });

  test('handles all-new (rare but possible — empty seen set)', () => {
    const seen = new Set<string>();
    const result = detectNewOrderIds(['o1', 'o2'], seen);
    expect(result.size).toBe(2);
  });

  test('handles empty current list', () => {
    const seen = new Set(['o1']);
    const result = detectNewOrderIds([], seen);
    expect(result.size).toBe(0);
  });

  test('does not mutate inputs', () => {
    // Defensive: the helper should never mutate the caller's
    // inputs. Mutating `seen` would corrupt the dashboard's state
    // baseline; mutating `current` would re-order the FlatList.
    const seen = new Set(['o1']);
    const current = ['o1', 'o2'];
    detectNewOrderIds(current, seen);
    expect(current).toEqual(['o1', 'o2']);
    expect(seen.has('o1')).toBe(true);
    expect(seen.size).toBe(1);
  });
});
