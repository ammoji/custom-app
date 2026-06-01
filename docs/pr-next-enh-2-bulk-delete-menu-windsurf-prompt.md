# PR-NEXT-ENH-2 — Bulk delete from shopkeeper menu

**Source:** Finding #5 follow-up in `docs/TESTING-FINDINGS-2026-05-30.md`: *"I still don't see option to do bulk delete for items. When I select an item, it give mark available or mark unavailable only."*

PR-NEXT-4 shipped unified soft-delete via `removeMenuItem` (single item, asymmetric behavior fix). The shopkeeper can already delete one item at a time from the edit screen. This PR adds the bulk delete path that closes finding #5's testing observation.

**Dependency:** Assumes **ENH-1** (smart bulk-action labels) has shipped first. ENH-1 establishes the smart-label render pattern + the `computeBulkAvailabilityCounts` helper extraction; ENH-2 adds the third action (Delete) to that bar. If you draft / ship ENH-2 before ENH-1, the bar would have three buttons fighting for space without ENH-1's no-op hiding logic.

**Deploy class:** server-first + client OTA.

1. `firebase deploy --only "functions:bulkRemoveMenuItems"`
2. IAM check on `bulkremovemenuitems` (recurring `allUsers` strip gotcha — new callable, will need the binding from scratch)
3. `eas update --branch production`

**Read first**

1. `CLAUDE.md` (full)
2. `docs/TESTING-FINDINGS-2026-05-30.md` — finding #5 entry + test result follow-up
3. `docs/pr-next-4-menu-management-windsurf-prompt.md` — parent PR that introduced the soft-delete pattern via `deletedAt`
4. `docs/pr-next-enh-1-smart-bulk-labels-windsurf-prompt.md` — ENH-1's smart-label render pattern this PR extends with the Delete button
5. `.windsurf/code-discipline.md` (Rules 1, 2, 3)
6. `.windsurf/deploy-discipline.md` — Cloud Run IAM verification
7. `functions/src/bulkMenuHelpers.ts` — pure validator template (this PR mirrors with a variant that doesn't require `available`)
8. `functions/src/index.ts` lines 2239–2330 — `bulkUpdateMenuAvailability` callable (template for the new bulk callable)
9. `functions/src/index.ts` lines 6584–6620 — `removeMenuItem` callable (template for the per-item soft-delete write: `deletedAt: serverTimestamp(), available: false, updatedAt: serverTimestamp()`)
10. `src/screens/shop/ShopMenuScreen.tsx` — modify the bulk action bar (post-ENH-1 state)

---

## Plan

### §A — Server: `bulkRemoveMenuItems` callable + pure validator

Files touched:

- `functions/src/bulkRemoveMenuHelpers.ts` (new) — §A.1
- `functions/src/index.ts` (new callable export) — §A.2
- `tests/functions/bulkRemoveMenuHelpers.test.ts` (new) — §A.3

#### §A.1 — Pure validator (mirror `validateBulkMenuRequest`, minus the `available` field)

```ts
/**
 * PR-NEXT-ENH-2 (finding #5 follow-up) — pure validator for
 * `bulkRemoveMenuItems`. Mirrors `validateBulkMenuRequest` from
 * `bulkMenuHelpers.ts` but doesn't require the `available` field
 * (the delete write is unconditional).
 *
 * Same 100-id cap, same shopOwner + shopId claim posture, same
 * non-empty-string check on every id. Pinned by
 * `tests/functions/bulkRemoveMenuHelpers.test.ts`.
 */

export const BULK_REMOVE_MAX_IDS = 100;

export type BulkRemoveInput = {
  auth:
    | {
        uid: string;
        token?: { shopOwner?: unknown; shopId?: unknown };
      }
    | null
    | undefined;
  menuItemIds: unknown;
};

export type BulkRemoveResult =
  | {
      ok: true;
      shopId: string;
      validIds: string[];
    }
  | {
      ok: false;
      code: 'unauthenticated' | 'permission-denied' | 'invalid-argument';
      message: string;
    };

export function validateBulkRemoveRequest(
  input: BulkRemoveInput,
): BulkRemoveResult {
  const { auth } = input;
  if (!auth || typeof auth.uid !== 'string' || auth.uid.length === 0) {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    };
  }
  if (auth.token?.shopOwner !== true) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Only shop owners can bulk-delete menu items',
    };
  }
  const shopId = auth.token?.shopId;
  if (typeof shopId !== 'string' || shopId.length === 0) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Shop owner claim is missing shopId',
    };
  }
  if (!Array.isArray(input.menuItemIds) || input.menuItemIds.length === 0) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'menuItemIds must be a non-empty array',
    };
  }
  if (input.menuItemIds.length > BULK_REMOVE_MAX_IDS) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: `Too many ids — max ${BULK_REMOVE_MAX_IDS} per call`,
    };
  }
  const validIds: string[] = [];
  for (const raw of input.menuItemIds) {
    if (typeof raw !== 'string' || raw.length === 0) {
      return {
        ok: false,
        code: 'invalid-argument',
        message: 'All menuItemIds must be non-empty strings',
      };
    }
    validIds.push(raw);
  }
  return { ok: true, shopId, validIds };
}
```

#### §A.2 — Callable export (mirror `bulkUpdateMenuAvailability`, swap the batch write to soft-delete)

Insert near the existing `bulkUpdateMenuAvailability` (around line 2239) so the two bulk callables sit side-by-side.

```ts
import { validateBulkRemoveRequest } from './bulkRemoveMenuHelpers';

/**
 * PR-NEXT-ENH-2 (finding #5 follow-up) — bulk soft-delete menu items.
 * Same shape as `bulkUpdateMenuAvailability`: chunk-query the shop's
 * menu subcollection, batch-write the soft-delete per matched doc,
 * return `{deletedCount, skippedCount}`. Already-deleted items are
 * idempotent (re-deleting just refreshes `deletedAt`).
 *
 * Soft-delete write matches `removeMenuItem` exactly:
 *   - deletedAt: serverTimestamp()
 *   - available: false
 *   - updatedAt: serverTimestamp()
 *
 * Order history is unaffected — `CartItem` snapshots name / price /
 * imageUrl at order time, no live read of the menu doc.
 */
export const bulkRemoveMenuItems = onCall<{ menuItemIds: string[] }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    const check = validateBulkRemoveRequest({
      auth: auth
        ? {
            uid: auth.uid,
            token: auth.token as unknown as {
              shopOwner?: unknown;
              shopId?: unknown;
            },
          }
        : null,
      menuItemIds: request.data?.menuItemIds,
    });
    if (!check.ok) {
      throw new HttpsError(check.code, check.message);
    }
    const { shopId, validIds } = check;

    // Chunk + match against the shop's own subcollection — same shape
    // as bulkUpdateMenuAvailability. Soft-deleted items already get
    // `deletedAt` so a future caller passing those ids hits the
    // `deletedAt != null` skip below.
    const CHUNK = 30;
    const menuRef = db.collection(`shops/${shopId}/menu`);
    const matchedIds: string[] = [];
    for (let i = 0; i < validIds.length; i += CHUNK) {
      const chunk = validIds.slice(i, i + CHUNK);
      // eslint-disable-next-line no-await-in-loop
      const snap = await menuRef
        .where(FieldPath.documentId(), 'in', chunk)
        .get();
      for (const doc of snap.docs) {
        const data = doc.data() as { deletedAt?: unknown };
        // Skip already-deleted: re-flagging would be harmless but
        // skews `deletedCount` upward in a way that confuses the
        // shopkeeper UI.
        if (data.deletedAt != null) continue;
        matchedIds.push(doc.id);
      }
    }

    if (matchedIds.length > 0) {
      const batch = db.batch();
      for (const id of matchedIds) {
        batch.update(menuRef.doc(id), {
          deletedAt: FieldValue.serverTimestamp(),
          available: false,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }

    const deletedCount = matchedIds.length;
    const skippedCount = validIds.length - matchedIds.length;

    // Best-effort audit log; non-fatal. Mirrors bulkUpdateMenuAvailability's
    // posture.
    await writeAuditLog({
      action: 'bulkRemoveMenuItems',
      uid: auth!.uid,
      shopId,
      payload: {
        requestedCount: validIds.length,
        deletedCount,
        skippedCount,
      },
    }).catch(e =>
      console.warn('[bulkRemoveMenuItems] audit log failed (non-fatal):', e),
    );

    return { deletedCount, skippedCount };
  },
);
```

#### §A.3 — Pure helper tests

Mirror `tests/functions/bulkMenuHelpers.test.ts` exactly, minus the `available` field cases. Target ~12 cases:

1. unauth → error
2. no shopOwner claim → permission-denied
3. shopOwner without shopId → permission-denied
4. shopOwner with empty-string shopId → permission-denied
5. menuItemIds not an array → invalid-argument
6. menuItemIds empty array → invalid-argument
7. menuItemIds over the 100 cap → invalid-argument
8. menuItemIds with a non-string entry → invalid-argument
9. menuItemIds with an empty-string entry → invalid-argument
10. happy path → ok with validIds + shopId
11. caller may hold both admin + shopOwner — shopOwner path wins
12. exactly 100 ids → ok (boundary)

---

### §B — Client: third button on the bulk action bar

Files touched:

- `src/services/orderService.ts` (new method) — §B.1
- `src/screens/shop/ShopMenuScreen.tsx` (modify) — §B.2

#### §B.1 — Service method

Add to `orderService` near `bulkUpdateMenuAvailability`:

```ts
async bulkRemoveMenuItems(input: {
  menuItemIds: string[];
}): Promise<{ deletedCount: number; skippedCount: number }> {
  // Mirror the existing RNFB callable wrapper style for
  // bulkUpdateMenuAvailability — copy the local pattern.
}
```

(Match the exact callable-invocation idiom already in use; don't introduce a new one.)

#### §B.2 — UI integration

Two parts: handler + render.

**Handler** — add to `ShopMenuScreen.tsx` alongside `handleBulkSetAvailability`:

```tsx
// PR-NEXT-ENH-2 (finding #5 follow-up) — bulk soft-delete handler.
// Mirrors handleBulkSetAvailability's optimistic + confirmation Alert
// + skippedCount surfacing pattern. Sends ALL selected ids (server
// idempotently skips already-deleted; no client-side flip-filter
// needed because deletion is unconditional).
const handleBulkDelete = async () => {
  const ids = Array.from(selectedIds);
  if (ids.length === 0) return;

  Alert.alert(
    `Delete ${ids.length} item${ids.length > 1 ? 's' : ''}?`,
    'Deleted items disappear from your menu and from the customer browse path. Past orders that included these items are unaffected (the order keeps a snapshot of name + price + image).',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBulkSubmitting(true);
          try {
            const r = await orderService.bulkRemoveMenuItems({
              menuItemIds: ids,
            });
            // Optimistic: drop the deleted ids from local items list.
            // The watcher / refresh will reconcile on the next tick;
            // the optimistic path keeps the UI feeling instant.
            const deletedSet = new Set(ids);
            setItems(prev => prev.filter(it => !deletedSet.has(it.id)));
            exitSelectMode();
            if (r.skippedCount > 0) {
              Alert.alert(
                'Deleted with skips',
                `${r.deletedCount} deleted, ${r.skippedCount} skipped (already deleted, or item may no longer exist).`,
              );
            }
            fetchOnce();
          } catch (e: any) {
            Alert.alert(
              'Bulk delete failed',
              e?.message ?? 'Please try again.',
            );
          } finally {
            setBulkSubmitting(false);
          }
        },
      },
    ],
  );
};
```

**Render** — restructure the bulk action bar into TWO rows. Row 1: ENH-1's smart Mark buttons (unchanged). Row 2: the Delete button (destructive style, full width when alone).

Update the `bulkBar` style to flex-column so the two rows stack:

```ts
bulkBar: {
  paddingHorizontal: spacing.lg,
  paddingVertical: spacing.md,
  backgroundColor: colors.surface,
  borderTopWidth: 1,
  borderTopColor: colors.border,
  gap: spacing.sm, // PR-NEXT-ENH-2 — vertical gap between mark row + delete row
  ...shadow.card,
},
markRow: {
  flexDirection: 'row',
},
```

Wrap ENH-1's two-button row in a `<View style={styles.markRow}>` and append the Delete row below:

```tsx
{selectMode && (bulkAvailableCount > 0 || bulkUnavailableCount > 0 || selectedIds.size > 0) && (
  <View style={styles.bulkBar}>
    {/* Row 1 — ENH-1's smart Mark buttons. Only renders when at
        least one of the two counts is > 0; with an empty selection
        the whole bar would have been hidden by the outer guard. */}
    {(bulkAvailableCount > 0 || bulkUnavailableCount > 0) && (
      <View style={styles.markRow}>
        {bulkAvailableCount > 0 && (
          <View style={{ flex: 1 }}>
            <Button
              title={`Mark ${bulkAvailableCount} unavailable`}
              onPress={() => handleBulkSetAvailability(false)}
              variant="secondary"
              disabled={bulkSubmitting}
              loading={bulkSubmitting}
            />
          </View>
        )}
        {bulkAvailableCount > 0 && bulkUnavailableCount > 0 && (
          <View style={{ width: spacing.sm }} />
        )}
        {bulkUnavailableCount > 0 && (
          <View style={{ flex: 1 }}>
            <Button
              title={`Mark ${bulkUnavailableCount} available`}
              onPress={() => handleBulkSetAvailability(true)}
              disabled={bulkSubmitting}
              loading={bulkSubmitting}
            />
          </View>
        )}
      </View>
    )}
    {/* PR-NEXT-ENH-2 (finding #5 follow-up) — Delete row.
        Always rendered when selection is non-empty (unlike the
        smart Mark buttons which can both hide on no-flip selections).
        Destructive variant flags the irreversible action. */}
    {selectedIds.size > 0 && (
      <View style={{ width: '100%' }}>
        <Button
          title={`Delete ${selectedIds.size} item${selectedIds.size > 1 ? 's' : ''}`}
          onPress={handleBulkDelete}
          variant="destructive"
          disabled={bulkSubmitting}
          loading={bulkSubmitting}
          fullWidth
        />
      </View>
    )}
  </View>
)}
```

Notes:

- **`variant="destructive"`** — verify this variant exists in `src/components/common/Button.tsx`. If not, use `variant="secondary"` with an inline `style={{ borderColor: colors.danger }}` and an explicit text color in props (or add a new variant — small Button.tsx change). Match whatever the local Button convention is.
- **Delete row uses `width: '100%'`** so the button takes the full bar width on its own row. No flex:1 race with the mark row.
- **Outer guard adjusted** — the bar is now also shown when `selectedIds.size > 0` even if both flip-counts are 0 (impossible in practice because every selected item is either available or unavailable, but defensive). The Delete button is the always-visible action whenever there's any selection.

---

### §C — Audit log entry name

`bulkRemoveMenuItems` is added to the audit log via `writeAuditLog`. The action string `'bulkRemoveMenuItems'` should appear in `AuditLogScreen`'s known-actions list if there is one (search the admin screens for an enum or label map of audit-action strings). Add the mapping if needed; otherwise the raw string surfaces, which is fine.

---

## Discipline checklist

1. **Rule 1 — Imports stay.** New imports on functions/src/index.ts (`validateBulkRemoveRequest`) and ShopMenuScreen.tsx (nothing new — `Button` + `Alert` already imported). Carry "DO NOT REMOVE" comments if local convention requires.
2. **Rule 2 — Hooks above conditionals.** No new hooks (handler is a const inside the component, not a hook).
3. **Rule 3 — Server-first deploy.** Callable deploys + IAM-verifies first, then client OTA. Mid-deploy a shop owner without OTA but with the new server would never see a 404 because the callable name isn't referenced anywhere on the un-OTA'd client.
4. **Rule 4 — Schema additive only.** `deletedAt` field already exists from PR-NEXT-4. No new fields.
5. **Cloud Run IAM verification (recurring gotcha).** After `firebase deploy --only "functions:bulkRemoveMenuItems"`:
   ```
   gcloud run services get-iam-policy bulkremovemenuitems --region asia-south1
   ```
   If missing, restore:
   ```
   gcloud run services add-iam-policy-binding bulkremovemenuitems --region asia-south1 --member=allUsers --role=roles/run.invoker
   ```
6. **Test discipline.** §A.3 adds ~12 helper tests.
7. **OTA classification.** Pure JS client + new callable. No `app.json`, no permission, no plugin → client OTA-safe; server is the only non-OTA deploy.

---

## Acceptance checklist

Need shop owner account + a menu of ≥5 items.

**Happy path — uniform selection delete:**

1. Open Shop Menu. Tap "Select." Select 3 items. Bulk bar shows Mark buttons (per ENH-1) + the Delete button at the bottom with title `Delete 3 items`.
2. Tap "Delete 3 items." Confirmation Alert: `"Delete 3 items?"` + the "Past orders unaffected" note. Tap "Delete" (destructive).
3. Selection optimistically drops from the list. After watcher tick, items confirmed gone from the menu.
4. Customer's ShopDetailScreen (anonymous browse) no longer shows the deleted items (the `deletedAt != null` filter on `listShopMenuPublic` from PR-NEXT-4 already handles this).
5. Past orders that included those items still render correctly (snapshot in `CartItem`).

**Mixed selection — Mark + Delete coexist:**

6. Tap Select. Select 1 available + 1 unavailable. Bulk bar shows: `Mark 1 unavailable` + `Mark 1 available` (Row 1, ENH-1's smart labels) + `Delete 2 items` (Row 2, full-width destructive).
7. Tap "Delete 2 items." Confirm. Both items gone.

**Single-item delete:**

8. Tap Select. Select 1 item. Bulk bar shows: `Mark 1 [un]available` (whichever applies) + `Delete 1 item`. Tap Delete. Confirmation Alert: `"Delete 1 item?"` (singular). Confirm.

**Already-deleted skip (rare):**

9. Manually flip an item's `deletedAt` in Firestore Console to a real timestamp. The item disappears from the screen (existing filter). If you can somehow get its ID into a bulk delete (edge case), the callable returns `{deletedCount: 0, skippedCount: 1}` and the UI surfaces `"Deleted with skips, 0 deleted, 1 skipped."`.

**Empty selection regression:**

10. Tap Select but don't select anything. Bulk bar: no Mark buttons (per ENH-1), no Delete button. Bar collapses (zero height). "Done" header still exits select mode.

**Cancellation flow:**

11. Open the Delete confirmation Alert → tap Cancel. Items stay. UI returns to select mode with same selection.

**Order-history isolation:**

12. Find a past order that included a now-deleted item (use Customer OrderDetailScreen). The order still renders the item name, price, image, quantity. The customer can also reorder via the existing reorder flow — `buildReorderPlan` will mark the deleted item as `removed_from_menu` ("No longer offered by the shop"), which is the correct historical-reorder UX (PR 13 + PR-NEXT-8 already handle this).

**Regression — ENH-1's smart labels still work:**

13. Run the ENH-1 acceptance steps 1-3 again. Mark labels still hide no-op buttons correctly. Delete button appears alongside them in mixed and uniform cases.

**Test suite:**

14. `cd functions && npm run build` clean
15. `cd functions && npm run test:unit` — green; suite count up by ~12 helper tests
16. `npm run test:unit` (root) — unchanged (this PR doesn't add client tests; the existing ENH-1 helper coverage stays)
17. `npx tsc --noEmit` clean
18. **Cloud Run IAM:** `gcloud run services get-iam-policy bulkremovemenuitems --region asia-south1` — `allUsers` binding confirmed.

---

## Out of scope (explicit deferrals)

- **Undo affordance** (snackbar with Undo after delete). Soft-delete makes this technically possible (just clear `deletedAt`), but adds UI scope. Defer until pilot feedback asks for it.
- **Admin-side bulk delete on another shop's menu.** Shop-owner-only.
- **Hard-delete (true Firestore doc deletion).** Soft-delete is the unified pattern from PR-NEXT-4; never reach for hard-delete on shop menus.
- **Delete with reason / comment.** Could log a reason in the audit log; defer.
- **Cascading delete of associated images in Storage.** `/menu/{shopId}/{filename}` images stay in Storage even after the menu item is soft-deleted — same as PR-NEXT-4's posture. They're cheap and might be reused.

---

## Deploy plan

**Step 1 — Server-first:**

```
cd functions
npm run build
firebase deploy --only "functions:bulkRemoveMenuItems"
```

Verify IAM:

```
gcloud run services get-iam-policy bulkremovemenuitems --region asia-south1
```

If `allUsers` binding missing, add:

```
gcloud run services add-iam-policy-binding bulkremovemenuitems \
  --region asia-south1 \
  --member=allUsers \
  --role=roles/run.invoker
```

**Step 2 — Client OTA:**

```
npx tsc --noEmit
npm run test:unit
git commit -m "PR-NEXT-ENH-2: bulk delete menu items (finding #5 follow-up)"
eas update --branch production --message "PR-NEXT-ENH-2 bulk delete"
```

Pull on shop owner device → run the 18-step acceptance checklist.

---

## Doc trail updates after ship

- `docs/TESTING-FINDINGS-2026-05-30.md` — under finding #5, add a sub-note: `Bulk delete (third action on the smart-label bar from ENH-1) → ✅ SHIPPED in PR-NEXT-ENH-2 (June 1 2026)`.
- `docs/SESSION_LOG.md` — one-paragraph entry covering the new callable, the validator mirror, the two-row bulk-bar layout, the server-first deploy + IAM verification.
- `CLAUDE.md` — bump date.
- `PRELAUNCH_CHECKLIST.md` — short note under the PR-NEXT-4 block.
