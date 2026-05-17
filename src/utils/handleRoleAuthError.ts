import type { AuthUser } from '../services/authService';

/**
 * Detects "your claim was revoked" type errors (permission-denied,
 * unauthenticated) coming back from a watcher or callable, and
 * refreshes the client's auth state so stale role flags drop. Used
 * by shop / delivery dashboards.
 *
 * Returns true iff the error was recognized AND a claim refresh was
 * attempted. The screen's own role-guard render branch will then
 * show its EmptyState on the next render after the auth store
 * updates — no explicit navigation needed.
 *
 * Why the broad code matching: callable errors arrive prefixed
 * (`functions/permission-denied`) while raw Firestore SDK errors do
 * not (`permission-denied`). Both shapes need to trigger.
 */
export type AuthErrorLike = {
  code?: unknown;
  message?: unknown;
} | null | undefined;

const REVOCATION_CODES = new Set([
  'permission-denied',
  'functions/permission-denied',
  'unauthenticated',
  'functions/unauthenticated',
]);

export function isRoleRevocationError(err: AuthErrorLike): boolean {
  const code = typeof err?.code === 'string' ? err.code : '';
  if (REVOCATION_CODES.has(code)) return true;
  // Fallback: some SDKs put the code only in the message. We match
  // the substring conservatively to avoid false positives on, say,
  // a "permission-denied while creating /orders" message that's
  // actually a Firestore rules issue (not a claim revocation) — but
  // for the dashboards in scope here, both outcomes warrant the
  // same UX (force a claim refresh, let the role-guard render).
  const msg = typeof err?.message === 'string' ? err.message : '';
  // Match both hyphen (HTTP-style: 'permission-denied') and
  // underscore (gRPC-style: 'PERMISSION_DENIED') variants — Firestore
  // and Functions clients have surfaced both shapes historically.
  return /permission[-_]denied|unauthenticated/i.test(msg);
}

export async function handleRoleAuthError(
  err: AuthErrorLike,
  refreshClaims: () => Promise<AuthUser | null>,
  setUser: (u: AuthUser | null) => void,
): Promise<boolean> {
  if (!isRoleRevocationError(err)) return false;
  try {
    const refreshed = await refreshClaims();
    setUser(refreshed);
  } catch (refreshErr) {
    // Refresh itself failed (network blip, signed-out token). Don't
    // throw — the screen's banner is already showing the original
    // error; we did our best. The next watcher tick will retry.
    console.warn(
      '[handleRoleAuthError] refreshClaims failed:',
      refreshErr,
    );
  }
  return true;
}
