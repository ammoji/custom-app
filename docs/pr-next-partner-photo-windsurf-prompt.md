# PR-NEXT-PARTNER-PHOTO — Mandatory delivery partner photo at onboarding

**Source:** Sudhir's 2026-06-09 e2e finding #11: *"Make delivery partner photo mandatory. So customer and shop keeper can verify it is the right person."* Scope locked via pre-design check: mandatory at onboarding (not optional, not deferred).

**Design lens — identity verification at the door:** customer or shop opens their order detail / partner card → sees partner's photo + name → matches against the person standing at their door before handing over food or accepting cash. Photo is the trust signal. Without it, "Rahul Bhat" is just a string.

**Deploy class:** **server-first** (1 new callable for signed upload URL + `claimDelivery` modification + admin approval flow update) → IAM verify → client OTA.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root and `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `npm run lint`, `npx eslint`
- `cd functions && npm run build` (compiles TS → lib/, does NOT deploy)
- File edits to files explicitly named in §A–§E below
- New file creation in directories explicitly named in the plan
- Re-running any of the above to verify after fixing an error

You MUST stop and ask before:

- Deploy commands: `firebase deploy …`, `eas update`, `eas build`, `gcloud run …`
- File deletes
- Force-push, rebase, branch ops
- Editing files NOT named in §A–§E
- Adding NEW dependencies not listed in the plan
- Schema additions / migrations not in the spec
- Storage rules changes that don't match the spec exactly

Default posture: **execute, report at end.** Final summary should include: files changed, test count delta, tsc clean confirmation, any decisions made autonomously inside the green-light zone, any items deferred to a human decision.

## Schema audit-grep (Rule 5)

```
grep -rn "getShopKycUploadUrl\|recordShopKyc\|kycUploadHelpers" functions/src
grep -rn "deliveryRequests\b" functions/src src
grep -rn "claimDelivery\|deliveryPersonName\|deliveryPersonRating" functions/src
grep -rn "BecomeDeliveryPartnerScreen\|DeliveryRequestDetailScreen" src/screens
grep -rn "expo-image-picker\|ImagePicker" src
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `getShopKycUploadUrl` callable | `functions/src/index.ts:2001` | Existing signed-URL mint pattern. Mirror for partner photo upload (different storage path + ownership check). |
| `kycUploadHelpers.ts` | `functions/src/kycUploadHelpers.ts` | Pure helper module for KYC URL signing. PARTNER-PHOTO reuses the same signing primitive — extract a shared `mintSignedPutUrl(args)` helper if it isn't already shaped that way. |
| `deliveryRequests/{uid}` | written by `submitDeliveryRequest` (find via grep), read by admin approval screens | Bundle adds `profilePhotoUrl?: string` to the pending doc shape. Optional on legacy / in-flight requests; admin UI shows banner if missing on pending shop. |
| `claimDelivery` denormalization block | `functions/src/index.ts:3654-3700` (PARTNER-CARD.2 added rating/count/vehicleType here) | Extend the same block with `deliveryPersonPhotoUrl`. Same nullable / back-compat posture — legacy partners without photo render the initials fallback. |
| `BecomeDeliveryPartnerScreen.tsx` | `src/screens/roles/BecomeDeliveryPartnerScreen.tsx` | The form flow. Bundle adds a mandatory photo capture step. |
| `expo-image-picker` | already in dependencies? grep to confirm | If not present, add `"expo-image-picker": "~16.0.0"` (Expo SDK 54 compatible). Native module — flagged in deploy section as POTENTIAL native rebuild but check if existing modules already include it. |

## Design lens — affected surfaces

### §A — Delivery onboarding (`BecomeDeliveryPartnerScreen.tsx`)

```
┌─────────────────────────────────────┐
│ ← Become a Delivery Partner         │
├─────────────────────────────────────┤
│                                     │
│ Your photo *                        │
│                                     │
│   ┌─────────────────────────┐       │
│   │                         │       │
│   │      📷 Tap to add      │       │
│   │     your face photo     │       │
│   │                         │       │
│   └─────────────────────────┘       │
│                                     │
│ Used by customers + shopkeepers to  │
│ recognize you at the door. Required.│
│                                     │
│ Vehicle type *                      │
│ [ Motorbike ▾ ]                     │
│                                     │
│ Phone (from auth)                   │
│ +91 8888888885                      │
│                                     │
│                  [ Submit for review]│
└─────────────────────────────────────┘
```

After photo captured:

```
│ Your photo *                        │
│                                     │
│   ┌──────────┐                      │
│   │ [thumb]  │   ↻ Re-capture       │
│   └──────────┘                      │
│   ✅ Uploaded                        │
```

If photo capture is skipped or upload fails → "Submit" button hard-disabled with red hint: *"📷 Capture your face photo to continue. Customers and shopkeepers need it to recognize you."*

### §B — Customer's PartnerDetailsSheet (replace initials avatar)

```
┌───────────────────────────────────┐
│   ━━━━                            │
│                                   │
│   ┌───────┐                       │
│   │ [face]│   Rahul Bhat          │  ← photo replaces initials
│   │ photo │   ⭐ New partner       │
│   └───────┘                       │
│                                   │
│   🛵 On the way to you            │
│   ...                             │
```

Legacy partners without photo → render initials avatar (existing behavior). Same fallback ladder pattern as the "New partner · welcome them!" rating fallback.

### §C — Shop's ShopOrderDetailScreen (new photo display)

```
│ Delivery partner                  │
│ ┌───────┐                         │
│ │ [face]│   Rahul Bhat            │
│ │ photo │   🛵 Motorbike          │
│ └───────┘                         │
│ [ 📞 Call Rahul ]                 │  ← Bundle B added the call CTA
```

Currently the shop sees the partner's name + vehicle as text. PARTNER-PHOTO adds the photo above the name.

### §D — Admin verification (`DeliveryRequestDetailScreen.tsx`)

```
│ Pending delivery partner request  │
│                                   │
│ Photo                             │
│ ┌─────────────────┐               │
│ │                 │               │
│ │  [face photo]   │  Tap to       │
│ │                 │  enlarge ↗︎    │
│ │                 │               │
│ └─────────────────┘               │
│                                   │
│ Name: Rahul Bhat                  │
│ Phone: +91 8888888885             │
│ Vehicle: Motorbike                │
│                                   │
│ ☐ I verified the photo matches    │
│   a real person (not a logo /     │
│   stock photo / blurred image)    │
│                                   │
│ [ Reject ]   [ Approve ]          │
```

Approve hard-disabled until the verification checkbox is checked. Same posture as SHOP-LOCATION-REQUIRED's location-verification checkbox.

---

## Plan

### §A — Mandatory photo capture in onboarding

`src/screens/roles/BecomeDeliveryPartnerScreen.tsx`:

1. Add `expo-image-picker` import. If not in dependencies, add and run `npx expo install expo-image-picker` (Expo SDK 54). **Verify via grep first** — if already present, skip the install.
2. New local state: `photoUri: string | null`, `photoUploading: boolean`, `photoUploadedUrl: string | null`.
3. Render the photo capture card above the existing form fields per §A mockup. Tap "📷 Tap to add" → `ImagePicker.launchCameraAsync({ mediaTypes: 'images', allowsEditing: true, aspect: [1, 1], quality: 0.7, cameraType: ImagePicker.CameraType.front })`. Camera-only — no library option for the pilot (anti-fraud: harder to upload a stock photo). Photo gets cropped to square 1:1 for consistent avatar rendering.
4. On photo captured: call new `getPartnerPhotoUploadUrl` callable → returns `{ uploadUrl, storagePath }`. Client `fetch().blob()` the local URI + PUTs to the signed URL. On success, set `photoUploadedUrl` to the public download URL (derived from `storagePath` via existing storage URL builder if present, else use Firebase Storage SDK `getDownloadURL`).
5. Submit gate: `canSubmit = !!photoUploadedUrl && !photoUploading && (other existing checks)`. Inline hint when photo missing: *"📷 Capture your face photo to continue."*
6. Submit handler passes `profilePhotoUrl` in the `submitDeliveryRequest` payload (extend the callable's input shape).

### §B — New server callable: `getPartnerPhotoUploadUrl`

`functions/src/index.ts` — mirror `getShopKycUploadUrl` structure:

```ts
export const getPartnerPhotoUploadUrl = onCall<{ contentType: string }>(
  { cors: true, enforceAppCheck: false },
  async req => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const contentType = String(req.data?.contentType ?? '');
    if (!['image/jpeg', 'image/png'].includes(contentType)) {
      throw new HttpsError('invalid-argument', 'contentType must be image/jpeg or image/png');
    }
    const ext = contentType === 'image/jpeg' ? 'jpg' : 'png';
    const storagePath = `delivery-profile/${req.auth.uid}.${ext}`;
    const url = await mintSignedPutUrlPure({ // reuse existing helper if extractable
      bucket: getStorage().bucket(),
      path: storagePath,
      contentType,
      expiresMs: 5 * 60 * 1000, // 5 min, matches KYC URL convention
    });
    return { uploadUrl: url, storagePath };
  },
);
```

If `mintSignedPutUrlPure` doesn't exist as a shared helper, extract it from `kycUploadHelpers.ts` and reuse here. Same v4 signed URL pattern.

### §C — `submitDeliveryRequest` accepts `profilePhotoUrl` + writes to deliveryRequest doc

Find the existing `submitDeliveryRequest` callable (grep). Extend input shape with `profilePhotoUrl: string` (required, validated as a Firebase Storage URL). Write to `deliveryRequests/{uid}.profilePhotoUrl`. Validator returns discriminated-union Result per Rule 14:

```ts
type SubmitDeliveryRequestResult = Result<
  { requestId: string },
  | 'unauthenticated'
  | 'invalid_phone'
  | 'invalid_vehicle_type'
  | 'invalid_photo_url'      // ← new
  | 'photo_url_required'     // ← new
  | 'already_pending'
>;
```

The validator's `invalid_photo_url` branch checks: starts with `https://`, contains the project's storage bucket, references the `delivery-profile/${uid}` path (no cross-uid spoofing).

Pin with **+5 tests** in `tests/functions/submitDeliveryRequestHelpers.test.ts` (or wherever existing tests live): missing url → photo_url_required, malformed url → invalid_photo_url, cross-uid url → invalid_photo_url, success path, legacy in-flight request without photoUrl → photo_url_required.

### §D — Admin approval flow: verify photo + propagate URL to users/{uid}

`src/screens/admin/DeliveryRequestDetailScreen.tsx`:

1. Render the photo at the top of the request detail per §D mockup. Tap to enlarge (use existing `DeliveryProofViewer` pattern OR a simple `Modal` with `Image` filling the screen).
2. New `photoVerifiedChecked` useState (above conditional returns per Rule 2). Approve button disabled when unchecked.

Server-side `approveDeliveryRequest` callable (find via grep) extended to:
1. Copy `deliveryRequests/{uid}.profilePhotoUrl` → `users/{uid}.profilePhotoUrl` atomically with the existing claim grant.
2. Stamp `users/{uid}.photoVerifiedAt` + `users/{uid}.photoVerifiedBy: auth.uid` (audit trail, same pattern as SHOP-LOCATION-REQUIRED's locationVerifiedAt/By).

### §E — Denormalize photoUrl onto order at claim time

`functions/src/index.ts:3654-3700` (or wherever PARTNER-CARD.2's denormalization block lives):

```ts
// PR-NEXT-PARTNER-PHOTO — extend the denormalization block. Same
// nullable / back-compat posture as deliveryPersonRating /
// deliveryPersonDeliveriesCount / deliveryPersonVehicleType.
order.deliveryPersonPhotoUrl =
  typeof partner.profilePhotoUrl === 'string' && partner.profilePhotoUrl.length > 0
    ? partner.profilePhotoUrl
    : null;
```

Update `Order` type in `src/types/index.ts` with `deliveryPersonPhotoUrl?: string | null` next to the other denormalized partner fields.

Client-side `PartnerDetailsSheet.tsx` + `ShopOrderDetailScreen.tsx`:
- Read `order.deliveryPersonPhotoUrl`
- If present → render `<Image source={{ uri: photoUrl }} style={styles.partnerPhoto} />`
- If null/missing → render existing initials avatar (legacy fallback)

Pure helper `formatPartnerAvatar(name, photoUrl)` returns `{ kind: 'photo', uri } | { kind: 'initials', text }` — testable without rendering. Pin with **+4 tests** (photo present, photo null, photo empty string, name null + photo null).

---

## Discipline checklist

1. **Rule 1** — all new imports + state reads carry "PR-NEXT-PARTNER-PHOTO — DO NOT REMOVE" comments.
2. **Rule 2** — `photoUri` / `photoUploading` / `photoVerifiedChecked` useStates sit with other top-level hooks above conditional returns.
3. **Rule 5** — schema audit-grep table in header. `deliveryRequests/{uid}.profilePhotoUrl`, `users/{uid}.profilePhotoUrl`, `order.deliveryPersonPhotoUrl` all explicitly added with optional / nullable shapes.
4. **Rule 7** — test fixtures use the actual storage URL format from Firebase Storage; no fake `gs://` URIs in production-path tests.
5. **Rule 11** — IAM verify post-deploy on `getPartnerPhotoUploadUrl` (new), `submitDeliveryRequest` (modified), `approveDeliveryRequest` (modified), `claimDelivery` (modified). 4 services total.
6. **Rule 13** — no new bottom-anchored modals. The "tap to enlarge" admin photo viewer is a full-screen Modal, not a sheet.
7. **Rule 14** — `submitDeliveryRequest`'s validator returns discriminated-union Result.
8. **Schema-additive only** — 3 new optional fields (1 on `deliveryRequests`, 1 on `users`, 1 on `order`). Legacy entities render initials avatar via fallback.
9. **Storage rules** — `delivery-profile/{uid}.*` writable by `request.auth.uid === uid` (signed-URL path; client uses the signed URL, but defense in depth on the rule). Readable publicly (so customer + shop apps can render the photo without auth tokens — same posture as KYC docs which are admin-only-readable; partner photos are PUBLIC by design). Add this to `storage.rules` and document the read-public posture.
10. **Test discipline:** **+5** (submitDeliveryRequest validator) + **+4** (formatPartnerAvatar) = **+9 tests minimum.** Suite trajectory roughly 1362 → ~1371 (assuming Bundle B landed first).

---

## Acceptance checklist

**§A Onboarding mandatory photo:**

1. Sign in as a fresh user (not yet a partner). Open BecomeDeliveryPartner. Submit button disabled with red hint "📷 Capture your face photo to continue."
2. Tap photo capture card → front-facing camera opens. Take photo → crop to square → upload. Spinner briefly. Thumbnail + "✅ Uploaded" appears.
3. Submit enables. Submit goes through. Lands on DeliveryApprovalWaitingScreen.
4. **Negative — bypass attempt.** Directly invoke `submitDeliveryRequest({ profilePhotoUrl: '' })` (or omit it). Server returns `photo_url_required`.
5. **Negative — cross-uid URL.** Invoke with `profilePhotoUrl: 'https://.../delivery-profile/<other-uid>.jpg'`. Server returns `invalid_photo_url`.

**§D Admin verification:**

6. Sign in as admin. Open the pending delivery request. Photo visible at the top. Tap photo → fullscreen preview opens. Tap close.
7. Verification checkbox unchecked → Approve disabled. Check → Approve enables.
8. Approve → server copies URL to `users/{uid}.profilePhotoUrl`, stamps `photoVerifiedAt`/`By`, grants claim.

**§E Denormalization + display:**

9. Newly-approved partner claims a fresh order. Customer opens PartnerDetailsSheet → photo renders (no initials).
10. Shop opens ShopOrderDetailScreen → photo renders next to partner name.
11. **Legacy fallback:** manually set `order.deliveryPersonPhotoUrl: null` on a test order in Firestore. Customer sheet renders initials avatar. No red box.

**Cloud Run IAM (Rule 11):**

12. After deploy:
    ```
    foreach ($svc in 'getpartnerphotouploadurl','submitdeliveryrequest','approvedeliveryrequest','claimdelivery') {
      gcloud run services get-iam-policy $svc --region=asia-south1 --project=grocery-mvp-dev
    }
    ```
    Confirm `allUsers / roles/run.invoker` on each. Add binding if missing.

**Storage rules:**

13. Sign in as Partner A. Try to upload directly to `delivery-profile/<partner-B-uid>.jpg` via Firebase Storage SDK (NOT via signed URL). Should fail with permission-denied.
14. Sign in as a non-partner user. Try to download `delivery-profile/<partner-uid>.jpg` directly. Should succeed (public read).

**Test suite:**

15. `npx tsc --noEmit` clean (root + functions). `npm run test:unit` clean. `npm run test:full` clean. Suite +9 minimum.

---

## Out of scope

- **Editing photo post-approval** — partner can't update their photo after onboarding without admin intervention. Edge case; defer until pilot signal demands it.
- **Photo re-verification cadence** — quarterly re-verification of partner photo. Defer.
- **Face-detection / sanity check** on the uploaded image (is it actually a face? — not a logo or blurred). Trust admin's eye for pilot. Could add Vision API check later.
- **Auto-rotation for portrait/landscape** photos. `ImagePicker`'s `allowsEditing + aspect: [1,1]` handles crop; orientation usually comes through correctly via EXIF.
- **Backfill photoUrl for legacy partners** approved before this PR. Initials fallback covers them; they can re-onboard via a manual admin flow if they want photo visibility.

---

## Deploy

```
# Server first (Rule 11)
cd functions; npm run build; cd ..
firebase deploy --only "functions:getPartnerPhotoUploadUrl,functions:submitDeliveryRequest,functions:approveDeliveryRequest,functions:claimDelivery"

# IAM verify all 4
foreach ($svc in 'getpartnerphotouploadurl','submitdeliveryrequest','approvedeliveryrequest','claimdelivery') {
  gcloud run services get-iam-policy $svc --region=asia-south1 --project=grocery-mvp-dev
}

# Storage rules
firebase deploy --only storage

# Client OTA
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "PR-NEXT-PARTNER-PHOTO mandatory delivery partner photo"
```

(Per Autonomous execution authorization, you must stop and ask before running any deploy command. Sudhir will deploy after reviewing the diff. Also flag: if `expo-image-picker` was newly added as a dependency, a native rebuild via `eas build` is required before the OTA can ship. Check existing dependencies + plugin block first.)

## Doc trail (Cowork handles post-ship, per Rule W)

After ship, Claude in Cowork will:
- Append finding #11 to `docs/TESTING-FINDINGS-2026-05-30.md` with `✅ SHIPPED in PR-NEXT-PARTNER-PHOTO`
- Update `CLAUDE.md` In-flight work
- Append `docs/SESSION_LOG.md` paragraph
- Cross-reference PARTNER-CARD.2's denormalization block (now extended with photoUrl)
