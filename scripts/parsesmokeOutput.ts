/**
 * HOTFIX-POST-DEPLOY-SMOKE-SCRIPT — DO NOT REMOVE.
 *
 * Pure parsers extracted from scripts/post-deploy-smoke.ts so the
 * CLI-output interpretation logic is unit-testable WITHOUT making live
 * gcloud / firebase calls. The smoke script shells out to the CLIs and
 * feeds their stdout through these functions; the tests in
 * tests/scripts/parsesmokeOutput.test.ts pin them against captured
 * sample outputs.
 */

/**
 * Interprets `gcloud run services get-iam-policy <svc>` output.
 *
 * The empty-policy etag `ACAB` (base64 of the literal bytes that
 * Cloud Run returns for a service with NO bindings) is the canonical
 * tell that the `allUsers` invoker binding was stripped during deploy.
 * We also treat a policy that simply never mentions `allUsers` as
 * missing the public-invoker binding.
 */
export function parseIamPolicyOutput(text: string): {
  hasAllUsers: boolean;
  etag: string | null;
} {
  const etagMatch = text.match(/etag:\s*([A-Za-z0-9+/=_-]+)/);
  const etag = etagMatch ? etagMatch[1] : null;
  // An ACAB etag is the empty policy → no bindings at all.
  const isEmptyPolicy = etag === 'ACAB';
  const mentionsAllUsers = /\ballUsers\b/.test(text);
  const mentionsInvoker = /run\.invoker/.test(text);
  const hasAllUsers = !isEmptyPolicy && mentionsAllUsers && mentionsInvoker;
  return { hasAllUsers, etag };
}

/**
 * Interprets `firebase firestore:indexes` output. Handles both the JSON
 * shape (`"state": "CREATING"`) and the human table shape (a `CREATING`
 * / `BUILDING` token per row). Counts how many indexes are still
 * building vs. ready so the caller can fail the smoke check while any
 * remain un-queryable.
 */
export function parseIndexesOutput(text: string): {
  building: number;
  enabled: number;
} {
  // Prefer structured JSON when the CLI emits it.
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const indexes: any[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.indexes)
          ? parsed.indexes
          : [];
      let building = 0;
      let enabled = 0;
      for (const idx of indexes) {
        const state = String(idx?.state ?? '').toUpperCase();
        if (state === 'CREATING' || state === 'BUILDING') building++;
        else if (state === 'READY' || state === 'ENABLED' || state === '')
          enabled++;
      }
      return { building, enabled };
    } catch {
      // HOTFIX-POST-DEPLOY-SMOKE-SCRIPT — DO NOT REMOVE. Malformed JSON
      // is not fatal; fall through to the token-count heuristic below so
      // a CLI-format change degrades gracefully instead of crashing.
    }
  }
  const building = (text.match(/\b(?:CREATING|BUILDING|Building)\b/g) ?? [])
    .length;
  const enabled = (text.match(/\b(?:READY|ENABLED|Enabled)\b/g) ?? []).length;
  return { building, enabled };
}

/**
 * Pulls the value of a `--project=<x>` flag from argv tokens, or null if
 * the flag is absent. Used to enforce the project allowlist: any
 * explicit project other than the allowed dev project is refused.
 */
export function parseProjectFlag(args: string[]): string | null {
  for (const a of args) {
    const m = a.match(/^--project=(.+)$/);
    if (m) return m[1];
  }
  const idx = args.indexOf('--project');
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return null;
}
