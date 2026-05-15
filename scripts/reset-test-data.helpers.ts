/**
 * Pure helpers for scripts/reset-test-data.ts.
 *
 * Split into its own module so the high-stakes logic (project
 * allowlist guard, admin-UID protection, flag parser, deletion plan
 * builder) can be unit-tested without booting firebase-admin or
 * reading service-account.json. The main script imports from here;
 * tests import from here too. Nothing in this file may import
 * firebase-admin — that's the whole point of the split.
 *
 * This module is the *only* defence between an absent-minded
 * keystroke and a production wipe, so every helper here favours
 * "throw loudly" over "best effort." If a guard is unsure, it
 * aborts.
 */

// -------------------------------------------------------------------
// Project allowlist
// -------------------------------------------------------------------

/**
 * Projects this script is allowed to operate on. Hardcoded — never
 * accept the allowlist from a flag or env var, that's the whole point
 * of an allowlist. If you really need to wipe a different project,
 * edit this array in a separate, reviewable commit.
 */
export const ALLOWED_PROJECTS = ['grocery-mvp-dev'] as const;
export type AllowedProject = (typeof ALLOWED_PROJECTS)[number];

/**
 * Throws if `projectId` is not in `ALLOWED_PROJECTS`. The error
 * message is operator-friendly — it's what the user sees if they
 * accidentally point the script at prod.
 */
export function assertProjectAllowed(
  projectId: string | undefined | null,
): asserts projectId is AllowedProject {
  if (!projectId) {
    throw new Error(
      'REFUSING TO RUN. Could not detect project ID from the Admin SDK.\n' +
        'This script only runs against: ' +
        ALLOWED_PROJECTS.join(', ') +
        '\nCheck service-account.json — it must include "project_id".',
    );
  }
  if (!(ALLOWED_PROJECTS as readonly string[]).includes(projectId)) {
    throw new Error(
      `REFUSING TO RUN. Detected project: ${projectId}.\n` +
        `This script only runs against: ${ALLOWED_PROJECTS.join(', ')}\n` +
        'If you really need to wipe a different project, edit the\n' +
        'ALLOWED_PROJECTS constant in scripts/reset-test-data.helpers.ts\n' +
        'and commit a separate change for review.',
    );
  }
}

// -------------------------------------------------------------------
// Admin UID protection
// -------------------------------------------------------------------

/**
 * Filter `adminUid` out of a list of UIDs. Returns the remaining
 * UIDs that are safe to delete.
 *
 * Throws if:
 *   - `adminUid` is empty (caller forgot to set ADMIN_PROTECT_UID)
 *   - `uids` is non-empty but `adminUid` is not in it (caller set
 *     the wrong UID — bailing prevents accidentally deleting the
 *     real admin if they happen to be in the list under a different
 *     UID)
 *
 * An empty input list is fine — there's nothing to filter and
 * nothing to protect, so we return [] silently.
 */
export function protectAdminFromUserList(
  uids: string[],
  adminUid: string,
): string[] {
  if (!adminUid) {
    throw new Error(
      'REFUSING TO RUN. ADMIN_PROTECT_UID env var must be set to the UID\n' +
        'of the admin account that should NOT be deleted. Find your UID in\n' +
        'Firebase Console → Authentication → Users. Then run:\n' +
        '  $env:ADMIN_PROTECT_UID="abc123..."',
    );
  }
  if (uids.length === 0) return [];
  if (!uids.includes(adminUid)) {
    throw new Error(
      `REFUSING TO RUN. ADMIN_PROTECT_UID is set to "${adminUid}", but no\n` +
        'record with that UID exists in the input list. Either the UID is\n' +
        'wrong, or the admin account has already been deleted. Either way,\n' +
        'operator should investigate before proceeding.',
    );
  }
  return uids.filter(u => u !== adminUid);
}

// -------------------------------------------------------------------
// CLI flag parser
// -------------------------------------------------------------------

export type ResetFlags = {
  execute: boolean;
  keepShops: boolean;
  keepOrders: boolean;
  noConfirm: boolean;
  /** Override for ADMIN_PROTECT_UID env var. */
  adminUid: string | null;
};

/**
 * Parse the script's argv into a typed flag bag.
 *
 * Recognised flags:
 *   --execute              actually delete (default: dry-run)
 *   --keep-shops           preserve /shops and their menu subcollections
 *   --keep-orders          preserve /orders
 *   --no-confirm           skip interactive confirmation (CI use)
 *   --admin-uid=<uid>      override ADMIN_PROTECT_UID env var
 *
 * Validation:
 *   - `--no-confirm` without `--execute` is an error — there's
 *     nothing to confirm in dry-run, so passing it stand-alone
 *     almost certainly means the operator meant to pass --execute
 *     too and we should refuse rather than silently no-op.
 *   - Unknown flags are an error — typos like `--keep-shop` (no s)
 *     would otherwise silently fall through to "delete everything,"
 *     which is the worst possible default for this script.
 *
 * Pure: only reads argv, no env, no fs. Caller threads ADMIN_PROTECT_UID
 * in via the env reader separately so this function stays unit-testable.
 */
export function parseFlags(argv: string[]): ResetFlags {
  const flags: ResetFlags = {
    execute: false,
    keepShops: false,
    keepOrders: false,
    noConfirm: false,
    adminUid: null,
  };

  for (const raw of argv) {
    if (raw === '--execute') {
      flags.execute = true;
    } else if (raw === '--keep-shops') {
      flags.keepShops = true;
    } else if (raw === '--keep-orders') {
      flags.keepOrders = true;
    } else if (raw === '--no-confirm') {
      flags.noConfirm = true;
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
          '  --execute, --keep-shops, --keep-orders, --no-confirm,\n' +
          '  --admin-uid=<uid>',
      );
    }
  }

  if (flags.noConfirm && !flags.execute) {
    throw new Error(
      '--no-confirm requires --execute. There is nothing to confirm in\n' +
        'dry-run mode, so passing --no-confirm without --execute is\n' +
        'almost certainly a typo. Refusing to proceed.',
    );
  }

  return flags;
}

// -------------------------------------------------------------------
// Deletion plan
// -------------------------------------------------------------------

export type CollectionCounts = {
  orders: number;
  shops: number;
  menu: number;
  users: number;
  authUsers: number;
};

export type DeletionPlan = {
  orders: number;
  shops: number;
  menu: number;
  users: number;
  authUsers: number;
  /** True if this plan would delete zero rows across all phases. */
  isNoOp: boolean;
};

/**
 * Compute how many docs each phase would delete, given the current
 * collection counts and the flag bag. This is the "what would be
 * deleted" preview used by both the dry-run output AND the real
 * --execute confirmation prompt — same numbers, both paths.
 *
 * --keep-shops zeroes out shops + menu (you can wipe orders/users/
 * auth without touching the catalog of shops).
 * --keep-orders zeroes out orders (rare; debugging a stuck order
 * while everything else gets reset).
 *
 * Users / auth are always wiped (minus the protected admin) — there
 * is no --keep-users flag because there's no real scenario where
 * you'd want to preserve test user accounts during a reset.
 */
export function buildDeletionPlan(
  counts: CollectionCounts,
  opts: Pick<ResetFlags, 'keepShops' | 'keepOrders'>,
): DeletionPlan {
  const orders = opts.keepOrders ? 0 : counts.orders;
  const shops = opts.keepShops ? 0 : counts.shops;
  const menu = opts.keepShops ? 0 : counts.menu;
  const users = counts.users;
  const authUsers = counts.authUsers;
  return {
    orders,
    shops,
    menu,
    users,
    authUsers,
    isNoOp: orders + shops + menu + users + authUsers === 0,
  };
}
