# PR-NEXT-BUNDLE-K — Shop catalog onboarding (master catalog browse + voice/swipe price entry)

**Source:** Sudhir's shop-onboarding strategy decision (2026-06-12). The 500-item master catalog was seeded into `products/{productId}` via `scripts/seed-master-catalog.ts`. Now shopkeepers need an in-app wizard to browse the master catalog by category and tag prices for items they carry. Customer-visible fields stay minimal (name, pack size, price, MRP). Cross-shop isolation enforced via Firestore rules. Custom item additions flow through an admin approval queue.

**Pilot context:** This is the gate between "shop approved" and "shop ready to take orders." For a kirana with 500-800 SKUs, the wizard must turn what's traditionally a 6-8 hour catalog entry job into a 60-90 minute speak-prices-while-walking-the-shop session.

**Deploy class:** **server-first.** 5 new callables + new composite indexes + new `products-pending/` collection + 2-3 new screens + voice integration. Schema-additive. Sizable bundle — 8 sections, ~70 tests forecast.

## Data model (locked in by Sudhir 2026-06-12)

```
products/{productId}                     ← MASTER CATALOG
  • id, name, brand, category, packSize, mrp, imageUrl
  • status: 'approved' | 'pending' | 'rejected'  (NEW field — defaults 'approved' on seed)
  • proposedBy?: <shopOwnerUid>                   (NEW — only set on shop-proposed items)
  • proposedAt?: <ms timestamp>                    (NEW — same)
  • Admin-only writes for status flips
  • Read-only for shops + customers

shops/{shopId}/menu/{menuItemId}         ← SHOP'S PRICE LIST (existing collection)
  • productId → references products/
  • price (shop's selling price)
  • inStock
  • ONLY items the shop carries
  • Isolated from other shops by Firestore rules

shops/{shopId}/onboardingState/catalog   ← PER-SHOP ONBOARDING PROGRESS (NEW)
  • categoriesCompleted: string[]               (which categories shop has finished)
  • lastCategoryViewed: string | null
  • lastItemViewedInCategory: string | null
  • itemsAdded: number                          (running count for progress UI)
  • startedAt: number
  • updatedAt: serverTimestamp
```

**Customer view** (per shop): reads `shops/X/menu/` filtered by `inStock === true`, joins to `products/` for name + photo + MRP. Displays four fields: name, pack size, shop's price, MRP (strikethrough if price < MRP).

**Shop onboarding view**: browses master catalog (`products/` where `status == 'approved'` OR proposed by self), per category. Sets prices → writes to own `shops/X/menu/`. Cannot edit master catalog. Proposes new items → writes to `products/` with `status: 'pending'`.

**Admin approval view**: reads `products/` where `status == 'pending'`, approves → flips to `'approved'`, reject → flips to `'rejected'` with reason.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root AND `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `cd functions && npm run build`
- File edits to files explicitly named in §A–§I below
- New file creation in `functions/src/`, `src/utils/`, `src/components/catalog/`, `src/screens/shop/catalog/`, `src/screens/admin/`, `scripts/`, `tests/`

You MUST stop and ask before:
- Deploy commands (`firebase deploy`, `eas update`, `gcloud …`)
- File deletes
- Editing files NOT in the §-named lists (especially: do NOT touch existing `shops/{shopId}/menu/` write code paths until §B explicitly extends them)
- Adding NEW dependencies — voice library should already be present from PR 34
- Schema additions BEYOND the 4 new fields listed above (`status`, `proposedBy`, `proposedAt` on products + the new `onboardingState/catalog` doc shape)
- Firestore rules changes outside what's needed for §B + §G

Default posture: **execute, report at end.**

## Required completion-report verification block (Rule 5 worked example #14)

In your final report, paste the literal output of:

```
wc -l functions/src/index.ts
grep -n "export const listMasterCatalogByCategory\|export const commitShopMenuItem\|export const commitShopMenuItemsBulk\|export const proposeMasterCatalogItem\|export const reviewPendingCatalogItem" functions/src/index.ts
grep -n "async listMasterCatalogByCategory\|async commitShopMenuItem\|async commitShopMenuItemsBulk\|async proposeMasterCatalogItem\|async reviewPendingCatalogItem" src/services/orderService.ts
ls -la src/screens/shop/catalog/
ls -la src/components/catalog/
npx jest tests/utils/ tests/static/ tests/functions/ 2>&1 | tail -15
```

Every numeric line number cited in your report must be within file bounds (verify with `wc -l <file>`). If a line number exceeds the file length, the export does not exist.

## Schema audit-grep (Rule 5)

```
grep -n "products/\|MasterProduct\|GLOBAL menu item" functions/src/index.ts src/types
grep -rn "shops/.*/menu" src functions/src
grep -n "status.*pending\|proposedBy\|products-pending" functions/src src
grep -rn "isCustom\|isMasterCatalog" src functions/src
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `products/{productId}` | Seeded by `scripts/seed-master-catalog.ts` (2026-06-12) | ~500 items, all `status: 'approved'` (will be added by backfill in §A) |
| `shops/{shopId}/menu/` subcollection | Existing, per `src/types` "GLOBAL menu items" comment | NO breaking changes — extend only |
| `products/{productId}.status` | NEW field, default 'approved' | Composite indexes needed (see §G) |
| `products-pending/` | Considered but NOT used | Sudhir's final design uses single `products/` collection + status flag |
| `shops/{shopId}/onboardingState/catalog` | NEW subcollection doc | One-per-shop, tracks wizard progress |

## Plan

### §A — Schema migration on `products/` (add `status` field)

Update `scripts/seed-master-catalog.ts` to write `status: 'approved'` on every doc. Then write a one-shot backfill `scripts/backfill-products-status.ts` that adds `status: 'approved'` to any existing doc missing the field. Idempotent + project allowlist + admin-uid required, same safety scaffolding as `backfill-review-per-dimension.ts`.

Also: add Firestore composite indexes for the queries §B and §G will issue:
```json
{ "collectionGroup": "products", "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "category", "order": "ASCENDING" },
    { "fieldPath": "name", "order": "ASCENDING" }
  ]
},
{ "collectionGroup": "products", "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "proposedAt", "order": "DESCENDING" }
  ]
}
```

Update `firestore.rules` to allow:
- Authenticated read on `products/{id}` where `status == 'approved'`
- Authenticated read on `products/{id}` where `status == 'pending' && proposedBy == request.auth.uid` (shop sees own pending)
- Admin claim required for writes to `products/{id}.status` field
- Shop-owner claim required for writes to `shops/{shopId}/onboardingState/catalog`

Pin **+4 tests** on the backfill helper (`deriveProductsStatusBackfill`).

### §B — Server callables (5 new)

`functions/src/index.ts` — add to the `export const list*` block:

**§B.1 — `listMasterCatalogByCategory`**
```ts
export const listMasterCatalogByCategory = onCall<{
  category: string;
  limit?: number;
  cursor?: string;  // last productId from previous page
}>(...)
```
- Auth: any signed-in user
- Filters: `where status in ['approved'] AND category == args.category ORDER BY name ASC LIMIT 50`
- Returns: `{ items: MasterCatalogItem[], hasMore: boolean }`
- Pure helper: `buildMasterCatalogPage(snap, limit)` returns the trimmed page + hasMore flag
- Pin **+3 tests** on the helper

**§B.2 — `commitShopMenuItem`** (single-item write)
```ts
export const commitShopMenuItem = onCall<{
  productId: string;
  price: number;
  inStock?: boolean;
}>(...)
```
- Auth: shop-owner claim + shop ownership verified via direct `shops/{shopId}.ownerUid` lookup (per HOTFIX-RESPOND-OWNER pattern; line-allowlisted with `// shop-owner-audit:allow` only at the resolve-my-shop fallback)
- Validates: price > 0, price <= 10 × MRP (sanity check — refuses obvious typos like ₹2750 for a ₹275 item)
- Writes to `shops/{shopId}/menu/{auto-id-or-productId}` with `{ productId, price, inStock: inStock ?? true, addedAt }`
- Pure helper: `validateShopMenuItemPrice({ price, mrp }): Result<{ price: number }, { code, message }>` — Rule 14 Result
- Pin **+5 tests** on the helper (valid price, > 10× MRP rejected, 0 rejected, negative rejected, exact MRP allowed)

**§B.3 — `commitShopMenuItemsBulk`** (efficient batch)
```ts
export const commitShopMenuItemsBulk = onCall<{
  items: Array<{ productId: string; price: number; inStock?: boolean }>;
}>(...)
```
- Auth: same as §B.2
- Max 50 items per call (over Firestore batch limit otherwise)
- Validates each item via `validateShopMenuItemPrice` — invalid items are rejected per-item with reason, valid ones still write
- Single Firestore batch write
- Returns: `{ successful: number, failed: Array<{ productId: string; reason: string }> }`
- Pin **+4 tests** on the batch helper (`partitionShopMenuItems(items, mrpLookup)`)

**§B.4 — `proposeMasterCatalogItem`**
```ts
export const proposeMasterCatalogItem = onCall<{
  name: string;
  brand?: string;
  category: string;
  packSize: { value: number; unit: string };
  suggestedMrp: number;
  photoUrl?: string;  // optional — uses signed upload URL flow
}>(...)
```
- Auth: shop-owner claim
- Validates: name non-empty, category valid (within `CATEGORIES` list), packSize finite + unit recognized, suggestedMrp > 0
- Writes to `products/{auto-id}` with `{ status: 'pending', proposedBy: <uid>, proposedAt: now, ...inputFields }`
- Returns the new productId so the shop can immediately commit it to their own menu via §B.2
- Pure helper: `validateMasterCatalogProposal(input): Result<{ doc: Record<string, unknown> }, { code, message }>`
- Pin **+4 tests** on the helper

**§B.5 — `reviewPendingCatalogItem`** (admin only)
```ts
export const reviewPendingCatalogItem = onCall<{
  productId: string;
  decision: 'approve' | 'reject';
  rejectionReason?: string;
}>(...)
```
- Auth: admin claim required
- Reads `products/{productId}` — must exist with `status == 'pending'`
- Writes: `status: decision === 'approve' ? 'approved' : 'rejected'`, `reviewedAt`, `reviewedBy`, optional `rejectionReason`
- Pin **+3 tests** on `validateCatalogReviewAction` pure helper

### §C — Per-category browse screen (swipe cards + voice + type)

`src/screens/shop/catalog/CategoryBrowseScreen.tsx` (NEW)

State:
- `category: string` (from route param)
- `items: MasterCatalogItem[]` (from `listMasterCatalogByCategory`)
- `currentIndex: number` (which item is on top of the swipe stack)
- `priceDrafts: Map<productId, number>` (pending writes; flushed on commit or navigation)
- `voiceListening: boolean`
- `voiceConfirmation: { productId, heardPrice } | null` (visual confirmation before commit)

UI (per Sudhir's design):

```
┌──────────────────────────────────┐
│ ← Atta, Rice & Dal · 47 / 70    │
│                                  │
│      ┌────────────────────┐     │
│      │   [Product photo]  │     │
│      │                    │     │
│      │  Aashirvaad Atta   │     │
│      │  Aashirvaad        │     │
│      │  5 kg              │     │
│      │  MRP ₹ 280         │     │
│      └────────────────────┘     │
│                                  │
│      [✓ Sell at MRP]            │
│                                  │
│  ┌─────────────────────────┐    │
│  │ 🎤  Tap to speak price  │    │
│  └─────────────────────────┘    │
│  ┌─────────────────────────┐    │
│  │ Or type: ₹___           │    │
│  └─────────────────────────┘    │
│                                  │
│      Skip ⟵        Next ⟶       │
└──────────────────────────────────┘
```

Swipe gestures via `react-native-gesture-handler`:
- Swipe right (or "Sell at MRP" button) → commit at MRP, auto-advance
- Swipe left (or "Skip" button) → no commit, auto-advance
- Tap mic → opens VoicePriceCapture component (see §D)
- Tap type field → keyboard opens, user types, "Done" commits

Each commit writes to `priceDrafts` map (in-memory) + persists onboarding state via §F. Bulk Firestore write happens on Review screen via §B.3.

Photo render: `<Image source={{uri: item.imageUrl}} onError={...}>` with initials fallback for missing photos (same pattern as `formatPartnerAvatar`).

Pure helpers:
- `deriveCardAction({ swipeDirection, swipeDistance }): 'commit_mrp' | 'skip' | 'cancel'` — translates gesture data to intent
- `nextItemIndex(currentIndex, items.length): number | 'end'` — handles last-item case

Pin **+5 tests** on the helpers.

### §D — Voice price capture component

`src/components/catalog/VoicePriceCapture.tsx` (NEW)

Reuses existing voice infrastructure from PR 34 (voice onboarding for customers). Investigate via:
```
grep -rn "voice\|speech\|@react-native-voice\|expo-speech" src
```

Component flow:
1. Tap mic on parent → modal opens
2. "Listening… speak the price in Hindi or English"
3. User says "do sau pachas rupay" / "two fifty rupees" / "₹250"
4. STT returns text → `parseVoicePriceInput(text, lang)` pure helper extracts number
5. Visual confirmation card: "I heard ₹250. Correct?" with [✓ Yes] [↩ Try again] [✕ Type instead]
6. ✓ → commit, modal dismisses, parent advances
7. ↩ → re-listens
8. ✕ → modal dismisses, parent focuses text input

Pure helper `parseVoicePriceInput(text: string, lang: 'hi' | 'en'): { price: number | null; confidence: 'high' | 'low' }`:
- Handles common patterns:
  - English: "two hundred fifty", "250 rupees", "₹250", "two fifty"
  - Hindi: "do sau pachas", "do sau pachas rupay", "ढाई सौ"
  - Mixed: "two sau pachas"
- Returns `{ price: 250, confidence: 'high' }` or `{ price: null, confidence: 'low' }` if ambiguous
- Pin **+8 tests** (English variants, Hindi variants, mixed, ambiguous "ek sau" (could be 100 or unclear), negative/zero, non-numeric speech)

### §E — Catalog review + bulk commit screen

`src/screens/shop/catalog/CatalogReviewScreen.tsx` (NEW)

Shown after the shop owner says "finish" from §C, OR returnable from the main onboarding hub at any time.

Layout: paginated list of all items in `priceDrafts`. Per row:
- Photo + name + pack size
- Price field (editable inline)
- MRP (read-only)
- Delete button (removes from drafts)

Top: "Save 247 items" CTA → calls `commitShopMenuItemsBulk` in chunks of 50.

Empty state: "No items added yet. Pick a category to start."

After successful commit:
- All items in drafts flush
- Onboarding state's `itemsAdded` increments
- Navigate back to category browse hub

Pure helper `partitionDraftsForBulkCommit(drafts: Map): Array<Array<{ productId, price }>>` — splits into 50-item chunks. Pin **+3 tests**.

### §F — Onboarding hub + state persistence

`src/screens/shop/catalog/BuildCatalogScreen.tsx` (NEW — entry point)

Top-level hub showing all 10 categories as cards:

```
┌─────────────────────────────────┐
│ Build your catalog              │
│ 247 items added so far          │
├─────────────────────────────────┤
│  🌾  Atta, Rice & Dal           │
│      47/70 items added · ✓ done │
├─────────────────────────────────┤
│  🥛  Dairy & Eggs               │
│      12/45 items · in progress  │
├─────────────────────────────────┤
│  🛢️  Oil & Ghee                 │
│      0/30 items · not started   │
└─────────────────────────────────┘
```

Tap a category → opens §C's CategoryBrowseScreen.

State persisted to Firestore `shops/{shopId}/onboardingState/catalog` doc:
- `categoriesCompleted: string[]`
- `lastCategoryViewed: string | null`
- `lastItemViewedInCategory: string | null`
- `itemsAdded: number`
- `updatedAt: serverTimestamp`

Read on mount via new callable `getOnboardingState` (or extend existing `getMyShop`). Write on every commit via `setOnboardingState` callable (or via direct Firestore client write — gated by rules).

Resume behavior: if shop has a `lastCategoryViewed` + `lastItemViewedInCategory`, show "Continue where you left off" CTA at the top.

Pure helper `computeCategoryProgress(categoryId, itemsInCategory, itemsAdded): { status: 'not_started' | 'in_progress' | 'done'; count: { added: number; total: number } }`. Pin **+4 tests**.

### §G — Admin pending catalog queue

`src/screens/admin/PendingCatalogQueueScreen.tsx` (NEW)

Lists `products/` where `status == 'pending'`, sorted by `proposedAt DESC`. Per row:
- Photo (if any)
- Name + brand + category + pack size
- Suggested MRP
- "Proposed by [shop name]" + relative time
- [Approve] [Reject] buttons

Tap approve → calls `reviewPendingCatalogItem({ productId, decision: 'approve' })`. Tap reject → opens reason input modal → `reviewPendingCatalogItem({ productId, decision: 'reject', rejectionReason })`.

Server callable `listPendingCatalogItems` (new — admin-only, paginated). Returns items + counts.

Audit log: every approval/rejection writes to `auditLog/` with action type + admin uid + productId + decision + reason.

Pin **+3 tests** on `summarizePendingCatalogItems` pure helper.

### §H — Custom item proposal flow

`src/screens/shop/catalog/ProposeCustomItemScreen.tsx` (NEW — reachable from §C "Don't see this item?" CTA)

Form:
- Name (required)
- Brand (optional)
- Category (picker — required)
- Pack size: value + unit (required)
- Suggested MRP (required, numeric)
- Photo upload (optional — uses existing `getProductPhotoUploadUrl` callable if exists, else add small new one mirroring `getPartnerPhotoUploadUrl` pattern)

Submit → calls `proposeMasterCatalogItem` → returns new `productId` → **also** auto-commits to shop's own menu via `commitShopMenuItem` (so they're not blocked from selling pending items immediately).

Toast: "Item added to your shop. Admin will review for the global catalog."

Pin **+3 tests** on the form validation helper.

### §I — Customer-side verification (no new client code, but verify)

The customer-facing shop browse and shop detail screens already read from `shops/{shopId}/menu/`. After §B.2 and §B.3 ship, customer should see only items the shop priced. Verify:

- Shop detail screen reads from `shops/{shopId}/menu/` ✓ (existing)
- Each menu item joins to `products/{productId}` for name + photo + MRP ✓ (existing GLOBAL menu item pattern)
- Customer sees only `inStock: true` items ✓ (existing)
- Customer does NOT see items where shop's price is missing ✓ (no commit = no menu doc = invisible)

No client changes needed for customer flow. **But verify with an integration test** (mock shop has 5 priced items, customer browse returns exactly 5).

Pin **+2 integration tests** on the customer browse flow.

### §J — Schema migration of existing seed

The 500 items I just seeded have `isMasterCatalog: true` but no `status` field. Backfill (per §A) adds `status: 'approved'`. Cleanup pass also removes the leftover `price` field on master catalog docs (it was a redundant suggested-sell-price from the seed CSV — master catalog should only carry MRP, not per-shop price).

`scripts/cleanup-master-catalog-price-field.ts` — one-shot, idempotent, dry-run default. Safety scaffold same as other backfills. Pin **+1 test** on the cleanup helper.

## Discipline checklist

1. **Rule 1** — every new import / state carries "PR-NEXT-BUNDLE-K — DO NOT REMOVE" comments.
2. **Rule 2** — every new useState in screens sits ABOVE conditional early returns.
3. **Rule 5** — schema audit-grep table in header. **Worked example #17 for the discipline notes:** *"Single-collection-with-status-flag is cleaner than separate-pending-collection when the entity lifecycle includes both states. Stable IDs across approval = simpler shop menu references. Composite indexes on (status, category) + (status, proposedAt) are cheap."*
4. **Rule 7** — auth.token shape verified (`claims.shopOwner`, `claims.admin` per post-HOTFIX-RATING-RESPONSE pattern). Static guards `authClaimNamesAudit` + `shopOwnerCheckAudit` must pass.
5. **Rule 8** — FEATURES.md update in Doc trail. Many rows touched (shop §2.3 Menu management, customer §1.5 Shop detail, admin §4.2 Shop moderation).
6. **Rule 11** — IAM verify on ALL 5 new callables: `listMasterCatalogByCategory`, `commitShopMenuItem`, `commitShopMenuItemsBulk`, `proposeMasterCatalogItem`, `reviewPendingCatalogItem`. Plus `listPendingCatalogItems` if added in §G. 5-6 services.
7. **Rule 13** — N/A (no new bottom-sheet modals; voice capture uses a screen-style modal but reuses BottomSheet chrome).
8. **Rule 14** — all 5 server-side validation helpers return Result.
9. **Schema-additive** — `status`, `proposedBy`, `proposedAt`, `reviewedAt`, `reviewedBy`, `rejectionReason` are NEW optional fields on `products/`. `shops/{shopId}/onboardingState/catalog` is NEW subcollection doc. Backfill in §A populates `status` on existing seed.
10. **Static guards** — all 6 existing guards must pass: `authClaimNames`, `noStaleDeferralComments`, `transactionReadOrder`, `shopOwnerCheck` (with new line-allowlists for §B.2's shop-resolve fallback), `partnerStatus`, `noSilentCatch`.
11. **Test discipline:** §A +4, §B (5 helpers) +19, §C +5, §D +8, §E +3, §F +4, §G +3, §H +3, §I +2, §J +1 = **+52 tests minimum.** Suite 1639 → ~1691.

## Acceptance checklist

1. **§A** Run `scripts/backfill-products-status.ts --execute` against `grocery-mvp-dev`. Verify all 500 master catalog docs now have `status: 'approved'`. Composite indexes Enabled in Firebase Console.
2. **§B.1** As shop owner, call `listMasterCatalogByCategory({ category: 'atta_rice_dal' })` → returns ~70 items, paginated. Items have `status: 'approved'`.
3. **§B.1** As customer (no shopOwner claim), same call succeeds (master catalog is universally readable). As anonymous user, succeeds (master catalog is public-read).
4. **§B.2** As shop owner of Shop X, call `commitShopMenuItem({ productId: 'staples-aashirvaad-atta-5kg', price: 285 })`. Verify `shops/X/menu/` has a doc referencing that productId with price 285.
5. **§B.2** Call with `price: 100000` (10× MRP of ₹275) → `failed-precondition: 'Price exceeds sanity limit'`. Regression guard.
6. **§B.3** Bulk commit 50 items in one call → all 50 written. Bulk commit 60 items → `invalid-argument: 'Max 50 items per call'`.
7. **§B.4** Propose a new item ("Patanjali Special Atta 5kg"). Verify `products/` has a new doc with `status: 'pending'`, `proposedBy: <my uid>`. Item is visible in my own catalog browse (but no other shop's). Auto-committed to my menu.
8. **§B.5** As admin, approve the pending item from #7. Verify `status: 'approved'`. Other shops can now see it.
9. **§B.5** As admin, reject a different pending item with reason. Verify `status: 'rejected'`, `rejectionReason` stored. Item disappears from all shop browse views.
10. **§C** Open BuildCatalogScreen → tap "Atta, Rice & Dal" → CategoryBrowseScreen shows first item with photo. Swipe right → committed at MRP, advances. Tap mic → say "two hundred fifty" → confirmation card shows "₹250" → tap ✓ → committed at 250, advances. Tap type → "275" → committed.
11. **§D** Voice in Hindi: "do sau pachas rupay" → confirmation shows "₹250". Voice with low confidence (ambiguous mumble) → "Try again" path triggered. No silent commits on misrecognition.
12. **§E** Add 5 items via swipe + voice + type. Tap "Review and save" → CatalogReviewScreen lists 5 items. Edit one inline. Tap "Save 5 items" → bulk write succeeds → drafts cleared.
13. **§F** Close app mid-onboarding. Reopen → BuildCatalogScreen shows "Continue where you left off" with the last category. Resume → CategoryBrowseScreen opens at the last item viewed.
14. **§G** As admin, open PendingCatalogQueueScreen → see all pending items. Approve one → it disappears from queue, becomes visible to all shops. Reject one with reason → also disappears.
15. **§H** From CategoryBrowseScreen, tap "Don't see this item?" → ProposeCustomItemScreen opens. Fill form → submit → item proposed AND auto-added to my menu.
16. **§I** As customer, browse shop X → see exactly the items shop X priced via §B.2 + §B.3 + §H. Items with `inStock: false` are hidden. Items not in shop X's menu (even though in master catalog) are NOT visible at shop X.
17. **§J** Run `scripts/cleanup-master-catalog-price-field.ts --execute`. Verify no master catalog docs have `price` field — only `mrp`.
18. **Cloud Run IAM** verify on all 5-6 new callables.
19. **Composite indexes** Enabled — Firebase Console shows both new indexes built (not Building).
20. `tsc` + tests clean. Suite +52 minimum. All 6 static guards pass.
21. **Deliberate-break demo (§B.2 auth):** revert §B.2's direct shop-ownership check to `where(ownerUid).limit(1)`. The `shopOwnerCheckAudit` static guard must fail. Restore. Guard passes.
22. **Deliberate-break demo (§B.2 price validation):** revert `validateShopMenuItemPrice` to accept any positive number. The "₹100000 for ₹275 item" test must fail. Restore. Test passes.
23. **Deliberate-break demo (§D voice parsing):** corrupt `parseVoicePriceInput` to return the first numeric token regardless of confidence. Tests for ambiguous input must fail (should have returned `confidence: 'low'`). Restore. Tests pass.

## Out of scope

- **PDF download for paper-fill workflow.** That's Bundle L, separate PR. Uses the same master catalog data as this bundle but adds PDF generation + reuses existing PR 32 OCR pipeline for photo upload. Drafted only after Bundle K ships and concierge first shop session informs the design.
- **Real product photos.** This bundle uses the placeholder photos from the seed (`picsum.photos/seed/<id>/300/300`). Real photo sourcing is a separate Cowork task — runs scrape against Open Food Facts + BigBasket and updates only `imageUrl` field.
- **Daily-fresh produce mode.** Vegetables and dairy with daily-changing prices are out of scope for the initial wizard. Separate flow ships after pilot proves the catalog browse design works.
- **Shop owner editing approved master catalog fields** (name, brand, photo). Per Sudhir's design: shops cannot edit master catalog. They can only set their own price/availability via `shops/{shopId}/menu/`. Custom item proposal is the only path for new items.
- **Customer-side discovery surfacing of "items other shops have that you don't"** — Sudhir flagged this as a nice future feature. Not in this bundle.

## Deploy

```
# 1. Indexes first (wait for Enabled in Firebase Console)
firebase deploy --only firestore:indexes
firebase deploy --only firestore:rules

# 2. Functions
cd functions; npm run build; cd ..
firebase deploy --only "functions:listMasterCatalogByCategory,functions:commitShopMenuItem,functions:commitShopMenuItemsBulk,functions:proposeMasterCatalogItem,functions:reviewPendingCatalogItem,functions:listPendingCatalogItems"

# 3. IAM verify all 6 services
foreach ($svc in 'listmastercatalogbycategory','commitshopmenuitem','commitshopmenuitemsbulk','proposemastercatalogitem','reviewpendingcatalogitem','listpendingcatalogitems') {
  gcloud run services get-iam-policy $svc --region=asia-south1 --project=grocery-mvp-dev
}

# 4. Run npm run smoke to verify deploy state
npm run smoke -- --check listMasterCatalogByCategory,commitShopMenuItem,commitShopMenuItemsBulk,proposeMasterCatalogItem,reviewPendingCatalogItem,listPendingCatalogItems

# 5. Backfill — status on existing master catalog
npx tsx scripts/backfill-products-status.ts --admin-uid=<your-admin-uid>
npx tsx scripts/backfill-products-status.ts --admin-uid=<your-admin-uid> --execute

# 6. Cleanup — remove leftover `price` field from master catalog
npx tsx scripts/cleanup-master-catalog-price-field.ts --admin-uid=<your-admin-uid>
npx tsx scripts/cleanup-master-catalog-price-field.ts --admin-uid=<your-admin-uid> --execute

# 7. Client OTA
npx tsc --noEmit
npm test
eas update --branch production --message "Bundle K — shop catalog onboarding wizard (master catalog browse + voice/swipe + custom item proposal + admin approval)"
```

## Doc trail (Cowork)

After ship:

- **CLAUDE.md** — strike Bundle K from in-flight. Update Current state with shop-onboarding capability now live.
- **SESSION_LOG** — paragraph covering: master catalog seeded → shop wizard built → first onboarding session with concierge → catalog as a compounding asset.
- **PRELAUNCH_CHECKLIST** — section per §.
- **PROMPT_AUTHORING_NOTES** — Rule 5 worked example #17 (single-collection-with-status-flag over separate-pending-collection).
- **FEATURES.md** (per Rule 8 — mandatory):
  - **Shop panel §2.3 Menu management** — ADD new row: `Catalog onboarding wizard | Browse 500-item master catalog by category, set price via swipe (MRP) / voice (Hindi+English) / type. Resume state per category. | Bundle K §C–§F | shipped`. ADD: `Custom item proposal | Submit new items to admin queue; auto-added to own menu pending review | Bundle K §H | shipped`.
  - **Customer panel §1.5 Shop detail** — verify "Menu items by category" row description still accurate; lineage HTML comment for Bundle K.
  - **Admin panel §4.2 Shop moderation** — ADD new row: `Pending catalog item review | Approve / reject shop-proposed master catalog items; reason stored on rejection | Bundle K §G | shipped`.
  - **Cross-cutting §5.9 Operational scripts** — ADD: `backfill-products-status | One-shot — adds status:'approved' to existing master catalog seed | Bundle K §A | shipped`. ADD: `cleanup-master-catalog-price-field | One-shot — removes leftover price field from master catalog (was redundant with mrp) | Bundle K §J | shipped`.
  - **Last updated** stamps on Shop §2.3, Customer §1.5, Admin §4.2, Cross-cutting §5.9 → date of deploy.
