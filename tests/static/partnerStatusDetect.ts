/**
 * HOTFIX-PARTNER-STATUS-DISPLAY §C — pure detector for the "in-flight
 * only" subtitle bug. Any line containing "On the way" or "Heading to"
 * MUST sit below (within 20 lines) a finalized-status guard
 * (delivered / cancelled / isFinalized / isDelivered / isCancelled) or a
 * derivePartnerCardSubtitle() call. Otherwise it's a two-state subtitle
 * that goes stale after handoff.
 *
 * Shared by partnerStatusAudit.test.ts (the guard) and its detection
 * unit tests. Loose by design — false positives are allowlisted with an
 * inline `partner-status-audit:allow` comment; false negatives ship.
 */

const INFLIGHT = /On the way|Heading to/;
const FINALIZED_GUARD =
  /'delivered'|"delivered"|'cancelled'|"cancelled"|isFinalized|isDelivered|isCancelled|derivePartnerCardSubtitle\(/;
const ALLOW_TOKEN = 'partner-status-audit:allow';
const LOOKBACK = 20;

/** Returns "line N ← <text>" descriptors for each unguarded usage. */
export function findUnguardedInflightStrings(src: string): string[] {
  const violations: string[] = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!INFLIGHT.test(line)) continue;
    if (line.includes(ALLOW_TOKEN)) continue;
    // Skip comment lines — documentation that mentions the copy (e.g.
    // "was two-state, stayed 'On the way' forever") is not a rendered
    // string and must not trip the guard.
    const trimmed = line.trimStart();
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*')
    ) {
      continue;
    }
    const windowStart = Math.max(0, i - LOOKBACK);
    const windowText = lines.slice(windowStart, i + 1).join('\n');
    if (FINALIZED_GUARD.test(windowText)) continue;
    if (windowText.includes(ALLOW_TOKEN)) continue;
    violations.push(`line ${i + 1} ← "${line.trim()}"`);
  }
  return violations;
}
