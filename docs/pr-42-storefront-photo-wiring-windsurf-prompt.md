# PR 42 — Storefront photo on shop card + mandatory in registration (Windsurf prompt)

> Note: This PR was originally drafted as a combined "category
> photos + storefront wiring" prompt. Sudhir split it on May 26
> 2026 — category photos require sourcing 10 Pexels PNGs that he
> doesn't have time for tonight, while storefront wiring is the
> higher-value piece that ships independently. The category-photos
> scope is preserved at `docs/pr-44-real-category-photos-
> windsurf-prompt.md` for a later cycle.

## Why this PR exists

PR 31 captures a storefront photo during shop self-registration —
the path lands in `pendingShopRequests/{id}.kycDocs.storefront
.storagePath`. But `approveShop` never wires that to
`shops/{shopId}.imageUrl`. Result: every newly-registered shop
has `imageUrl: ""` on the customer-facing doc, and customers see
the PR 41 hotfix's 🏪 emoji placeholder instead of the actual
storefront photo. Confirmed in the May 26 smoke test — Sudhir
Grocery Store was registered with a real KYC storefront photo
yet customers see a placeholder square.

This PR closes that gap end-to-end:

1. `approveShop` generates a v4 signed read URL for the
   storefront photo at approval time and writes it to
   `shops/{shopId}.imageUrl`.
2. RegisterShopScreen makes the storefront photo upload
   mandatory (currently optional in practice).
3. ShopCard already renders `<Image>` for truthy `imageUrl`
   per the PR 41 hotfix — no change needed there, but the
   smoke test should confirm both real-photo and placeholder
   paths still work.

Pilot impact: every shop tile in the customer-facing list
becomes "real photo of the actual shop" instead of an emoji
placeholder. Direct Trust Principle 1 win (visual quality
signals product seriousness).

## Read first

- `.windsurf/code-discipline.md` — Rules 8, 9 are both relevant
  (Zustand stable refs, Image URI guard). The latter is already
  applied in ShopCard via PR 41 hotfix.
- `.windsurf/deploy-discipline.md` — especially the "Cloud Run
  `allUsers` invoker IAM" section. `approveShop` is being
  touched; deploy plan MUST verify its IAM post-deploy.
- `functions/src/index.ts` near line 3383 (the existing
  `approveShop` callable). New signed-URL logic lands inside
  this function just before the `shops/{shopId}` doc write
  (around line 3414 where `status: 'active'` is set).
- `src/screens/roles/RegisterShopScreen.tsx` — the screen that
  uploads storefront. Locate the validation logic for the
  submit step.
- `src/components/shop/ShopCard.tsx` — already handles
  truthy/falsy `imageUrl` per the PR 41 hotfix. Verify only,
  no edits.

## Scope of changes

### A. `approveShop` signs a read URL for the storefront and writes to `shop.imageUrl`

`functions/src/index.ts`, inside the `approveShop` callable
(around line 3383). Locate the section where `shops/{shopId}`
doc is being written (look for `status: 'active'` near line
3414). Just before that write, generate a signed read URL for
the storefront photo:

```ts
// PR 42 — Wire storefront photo from KYC upload to the
// customer-facing shop.imageUrl. The storage path was captured
// during RegisterShop (PR 31) but never copied to imageUrl
// until now. Customers saw the 🏪 placeholder (PR 41 hotfix)
// for every newly-registered shop.
//
// Generate a v4 signed read URL. Long expiry (10 years) since
// the photo is non-sensitive shop branding — customers see it
// every time they browse the shop list, can't rotate per-call.
// If the storage path is missing (shouldn't happen post-PR-42
// mandatory enforcement but defend anyway), imageUrl stays
// empty and the client falls back to the 🏪 placeholder.
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
    // Leave undefined → fallthrough to empty imageUrl below.
    // Shop still approves; client renders the 🏪 placeholder.
  }
}

// Then inside the shops/{shopId} write, add:
imageUrl: storefrontImageUrl ?? '',
```

**IAM dependency:** This relies on the same `signBlob`
permission as PR 31's KYC upload. Already granted to the
compute service account during PR 31. No additional IAM
work needed for the signing itself — but the deploy plan
must verify `approveShop`'s Cloud Run `allUsers` invoker
binding (see Section D below).

### B. Make storefront photo mandatory in `RegisterShopScreen`

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
"Please upload a photo of your storefront before submitting.
This will be your shop's main image in the app."

### C. ShopCard renders real photo (verify only, no code change)

After Section A ships, `shops/{id}.imageUrl` will hold the
signed URL. `ShopCard.tsx` already has the PR 41 hotfix that
renders `<Image>` when truthy, 🏪 placeholder when falsy. So
once URLs flow through, the card auto-upgrades to showing real
photos. No additional ShopCard changes needed — but the smoke
test must confirm both paths still work:

- New shop registered post-PR-42: real storefront photo shows
- Old shop (pre-PR-42) with `imageUrl: ""`: 🏪 placeholder still
  shows (no regression)

If you find the existing Sudhir Grocery Store in Firestore has
`imageUrl: ""` and you want it to show the real photo, the
admin can re-approve it through the admin UI to trigger the
new signed-URL path — or run a one-off migration script. Both
are acceptable.

### D. Cloud Run IAM verification (mandatory deploy step)

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
new shop after deploy will 401 silently and the shopkeeper will
be stuck on WaitingForApproval forever.

## Tests to add

1. `tests/functions/approveShopHelpers.test.ts` — extend or
   create:
   - Storefront path is read from
     `pendingData.kycDocs.storefront.storagePath` correctly
   - Signed URL generation is mocked + called with correct
     arguments (10-year expires, v4, read action)
   - Missing/null storefront path → `imageUrl` stays empty
     (non-fatal degradation)
   - signBlob failure (mocked rejection) → `imageUrl` stays
     empty, function still resolves (catch logs but doesn't
     throw)
2. Update `tests/screens/RegisterShopScreen.test.tsx` if it
   exists — assert submit is disabled until storefront is
   uploaded.

Aim for ~4 new test assertions. Full suite should still be
green (~726+ after PR 41 lands).

## Discipline checklist

- [ ] Hooks remain above conditional returns in
      `RegisterShopScreen` (Rule of Hooks).
- [ ] No import auto-strip on the touched files.
- [ ] `firestore.rules` / `firestore.indexes.json` unchanged.
- [ ] No new schema fields — `shop.imageUrl` is already in the
      `Shop` type.
- [ ] No new Firebase Functions secrets needed.
- [ ] No new permissions, no native rebuild.

## Deploy plan

This PR is **OTA + functions** — no native rebuild, no hosting
deploy.

Sequence:

1. `npm run test:unit` — green.
2. **Server-first** — `firebase deploy --only functions`.
   Confirms `approveShop` shows up in `firebase functions:list`
   with a recent timestamp.
3. **Cloud Run IAM verification — MANDATORY**:
   ```powershell
   gcloud run services get-iam-policy approveshop --region=asia-south1 --project=grocery-mvp-dev
   ```
   Confirm `allUsers` + `roles/run.invoker` in bindings. Apply
   `add-iam-policy-binding` if missing.
4. **Client OTA** — `eas update --branch production --message
   "PR 42 storefront photo on shop card + mandatory in
   registration"`.
5. **Trigger sanity test** on device after force-quit + reopen:
   - Sign in as a fresh shop owner test phone
   - Submit a new shop registration WITH a storefront photo
   - Sign in as admin → approve the new shop
   - Sign in as customer → browse shops → confirm new shop's
     card shows the actual photo, not the 🏪 placeholder
   - Try to register another shop WITHOUT uploading storefront
     → submit should be disabled OR show error message
6. **Existing Sudhir Grocery Store**: admin re-approves it to
   trigger the new signed-URL path. (Or accept that the
   pre-existing shop renders the 🏪 placeholder until
   re-approved.)

## Smoke acceptance (add to `docs/PILOT_SMOKE_TEST_PLAN.md`
Phase 4)

1. **Storefront upload is now required.** As shop owner test
   phone, attempt to complete RegisterShop WITHOUT uploading
   a storefront. Submit button is disabled or shows error.
   Upload photo → submit succeeds.
2. **New shop's customer-facing card shows real photo.**
   Register a shop with a storefront photo → admin approves →
   customer browses → shop card shows the actual uploaded photo
   (not 🏪).
3. **Existing pre-PR-42 shops without `imageUrl` still
   render gracefully.** Confirm Sudhir Grocery Store (or any
   pre-PR-42 shop) still shows the 🏪 placeholder if its
   imageUrl is empty. No regression.
4. **Re-approval upgrades imageUrl.** Admin opens an existing
   shop (pre-PR-42) → re-approves through the admin UI → the
   shop's customer card now shows the real photo.

## Out of scope (defer)

- **Real category photos for menu items** — preserved at
  `docs/pr-44-real-category-photos-windsurf-prompt.md`.
  Needs Sudhir to source 10 Pexels PNGs first.
- **Per-item photo upload by shop owners** — future PR.
- **Image optimization / WebP variants** — Firebase Hosting
  CDN is enough for 400×400 PNG storefronts at pilot scale.

## Definition of done

- `approveShop` writes a signed-read URL into
  `shop.imageUrl` when KYC has a storefront path.
- RegisterShop blocks submission without a storefront upload
  and shows the new label/error copy.
- Cloud Run IAM verification step run; `approveShop` has
  `allUsers` invoker binding.
- Unit suite green (~726+ after PR 41 lands).
- Smoke acceptance items 1-4 all pass on device.
- Existing Sudhir Grocery Store either re-approved (with the
  real storefront photo) or left as-is with the 🏪
  placeholder. Either is acceptable.
- Doc trail: CLAUDE.md + SESSION_LOG.md + ROADMAP.md updated.
  PILOT_SMOKE_TEST_PLAN.md Phase 4 gets the 4 new acceptance
  items.
