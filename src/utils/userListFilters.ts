import type { UserInfo } from '../types';

/**
 * Pure filter+sort helper for the admin UserManagementScreen
 * (Phase 12c). Keeps role-chip logic, search matching, and sort
 * direction in one testable function so the screen stays a thin
 * shim around `useMemo(() => filterAndSortUsers(...))`.
 *
 * `customer` is the absence of any role flag — admin / shopOwner /
 * delivery all false. Anonymous accounts also fall here, since
 * they're customers in the same sense (no special privilege).
 *
 * Search matches both phone and uid substrings, case-insensitive.
 * The match-on-uid path is what the previous screen had, kept so
 * admin can paste a uid from logs.
 *
 * Sort key is `lastSignInAt` ("recency"). Users with no
 * `lastSignInAt` (rare — newly-created service accounts) sort to
 * the END regardless of direction so they don't pollute the
 * "newest" bucket. Within the same key value, sort is stable —
 * the platform's Array.prototype.sort is stable in V8 / Hermes.
 */

export type RoleFilter =
  | 'all'
  | 'admin'
  | 'shopOwner'
  | 'delivery'
  | 'customer';

export type SortDir = 'newest' | 'oldest';

function isCustomer(u: UserInfo): boolean {
  return !u.isAdmin && !u.isShopOwner && !u.isDelivery;
}

function matchesRole(u: UserInfo, role: RoleFilter): boolean {
  switch (role) {
    case 'all':
      return true;
    case 'admin':
      return u.isAdmin === true;
    case 'shopOwner':
      return u.isShopOwner === true;
    case 'delivery':
      return u.isDelivery === true;
    case 'customer':
      return isCustomer(u);
  }
}

function matchesQuery(u: UserInfo, q: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const phone = (u.phoneNumber ?? '').toLowerCase();
  const uid = u.uid.toLowerCase();
  return phone.includes(needle) || uid.includes(needle);
}

export function filterAndSortUsers(
  users: UserInfo[],
  role: RoleFilter,
  sortDir: SortDir,
  query: string,
): UserInfo[] {
  const filtered = users.filter(
    u => matchesRole(u, role) && matchesQuery(u, query),
  );
  // Copy before sort — never mutate caller's array.
  const sorted = filtered.slice();
  sorted.sort((a, b) => {
    const aHas = a.lastSignInAt != null;
    const bHas = b.lastSignInAt != null;
    if (!aHas && !bHas) return 0;
    if (!aHas) return 1; // a goes after b (push nulls to end)
    if (!bHas) return -1;
    const av = a.lastSignInAt as number;
    const bv = b.lastSignInAt as number;
    return sortDir === 'newest' ? bv - av : av - bv;
  });
  return sorted;
}
