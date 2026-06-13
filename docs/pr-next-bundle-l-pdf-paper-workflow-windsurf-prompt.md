# PR-NEXT-BUNDLE-L — PDF download + paper workflow for catalog onboarding

**Cascade-on-Sonnet handoff prompt** · Author: Claude · Drafted: 2026-06-13 (Sat morning, CST)

---

## Why this PR exists

Bundle K shipped the on-phone catalog browser. Bundle K.1 (in flight with
Devin as of this draft) pivots the on-phone browser from swipe-cards
to an Excel-style table with top-bar voice auto-advance — denser, faster
bulk entry.

But there's a workflow we haven't covered: **the kirana owner who would
rather walk the aisles with a clipboard than tap a phone.** Older
shopkeepers in particular. And even tech-comfortable owners run into
the same friction — they don't want to interrupt shop activity while
they price 200 items, but they CAN spare 30 minutes after closing to
sit with a printed list and a pen.

Bundle L closes that workflow:

1. **Shop owner taps "Print blank catalog" in BuildCatalogScreen.**
2. **Server generates a printable PDF** — one page per category, with
   product name + brand + pack + a blank "Your price" box per row.
3. **Shop owner prints, fills it out at leisure** (or hands it to
   someone in the shop with neater handwriting).
4. **Shop owner snaps a photo of each filled page** in
   `ScanCatalogPagesScreen` and uploads.
5. **Existing PR 32 `extractMenuFromImage` pipeline** (purpose-built for
   reading Indian rate-lists — see `menuExtractionHelpers.ts`) parses
   each page into `ExtractedMenuDraft[]`.
6. **Items land in the existing Bundle K `CatalogReviewScreen`** for
   commit — no new review surface needed; same final flow as voice
   capture, scan-menu, and inline price entry all converge here.

This is a **pure client + Functions PR** with one new callable and one
new screen. Zero schema changes. Zero new composite indexes. The OCR
backend (`extractMenuFromImage`) already exists at full quality and
has been in production since PR 32 — Bundle L just feeds it different
input pages.

---

## Read first (in this order)

1. `CLAUDE.md` — pilot-prep wave status; Bundle K + K.1 context.
2. `docs/PROMPT_AUTHORING_NOTES.md` — Rule 5 worked examples #10-#16
   + Required completion-report verification block. **Mandatory read
   before writing or reviewing the completion report.**
3. `docs/pr-next-bundle-k-shop-catalog-onboarding-windsurf-prompt.md` —
   Bundle K design (master catalog + BuildCatalogScreen +
   CategoryBrowseScreen → CategoryListScreen in K.1 + CatalogReviewScreen).
4. `docs/pr-next-bundle-k1-catalog-table-view-windsurf-prompt.md` —
   K.1 pivot. CatalogReviewScreen is the convergence point we feed.
5. `functions/src/menuExtractionHelpers.ts` — the existing PR 32 pure
   helpers. Bundle L reuses `MENU_EXTRACTION_SYSTEM_PROMPT`,
   `parseExtractedItems`, the whole helper module unchanged.
6. `functions/src/index.ts` lines ~9132–9320 — the existing
   `extractMenuFromImage` callable. Bundle L's new `extractCatalogPagePrices`
   callable is **modeled on this** (same auth gate, same quota counter,
   same Claude call structure) but with a refined system prompt
   (`CATALOG_PAGE_EXTRACTION_SYSTEM_PROMPT`) that tells Claude the
   PDF row format and asks for `{productId, sellPrice}` pairs rather
   than freeform `ExtractedItem[]`.
7. `src/screens/shop/ScanMenuScreen.tsx` — the existing PR 32 screen
   pattern (pick → processing → review → committing). Bundle L's
   `ScanCatalogPagesScreen` uses the same four-phase state machine
   with one twist: multi-photo (one per category page).
8. `src/screens/shop/BuildCatalogScreen.tsx` — Bundle K hub. We add
   a "Print blank catalog" CTA.

---

## Discipline checklist (every item must be checked off in the completion report)

- [ ] **Rule 5** (`.windsurf/code-discipline.md`): every new TypeScript
      symbol added has its consumers audited via grep BEFORE the PR
      is reported complete. Behavior-level audit, not just type-level.
- [ ] **Rule 11**: any server-callable changes get an IAM
      `allUsers` audit + `npm run smoke` after deploy. **Bundle L
      adds one new callable (`extractCatalogPagePrices`) — IAM check
      MUST appear in the completion report.**
- [ ] **Rule W**: complete the PR autonomously (no mid-flight "is this
      OK?"). Apply the deliberate-break demos at the end.
- [ ] **Rule 5 worked example #14**: PR completion verification
      requires grep evidence, not "tsc clean" alone. Required
      completion-report verification block at bottom of report.
- [ ] **Rule 5 worked example #15**: silent-catch guard
      (`noSilentCatchAudit`) MUST pass. New `.catch(() => {})` blocks
      need explicit allowlist comments with one-line justification.
- [ ] **Rule 5 worked example #16**: deploy-state ≠ code-state.
      After Sudhir deploys the new callable, he runs `npm run smoke`
      (or `npm run smoke:iam`) to confirm IAM allUsers binding is in
      place. Not on Devin — but the completion report MUST include
      the post-deploy `npm run smoke` line in the deploy instructions.
- [ ] **PROMPT_AUTHORING_NOTES Rule 8**: every PR includes
      explicit `docs/FEATURES.md` update instructions. Section
      additions listed at the end of this prompt.

---

## §A — Server: PDF generation

New file: `functions/src/catalogPdfHelpers.ts`

Pure helper. Takes `(masterCatalogItems: MasterCatalogItem[], shopName: string, generatedAt: Date)` and returns a `Buffer` containing the PDF. **No firebase-admin, no firebase-functions imports — pure pdfkit call. Unit testable.**

Use **`pdfkit`** as the PDF library. It's the most mature Node PDF
library, no native deps (Chromium-free), MIT licensed, ~3MB. Already
proven in the gen-pdf-from-template workflow (the `printable-bill` PR).
Install via `cd functions && npm install pdfkit @types/pdfkit`.

Page structure (one page per category):

```
HamaraSetu — Build your catalog                    Page 1 of 10
{Shop name}                              Generated 13 Jun 2026

CATEGORY: Atta, Rice & Dal                  (15 items shown)

┌──────────────────────────────────────────────────────────────┐
│ #   Product (brand · pack)                MRP    Your price   │
├──────────────────────────────────────────────────────────────┤
│ 1   Aashirvaad Atta (10 kg)              ₹520    ____________ │
│ 2   Aashirvaad Atta Multigrain (5 kg)    ₹325    ____________ │
│ 3   Daawat Basmati (1 kg)                ₹190    ____________ │
│ ...                                                            │
└──────────────────────────────────────────────────────────────┘

Skip items you don't sell — leave the price box blank.
Item ID (do not edit): ABCD-1234

[QR code in bottom-right: encodes shop+page identifier
 for the OCR pipeline to confirm which page was scanned]
```

Implementation notes:

- **Item ID line** is small (8pt grey) under each row's name so the
  OCR can map handwriting back to `productId`. Each row's product
  has the masterCatalogId visible enough for the model to read.
- **QR code** at page footer — encodes JSON `{shopId, pageNumber, categoryId, productIds: [...]}`.
  Use `qrcode` npm package (mature, MIT, 200KB). Optional but **strongly
  recommended** — makes OCR pipeline robust to "shopkeeper photographed
  pages in random order" (which they will).
- **Page header** includes `HamaraSetu` brand mark + page number + shop
  name. Sudhir's Sara Stack Labs branding pulled from
  `src/constants/branding.ts` (re-exported on server side or duplicated;
  consider whether `BRAND_NAME` should move to a shared `functions/src/branding.ts`).
- **Generated PDF size budget:** ~50KB/page × 10 categories = 500KB
  total. Below Firebase Storage's per-document soft limits.

Add to `functions/src/index.ts`:

```ts
// PR-NEXT-BUNDLE-L — Generates a printable PDF of the shop's catalog
// candidate list (one page per category). Output is uploaded to
// Storage at /shops/{shopId}/catalog-pdfs/{ISO-timestamp}.pdf with
// firebaseStorageDownloadTokens metadata, and the URL returned.
//
// Auth: shop owner of the shop only. Admin allowed.
// Quota: 5/day per shop (reusing the same `aiQuotas/{shopId}` doc the
// extractMenuFromImage callable uses — pdf generation is cheaper than
// Claude calls but PDFs accumulate in Storage so cap regardless).
export const generateCatalogPdf = onCall<{
  shopId: string;
  categoryIds: string[]; // empty = all 10 categories
}, Promise<{ url: string; pageCount: number; itemCount: number }>>(...);
```

**Read-then-write transaction structure** (Rule 5 worked example #11):

1. READ: shop doc (ownership check, name) + aiQuotas/{shopId} (rate
   limit) + products where status='approved' and category in categoryIds.
2. COMPUTE: build PDF buffer in-memory.
3. WRITE: upload to Storage + bump aiQuotas counter + audit log entry.

The Storage upload itself is async outside the transaction. The
aiQuotas counter bumps inside the transaction.

---

## §B — Server: Catalog page OCR extraction

New callable: `extractCatalogPagePrices`.

```ts
export const extractCatalogPagePrices = onCall<{
  shopId: string;
  pageImageBase64: string;
  // From the QR code if scanned successfully; null otherwise.
  // When null, server falls back to OCR-from-prompt to identify
  // which products this page contains.
  qrPayload?: { shopId: string; pageNumber: number; categoryId: string; productIds: string[] };
}, Promise<{
  prices: Array<{ productId: string; sellPrice: number; confidence: 'high' | 'medium' | 'low' }>;
  droppedCount: number;
  pageCategory: string;
}>>(...);
```

Implementation: extends `menuExtractionHelpers.ts` with:

- `CATALOG_PAGE_EXTRACTION_SYSTEM_PROMPT` — new system prompt that
  tells Claude **the input is a catalog page, the products are pre-
  printed with known names + IDs, and only the handwritten price box
  needs to be read.** Output schema:
  ```json
  {
    "prices": [
      { "productId": "ABCD-1234", "sellPrice": 525, "confidence": "high" }
    ]
  }
  ```
- `parseCatalogPagePrices(text: string, allowedProductIds: string[]):
  { prices: ParsedPrice[]; droppedCount: number }` — validates each
  returned productId against the allowed list (the QR payload or, if
  QR missing, all approved products), drops `sellPrice` rows where
  the value is non-numeric or negative or unreasonably high (>₹100,000),
  drops products not in the allowed list.

Unit tests:
- Empty page (no handwriting) → empty prices array, droppedCount 0.
- All rows filled cleanly → all prices returned with high confidence.
- Some rows blank, some filled → only filled rows returned (shopkeeper
  intent: blank = "I don't sell this").
- Malicious productId not in QR payload → dropped.
- Negative or zero sellPrice → dropped.
- sellPrice >₹100,000 → dropped (likely OCR misread of "550" as "550000").
- Hindi numeral input ("५२५") → parsed correctly.

---

## §C — Client: "Print blank catalog" CTA in BuildCatalogScreen

Edit `src/screens/shop/BuildCatalogScreen.tsx`:

Add a secondary CTA below the existing category grid: **"📄 Print blank catalog"**.

Tap behavior:

1. Show a `BottomSheet` (Rule 13) — "Generate a printable catalog?"
   with two confirms: "All 10 categories" or "Only categories I've
   tapped" (the second option grayed-out if user hasn't opened any
   categories yet — fall back to "All").
2. On confirm, call `generateCatalogPdf({ shopId, categoryIds: [] })`.
3. Show "Generating PDF…" inline loader with progressive copy ("Pulling product list…" → "Rendering pages…" → "Uploading…").
4. On success, open the returned URL via `Linking.openURL(url)` (iOS
   opens it in Safari/Preview; Android offers Open With dialog).
5. Show a follow-up Toast (`src/components/common/Toast`): **"PDF saved.
   When you've filled it out, tap 'Scan filled catalog' on the same
   screen to upload."**

---

## §D — Client: New screen `ScanCatalogPagesScreen`

New file: `src/screens/shop/ScanCatalogPagesScreen.tsx`.

Modeled on `src/screens/shop/ScanMenuScreen.tsx` (PR 32). Same four-
phase state machine:

```ts
type Phase = 'pick' | 'processing' | 'review' | 'committing';
```

Differences from ScanMenuScreen:

- **Multi-photo flow.** Phase 1 lets user pick multiple pages (one
  per category). UI shows a horizontal scroll of picked thumbnails
  + a "+ Add page" button. "Process X pages" CTA at the bottom.
- **Server call:** per-page calls to `extractCatalogPagePrices`,
  sequenced with a 500ms gap between calls to avoid Claude rate limits.
- **QR code scan attempt** in phase 2: use `expo-camera`'s built-in
  QR scanner on each picked image. If QR found, pass `qrPayload` to
  the callable; if not, callable falls back to product-list inference.
- **Phase 3 review:** all extracted prices across all pages
  concatenated into a single list, passed to the existing Bundle K
  `CatalogReviewScreen` as `route.params.preFilledItems`. **No new
  review UI.** `CatalogReviewScreen` already knows how to filter
  out empty rows + show category breakdown + commit via
  `commitShopMenuItemsBulk`. This is the convergence point.

Navigation entry point:

In `BuildCatalogScreen`, below the "Print blank catalog" CTA, add
a third button: **"📷 Scan filled catalog"** — navigates to
`ScanCatalogPagesScreen`.

---

## §E — Audit-grep: ensure CatalogReviewScreen accepts pre-filled items

`CatalogReviewScreen` already exists (Bundle K). It currently reads
items from a Zustand store (`useCatalogDraftStore`) populated by
`CategoryListScreen`. Bundle L needs to either:

(a) **Push the OCR-extracted items into the same store** before
    navigating — preferred, single source of truth. Reuses commit code
    path 100%.
(b) Accept items via `route.params.preFilledItems` — more explicit but
    forks the commit path. Avoid.

Pick (a). After OCR succeeds in `ScanCatalogPagesScreen`, call
`useCatalogDraftStore.getState().setBulkPrices(extractedPrices)` then
`navigation.navigate('CatalogReview')`.

**Audit-grep before completion:** confirm `useCatalogDraftStore`
exists with the right shape (it's defined in Bundle K — check
`src/store/catalogDraftStore.ts`). If method `setBulkPrices` doesn't
exist, add it.

---

## §F — Pure helpers (unit-testable, no Firestore)

`functions/src/catalogPdfHelpers.ts`:
- `buildCatalogPdfBuffer(items, shopName, generatedAt) → Buffer`
- `groupItemsByCategory(items) → Map<categoryId, items[]>`
- `formatItemRow(item) → string` — returns the row text exactly as
  rendered, for snapshot tests
- `buildQrPayload(shopId, pageNumber, categoryId, productIds) → string` —
  the JSON-stringified QR content

`functions/src/menuExtractionHelpers.ts` extensions:
- `CATALOG_PAGE_EXTRACTION_SYSTEM_PROMPT` constant
- `parseCatalogPagePrices(text, allowedProductIds) → { prices, droppedCount }`

`src/utils/catalogScanHelpers.ts` (new):
- `mergeScannedPrices(scannedPrices: Array<{prices, droppedCount}>)
  → { merged: Array<{productId, sellPrice}>, totalDropped: number,
  duplicates: number }` — when shopkeeper accidentally photographs
  the same page twice, drop the duplicate productIds (keep the higher-
  confidence reading).

---

## §G — Tests (forecast: +28 tests minimum)

`tests/functions/catalogPdfHelpers.spec.ts` — +7 tests
- buildCatalogPdfBuffer with 0 items → throws InvalidArgument
- buildCatalogPdfBuffer with 1 category, 3 items → 1 page Buffer
- buildCatalogPdfBuffer with all 10 categories → 10 page Buffer
- groupItemsByCategory correctly bins items
- formatItemRow handles missing brand
- formatItemRow handles unusually long item name (truncates at 60 chars)
- buildQrPayload produces deterministic JSON output

`tests/functions/extractCatalogPagePrices.spec.ts` — +9 tests
- parseCatalogPagePrices: clean response → all prices returned
- parseCatalogPagePrices: empty handwriting → empty prices, droppedCount 0
- parseCatalogPagePrices: malicious productId not in allowed list → dropped
- parseCatalogPagePrices: negative price → dropped
- parseCatalogPagePrices: 0 price → dropped
- parseCatalogPagePrices: price >100000 → dropped
- parseCatalogPagePrices: non-numeric price → dropped
- parseCatalogPagePrices: Hindi numerals → parsed correctly
- parseCatalogPagePrices: malformed JSON from Claude → throws ParseError

`tests/services/catalogScanHelpers.spec.ts` — +5 tests
- mergeScannedPrices: 2 pages no overlap → all prices returned
- mergeScannedPrices: 2 pages full overlap (dup photo) → 1 set, duplicates=N
- mergeScannedPrices: partial overlap → higher-confidence wins
- mergeScannedPrices: same productId both high → first wins (stable)
- mergeScannedPrices: empty input → empty output, no throw

`tests/functions/generateCatalogPdf.spec.ts` — +7 tests
- non-shop-owner caller → unauthenticated
- shop owner of different shop → permission-denied
- aiQuotas at limit → resource-exhausted
- empty categoryIds → uses all 10
- successful generation → returns url + pageCount + itemCount
- audit log written
- quota counter bumped exactly +1

Run targets:
- `npx jest catalogPdfHelpers extractCatalogPagePrices catalogScanHelpers generateCatalogPdf` should show +28 tests minimum.
- Total suite at completion: 1639 + 28 = 1667 minimum (probably more — Bundle L may force test additions in adjacent files).
- `tsc --noEmit` clean on both `src/` and `functions/`.
- `npx jest` runs both `logic` and `components` projects (HOTFIX-JEST-PROJECTS-CONFIG already shipped).

---

## §H — Deploy plan (Sudhir runs after Devin reports complete)

```powershell
# 1. Functions build
cd functions
npm install pdfkit @types/pdfkit qrcode @types/qrcode
npm run build

# 2. Deploy the new callable + the modified extractMenuFromImage (no
#    behavior change but redeploy to be safe)
firebase deploy --only "functions:generateCatalogPdf,functions:extractCatalogPagePrices"

# 3. IAM check (Rule 11) — both callables
foreach ($svc in 'generatecatalogpdf','extractcatalogpageprices') {
  gcloud run services get-iam-policy $svc --region=asia-south1 --project=grocery-mvp-dev
}
# Expected: both show 'allUsers' bound to 'roles/run.invoker'.

# 4. Post-deploy smoke validator (Rule 5 #16)
npm run smoke -- --include=generateCatalogPdf,extractCatalogPagePrices

# 5. Client OTA
eas update --branch production --message "Bundle L — PDF download + paper workflow"
```

**No Firestore rules changes. No new composite indexes. No schema changes.**

---

## §I — Required completion-report verification block

The completion report MUST include this exact block (Rule 5 #14):

```
=== Bundle L verification ===

# Callable exports
$ grep -n "export const generateCatalogPdf" functions/src/index.ts
<line number>:export const generateCatalogPdf = onCall<...

$ grep -n "export const extractCatalogPagePrices" functions/src/index.ts
<line number>:export const extractCatalogPagePrices = onCall<...

# Helper module
$ wc -l functions/src/catalogPdfHelpers.ts
<line count>

# Constants
$ grep -n "CATALOG_PAGE_EXTRACTION_SYSTEM_PROMPT" functions/src/menuExtractionHelpers.ts
<line number>:export const CATALOG_PAGE_EXTRACTION_SYSTEM_PROMPT = ...

# Client screen
$ ls -la src/screens/shop/ScanCatalogPagesScreen.tsx
<file info>

$ grep -n "navigation.navigate('CatalogReview')" src/screens/shop/ScanCatalogPagesScreen.tsx
<line number>:    navigation.navigate('CatalogReview');

# CatalogReviewScreen pre-filled path (proves no fork)
$ grep -n "setBulkPrices" src/store/catalogDraftStore.ts
<line number>:  setBulkPrices: (prices) => set((state) => ...

# BuildCatalogScreen CTA additions
$ grep -n "Print blank catalog\|Scan filled catalog" src/screens/shop/BuildCatalogScreen.tsx
<line numbers>

# Test count
$ npx jest --listTests | wc -l
<count — should be ≥ 1639+ → confirm by running suite>

$ npx jest 2>&1 | tail -5
<output showing PASS X, FAIL 0, suites: N>

# Type check
$ cd functions && npx tsc --noEmit && echo "functions clean"
functions clean

$ cd .. && npx tsc --noEmit && echo "src clean"
src clean

# Static guards still pass
$ npx jest tests/audits 2>&1 | tail -3
<all 6 static guards pass>
```

Without this block in the completion report, the PR is **not
considered complete** regardless of "tsc clean" claims. This is the
HOTFIX-ATTENTION-CALLABLES-MISSING lesson hard-coded.

---

## §J — Deliberate-break demos (run before reporting complete)

Demo 1: **PDF helper throws on empty input.**
1. In a test file, call `buildCatalogPdfBuffer([], 'TestShop', new Date())`.
2. Expect throw with `InvalidArgument` and message containing "no items".
3. Restore.

Demo 2: **OCR parser drops malicious productId.**
1. Hand-craft a parser test input with productId `'NOT-IN-ALLOWED-LIST'`.
2. Assert that prices array does not contain that productId and droppedCount ≥ 1.
3. Temporarily comment out the allowedProductIds check in parser.
4. Run test → it should now FAIL (productId leaks through).
5. Restore the check.
6. Run test → it should PASS.

Demo 3: **Quota counter enforced.**
1. Manually patch `aiQuotas/{testShopId}.generatePdfCount` to `5` (the cap).
2. Call `generateCatalogPdf` from a test-mode unit test (emulator if
   available, otherwise mock the Firestore SDK).
3. Expect `HttpsError('resource-exhausted', ...)`.
4. Reset to 0 → expect success.

These demos prove the tests actually pin the behavior. Without them
the wave can drift back to the "tests pass, but they don't pin anything"
state that produced HOTFIX-ATTENTION-CALLABLES-MISSING.

---

## §K — FEATURES.md updates (Rule 8)

Add to `docs/FEATURES.md`:

- **§3.X (Shop panel)**: new "Catalog PDF + paper workflow" subsection
  under existing "Catalog onboarding" (Bundle K).
  - "Shop owners can print a blank catalog as a PDF (one page per
    category), fill it out by hand at the shop, then scan each filled
    page back into the app. Pages are read by Claude OCR
    (`extractCatalogPagePrices`); extracted prices land in the existing
    CatalogReviewScreen for commit. QR code on each page disambiguates
    page identity even when shopkeeper scans pages in random order.
    Quota: 5 PDFs per shop per day (shared aiQuotas counter)."

- **§5.10 (Static-source guards)**: confirm 6 guards still pass (no
  additions in Bundle L). Note in the changelog row: "Bundle L —
  audit-grep on `useCatalogDraftStore.setBulkPrices` confirms single
  source of truth for catalog draft commits (paper + voice + inline
  all converge on `commitShopMenuItemsBulk`)."

- **§5.9 (Operational scripts)**: no new scripts (Bundle L is fully
  in-app + Functions).

---

## §L — Out of scope

Explicitly NOT in Bundle L:

- **Multi-page PDF stitching** (e.g. "scan all 10 pages at once with
  a doc-scanner app then upload as a single PDF"). Multi-image flow
  is enough for pilot. Reconsider after first 3 shops use it.
- **Print-from-app via React Native print plugin.** Just `Linking.openURL`
  on the PDF URL and let the OS handle it. Print plugins add ~3MB and
  break on Expo Go.
- **Server-side billing for PDF generation cost.** PDFs are
  ~free to generate (pdfkit is fast, no external API). Quota is just to
  cap Storage growth.
- **Localized PDF (Hindi product names).** Phase 1 ships English. PR-NEXT
  can add a `lang: 'en' | 'hi'` parameter once we have Hindi product
  names in the master catalog.
- **Custom-item additions from scan.** If shopkeeper writes a product
  not in the PDF (e.g. scribbles in the margin), it's ignored. They
  use the existing `ProposeCustomItemScreen` flow for those.
- **Re-print existing shop catalog** (i.e. "I already have menuItems,
  print a PDF of just what I sell"). Useful but orthogonal — Bundle L
  is for catalog *building*, not catalog *managing*. Defer to PR-NEXT-LIST.

---

## §M — Worth-doing-before-pilot? (Sudhir to decide)

This is genuine optionality. Bundle L is **not pilot-blocking** if
voice + inline price entry (Bundle K + K.1) work well for the first
1-3 shop owners. Build it now if:

- Sudhir's instinct is shop #1's owner will prefer paper.
- We want the pitch line "list 500 items in 30 minutes on paper" for
  shop-acquisition conversations.
- We want a defensive workflow for older shopkeepers who feel
  overwhelmed by the phone UI.

Defer it if:

- Bundle K.1 voice-from-top auto-advance proves fast enough in retest.
- Shop #1's owner is a 30-something comfortable with phones.
- We want to get pilot live this week and add paper workflow as
  PR-AFTER-PILOT only if a shop asks for it.

My read: **build it now while context is hot.** The PR will take
~2 days of Devin time, the backend reuse is clean (the OCR pipeline
is already in production), and having "we can do paper too" in our
back pocket de-risks the first 3 shop conversations significantly.
If Sudhir defers, this prompt stays valid for at least 6 months — the
underlying menuExtractionHelpers.ts pipeline is stable.

---

## Test count forecast

**+28 minimum** (probably +30–35 with adjacent helper tests Devin
adds during implementation).

Total at completion: 1639 → **~1667+**.

Static guards (6) must still pass. `tsc --noEmit` must be clean on
both `src/` and `functions/`.

---

## Estimated Devin quota burn

Medium: ~12–18% of weekly quota. The PR has clear scope (one new
callable, one new helper module, one new screen), and the OCR backend
already exists. The new screen mostly mirrors `ScanMenuScreen.tsx`
which is a 600-line known-good template.

If quota is tight: defer to next week. If quota is fresh (Sudhir
just got new quota Saturday morning): green-light.

---

End of prompt.
