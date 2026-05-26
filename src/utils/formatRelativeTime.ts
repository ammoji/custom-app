/**
 * PR 36.1 — Format a future timestamp as a human-friendly relative
 * duration ("Ready in 22 minutes", "Ready in 1 hour 5 minutes",
 * "Ready any moment now", "Ready 15 minutes ago" for past).
 *
 * Pure — no side effects, no `Date.now()` inside. Caller passes
 * `nowMs` so the function is deterministic and unit-testable.
 *
 * Locale: English for v1. The hi-IN version comes when customer-
 * side i18n lands (out of scope per the deferred customer-i18n
 * follow-up logged with PR 34).
 */
export type RelativeTimeResult = {
  primary: string; // "Ready in 22 minutes"
  isPast: boolean; // true if target is now or earlier
  totalMinutes: number; // signed: positive = future, negative = past
};

export function formatRelativeTime(
  targetMs: number,
  nowMs: number,
  options?: { label?: string; pastLabel?: string },
): RelativeTimeResult {
  const label = options?.label ?? 'Ready';
  const pastLabel = options?.pastLabel ?? options?.label ?? 'Ready';
  const deltaMs = targetMs - nowMs;
  const totalMinutes = Math.round(deltaMs / 60_000);

  if (totalMinutes <= 0) {
    if (totalMinutes >= -2) {
      return {
        primary: `${pastLabel} any moment now`,
        isPast: true,
        totalMinutes,
      };
    }
    const ago = Math.abs(totalMinutes);
    if (ago < 60) {
      return {
        primary: `${pastLabel} ${ago} minute${ago === 1 ? '' : 's'} ago`,
        isPast: true,
        totalMinutes,
      };
    }
    const hours = Math.floor(ago / 60);
    const mins = ago % 60;
    const hoursPart = `${hours} hour${hours === 1 ? '' : 's'}`;
    const minsPart =
      mins > 0 ? ` ${mins} minute${mins === 1 ? '' : 's'}` : '';
    return {
      primary: `${pastLabel} ${hoursPart}${minsPart} ago`,
      isPast: true,
      totalMinutes,
    };
  }

  // Future. `totalMinutes < 1` is unreachable here because we
  // already returned for `totalMinutes <= 0`; but if `deltaMs`
  // rounds up from 0–30s to 1 min, we want "less than a minute"
  // for the sub-30s window. Guard via deltaMs directly.
  if (deltaMs < 60_000) {
    return {
      primary: `${label} in less than a minute`,
      isPast: false,
      totalMinutes,
    };
  }
  if (totalMinutes < 60) {
    return {
      primary: `${label} in ${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`,
      isPast: false,
      totalMinutes,
    };
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const hoursPart = `${hours} hour${hours === 1 ? '' : 's'}`;
  const minsPart =
    mins > 0 ? ` ${mins} minute${mins === 1 ? '' : 's'}` : '';
  return {
    primary: `${label} in ${hoursPart}${minsPart}`,
    isPast: false,
    totalMinutes,
  };
}
