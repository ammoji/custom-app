# PR 1 — Security hardening (Windsurf prompt)

## Why this PR exists

Code review on May 17 2026 (after Phase 12c shipped) surfaced three
launch-blocker security gaps and one test-coverage gap. None of them
break the happy path during family testing — but each one is exploitable
the day the app goes public.

The full review is in `PRELAUNCH_CHECKLIST.md` under "Code review
findings (May 17 2026) → PR 1 — Security hardening (launch blocker)".
This PR fixes all four items as a single coherent diff.

Pure server-side + rules + tests. No customer/owner/delivery UX
changes. Family testing won't notice the deploy.

## Read first

- `.windsurf/test-discipline.md` — tests run **once at end** + the
  deliberate-break demo. `npm test` is the runner.
- `.windsurf/deploy-discipline.md` — one `--only` target per command,
  no pipes, no auto-deploy from Windsurf.
- `firestore.rules` — current rules. Section to harden:
  `match /users/{userId}` (lines ~26-35) and
  `match /shops/{shopId}/menu/{menuItemId}` (lines ~52-62).
- `functions/src/index.ts` — `becomeDelivery` (line ~998) is the
  callable being removed; pattern for the new admin-approval flow
  is `registerShop` + `approveShop` (lines ~1414, ~1497).
- `tests/contracts/orderReadAuth.parity.test.ts` — the parity test
  pattern to copy. This test is the gold standard for catching
  rules-vs-functions auth drift.
- `functions/src/getOrderAuth.ts` — pattern for extracted auth
  helpers (`canReadOrder`); we'll add a similar helper for the new
  delivery-approval flow.

## Scope (in)

### Part 1 — Remove self-service `becomeDelivery`

1. **Delete the `becomeDelivery` callable** from
   `functions/src/index.ts`. Anyone with a `delivery` claim today
   should keep it (don't strip claims on existing users); the new
   restriction only applies to people requesting it after this
   deploy.

2. **Delete the client method** `orderService.becomeDelivery()` and
   any UI that calls it. Search for usages:
   - `src/screens/roles/BecomeDeliveryPartnerScreen.tsx` — this
     screen's CTA should be replaced with "Apply via admin" and a
     short form (see Part 2). Do NOT delete the screen — it's
     reachable from HomeScreen.
   - `src/screens/HomeScreen.tsx` — the "Become delivery partner"
     tile stays; it routes to the same screen.

3. **Add `requestDeliveryRole` callable** that writes a doc to
   `deliveryRequests/{uid}`:
   ```ts
   {
     uid: string,
     phone: string,            // from auth.token.phone_number
     name?: string,            // optional, from form
     vehicleType?: string,     // optional: bike / scooter / cycle
     city?: string,            // optional, for routing
     submittedAt: number,      // epoch ms
     status: 'pending',        // pending | approved | rejected
   }
   ```
   The callable should reject if the caller already has the
   `delivery` claim, or already has a `deliveryRequests/{uid}` doc
   with `status: 'pending'`. (One request per user at a time.)

4. **Add `approveDeliveryRole` callable** — admin-only, takes
   `{ uid: string }`. Sets the `delivery` claim via
   `mergeCustomClaims` (same helper `approveShop` uses), updates
   the request doc to `status: 'approved' + approvedAt + approvedBy`,
   mirrors `isDelivery: true` to `users/{uid}`, and pushes a
   notification to the user.

5. **Add `rejectDeliveryRole` callable** — admin-only, takes
   `{ uid: string, reason: string }`. Updates the request doc to
   `status: 'rejected' + rejectedAt + rejectedBy + rejectedReason`.
   Pushes a notification with the reason. Does NOT delete the doc
   (audit trail).

6. **Add `listPendingDeliveryRequests` callable** — admin-only,
   returns all `deliveryRequests` where `status == 'pending'`,
   ordered by `submittedAt` ascending (FIFO, mirrors
   `listPendingShops`).

### Part 2 — Client-side delivery request flow

7. **Rewrite `BecomeDeliveryPartnerScreen.tsx`** to render a form
   (name optional, vehicle type optional dropdown, city optional)
   that calls `orderService.requestDeliveryRole(form)`. On success,
   navigate to a new `DeliveryApprovalWaitingScreen` that polls the
   user's request status every 30s (mirror
   `WaitingForApprovalScreen.tsx` for shop registration).

8. **Create `DeliveryApprovalWaitingScreen.tsx`** — three states:
   - `pending`: "Your request is being reviewed. We'll notify you."
   - `approved`: "You're approved! Open the delivery dashboard."
     (button routes to `DeliveryDashboard`)
   - `rejected`: shows `rejectedReason`, button to "Edit and
     resubmit" (deletes the request doc, returns to the form).

9. **Add `getMyDeliveryRequest` callable** (no admin check, just
   `auth`) returning the caller's own request doc or null. Used by
   the polling screen.

10. **Add admin screen** `PendingDeliveryRequestsScreen.tsx` —
    mirror of `PendingShopsScreen.tsx`, but for delivery requests.
    Route from HomeScreen admin tiles.

11. **Add admin detail screen** `DeliveryRequestDetailScreen.tsx` —
    mirror of `ShopRegistrationDetailScreen.tsx`. Approve / reject
    buttons + reason modal.

12. **Register the two new admin routes** in
    `src/navigation/AppNavigator.tsx`. Add HomeScreen admin tile
    "🛵 Delivery requests".

### Part 3 — Firestore rules tightening

13. **`/users/{userId}` write rule** — currently allows arbitrary
    field writes on own doc. Tighten to a field whitelist. New rule:
    ```
    match /users/{userId} {
      allow read: if request.auth.uid == userId || isAdmin();
      allow create, update: if request.auth.uid == userId
        && request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly([
              'uid', 'phone', 'email', 'name',
              'addresses', 'defaultAddressId',
              'updatedAt', 'createdAt',
              'fcmTokens',  // see special-case rule below
            ]);
      allow delete: if false;
    }
    ```
    Note: clients DO need to write `fcmTokens` (for push registration).
    That's fine — `fcmTokens` is in the whitelist. The flags that are
    EXCLUDED from the whitelist are: `isAdmin`, `isShopOwner`,
    `shopId`, `isDelivery`, `deliveryStatus`. Those are only written
    by Cloud Functions (server-side, via Admin SDK which bypasses
    rules).

14. **`/shops/{shopId}/menu/{menuItemId}` read rule** — currently
    allows public read. Change to require parent shop active:
    ```
    match /shops/{shopId} {
      match /menu/{menuItemId} {
        allow read: if get(/databases/$(database)/documents/shops/$(shopId))
          .data.status == 'active' || isAdmin();
        allow create, update, delete: if false;
      }
    }
    ```
    **Performance note:** `get()` inside rules counts as a doc read
    against the rules quota. For an active shop's menu page, this
    adds 1 read per menu item evaluated. Acceptable for MVP scale
    (~34 items per shop); revisit if shops grow to 500+ items.

15. **Add `deliveryRequests/{uid}` rules:**
    ```
    match /deliveryRequests/{uid} {
      allow read: if request.auth.uid == uid || isAdmin();
      allow create: if request.auth.uid == uid;
      allow update, delete: if false;  // only Functions write
    }
    ```

### Part 4 — Parity test coverage

16. **Extend `tests/contracts/orderReadAuth.parity.test.ts`** to
    cover the auth boundary of:
    - `listShopOrders` (shopOwner-only, scoped to claims.shopId)
    - `listMyOrders` (customer-only, scoped to auth.uid)
    - `listAvailableDeliveries` (delivery-only)
    - `listShopMenuPublic` (no auth required, but shop must be active)
    - `listAllUsers` / `listAllShops` (admin-only)
    - `requestDeliveryRole` (signed-in, no existing request)
    - `approveDeliveryRole` / `rejectDeliveryRole` (admin-only)
    - `listPendingDeliveryRequests` (admin-only)
    - `getMyDeliveryRequest` (signed-in)

    Each entry asserts:
    - the Cloud Function's auth check
    - the Firestore rule (if direct read/write exists for this resource)
    - that they agree on the same matrix of (caller-role, target) →
      allow/deny

17. **Add `tests/functions/deliveryRequestHelpers.test.ts`** —
    pure-helper tests for any extracted validation logic
    (`validateDeliveryRequestInput`, `canApproveDeliveryRequest`,
    etc.). Mirror the `shopOrdersHelpers` / `profileHelpers`
    posture: callable wraps the helper; helper returns a
    discriminated `{ ok: true; ... } | { ok: false; code, message }`.

## Scope (out — explicitly defer)

- **Migrating existing delivery users to the approval flow** — anyone
  who already has the `delivery` claim keeps it. The new flow only
  gates future requests. Bulk audit + revoke can be a follow-up if
  needed.
- **Email/SMS for the admin when a new delivery request lands** —
  push notification to admin device is enough for MVP. Tracked as a
  follow-up.
- **Vehicle verification (license upload, vehicle reg)** — MVP
  collects vehicle type as a free-text dropdown only. Document
  upload is a post-launch feature.

## Acceptance checklist

- [ ] `becomeDelivery` callable removed from `functions/src/index.ts`.
      `Grep` confirms zero references in source.
- [ ] `orderService.becomeDelivery` method removed. `Grep` confirms
      zero callers.
- [ ] `requestDeliveryRole`, `approveDeliveryRole`,
      `rejectDeliveryRole`, `listPendingDeliveryRequests`,
      `getMyDeliveryRequest` callables added + deployed.
- [ ] `BecomeDeliveryPartnerScreen` rewritten as a form;
      `DeliveryApprovalWaitingScreen` created.
- [ ] `PendingDeliveryRequestsScreen` +
      `DeliveryRequestDetailScreen` created and routed.
- [ ] HomeScreen admin tile "🛵 Delivery requests" added.
- [ ] `firestore.rules` updated for `/users` whitelist,
      `/shops/*/menu` status gate, `/deliveryRequests/{uid}`. Rules
      compile clean.
- [ ] Parity test extended; all listed callables covered with
      allow/deny matrices.
- [ ] `npm test` passes — total ≥ baseline + N new tests where N is
      the count added by this PR (expect ≥ 15).
- [ ] Deliberate-break demo — pick one auth check (suggest
      `requestDeliveryRole`'s "already has delivery claim" guard),
      temporarily weaken it, confirm a test fails by name, revert.
- [ ] `npx tsc --noEmit` — 0 new errors (11 baseline preserved).
- [ ] `npm run audit:indexes` passes. The new
      `deliveryRequests` queries (where `status == 'pending'` orderBy
      `submittedAt`) may need a composite index — add to
      `firestore.indexes.json` if so.

## Deploy plan (hand to user)

Per `.windsurf/deploy-discipline.md`, one target per command, no pipes:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes   # only if new index added
firebase deploy --only functions:requestDeliveryRole,functions:approveDeliveryRole,functions:rejectDeliveryRole,functions:listPendingDeliveryRequests,functions:getMyDeliveryRequest
```

**Important:** when prompted about deleting `becomeDelivery`, answer
`Y` only after you've confirmed there are no active in-flight users
relying on it (search Sentry for recent `becomeDelivery` invocations).
If you're unsure, deploy WITHOUT the deletion first (use `--only`
flag to deploy only the new callables), then in a follow-up deploy
delete `becomeDelivery` once you've confirmed zero traffic.

After functions:list confirms the deploy, OTA the client:
```powershell
eas update --branch preview --message "PR 1: security hardening"
```

Test on preview channel with family-test devices before promoting to
production. The flow change (self-service → admin approval) is
user-visible for anyone trying to become a delivery partner — make
sure your admin device gets the OTA first so you can approve
incoming requests.

## Reporting back

- Output of `npm test` (final run, single execution per discipline).
- Output of `npx tsc --noEmit` (error count, baseline vs new).
- Deliberate-break demo: the test name that failed, the line you
  modified, confirmation of revert.
- List of new files + line counts.
- Any deviations from the spec (justified inline).
- The deploy commands you handed back to me, NOT executed by you.

## Design notes for Windsurf

- The delivery-approval flow should feel identical to the shop
  registration flow. Reuse `mergeCustomClaims`, `pushToUser`,
  `pushToAdmins` — they exist already.
- The `deliveryRequests` collection is new; pick the name carefully
  because the Firestore rule path is baked into client code via
  CRUD attempts. `deliveryRequests` is the safer name vs.
  `deliveryApplications` (shorter, matches existing
  `pendingShops` mental model).
- If you find yourself adding more than 4 fields to the request doc,
  push back — keep MVP small. Vehicle license, photo upload, KYC
  documents are all post-launch.
- One thing to NOT do: don't try to deduplicate the
  approve/reject flow with the existing `approveShop`/`rejectShop`.
  They look similar but the data model and the post-approval push
  notification text differ enough that extracting a generic helper
  obscures more than it saves.
