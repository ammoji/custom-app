# PR 44 — Real category photos for menu items (Windsurf prompt)

> **Originally drafted on May 26 2026 as a combined PR 42**
> ("category photos + storefront wiring"). Sudhir split the
> two on the same day — storefront wiring shipped independently
> as PR 42 because it doesn't depend on external assets, while
> real category photos require sourcing 10 Pexels PNGs first.
> This file preserves the category-photos scope only. The
> storefront-wiring sections that originally lived here are now
> at `docs/pr-42-storefront-photo-wiring-windsurf-prompt.md`.
>
> **Prerequisite before sending this prompt to Windsurf:**
> Sudhir places 10 sourced photos (+ generic.png fallback) in
> `dist/category-icons/`. See the "Inputs Sudhir provides"
> section below for the exact file names + Pexels search guide.
> Without those files in place, Windsurf cannot run this PR —
> the wiring would deploy URLs pointing at 404'd images.

## Why this PR exists

The visual gap from PR 41 smoke testing (May 26 2026) that this
PR closes:

1. **Item images on customer-facing menus are placehold.co URLs
   with broken Unicode emoji rendering.** The URL form
   `https://placehold.co/400x400/FFF3B0/8B4513.png?text=🫒 Oil &
   Ghee` is technically correct (PR 32.2 nailed the `.png` placement
   so RN can render it) — but placehold.co's text-rendering font
   doesn't support all Unicode 13 emoji, so the rendered PNG shows
   "? Oil & Ghee" instead of "🫒 Oil & Ghee." Looks broken.
2. **Storefront photo uploaded during shop registration is never
   surfaced on the customer-facing shop card.** PR 31 captured a
   `kycDocs.storefront.storagePath` field on shop docs, but
   `approveShop` never wired that storage path through to
   `shop.imageUrl`. Customers see a 🏪 emoji placeholder (PR 41
   hotfix) instead of the actual storefront photo. Confirmed in
   Firestore: shop doc has `kycDocs.storefront.storagePath:
   "shop-kyc/.../storefront_.jpg"` but `imageUrl: ""`.

This PR closes both gaps in one cycle, plus enforces storefront
photo as mandatory in RegisterShop (currently effectively
optional — uploads succeed but submission proceeds without the
file).

Pilot impact: customer's first impression of a kirana shop in
the app shifts from "emoji placeholder rectangle" to "real
photo of the shop and real photos for each category" — closes
the Trust Principle 1 (visual quality signals product
seriousness) gap that the rebrand started but couldn't finish.

## Inputs Sudhir provides

**10 category photos sourced from Pexels** (free, royalty-free
stock photos), saved as PNGs in `dist/category-icons/`. File
naming convention is `kebab-case-category-id.png`:

| File name | Category ID | Pexels search guide |
|---|---|---|
| `dist/category-icons/atta-rice-dal.png` | `atta_rice_dal` | "rice sack jute" or "wheat flour bag" |
| `dist/category-icons/oil-ghee.png` | `oil_ghee` | "olive oil bottle" or "ghee jar indian" |
| `dist/category-icons/dairy-eggs.png` | `dairy_eggs` | "milk bottle eggs" |
| `dist/category-icons/bakery.png` | `bakery` | "rusk bread loaf" or "indian bakery items" |
| `dist/category-icons/masala-spices.png` | `masala_spices` | "indian spices bowl" or "masala powders" |
| `dist/category-icons/snacks-biscuits.png` | `snacks_biscuits` | "indian biscuits namkeen" |
| `dist/category-icons/beverages.png` | `beverages` | "tea coffee chai" or "soft drinks bottles" |
| `dist/category-icons/personal-care.png` | `personal_care` | "soap shampoo bottles" |
| `dist/category-icons/household.png` | `household` | "detergent cleaning bottles" |
| `dist/category-icons/fruits-vegetables.png` | `fruits_vegetables` | "fresh vegetables market" |

Each file:
- 400×400 PNG (matches the existing placehold.co dimensions
  so no client-side layout changes needed)
- Cropped/centered so the product is the focus
- Light background preferred (matches the white shop-card style)

Sudhir places all 10 files in `dist/category-icons/` before
shipping this PR. Windsurf should NOT generate the photos —
treat them as inputs that exist on disk.

If any of the 10 files is missing when Windsurf runs, the build
should fail loudly (not silently fall through). Add a pre-commit
check or test that validates all 10 paths exist.

## Read first

- `.windsurf/code-discipline.md` — Rules 7, 8, 9 are all relevant
  (RN raster format, Zustand stable refs, Image URI empty-string
  guard).
- `.windsurf/deploy-discipline.md` — especially the new "Cloud
  Run `allUsers` invoker IAM" section. `approveShop` is touched
  in this PR; deploy plan MUST verify its IAM post-deploy.
- `functions/src/categoryConstants.ts` — the file being
  rewritten. Note the heavy comment block at the top documenting
  PR 32.1, 32.2 history. Replace the URLs but preserve the
  comments documenting the "load-bearing `.png`" lessons —
  they're future-proofing against re-introducing the bug.
- `functions/src/index.ts` near line 3383 — the existing
  `approveShop` callable. The new wiring logic lands inside this
  function, just before it writes the `shops/{shopId}` doc.
- `src/screens/roles/RegisterShopScreen.tsx` — the screen that
  uploads storefront. Find the validation logic for the submit
  step and add the storefront-required check.
- `src/components/shop/ShopCard.tsx` — already has the 🏪
  placeholder guard from PR 41 hotfix. Confirm it still works
  when `shop.imageUrl` is populated (truthy URL renders Image;
  falsy renders 🏪 fallback). No code change here, but verify.

## Scope of changes

### A. Replace `CATEGORY_PLACEHOLDER_URLS` with hosted-photo URLs

`functions/src/categoryConstants.ts`:

Replace each placehold.co URL with the corresponding hosted URL.
PRESERVE the comment block above the map — it documents the
PR 32.1/32.2 lessons. Just rewrite the URL values.

```ts
export const CATEGORY_PLACEHOLDER_URLS: Record<string, string> = {
  atta_rice_dal:
    'https://grocery-mvp-dev.web.app/category-icons/atta-rice-dal.png',
  oil_ghee:
    'https://grocery-mvp-dev.web.app/category-icons/oil-ghee.png',
  dairy_eggs:
    'https://grocery-mvp-dev.web.app/category-icons/dairy-eggs.png',
  bakery:
    'https://grocery-mvp-dev.web.app/category-icons/bakery.png',
  masala_spices:
    'https://grocery-mvp-dev.web.app/category-icons/masala-spices.png',
  snacks_biscuits:
    'https://grocery-mvp-dev.web.app/category-icons/snacks-biscuits.png',
  beverages:
    'https://grocery-mvp-dev.web.app/category-icons/beverages.png',
  personal_care:
    'https://grocery-mvp-dev.web.app/category-icons/personal-care.png',
  household:
    'https://grocery-mvp-dev.web.app/category-icons/household.png',
  fruits_vegetables:
    'https://grocery-mvp-dev.web.app/category-icons/fruits-vegetables.png',
};
```

Also update the generic fallback URL inside
`placeholderImageForCategory`:

```ts
return (
  CATEGORY_PLACEHOLDER_URLS[categoryId] ??
  'https://grocery-mvp-dev.web.app/category-icons/generic.png'
);
```

Sudhir also adds a `dist/category-icons/generic.png` for the
fallback path (use a neutral grocery-shopping-bag photo).

Update the comment block above `CATEGORY_PLACEHOLDER_URLS` to
reflect the change: still note the historical placehold.co
lessons, but explain that PR 42 moved to self-hosted PNGs to
get real product photography. Strip the now-stale "if
placehold.co goes down" paragraph and replace with "if
Firebase Hosting goes down, the photos break gracefully but
the `imageUrl` field still contains a URL — the client's
<Image> falls back to its own image-failed handling."

### B. Wire `kycDocs.storefront` → `shop.imageUrl` in `approveShop`

`functions/src/index.ts`, inside the `approveShop` callable
(around line 3383). Locate the section where `shops/{shopId}`
doc is being written (look for `status: 'active'` around line
3414). Just before that write, generate a signed read URL for
the storefront photo:

```ts
// PR 42 — Wire storefront photo from KYC upload to the
// customer-facing shop.imageUrl. The storage path was
// captured during RegisterShop (PR 31) but never copied to
// imageUrl until now. Customers saw the 🏪 placeholder
// (PR 41 hotfix) for every newly-registered shop.
//
// Generate a v4 signed read URL (long expiry — 10 years —
// since the photo is non-sensitive shop branding). If the
// storage path is missing for some reason (shouldn't happen
// post-PR-42 mandatory enforcement but defend anyway),
// imageUrl stays as the previous value (which is the empty
// string for new shops or the existing URL for already-active
// ones).
let storefrontImageUrl: string | undefined;
const storefrontPath = pendingData?.kycDocs?.storefront?.storagePath;
if (typeof storefrontPath === 'string' && storefrontPath) {
  try {
    const bucket = getStorage().bucket();
    const file = bucket.file(storefrontPath);
    const [url] = await file.getSignedUrl({
      action: 'read',
      version: 'v4',
      expires: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
    });
    storefrontImageUrl = url;
  } catch (e) {
    console.warn(
      '[approveShop] storefront signed URL failed (non-fatal):',
      e,
    );
    // Leave storefrontImageUrl undefined → fallthrough to old
    // imageUrl (empty string for new shops). Trust Principle 1
    // is degraded but shop still approves successfully.
  }
}

// Then in the shops doc write, add:
imageUrl: storefrontImageUrl ?? '',
```

**IAM dependency:** This relies on the same `signBlob`
permission as PR 31's KYC upload. Already granted to the
compute service account during PR 31. No additional IAM work
needed — but the deploy plan must verify `approveShop`'s
Cloud Run IAM has `allUsers` binding (see Section F below).

### C. Make storefront photo mandatory in `RegisterShopScreen`

Currently the RegisterShop submit logic checks for Aadhaar but
not for storefront. Find the validation step and add storefront
to the required list.

Look for the submit button's disabled/enabled state — wherever
it currently checks for `kycDocs.aadhaar`, add an equivalent
check for `kycDocs.storefront`. The user-facing copy on the
upload tile should also change from "Storefront photo
(optional)" to "Storefront photo (required)" — find the label
in the JSX and update.

Error message if the user tries to submit without a storefront:
"Please upload a photo of your storefront before submitting. This
will be your shop's main image in the app."

### D. Shop card already handles it (verify, no code change)

After Section B ships, `shops/{id}.imageUrl` will hold the
signed URL. `ShopCard.tsx` already has the PR 41 hotfix that
renders `<Image>` when truthy, 🏪 placeholder when falsy. So
once URLs flow through, the card auto-upgrades to showing real
photos. No additional ShopCard changes needed.

Smoke test should confirm both paths work:
- New shop registered post-PR-42: real storefront photo shows
- Old shop (pre-PR-42) with `imageUrl: ""`: 🏪 placeholder
  still shows (no regression)

### E. Firebase Hosting deploy includes the new directory

`firebase.json` should already cover `dist/**`. Verify nothing
in `hosting.ignore` excludes `category-icons/`. If it does, fix
that.

Pre-flight test before shipping: after `firebase deploy --only
hosting`, hit
`https://grocery-mvp-dev.web.app/category-icons/atta-rice-dal.png`
in a browser. Should return the PNG. If it 404s, the file
isn't being deployed and the categoryConstants URLs will all
break.

### F. Cloud Run IAM verification (mandatory deploy step)

Per `.windsurf/deploy-discipline.md` "Cloud Run `allUsers`
invoker IAM" section. `approveShop` is being modified; after
`firebase deploy --only functions`, verify:

```powershell
gcloud run services get-iam-policy approveshop --region=asia-south1 --project=grocery-mvp-dev
```

Must show `allUsers` + `roles/run.invoker` in bindings. If
missing:

```powershell
gcloud run services add-iam-policy-binding approveshop --region=asia-south1 --member=allUsers --role=roles/run.invoker --project=grocery-mvp-dev
```

Without this verification, admin's first attempt to approve a
new shop after deploy will 401 silently and the shopkeeper
will be stuck on WaitingForApproval forever.

## Tests to add

1. `tests/functions/categoryConstants.test.ts` — extend existing
   test to confirm:
   - All 10 keys present (parity with `VALID_CATEGORIES`)
   - All URLs match the pattern
     `https://grocery-mvp-dev.web.app/category-icons/.+\.png`
   - No URL still references `placehold.co` (defense against
     half-merge)
2. `tests/integration/dist-category-icons-files.test.ts` —
   filesystem check that all 10 PNG files exist in
   `dist/category-icons/`. Fails loudly if any file is missing.
   Includes `generic.png` for the fallback path.
3. Update `tests/functions/approveShopHelpers.test.ts` (or
   create if doesn't exist) to test:
   - Storefront path is read from `pendingData.kycDocs.storefront
     .storagePath` correctly
   - Signed URL is generated (mocked)
   - Missing/null storefront path → `imageUrl` stays empty
     (non-fatal degradation)
4. Update `tests/screens/RegisterShopScreen.test.tsx` (if it
   exists) to assert submit is disabled until storefront is
   uploaded.

Aim for ~6 new test assertions. Full suite should be 730+
passing after this PR.

## Discipline checklist

- [ ] All hooks remain above any conditional returns in
      `RegisterShopScreen` (Rule of Hooks).
- [ ] No import auto-strip on the touched files.
- [ ] `firestore.rules` / `firestore.indexes.json` unchanged
      (no schema additions to existing types — `shop.imageUrl`
      is already declared).
- [ ] Don't strip the historical comment block above
      `CATEGORY_PLACEHOLDER_URLS` in `categoryConstants.ts`. The
      PR 32.1/32.2 lessons are still load-bearing for any future
      change.
- [ ] No new Firebase Functions secrets needed.
- [ ] No new permissions, no native rebuild.

## Deploy plan (read carefully)

This PR is **OTA + hosting + functions** — no native rebuild.
Three deploy steps; order matters.

Sequence:

1. `npm run test:unit` — green, suite passes.
2. **Hosting first** — `firebase deploy --only hosting`. This
   publishes the 10 PNGs at
   `https://grocery-mvp-dev.web.app/category-icons/*.png`.
   Verify with a browser tab before continuing.
3. **Functions second** — `firebase deploy --only functions`.
   This rolls out the updated `approveShop` logic + the new
   `categoryConstants.ts` URLs that
   `addCustomMenuItem` and `addExtractedMenuItems` use.
4. **Cloud Run IAM verification — MANDATORY per
   `.windsurf/deploy-discipline.md`.** Run:

   ```powershell
   gcloud run services get-iam-policy approveshop --region=asia-south1 --project=grocery-mvp-dev
   gcloud run services get-iam-policy addcustommenuitem --region=asia-south1 --project=grocery-mvp-dev
   gcloud run services get-iam-policy addextractedmenuitems --region=asia-south1 --project=grocery-mvp-dev
   ```

   All three must show `allUsers` + `roles/run.invoker`. If any
   is missing, apply `add-iam-policy-binding` per the discipline
   doc.

5. **Client OTA** — `eas update --branch production --message
   "PR 42 real category photos + storefront wiring"`.
6. **Trigger sanity test** on device after force-quit + reopen:
   - Sign in as Shopkeeper 2 (9999999994) and view the shop —
     shop card should now show the actual storefront photo
     (assuming KYC docs from earlier registration are still in
     storage; otherwise re-upload). Old: 🏪 placeholder. New:
     real photo.
   - On the existing menu, force a refresh — items should now
     show real category photos instead of placehold.co text.

## Smoke acceptance (add to `docs/PILOT_SMOKE_TEST_PLAN.md`
Phase 5)

1. **Existing menu items show real category photos.** Open the
   menu (sign in as any account, browse shop, look at item
   grid). Each item shows a real product photo derived from
   `categoryConstants.ts` URLs. No "?" rendering, no broken
   layouts.
2. **New scan-extracted items get real photos.** Re-scan a
   printed price list as the shop owner. Items added show real
   category photos.
3. **New manual-add items get real photos.** Add a custom item
   via AddCustomMenuItem. Picks the category, leaves photo
   empty. Item renders with the category photo, not the
   placeholder.
4. **New shop registration shows real storefront on shop
   card.** Register a new shop (test phone, full flow), upload
   a storefront photo, submit, admin approves. Customer view
   of the new shop shows the actual uploaded storefront photo,
   not the 🏪 placeholder.
5. **Old shop (pre-PR-42) without imageUrl still renders
   gracefully.** If any pre-PR-42 shop docs exist with
   `imageUrl: ""`, the ShopCard fallback (🏪) still renders.
   Use the existing `Sudhir Grocery Store` from yesterday's
   testing to verify if it's still in Firestore.
6. **Storefront photo is mandatory in RegisterShop.** Try to
   submit without uploading a storefront. Submit button is
   disabled OR shows error message. Upload photo → submit
   succeeds.

## Out of scope (defer)

- **Per-item photo upload by shop owners.** Each menu item
  could eventually have a real product photo (not just the
  category fallback). Already partially possible via PR 6.1's
  signed PUT URL infrastructure but UI doesn't expose it yet.
  Future PR — not pilot-blocking.
- **Image optimization / CDN.** Firebase Hosting serves the
  PNGs from its global CDN already; no work needed. Could
  introduce WebP variants later for perf, but 400×400 PNG is
  already small (~30-80KB each based on Pexels typical
  compression).
- **Logo redesign or theme.ts palette refresh.** Still PR 40
  scope.

## Definition of done

- All 10 category PNGs (+ generic.png) deployed to Firebase
  Hosting and accessible via browser.
- `categoryConstants.ts` URLs all point at
  `grocery-mvp-dev.web.app/category-icons/*.png`.
- `approveShop` writes a signed-read URL for the storefront
  photo into `shop.imageUrl` when KYC has one.
- RegisterShop blocks submission without a storefront upload.
- Cloud Run IAM verification step run + all three modified
  callables (`approveShop`, `addCustomMenuItem`,
  `addExtractedMenuItems`) have `allUsers` invoker.
- Unit suite green (730+).
- Smoke acceptance items 1-6 above all pass on device.
- Doc trail: CLAUDE.md + SESSION_LOG.md + ROADMAP.md updated
  with PR 42 shipped status. PILOT_SMOKE_TEST_PLAN.md Phase 5
  gets the 6 new acceptance items.
