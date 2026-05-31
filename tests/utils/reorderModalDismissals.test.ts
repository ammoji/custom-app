/**
 * PR-NEXT-8 §A.2 (finding #14) — pin the dismissable-✕ contract for
 * the Reorder modal's Unavailable rows.
 *
 * The repo doesn't currently host `@testing-library/react-native`,
 * so per the PR prompt's fallback we ship the pin via the small
 * pure helpers in `src/utils/reorderModalDismissals.ts` rather than
 * mounting the modal in a test renderer. The semantics under test
 * are: the dismissal-set update is immutable + idempotent, and
 * `buildPlanKey` produces a stable string identity for plans with
 * identical contents.
 */

import {
  addDismissedId,
  buildPlanKey,
} from '../../src/utils/reorderModalDismissals';

describe('PR-NEXT-8 — addDismissedId', () => {
  test('adds a new id and returns a fresh Set instance', () => {
    const initial = new Set<string>();
    const next = addDismissedId(initial, 'menu_a');
    expect(next).not.toBe(initial); // reference must change for React setState
    expect(next.has('menu_a')).toBe(true);
    expect(initial.has('menu_a')).toBe(false); // input unmutated
  });

  test('idempotent: re-dismissing the same id returns the SAME instance', () => {
    // Saves a spurious re-render — React's setState is reference-
    // compared, so returning the same set tells React "nothing
    // changed; skip the render."
    const s = new Set<string>(['menu_a']);
    const next = addDismissedId(s, 'menu_a');
    expect(next).toBe(s);
  });

  test('preserves prior dismissals when adding a new id', () => {
    const s = new Set<string>(['menu_a', 'menu_b']);
    const next = addDismissedId(s, 'menu_c');
    expect(Array.from(next).sort()).toEqual(['menu_a', 'menu_b', 'menu_c']);
  });

  test('null id is a no-op (returns input set unchanged)', () => {
    const s = new Set<string>(['menu_a']);
    expect(addDismissedId(s, null)).toBe(s);
  });

  test('undefined id is a no-op', () => {
    const s = new Set<string>();
    expect(addDismissedId(s, undefined)).toBe(s);
  });

  test('empty string is a no-op (defensive: empty menuItemId would never dismiss)', () => {
    const s = new Set<string>();
    expect(addDismissedId(s, '')).toBe(s);
  });

  test('chaining: three sequential dismissals accumulate without stomping', () => {
    let s = new Set<string>();
    s = addDismissedId(s, 'a');
    s = addDismissedId(s, 'b');
    s = addDismissedId(s, 'c');
    expect(s.size).toBe(3);
    expect(s.has('a') && s.has('b') && s.has('c')).toBe(true);
  });
});

describe('PR-NEXT-8 — buildPlanKey', () => {
  test('null plan → null key (matches React effect-deps null pass-through)', () => {
    expect(buildPlanKey(null)).toBeNull();
  });

  test('undefined plan → null key', () => {
    expect(buildPlanKey(undefined)).toBeNull();
  });

  test('plans with identical shopId + line ids produce identical keys', () => {
    // The whole point of this helper: parent screen may re-create
    // the plan object across renders. The dismissal-reset effect
    // must NOT fire on those re-creations; identical contents must
    // hash to identical keys.
    const a = {
      shopId: 'shop_1',
      lines: [{ menuItemId: 'm1' }, { menuItemId: 'm2' }],
    };
    const b = {
      shopId: 'shop_1',
      lines: [{ menuItemId: 'm1' }, { menuItemId: 'm2' }],
    };
    expect(buildPlanKey(a)).toBe(buildPlanKey(b));
  });

  test('different shopId → different key', () => {
    const a = { shopId: 'shop_1', lines: [{ menuItemId: 'm1' }] };
    const b = { shopId: 'shop_2', lines: [{ menuItemId: 'm1' }] };
    expect(buildPlanKey(a)).not.toBe(buildPlanKey(b));
  });

  test('different line set → different key (so re-opening for a different reorder DOES reset dismissals)', () => {
    const a = {
      shopId: 'shop_1',
      lines: [{ menuItemId: 'm1' }, { menuItemId: 'm2' }],
    };
    const b = {
      shopId: 'shop_1',
      lines: [{ menuItemId: 'm1' }, { menuItemId: 'm3' }],
    };
    expect(buildPlanKey(a)).not.toBe(buildPlanKey(b));
  });

  test('line order matters (defensive: should not collide for same set in different order)', () => {
    // The picker preserves source-order from the past order; we
    // pin the contract so a future refactor that reorders lines
    // is forced to think about whether dismissals should reset.
    const a = {
      shopId: 'shop_1',
      lines: [{ menuItemId: 'm1' }, { menuItemId: 'm2' }],
    };
    const b = {
      shopId: 'shop_1',
      lines: [{ menuItemId: 'm2' }, { menuItemId: 'm1' }],
    };
    expect(buildPlanKey(a)).not.toBe(buildPlanKey(b));
  });

  test('missing lines field → empty line component, still stable', () => {
    const a = { shopId: 'shop_1' };
    const b = { shopId: 'shop_1', lines: [] };
    expect(buildPlanKey(a)).toBe(buildPlanKey(b));
    expect(buildPlanKey(a)).toBe('shop_1:');
  });

  test('missing shopId → empty shop component, still stable', () => {
    expect(buildPlanKey({ lines: [{ menuItemId: 'm1' }] })).toBe(':m1');
  });
});
