# PR 8 — Admin audit log + Bulk menu actions (Windsurf prompt)

## Why this PR exists

Two deferred items grouped because they're both "shop-and-admin
operational maturity" — neither individually justifies a PR but
together they close a coherent gap that real shops + a real admin
need post-launch.

**Part A: Admin audit log.** Currently admin actions
(revoke / suspend / approve / reject / refund / settings change)
write `statusHistory` entries on the affected doc, but there's no
central log. Trust + governance requires "who did what when" to be
auditable in one place. Add `/auditLog/{entryId}` collection +
write helper + admin-only viewer screen.

**Part B: Bulk menu actions.** Shop owners with 50+ items today must
toggle availability one at a time via `ShopMenuScreen`. Add
multi-select mode + a `bulkUpdateMenuAvailability` callable so
"mark all unavailable" (e.g. shop is closed for the day) is one
tap, not 50.

**Note on what's NOT here:** the original draft of PR 8 included
stock auto-decrement on order placement. That was dropped after a
domain review surfaced a real-world mismatch: kirana shops sell
both online (via app) and offline (walk-in customers). Offline
sales aren't tracked in the app. Auto-decrementing only on online
orders would make the in-app stock counts drift higher than
reality over time → app allows orders the shop can't actually
fulfill → forced cancellations + refund flow load. The current
schema's `stock: null` (unlimited) default is the right posture
for kirana: shops manually mark items unavailable via the toggle
when truly out. Revisit stock auto-decrement only if a clear
shop-driven signal emerges post-launch (e.g. a specific shop
asking for it AND committing to manual offline-sale tracking).

Both parts are server + small client work. Single OTA at the end.
JS-only client changes (no new native modules) — OTA will apply
to existing TestFlight builds without a rebuild.

## Read first

- `.windsurf/test-discipline.md` and `.windsurf/deploy-discipline.md`.
- `functions/src/index.ts` — list every admin callable to wire
  audit-log writes into:
  - `revokeShopOwner`, `revokeDelivery`
  - `suspendShop`, `unsuspendShop`
  - `approveShop`, `rejectShop`
  - `approveDeliveryRole`, `rejectDeliveryRole`
  - `cancelPaidOrder` (admin path)
  - `updateShopSettings` (both admin AND shopOwner branches)
  - `updateOrderStatus` (admin-only path; manual override)
  - `cleanupAbandonedOrders` (system actor)
- `functions/src/cancelPaidOrderHelpers.ts` etc — pattern for the
  new pure helpers.
- `src/screens/shop/ShopMenuScreen.tsx` — host for Part B's
  multi-select UI.
- `firestore.rules` — gate the new `/auditLog/{id}` collection
  admin-only read, server-only write.

## Scope (in)

### Part A — Admin audit log

#### A.1 — Schema + rules

New collection `auditLog/{entryId}` with schema:

```ts
type AuditLogEntry = {
  id: string;                 // entry id (auto-generated)
  timestamp: number;          // epoch ms
  actorUid: string;           // who did it
  actorRole: 'admin' | 'shopOwner' | 'system'; // 'system' for cron
  actionType: string;         // canonical action name (see below)
  targetType: 'shop' | 'user' | 'order' | 'delivery_request' | 'refund';
  targetId: string;
  targetSummary?: string;     // denormalized (e.g. "Sharma Kirana Store")
                              // for display without an extra lookup
  reason?: string;            // user-supplied reason if applicable
  metadata?: Record<string, unknown>; // action-specific extras
};
```

`actionType` enum (string literals — keep stable for audit history):

- `'shop.approve' | 'shop.reject' | 'shop.suspend' | 'shop.unsuspend' | 'shop.update_settings'`
- `'user.revoke_shop_owner' | 'user.revoke_delivery'`
- `'delivery_request.approve' | 'delivery_request.reject'`
- `'order.cancel_paid' | 'order.cancel_by_customer_window' | 'order.cancel_abandoned'`
- `'order.manual_status_update'` (admin override via updateOrderStatus)

Firestore rule:
```
match /auditLog/{entryId} {
  allow read: if isAdmin();
  allow write: if false; // server-only via Admin SDK
}
```

Single-field index on `timestamp DESC` (Firestore auto-creates
this; add to `firestore.indexes.json` only if you find
`audit:indexes` complains — which it shouldn't for single-field
indexes).

#### A.2 — Pure helper + write wrapper

New file `functions/src/auditLogHelpers.ts`:

```ts
/**
 * Pure helper to build an audit log entry. Callable wrappers
 * compose this into their existing transaction / batch / standalone
 * write. The audit write is intentionally non-blocking — if Firestore
 * is unavailable we log and continue; we don't reject the underlying
 * action just because the audit write failed (would be a worse outcome
 * for the user).
 */
export type AuditLogInput = {
  actorUid: string;
  actorRole: 'admin' | 'shopOwner' | 'system';
  actionType: string;
  targetType: 'shop' | 'user' | 'order' | 'delivery_request' | 'refund';
  targetId: string;
  targetSummary?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export function buildAuditLogEntry(
  input: AuditLogInput,
  now: number = Date.now(),
): {
  id: string;
  doc: Record<string, unknown>;
} { ... }
```

Tests in `tests/functions/auditLogHelpers.test.ts` (≥6 cases):
- Builds entry with all fields populated
- Generates a unique id per call
- Omits optional fields cleanly (reason / metadata / targetSummary)
- Uses injected `now` for deterministic timestamps
- Preserves metadata structure (objects, arrays, nested)
- Rejects invalid actorRole / targetType (TS type-narrow; runtime
  validation only if string union slips through — defensive case)

Server-side helper in index.ts (or a thin wrapper file):

```ts
async function writeAuditLog(input: AuditLogInput): Promise<void> {
  try {
    const { id, doc } = buildAuditLogEntry(input);
    await db.collection('auditLog').doc(id).set(doc);
  } catch (e) {
    console.warn('[auditLog] write failed (non-fatal):', e);
    // Don't throw — the audit write failing should not block the
    // underlying action. Worst case: gap in the audit history.
    // Acceptable for MVP; revisit if compliance requires hard
    // guarantees (e.g. SOC2 audit).
  }
}
```

#### A.3 — Wire into every admin callable

For each callable listed in "Read first", add `await
writeAuditLog({...})` at the end of the success path. Pass:

- `actorUid: auth.uid`
- `actorRole: 'admin'` for admin-only callables;
  `'shopOwner'` for `updateShopSettings` shop-owner branch;
  `'system'` for `cleanupAbandonedOrders`
- `actionType`: matching the canonical enum
- `targetType` + `targetId`: the affected resource
- `targetSummary`: denormalized name (e.g. shop name, user phone)
  for display without an extra lookup
- `reason`: from input if user supplied one
- `metadata`: action-specific extras
  - `shop.update_settings`: `{ before: {...}, after: {...} }`
  - `order.cancel_paid`: `{ amount, refundId }`
  - `user.revoke_shop_owner`: `{ shopIdAffected }`
  - etc.

Important: `writeAuditLog` is `await`ed for ordering but its catch
block swallows errors. The action succeeds even if audit write
fails.

#### A.4 — Admin viewer screen

New screen `src/screens/admin/AuditLogScreen.tsx`:

- Polls a new callable `listRecentAuditEntries({ limit?: number, before?: number })`
  every 60s (low priority; admin only opens occasionally)
- Renders flat list, newest first
- Each row shows: timestamp (relative + absolute), action type with
  human-readable label, actor uid (or denormalized name if
  available), target summary, reason if any
- Tap row → expands to show metadata JSON
- Empty state: "No audit entries yet"
- Pagination: "Load more" button at bottom, calls
  `listRecentAuditEntries({ before: oldestTimestamp })`
- Pull-to-refresh same pattern as AdminOrdersScreen

New callable `listRecentAuditEntries` — admin-only, returns up to
50 entries ordered by timestamp desc. Cursor-based pagination
via `before` timestamp.

Navigation: add an "📜 Audit log" tile on HomeScreen admin section
(below the existing "🏪 All Shops" tile). Register the route in
`AppNavigator.tsx` as `AuditLog: undefined`.

For Part A no need to backfill historical entries — the audit log
starts from PR 8 deploy. Prior admin actions live in statusHistory
on affected docs.

### Part B — Bulk menu actions

#### B.1 — Server callable

New callable `bulkUpdateMenuAvailability({ menuItemIds: string[], available: boolean })`:

- Auth: shopOwner only, scoped to claims.shopId
- Validation:
  - `menuItemIds` is non-empty array, max 100 items per call
  - All ids are strings
  - `available` is boolean
- Transactional update: for each id, verify it belongs to the
  caller's shop (security: prevent owner from toggling another
  shop's items even if they know the ids), then update availability
- Returns `{ updatedCount: number, skippedCount: number }` where
  skipped = ids that didn't match the caller's shop or didn't exist

Pure helper `functions/src/bulkMenuHelpers.ts`:

```ts
export type BulkMenuInput = {
  auth: { uid: string; token?: { shopOwner?: unknown; shopId?: unknown } } | null;
  menuItemIds: unknown;
  available: unknown;
};

export type BulkMenuResult =
  | {
      ok: true;
      shopId: string;
      validIds: string[];
      available: boolean;
    }
  | {
      ok: false;
      code: 'unauthenticated' | 'permission-denied' | 'invalid-argument';
      message: string;
    };

export function validateBulkMenuRequest(input: BulkMenuInput): BulkMenuResult { ... }
```

Tests in `tests/functions/bulkMenuHelpers.test.ts` (≥8 cases):
- Unauthenticated → unauthenticated
- Non-shop-owner caller → permission-denied
- Missing menuItemIds → invalid-argument
- Empty array → invalid-argument
- Non-array → invalid-argument
- Non-string ids inside array → invalid-argument
- > 100 ids → invalid-argument (max cap)
- Non-boolean available → invalid-argument
- Happy path: 5 ids, available=false → ok with all 5 in validIds

#### B.2 — Client UI in ShopMenuScreen

- Add a "Select" mode toggle button in the header (next to or
  replacing existing filter chips when selecting)
- In select mode:
  - Each row gets a checkbox at the leading edge
  - Tapping a row toggles selection (instead of navigating to
    edit)
  - Header shows count: "3 selected"
- Bottom sticky action bar appears with two buttons:
  - "Mark X items unavailable" (red/secondary variant)
  - "Mark X items available" (primary)
  - Disabled when 0 selected
- Tap an action → confirm dialog ("Mark 3 items unavailable?") →
  callable → on success, refresh menu list + exit select mode
- "Cancel selection" button (or X icon in header) exits select
  mode without changes

Client method `orderService.bulkUpdateMenuAvailability({ menuItemIds, available })`.

#### B.3 — Audit log integration (cross-cutting)

The bulk callable also writes an audit log entry — `actionType:
'shop.bulk_menu_availability'` with metadata
`{ count: validIds.length, available }`. This isn't strictly an
admin action (shop owner is acting on their own shop) but is
useful for "did the shop accidentally mark everything unavailable
at 3am?" diagnostics. ActorRole = 'shopOwner'.

Add `'shop.bulk_menu_availability'` to the actionType enum in Part
A.

## Scope (out — explicitly defer)

- **Stock auto-decrement** (dropped from original draft, see
  "Why this PR exists" rationale). Revisit only with a clear
  shop-driven signal post-launch.
- **Audit log retention policy / archive.** MVP keeps everything;
  Firestore is cheap. Revisit at 10k entries.
- **CSV export of audit log.** Useful but post-launch.
- **Audit log search / filter by action type.** MVP lists by
  timestamp desc; add filtering when log gets noisy.
- **Bulk DELETE menu items.** PR 8 supports bulk availability
  toggle only (most common need). Delete is per-item to avoid
  catastrophic fat-finger. Revisit if requested.
- **Bulk price update.** Same reasoning — too risky for a single
  tap.
- **Per-action stock-tracking on / off toggle** per shop. With
  Part A dropped, this becomes moot.

## Acceptance checklist

- [ ] `auditLogHelpers.ts` exists with `buildAuditLogEntry`. ≥6
      tests.
- [ ] `writeAuditLog` wrapper in index.ts swallows errors
      (non-fatal).
- [ ] All admin callables write audit entries on success:
      `revokeShopOwner`, `revokeDelivery`, `suspendShop`,
      `unsuspendShop`, `approveShop`, `rejectShop`,
      `approveDeliveryRole`, `rejectDeliveryRole`, `cancelPaidOrder`,
      `updateShopSettings` (both branches), `updateOrderStatus`
      (admin path), `cleanupAbandonedOrders` (system actor).
      Plus `bulkUpdateMenuAvailability` from Part B.
- [ ] `auditLog` Firestore rule exists (admin read, server-only
      write).
- [ ] `AuditLogScreen` created + routed + "📜 Audit log" admin
      tile on HomeScreen.
- [ ] `listRecentAuditEntries` callable added (admin-only,
      cursor-paginated).
- [ ] `bulkMenuHelpers.ts` with `validateBulkMenuRequest`. ≥8
      tests.
- [ ] `bulkUpdateMenuAvailability` callable + client method.
- [ ] `ShopMenuScreen` multi-select mode + bottom action bar.
- [ ] `npm test` passes — total ≥ baseline + ~14 new tests.
- [ ] Deliberate-break demo: pick ONE high-stakes helper (suggest
      `validateBulkMenuRequest` — weaken the shopOwner-claim check
      from `!== true` to `!`). Confirm a specific test fails by
      name (the "truthy-but-not-true" strict-equality test that's
      become the canonical demo target for this codebase).
- [ ] `npx tsc --noEmit` — 0 new errors (baseline unchanged).
- [ ] `npm run audit:indexes` passes.

## Deploy plan (hand to user — NOT executed)

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Rules (new auditLog collection)
firebase deploy --only firestore:rules --project grocery-mvp-dev

# 2. Functions — many touched (~13 callables get audit writes +
#    2 new callables: bulkUpdateMenuAvailability + listRecentAuditEntries).
#    Bulk deploy is fine here; no callables are removed so no
#    interactive delete prompt.
firebase deploy --only functions --project grocery-mvp-dev
firebase functions:list --project grocery-mvp-dev

# 3. OTA — straight to production. JS-only client changes, no
#    new native modules. Will apply to existing TestFlight build.
eas update --branch production --message "PR 8: admin audit log + bulk menu actions"
```

Smoke tests on production phone:

1. **Audit log writes**: as admin, suspend a shop → open Audit Log
   screen → confirm entry appears with action `shop.suspend`,
   target = shop name, reason text.
2. **Audit log paging**: scroll to bottom of audit log → tap
   "Load more" → older entries appear.
3. **Audit log non-admin read denied**: from Firestore Console as
   a non-admin user → try to read `/auditLog` → rules deny.
4. **Bulk availability toggle**: ShopMenu → tap "Select" → check
   3 items → tap "Mark 3 items unavailable" → confirm → all 3 flip
   to unavailable, select mode exits, list reflects new state.
5. **Bulk on another shop's items rejected**: from a dev script,
   call `bulkUpdateMenuAvailability` with `menuItemIds` from a
   shop you don't own → expect skippedCount = N, updatedCount = 0
   (or all-rejected with permission-denied; verify spec behavior).
6. **Bulk action audit entry**: after the bulk toggle, open Audit
   Log → entry for `shop.bulk_menu_availability` with count + the
   target shop id.

## Reporting back

- Output of `npm test`.
- Output of `npx tsc --noEmit` (error count, baseline vs new).
- Deliberate-break demo: test name that failed, file/line you
  weakened, confirmation of revert.
- New files + line counts.
- Per-callable notes on the audit-log wiring (any callable that
  was harder than expected to instrument).
- The deploy commands handed back — NOT executed.

## Design notes for Windsurf

- The audit log write is intentionally non-fatal. A Firestore
  outage during the audit write should not break the user-visible
  action. Comment + tests should make this explicit.
- The `actionType` strings are part of the audit's stable contract.
  Treat them like an API: don't rename them in the future. New
  action types are fine; renames break historical search.
- The bulk callable's "skippedCount" return field is intentional —
  the UX should distinguish "all 5 toggled" from "3 toggled, 2
  silently skipped because they don't exist anymore." Surface the
  skip count to the user on the confirmation toast if non-zero.
- For Part B, the multi-select UI should reuse existing styles
  where possible. The bottom action bar is a new pattern; mirror
  PaymentStatusBanner's positioning posture if a sticky element
  exists, or position absolute with safe-area padding.
- Auto-formatter foot-gun: `buildAuditLogEntry`, `writeAuditLog`,
  `validateBulkMenuRequest` are all new imports likely to be
  stripped on save. The AddCustomMenuItem regression from PR 6 is
  the cautionary tale — verify imports survived after EVERY save
  with `grep -E "buildAuditLogEntry|writeAuditLog|validateBulkMenuRequest"`.
- The `listRecentAuditEntries` callable should NOT return
  `metadata` containing user-identifying info (phone numbers, full
  addresses, etc.) — keep the audit log itself complete, but the
  list endpoint can return a redacted-summary view if any field is
  sensitive. For PR 8 there's nothing especially sensitive, but
  worth a one-line comment in the callable so future contributors
  remember this concern.
