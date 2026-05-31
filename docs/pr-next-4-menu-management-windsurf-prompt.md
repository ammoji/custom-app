# PR-NEXT-4 — Menu management: bulk-unavailable fix + unified soft-delete (Windsurf prompt)

> Two findings, both shopkeeper menu management. See
> `docs/TESTING-FINDINGS-2026-05-30.md` findings #4 + #5.
>
> - **Finding #4 — bulk "Mark N unavailable" silently fails.**
>   Root cause **confirmed in code** during drafting:
>   `bulkUpdateMenuAvailability` queries `db.collection('menuItems')`
>   (a top-level collection that doesn't exist); per-shop menu items
>   actually live in the **subcollection**
>   `shops/{shopId}/menu/{menuItemId}`. Every query returns empty →
>   `matchedIds.length === 0` → every requested ID gets bucketed as
>   `skippedCount`. The error message "item may no longer exist"
>   misdirected diagnosis. One-line collection-path fix.
> - **Finding #5 — Delete doesn't behave like delete.** The existing
>   `removeMenuItem` callable has an asymmetric behavior the shopkeeper
>   can't reason about: **custom items** are hard-deleted (disappear
>   from menu); **global items** are soft-disabled via `available: false`
>   (stay in menu, just marked unavailable). The Delete button on
>   `ShopMenuItemEditScreen` already exists and calls `removeMenuItem`,
>   so this isn't a missing UI — it's a behavior gap. Unify via a
>   `deletedAt` soft-delete pattern that makes every delete actually
>   remove the item from listings, custom and global alike.
>
> Server-first deploy. Client side is OTA-safe (no native module
> change). Estimated Windsurf effort: ~30–45 min.

## Why this PR exists

Finding #4 means a shopkeeper with 100 items can only update one at a
time. At pilot scale this is annoying; at any real scale it's
unworkable. The bug is a one-line fix in the wrong collection path
(`menuItems` → `shops/{shopId}/menu`); the per-helper validation +
chunking + audit-log code is already correct.

Finding #5 is the same bug shape one level up — the delete button
exists but doesn't do what it says it does for global items. Customers
keep seeing items they "removed" still listed as unavailable, and
shopkeepers get confused why their cleanup isn't sticking. The unified
`deletedAt` pattern is small, additive, and matches what's already on
the locked-design list in TESTING-FINDINGS-2026-05-30.md.

## Read first

- `docs/TESTING-FINDINGS-2026-05-30.md` → findings #4 + #5.
- `functions/src/index.ts`:
  - **~line 2213 — `bulkUpdateMenuAvailability` callable.** Line 2247
    is the bug (`db.collection('menuItems')`). Lines 2241–2256 are the
    chunk-and-query loop that needs rewriting.
  - **~line 6209 — `removeMenuItem` callable.** Today: custom →
    hard-delete; global → set `available: false`. Both branches change
    to `deletedAt: serverTimestamp()` write.
  - **~line 6250 — `listShopMenuPublic` callable.** Customer-facing
    list; add `deletedAt == null` filter.
  - Search for `listMyShopMenu` — shopkeeper-facing list; same filter.
  - Search for `searchMenuPublic` — cross-shop customer search; same
    filter.
  - Search for `validateBulkMenuRequest` — pure helper, no change
    needed (returns `shopId` from the claim already).
- `src/types/index.ts` — `MenuItem` (~line 188). Add `deletedAt?:
  number | null` field.
- `src/screens/shop/ShopMenuScreen.tsx` — bulk-selection UI (line
  ~504 for the "Mark N unavailable" CTA). No code change here —
  fix on the server makes the existing UI work.
- `src/screens/shop/ShopMenuItemEditScreen.tsx` (~line 226 — already
  calls `removeMenuItem`). Update the Delete confirmation copy so the
  shopkeeper understands the new uniform "remove from menu" behavior.
- `src/services/orderService.ts` — `removeMenuItem` client wrapper
  (~line 856). Return shape simplifies (no more `softDisabled` branch);
  the wrapper signature changes accordingly.
- `.windsurf/code-discipline.md` Rule 1 (import-strip — type field
  addition touches several files). Rule 10 (reads-before-writes in
  `removeMenuItem` — already fine).
- `.windsurf/deploy-discipline.md` — Cloud Run IAM verify for every
  redeployed public callable.

## Locked design decisions

- **Unified `deletedAt: number | null`** on MenuItem. Optional /
  back-compat: legacy menu items without the field are treated as
  not-deleted (no migration needed). Server writes
  `FieldValue.serverTimestamp()` on delete; client reads it as epoch
  ms via the existing `toMenuItem` normalizer (if one exists; otherwise
  the field is read raw and the listings just check for truthy /
  null).
- **`removeMenuItem` writes `deletedAt` for BOTH custom and global**
  items. No more hard-delete branch. Order history is unaffected
  because `CartItem` on the order embeds a snapshot (name, price,
  imageUrl) at order-time — never reads back from the live menu doc.
- **All listings filter `deletedAt == null`** server-side:
  `listMyShopMenu`, `listShopMenuPublic`, `searchMenuPublic`, and the
  fixed `bulkUpdateMenuAvailability`'s candidate query. Deleted items
  are effectively gone from every read surface.
- **No undelete UI in this PR.** A future PR can surface an "Archived
  items" view for shopkeepers / admins if needed. For pilot scale the
  conservative "deleted means gone" is fine — `deletedAt` is on the
  doc for forensic / admin recovery via Firestore console only.
- **`bulkUpdateMenuAvailability`'s defensive `data.shopId === shopId`
  check goes away.** Once the query is scoped to the shop's own
  subcollection, every returned doc belongs to that shop by
  construction. The check was a workaround for the wrong-path query
  returning cross-shop hits; with the right path, it's dead code.

## Scope of changes

### A. Fix `bulkUpdateMenuAvailability` collection path (finding #4)

`functions/src/index.ts` lines 2241–2256. Replace the wrong-path
chunked query with a subcollection-scoped one:

```ts
// Read all candidate docs from THIS SHOP'S menu subcollection.
// Pre-PR this queried `db.collection('menuItems')` — a top-level
// collection that doesn't exist; per-shop menu items live at
// `shops/{shopId}/menu/{menuItemId}` (Phase 12a-v2-ii). Every query
// returned empty, every ID got bucketed as `skippedCount`, and the
// error message "item may no longer exist" misdirected diagnosis.
// Once the query is scoped to the shop's own subcollection, every
// returned doc belongs to that shop by construction — the
// `data.shopId === shopId` filter from the pre-fix version becomes
// dead code (kept the doc-existence check, dropped the shopId
// match).
//
// Also filter `deletedAt == null` so a soft-deleted item (PR-NEXT-4
// §C) doesn't get its `available` flag toggled — would be a wasted
// write and confusing if a future admin tool surfaces the deleted
// item back.
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
    if (data.deletedAt != null) continue; // skip soft-deleted
    matchedIds.push(doc.id);
  }
}
```

**Then the batch-update loop** also needs the path correction. Lines
2261–2268 currently update `db.collection('menuItems').doc(id)` —
change to:

```ts
const batch = db.batch();
for (const id of matchedIds) {
  batch.update(menuRef.doc(id), {
    available,
    updatedAt: FieldValue.serverTimestamp(), // PR 48 §I — use
    // serverTimestamp not Date.now() so getMyShop's orderBy doesn't
    // hit the mixed-type bug from PR 48. (Was Date.now() pre-fix.)
  });
}
await batch.commit();
```

⚠️ **Two import-discipline notes:**
1. `FieldPath` needs to be imported from `firebase-admin/firestore`
   if not already. Don't let the LSP cascade-remove other imports
   from that module.
2. `FieldValue.serverTimestamp()` should already be imported (used
   widely); confirm.

### B. Add `deletedAt` to `MenuItem` type (finding #5)

`src/types/index.ts`, on the `MenuItem` type (~line 188):

```ts
// PR-NEXT-4 — soft-delete timestamp. Written by `removeMenuItem`
// (both custom + global items use the unified soft-delete now).
// All menu listings (listMyShopMenu, listShopMenuPublic,
// searchMenuPublic, bulkUpdateMenuAvailability's candidate query)
// filter `deletedAt == null` server-side, so a deleted item
// effectively disappears from every read surface. Order history
// is unaffected because CartItem snapshots name/price/imageUrl at
// order time — orders never read back from the live menu doc.
// Optional / back-compat: legacy menu items without the field are
// treated as not-deleted (no migration needed).
deletedAt?: number | null;
```

OPTIONAL. Don't make it required. Same back-compat posture as
`shopLocation`, `paidMethod`, etc.

### C. Modify `removeMenuItem` to write `deletedAt` for both kinds

`functions/src/index.ts` ~line 6234 (the `isCustom` branch split).
Collapse the two branches into a uniform soft-delete:

```ts
// Old behavior was asymmetric:
//   custom items → hard delete (gone from menu)
//   global items → set available: false (stayed in menu)
// Shopkeeper saw "Delete" do different things in different cases and
// reported it as "delete doesn't work" (finding #5). The unified
// soft-delete pattern below makes every delete actually remove the
// item from listings, custom and global alike. The doc stays in
// Firestore with `deletedAt` set so an admin can forensically
// recover via the Firestore console if needed; no undelete UI in
// this PR.
await ref.update({
  deletedAt: FieldValue.serverTimestamp(),
  // Also flip `available: false` for defense-in-depth — if any
  // listing/query forgets to filter `deletedAt`, the
  // already-filtered `available == true` clause on
  // listShopMenuPublic still hides it.
  available: false,
  updatedAt: FieldValue.serverTimestamp(),
});
return { ok: true as const };
```

**Note** the return shape simplifies: no more `deleted` /
`softDisabled` discriminator (both branches now do the same thing).
Update the client wrapper signature in §F to match.

### D. Filter `deletedAt` in every listing surface

Three reads need the new filter clause:

**1. `listMyShopMenu`** — grep for it. The query currently fetches
the shop's menu subcollection without a `deletedAt` filter. Add:

```ts
// PR-NEXT-4 — exclude soft-deleted items.
.where('deletedAt', '==', null)
```

Wait — Firestore's `where('field', '==', null)` does match docs
where the field is **absent OR explicitly null**, BUT only if the
field is indexed. For brand-new menu items without `deletedAt`, the
absent-field case is the common one. **Best practice: filter
client-side in-memory** after the existing `.get()` (cheap; menu
sizes are small) to avoid the index dance:

```ts
const items = snap.docs
  .map(d => ({ id: d.id, ...d.data() }) as Record<string, any>)
  .filter(i => i.deletedAt == null); // handles both absent + null
```

**2. `listShopMenuPublic`** — same pattern, add the filter to the
in-memory chain at line ~6279.

**3. `searchMenuPublic`** — same; it does a collection-group query
across all `menu` subcollections. Filter `deletedAt == null` in the
post-query filter chain.

**4. `bulkUpdateMenuAvailability`** — already covered in §A above
(the `continue` on `data.deletedAt != null` inside the chunked loop).

⚠️ **Don't add a composite Firestore index just for this.** The
in-memory filter is simpler, more debuggable, and shops have
≤1000-ish items — well under the 50-result soft cap on a single
query.

### E. Update `removeMenuItem` client wrapper

`src/services/orderService.ts` ~line 856. Simplify the return type:

```ts
async removeMenuItem(input: {
  menuItemId: string;
}): Promise<{ ok: true }> {
  // PR-NEXT-4 — unified soft-delete; return shape simplified from
  // `{ deleted: boolean; softDisabled?: boolean }`. Every delete
  // now removes the item from listings uniformly (custom + global).
  // Legacy callers that destructure `.deleted` will get `undefined`,
  // which is falsy — defensively check the property access; the
  // ShopMenuItemEditScreen caller in §F is the only known reader and
  // doesn't use the field.
  if (isNative) {
    const fn = getNativeFunctions().httpsCallable('removeMenuItem');
    const result = await fn(input);
    return result.data as { ok: true };
  }
  const fn = httpsCallable(functions, 'removeMenuItem');
  const result = await fn(input);
  return result.data as { ok: true };
},
```

**Grep for `.softDisabled` and `.deleted` callsite usage** before
changing the type. If any reader exists, either update it or keep
the old fields in the return type as optional `never`-like values.

### F. Update `ShopMenuItemEditScreen` Delete confirmation copy

`src/screens/shop/ShopMenuItemEditScreen.tsx` ~line 226 — the
delete handler already exists; just update the confirmation Alert /
modal copy to reflect the new uniform behavior. Pre-PR copy probably
mentions "permanently delete" for custom or "mark unavailable" for
global; post-PR it's the same for both:

```
Title:   Remove this item from your menu?
Message: This will hide [item name] from your shop's menu. Past
         orders containing this item will still show it correctly.
         You can re-add it later by creating a new custom item with
         the same details.
Confirm: Remove from menu
Cancel:  Keep it
```

⚠️ **Hooks discipline (Rule 2):** if you reorganize handlers, the
`useState` calls stay above any conditional early returns.

### G. (Optional) Audit-log shape on `bulkUpdateMenuAvailability`

The current audit log (line 2275) writes `requestedCount,
updatedCount, skippedCount, available`. With the path fix,
`skippedCount` will now usually be 0 (since the query returns only
the shop's own docs by construction). The metadata stays unchanged
— still useful to see counts on each bulk operation. No change
required, but worth a comment update.

## Tests

**New / extended:**

- **Server-side coverage for `bulkUpdateMenuAvailability`'s collection
  path.** The existing tests (if any) likely only cover
  `validateBulkMenuRequest` in isolation, which is why this bug
  shipped. The wrapper's IO needs at least one integration-style test
  that pins the right collection path is being queried. If the test
  suite uses firebase-functions-test or a mocked db, assert the mock
  was called with `shops/{shopId}/menu`. If no such harness exists,
  the smoke acceptance below is the verification — don't bolt on an
  emulator setup just for this.
- **Pure helper for `deletedAt` filtering** if Windsurf wants to be
  thorough — `excludeDeleted(items: MenuItem[]): MenuItem[]` lives
  in a new `src/utils/menuListingHelpers.ts`, unit-tested with
  absent / null / non-null `deletedAt` cases (mirrors the
  `displayOrderStatus` + `chargeForDistance` pure-helper convention).
  Optional but cheap; would make the three listing-filter sites
  consistent.
- **Update existing `removeMenuItem` tests** (if any): the return
  shape simplifies from `{ deleted, softDisabled? }` to `{ ok }`.
  The write assertion changes from "deletes the doc OR sets available"
  to "sets `deletedAt` + `available: false` on the doc."

Target test count after this PR: ~1020+ (was 1016 after PR-NEXT-3).

## Deploy plan (server-first — deploy-discipline)

1. Deploy the changed functions:
   ```
   firebase deploy --only functions:bulkUpdateMenuAvailability,functions:removeMenuItem,functions:listMyShopMenu,functions:listShopMenuPublic,functions:searchMenuPublic
   ```

2. **Verify Cloud Run IAM** on the redeployed public callables (no
   new callables in this PR — but verify the redeploys preserved
   the `allUsers` binding, which is the recurring gotcha):
   ```
   gcloud run services get-iam-policy bulkupdatemenuavailability --region=asia-south1
   gcloud run services get-iam-policy removemenuitem --region=asia-south1
   gcloud run services get-iam-policy listmyshopmenu --region=asia-south1
   gcloud run services get-iam-policy listshopmenupublic --region=asia-south1
   gcloud run services get-iam-policy searchmenupublic --region=asia-south1
   ```
   Add `allUsers` / `roles/run.invoker` to any missing:
   ```
   gcloud run services add-iam-policy-binding <svc> --region=asia-south1 --member=allUsers --role=roles/run.invoker
   ```

3. Ship the client:
   ```
   eas update --branch production --message "PR-NEXT-4 menu bulk-unavailable fix + unified soft-delete"
   ```
   OTA-safe — no native module / no permission / no app.json change.

## Smoke acceptance

1. **Finding #4 — bulk unavailable on real items.** Shopkeeper opens
   ShopMenuScreen, selects 3 items, taps "Mark 3 unavailable" →
   confirm. **Expected: "Updated 3, skipped 0."** Pre-fix: "Updated 0,
   skipped 3 (item may no longer exist)."
2. **Finding #4 cross-shop safety.** This is automatic now (the
   subcollection scope means cross-shop IDs simply don't appear in
   the query). Sanity-check: log the audit-log entry for the bulk op
   and confirm `skippedCount: 0` in the metadata.
3. **Finding #5 — delete a CUSTOM item.** Shopkeeper goes into a
   custom item's edit screen, taps Delete, confirms. **Expected:**
   item disappears from the menu list immediately. The customer
   (other device) refreshes ShopDetailScreen — item is gone there
   too.
4. **Finding #5 — delete a GLOBAL item.** Same flow as #3 on a
   global (non-custom) item. **Expected:** same behavior — gone from
   both shopkeeper menu list AND customer-facing list. Pre-fix the
   item would have stayed in both lists (just marked unavailable).
5. **Order history preservation.** After deleting an item, open a
   past order that contained that item. **Expected:** item name +
   image + price still render correctly (snapshot embedded in
   `order.items[]`, not a live read from the menu doc).
6. **Bulk + soft-delete interaction.** Delete an item, then run a
   bulk "Mark unavailable" that includes the deleted item's ID.
   **Expected:** deleted item is silently skipped (filtered by
   `deletedAt != null` in the candidate query); other items in the
   bulk update process normally.

## Out of scope (do not pull in)

- Undelete UI / "Archived items" view for shopkeepers or admins.
  Future PR if shopkeepers ask.
- Composite Firestore index for `deletedAt`. The in-memory filter is
  fine at pilot scale and avoids index management.
- Hard-delete cleanup job (e.g., physically remove soft-deleted docs
  after N days). Storage is cheap; doc count is low.
- Renaming the existing `removeMenuItem` callable to `deleteMenuItem`
  or similar. Reuses the name to keep the diff small + matches the
  existing client wrapper. The asymmetry was in the *behavior*, not
  the name.
- Allowing customers to see "this item was recently removed" hints.
  Just gone from the menu.

## Update doc trail after shipping

1. Mark findings #4 and #5 as **Shipped** in
   `docs/TESTING-FINDINGS-2026-05-30.md`.
2. Append a SESSION_LOG entry covering:
   - The collection-path-mismatch class of bug (the same shape as
     PR-NEXT-1's status-display bug — UI/server-side reading from
     different sources for the same fact); useful pattern to grep
     for in future audits.
   - The unified `deletedAt` pattern (cleaner than the previous
     custom-hard-delete-vs-global-soft-disable asymmetry).
3. Bump test suite count in `CLAUDE.md` Current state.
