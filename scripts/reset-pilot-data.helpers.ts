/**
 * Pure helpers for `scripts/reset-pilot-data.ts`.
 *
 * Companion to `scripts/reset-test-data.helpers.ts`. The other one
 * protects against an accidental full nuke (orders + shops + users
 * + auth — "nuke from orbit"). This one protects against an
 * accidental keep-users-only nuke ("clean app, same testers"
 * mode used between pilot phases / before demos).
 *
 * Same safety posture as the existing helpers — never read
 * project IDs from flags, never trust an empty admin UID — but
 * a different deletion plan: 11 collections wiped, `users` and
 * `aiFeatures` preserved, role claims revoked from non-admin
 * users so the app doesn't try to route them to a deleted shop
 * on next sign-in.
 *
 * Nothing in this file may import `firebase-admin` — the entire
 * point of the split is to keep the dangerous logic unit-testable
 * without booting the SDK. The main script does the wiring.
 */

// PR 36.2 — re-export the allowlist + assertion + admin-protection
// helper from the existing reset-test-data helpers so the pilot
// script and the test-data script share a single source of truth
// for which projects can be wiped + how the admin UID is shielded.
// If you ever need to expand the allowlist (almost certainly you
// don't), edit `reset-test-data.helpers.ts` once and both scripts
// pick it up.
export {
  ALLOWED_PROJECTS,
  assertProjectAllowed,
  protectAdminFromUserList,
  type AllowedProject,
} from './reset-test-data.helpers';

// -------------------------------------------------------------------
// Flag parser
// -------------------------------------------------------------------

export type ResetPilotFlags = {
  /** Actually delete. Default: dry-run (planning only). */
  execute: boolean;
  /** Skip the interactive "type DELETE" confirmation. */
  yes: boolean;
  /** Omit Storage cleanup; useful in tests + Firestore-only resets. */
  skipStorage: boolean;
  /** Override for `ADMIN_PROTECT_UID` env var. */
  adminUid: string | null;
};

/**
 * Parse argv into a typed flag bag.
 *
 * Recognised flags:
 *   --execute              actually delete (default: dry-run)
 *   --yes                  skip the typed-DELETE confirmation
 *   --skip-storage         omit Storage cleanup (Firestore only)
 *   --admin-uid=<uid>      override ADMIN_PROTECT_UID env var
 *
 * Unknown flags throw — typos like `--exec` would otherwise
 * silently fall through to "dry-run" which (in this script) is
 * harmless but masks operator confusion. Mirror reset-test-data's
 * "throw on unknown" stance.
 *
 * `--yes` without `--execute` throws too: there's nothing to
 * confirm in dry-run, so the combo is almost certainly a missing
 * `--execute`. Refusing here surfaces the typo early.
 */
export function parseFlags(argv: string[]): ResetPilotFlags {
  const flags: ResetPilotFlags = {
    execute: false,
    yes: false,
    skipStorage: false,
    adminUid: null,
  };

  for (const raw of argv) {
    if (raw === '--execute') {
      flags.execute = true;
    } else if (raw === '--yes') {
      flags.yes = true;
    } else if (raw === '--skip-storage') {
      flags.skipStorage = true;
    } else if (raw.startsWith('--admin-uid=')) {
      const v = raw.slice('--admin-uid='.length).trim();
      if (!v) {
        throw new Error(
          'Bad flag: --admin-uid= requires a value, e.g. --admin-uid=abc123',
        );
      }
      flags.adminUid = v;
    } else {
      throw new Error(
        `Unknown flag: "${raw}". Recognised flags:\n` +
          '  --execute, --yes, --skip-storage, --admin-uid=<uid>',
      );
    }
  }

  if (flags.yes && !flags.execute) {
    throw new Error(
      '--yes requires --execute. There is nothing to confirm in\n' +
        'dry-run mode, so passing --yes without --execute is almost\n' +
        'certainly a typo. Refusing to proceed.',
    );
  }

  return flags;
}

// -------------------------------------------------------------------
// Collections to wipe
// -------------------------------------------------------------------

/**
 * The Firestore collections this script deletes. Order doesn't
 * actually matter for correctness because we wipe every entry —
 * there are no FK-style references that would dangle. Listed
 * alphabetically for stability + diff-friendliness.
 *
 * NOT in this list (kept intentionally):
 *   - `users`        — keep all auth + profile data so testers can
 *                      sign back in fresh.
 *   - `aiFeatures`   — keep kill-switch docs (`menuExtraction`,
 *                      `voiceOnboarding`) so the AI features stay
 *                      on/off as configured across resets.
 *
 * If a future PR introduces a new top-level collection (e.g.,
 * `khata` when PR 37 un-defers, or a new analytics rollup), add
 * it here. The unit tests pin "users not in list" + "aiFeatures
 * not in list" as the two load-bearing exclusions; everything
 * else is additive.
 */
export const COLLECTIONS_TO_WIPE = [
  'aiAuditLog',
  'aiQuotas',
  'auditLog',
  'deliveryRequests',
  'featureUsageLog',
  'orders',
  'pendingShopRequests',
  'products',
  'razorpayWebhookEvents',
  'refunds',
  // `shops` includes nested `menu/` subcollections — main script
  // descends into each shop's menu before deleting the parent.
  'shops',
] as const;

export type WipeCollectionName = (typeof COLLECTIONS_TO_WIPE)[number];

/**
 * Collections we deliberately do NOT wipe. Pinned in a unit test
 * against `COLLECTIONS_TO_WIPE` so a future "let me also clean up
 * users" patch fails CI loudly.
 */
export const PROTECTED_COLLECTIONS = ['users', 'aiFeatures'] as const;

// -------------------------------------------------------------------
// Storage paths to wipe
// -------------------------------------------------------------------

/**
 * Storage prefixes wiped when `--skip-storage` is not set.
 *
 *   - `shop-kyc/` — PR 31 KYC document uploads (Aadhaar / shop
 *                    photo / GST registration certificate scans)
 *   - `menu/`      — PR 6.1 menu item image uploads
 *
 * Service account JSON keys, function deploy artifacts, and any
 * Firebase-managed paths are intentionally not touched.
 */
export const STORAGE_PATHS_TO_WIPE = ['shop-kyc/', 'menu/'] as const;

// -------------------------------------------------------------------
// User role-claim cleanup planning
// -------------------------------------------------------------------

/**
 * Minimum shape of a `users/{uid}` doc snapshot that this planner
 * needs. Other fields on the real doc (`displayName`, `phoneNumber`,
 * `createdAt`, …) are irrelevant — we never delete the user, only
 * scrub their role fields.
 */
export type UserDocSnapshot = {
  uid: string;
  isShopOwner?: boolean;
  isDelivery?: boolean;
  shopId?: string | null;
};

/**
 * Given the `users` collection snapshot + the admin UID, return:
 *   - `uidsToClean`: non-admin UIDs that have at least one
 *     role/shop field set and therefore need their Firestore
 *     fields scrubbed AND their Auth custom claims rewritten.
 *   - `fieldsToRemove`: the canonical 4-tuple of fields the
 *     main script will delete from each `users/{uid}` doc.
 *
 * Throws if `adminUid` is empty — better to abort here than to
 * accidentally include the admin in the cleanup list. Empty input
 * list is fine (no users yet → nothing to clean).
 */
export function planUserRoleCleanup(
  users: UserDocSnapshot[],
  adminUid: string,
): {
  uidsToClean: string[];
  fieldsToRemove: ReadonlyArray<
    'isShopOwner' | 'isDelivery' | 'shopId' | 'favorites'
  >;
} {
  if (!adminUid) {
    throw new Error(
      'planUserRoleCleanup: adminUid required.\n' +
        'Set ADMIN_PROTECT_UID env var or pass --admin-uid=<uid>.',
    );
  }

  const uidsToClean = users
    .filter(u => u.uid !== adminUid)
    .filter(
      u =>
        u.isShopOwner === true ||
        u.isDelivery === true ||
        (u.shopId !== null && u.shopId !== undefined),
    )
    .map(u => u.uid);

  // Always the same 4 fields. Returning a constant keeps the
  // main script and the unit tests aligned on which fields
  // belong to "role state" — if a future PR adds a new field
  // (e.g., `isWholesaleBuyer`), update here + the test.
  const fieldsToRemove = [
    'isShopOwner',
    'isDelivery',
    'shopId',
    'favorites',
  ] as const;

  return { uidsToClean, fieldsToRemove };
}

// -------------------------------------------------------------------
// Custom-claim rewrite planning
// -------------------------------------------------------------------

/**
 * Compute the new custom-claims object for a user whose role
 * is being revoked. Preserves any `admin: true` claim (so a
 * second admin who happens to be in the list isn't downgraded
 * by accident — defence in depth on top of the adminUid filter).
 * Drops `shopOwner`, `shopId`, and `delivery` claims unconditionally.
 *
 * Returning `null` would clear ALL claims via
 * `setCustomUserClaims(uid, null)`; we instead return an object
 * (possibly empty) so the admin claim survives.
 */
export function buildClaimsAfterRoleRevoke(
  current: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  if (current && current.admin === true) {
    next.admin = true;
  }
  return next;
}
