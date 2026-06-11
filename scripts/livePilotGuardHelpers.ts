/**
 * PR 39.2 — Live-pilot guard. Read by all three reset scripts at
 * startup to refuse deletion when the pilot is live (a real
 * customer has placed a real money order against this Firestore
 * project).
 *
 * Two layers:
 *   1. `parsePilotStatusFlag` — interpret raw Firestore doc data
 *      into a normalized boolean. Strict equality on
 *      `data.isLive === true`; any ambiguity (missing doc,
 *      missing field, truthy non-boolean) resolves to `false`
 *      (safe = pre-pilot). The flag's job is to say YES we're
 *      live; absence of YES means we're not.
 *   2. `evaluateLivePilotGuard` — decide whether to proceed
 *      given the parsed flag + operator's `--i-know-pilot-is-live`
 *      override. Discriminated-union Result; caller maps the
 *      `not-ok` branch to a loud banner + process.exit(1).
 *
 * Read-failure posture (in the glue, NOT this pure helper):
 * fail-CLOSED — treat read errors as if isLive=true. Cost of
 * refusing during a transient outage is "wait + retry";
 * cost of fail-OPEN is potential data loss. The glue lives in
 * the main scripts and is dry-run-smoke-tested per
 * test-discipline.md.
 *
 * Nothing in this file may import firebase-admin — same posture
 * as the other helpers split, so these can be unit-tested
 * without booting the SDK.
 */

// PR 39.2 — DO NOT REMOVE. Used by parsePilotStatusFlag below.
export type ParsePilotStatusInput = unknown;

/**
 * Parse a Firestore doc snapshot's `.data()` (or null if doc
 * doesn't exist) into a normalized isLive boolean.
 *
 * Strict equality: only `data.isLive === true` (boolean) returns
 * true. Missing doc, missing field, string "true", number 1, etc.
 * all resolve to false — the flag's contract is explicit boolean.
 */
export function parsePilotStatusFlag(rawDocData: ParsePilotStatusInput): boolean {
  if (rawDocData == null || typeof rawDocData !== 'object') return false;
  const data = rawDocData as Record<string, unknown>;
  return data.isLive === true;
}

// PR 39.2 — DO NOT REMOVE. Used by evaluateLivePilotGuard below.
export type LivePilotVerdict =
  | { ok: true; reason: 'pilot_not_live' | 'override_acknowledged' }
  | { ok: false; reason: 'pilot_is_live_no_override' };

/**
 * Pure decision: given the parsed flag + operator's explicit
 * override flag, should we proceed with the wipe?
 *
 * Discriminated-union Result — caller maps the `not-ok` branch
 * to a loud banner + process.exit(1). Never throws; the calling
 * glue decides what to do with a refuse verdict.
 */
export function evaluateLivePilotGuard(args: {
  isLive: boolean;
  overrideAcknowledged: boolean;
}): LivePilotVerdict {
  if (!args.isLive) return { ok: true, reason: 'pilot_not_live' };
  if (args.overrideAcknowledged) {
    return { ok: true, reason: 'override_acknowledged' };
  }
  return { ok: false, reason: 'pilot_is_live_no_override' };
}

/**
 * Build the loud refuse banner shown when the guard refuses.
 * Pure function returning a string so it's testable without
 * touching console.log.
 */
export function buildLivePilotRefuseBanner(): string {
  const W = 60;
  const line = '═'.repeat(W);
  const blank = '║' + ' '.repeat(W - 2) + '║';
  const center = (s: string) =>
    '║ ' + s.padEnd(W - 4).slice(0, W - 4) + ' ║';
  return [
    '╔' + line + '╗',
    center('✋ PILOT IS LIVE — RESET REFUSED'),
    '╠' + line + '╣',
    blank,
    center('appConfig/pilotStatus.isLive = true'),
    blank,
    center('This wipe would destroy live customer orders,'),
    center('shop data, or partner ratings. The script is'),
    center('refusing to proceed.'),
    blank,
    center('If you are CERTAIN this is intentional disaster'),
    center('recovery AND you have coordinated with at least'),
    center('one other human, re-run with:'),
    blank,
    center('    --i-know-pilot-is-live'),
    blank,
    center('Otherwise, do nothing. The flag at'),
    center('appConfig/pilotStatus is the canonical signal.'),
    blank,
    '╚' + line + '╝',
  ].join('\n');
}
