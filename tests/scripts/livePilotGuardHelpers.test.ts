/**
 * PR 39.2 — pure-helper tests for `scripts/livePilotGuardHelpers.ts`.
 *
 * 11 cases total:
 *   7 for parsePilotStatusFlag
 *   4 for evaluateLivePilotGuard
 *
 * No tests for buildLivePilotRefuseBanner — pure constant-output
 * formatter; manual inspection is sufficient per the spec.
 */
import {
  evaluateLivePilotGuard,
  parsePilotStatusFlag,
} from '../../scripts/livePilotGuardHelpers';

describe('parsePilotStatusFlag', () => {
  test('null → false (doc does not exist)', () => {
    expect(parsePilotStatusFlag(null)).toBe(false);
  });

  test('undefined → false', () => {
    expect(parsePilotStatusFlag(undefined)).toBe(false);
  });

  test('{} → false (doc exists but no isLive field)', () => {
    expect(parsePilotStatusFlag({})).toBe(false);
  });

  test('{ isLive: true } → true (the only true case)', () => {
    expect(parsePilotStatusFlag({ isLive: true })).toBe(true);
  });

  test('{ isLive: false } → false', () => {
    expect(parsePilotStatusFlag({ isLive: false })).toBe(false);
  });

  test('{ isLive: "true" } → false (strict equality; string truthy ≠ boolean true)', () => {
    expect(parsePilotStatusFlag({ isLive: 'true' })).toBe(false);
  });

  test('{ isLive: 1 } → false (strict equality; numeric truthy ≠ boolean true)', () => {
    expect(parsePilotStatusFlag({ isLive: 1 })).toBe(false);
  });
});

describe('evaluateLivePilotGuard', () => {
  test('isLive=false, override=false → ok pilot_not_live', () => {
    expect(
      evaluateLivePilotGuard({ isLive: false, overrideAcknowledged: false }),
    ).toEqual({ ok: true, reason: 'pilot_not_live' });
  });

  test('isLive=false, override=true → ok pilot_not_live (override irrelevant when not live)', () => {
    expect(
      evaluateLivePilotGuard({ isLive: false, overrideAcknowledged: true }),
    ).toEqual({ ok: true, reason: 'pilot_not_live' });
  });

  test('isLive=true, override=false → not-ok pilot_is_live_no_override', () => {
    expect(
      evaluateLivePilotGuard({ isLive: true, overrideAcknowledged: false }),
    ).toEqual({ ok: false, reason: 'pilot_is_live_no_override' });
  });

  test('isLive=true, override=true → ok override_acknowledged', () => {
    expect(
      evaluateLivePilotGuard({ isLive: true, overrideAcknowledged: true }),
    ).toEqual({ ok: true, reason: 'override_acknowledged' });
  });
});
