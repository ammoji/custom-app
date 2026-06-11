# PR-NEXT-BUNDLE-B — Mid-flow UX (3 fixes)

**Source:** Sudhir's 2026-06-09 e2e retest. Three findings bundled — bigger than Bundle A because each touches the server side, but they're independent so they ship as one cohesive UX improvement to the order-fulfillment flow.

**Deploy class:** **server-first** (1 modified callable, 1 new callable accessor) → IAM verify → client OTA.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root and `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `npm run lint`, `npx eslint`
- `cd functions && npm run build` (compiles TS → lib/, does NOT deploy)
- File edits to files explicitly named in §A–§C below
- New file creation in directories explicitly named in the plan
- Re-running any of the above to verify after fixing an error

You MUST stop and ask before:

- Deploy commands: `firebase deploy …`, `eas update`, `eas build`, `gcloud run …`
- File deletes
- Force-push, rebase, branch ops
- Editing files NOT named in §A–§C
- Adding NEW dependencies not listed in the plan
- Schema additions / migrations not in the spec

Default posture: **execute, report at end.** Final summary should include: files changed, test count delta, tsc clean confirmation, any decisions made autonomously inside the green-light zone, any items deferred to a human decision.

## Schema audit-grep (Rule 5)

```
grep -rn "getLivePartnerEta\|deliveryDurationMin" src functions
grep -rn "getDeliveryPartnerContact\|Show partner phone" src
grep -rn "markDelivered\|proofPhotoUrl\|uploadDeliveryProof" src functions
grep -rn "order.customerUid\|order.shopId" functions/src
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `getLivePartnerEta` callable | `functions/src/index.ts:4353-4391` | Currently customer-only (gate: `order.customerUid === auth.uid`). Bundle extends gate to also allow shop owner of the order's shop. |
| `order.deliveryDurationMin` | `src/types/index.ts:463` | Static at-order estimate. Shop dashboard currently uses this. After Bundle B, shop reads live ETA from `getLivePartnerEta`. |
| `getDeliveryPartnerContact` | `functions/src/partnerContactHelpers.ts` | Returns `{ phone }`. Currently customer fetches on demand via "Show phone" button. Bundle changes UX to one-tap call. |
| `markDelivered` | (find via grep) | Server callable; currently lacks proof requirement. Bundle adds `proofPhotoUrl` validator. |
| `uploadDeliveryProof` | `src/utils/uploadDeliveryProof.ts` + `src/components/order/DeliveryProofViewer.tsx` | Upload + view already implemented. Just needs server-side gate making it required. |

## Plan

### §A — #9 ETA consistency: extend `getLivePartnerEta` to shop role + replace static ETA on shop dashboard

**Root cause:** Customer sheet uses live partner→drop ETA via `getLivePartnerEta` callable (PARTNER-CARD.2). Shop dashboard reads `order.deliveryDurationMin` which is the static at-order-time estimate. After the partner is en route, the static number is stale.

**Fix:** 
1. Server: extend `getLivePartnerEta`'s authorization gate to also allow `auth.token?.shopOwner === true && auth.token?.shopId === order.shopId`. Discriminated-union Result already covers the rejection codes; just one new "or" branch in the gate.
2. Client (shop dashboard): replace static `deliveryDurationMin` render with a live poll via the same `useLivePartnerEta(orderId, sheetOpen, orderStatus)` hook from Bundle A's §C. Shop sees the same minute count the customer sees.
3. Client (shop OrderDetail): same replacement.

**Files:**
- `functions/src/livePartnerEtaHelpers.ts` — extend `getLivePartnerEtaPure` gate to accept `auth: { uid: string; shopId?: string; isShopOwner?: boolean }` and pass-through. Update `not_customer` failure code to `not_authorized` (more accurate).
- `functions/src/index.ts` — `getLivePartnerEta` callable extracts the shopOwner claims and passes them through.
- `src/screens/shop/ShopOrderDetailScreen.tsx` — replace static ETA render with `useLivePartnerEta` call. Conditionally render based on order.status (don't poll for pending/accepted/cancelled).
- `src/screens/shop/ShopOwnerDashboardScreen.tsx` — same for the active-orders list.

**Test pin extension (+5 tests in `tests/functions/getLivePartnerEta.test.ts`):**
1. Shop owner of order's shop → ok, returns ETA
2. Shop owner of DIFFERENT shop → `not_authorized`
3. Customer of order → ok (regression of existing behavior)
4. Admin → currently NOT allowed (decision: add to a follow-up if needed; out of scope here)
5. No shop claim + not customer → `not_authorized`

### §B — #10 One-tap call (collapse "Show phone → reveal → Call" into single CTA)

**Root cause:** PARTNER-CARD.2 shipped a two-step UX: customer taps "Show partner phone" → callable fetches phone → button flips to "Call Rahul" → tap to dial. The reveal-then-call was over-engineered for privacy; phone is already gated to post-pickup server-side.

**Fix:** Single CTA "📞 Call partner". Tap → calls `getDeliveryPartnerContact` if phone not yet in component state → opens dialer in the same tap callback. Two-step disappears.

**Files:**
- `src/components/order/PartnerDetailsSheet.tsx` — collapse the three-branch phone disclosure (pre-pickup muted / reveal button / call link) into two branches (pre-pickup muted / single "📞 Call partner" CTA).
- Single async handler:
  ```ts
  const handleCallPartner = async () => {
    if (partnerPhone) {
      Linking.openURL(`tel:${partnerPhone}`);
      return;
    }
    try {
      setRevealing(true);
      const { phone } = await orderService.getDeliveryPartnerContact(order.id);
      setPartnerPhone(phone);
      Linking.openURL(`tel:${phone}`);
    } catch (e: any) {
      Alert.alert('Could not load phone', e?.message ?? 'Please try again.');
    } finally {
      setRevealing(false);
    }
  };
  ```
- `src/screens/OrderDetailScreen.tsx` — `onRevealPhone` handler simplified accordingly (remove the pre-fetch-on-tap-then-flip-button pattern).

No new tests — presentational + flow simplification.

### §C — #13 Mandatory delivery proof

**Root cause:** Partner can tap "Delivered" without uploading a proof photo. Server-side `markDelivered` doesn't validate. `DeliveryProofViewer` exists for displaying proofs but they're optional.

**Fix:** Server-side validator gates `markDelivered` on `order.proofPhotoUrl` being present (uploaded via `uploadDeliveryProof` before the markDelivered call). Client-side dashboard already shows an "Add delivery proof" affordance — surface a clearer error when partner tries to skip.

**Files:**
- `functions/src/index.ts` — find `markDelivered` (grep). Add validator at the top of the callable body: if `order.proofPhotoUrl` is missing or empty, throw `failed-precondition` with message `'Upload a delivery proof photo before marking delivered.'`.
- `functions/src/markDeliveredHelpers.ts` (new or extend existing) — extract the validator as a pure helper `validateMarkDeliveredProofGate(order)` returning Result. Reuse the discriminated-union pattern from `codDeliveryGate` and `livePartnerEtaHelpers`.
- `src/screens/delivery/DeliveryDashboardScreen.tsx` ActiveDeliveryCard — disable the "Delivered" button when `!order.proofPhotoUrl`. Inline hint above it: `📷 Upload delivery proof first` with a tappable shortcut to the existing upload flow.
- `src/screens/delivery/DeliveryOrderDetailScreen.tsx` — same gate.

**Test pin (+6 tests in `tests/functions/markDeliveredHelpers.test.ts`):**
1. Order with `proofPhotoUrl: 'https://...'` → ok
2. Order with `proofPhotoUrl: ''` → `no_proof`
3. Order with `proofPhotoUrl: undefined` → `no_proof`
4. Order with `proofPhotoUrl: null` → `no_proof`
5. Order with whitespace-only proofPhotoUrl `'   '` → `no_proof`
6. Edge: legacy order pre-PR without the field → `no_proof` (graceful — partner just uploads proof now)

## Discipline checklist

1. **Rule 1** — every new import / state read carries "PR-NEXT-BUNDLE-B — DO NOT REMOVE" comments.
2. **Rule 2** — `useLivePartnerEta` reads in shop screens sit with other top-level hooks.
3. **Rule 5** — schema audit-grep table in header confirms field names (`order.shopId`, `order.proofPhotoUrl`, etc.).
4. **Rule 7** — test fixtures use real schema field names; `auth.token` shape matches Firebase custom-claims convention.
5. **Rule 11** — IAM verify on `getLivePartnerEta` AND `markDelivered` post-deploy (both modified).
6. **Rule 14** — `validateMarkDeliveredProofGate` returns discriminated-union Result.
7. **Schema-additive only** — no field additions; just stricter validation on an existing field (`proofPhotoUrl`).
8. **Test discipline:** +5 (`getLivePartnerEta` shop-role) + 6 (`validateMarkDeliveredProofGate`) = **+11 tests minimum.** Suite trajectory roughly 1351 → ~1362 (assuming Bundle A landed first).

## Acceptance checklist

**§A ETA consistency:**
1. Customer places order, partner claims + picks up. Customer's partner sheet shows live ETA (e.g. "Arriving in ~7 min"). Shop's OrderDetail header now shows the same live "~7 min" — not the static at-order-time number.
2. After ~30s, both customer and shop ETAs refresh to the new live value (e.g. "~5 min"). They stay in lockstep.
3. **Negative — shop tries to read another shop's order ETA.** Manually invoke `getLivePartnerEta({orderId: <other shop's order>})` as a different shopOwner. Returns `not_authorized`.
4. **Regression — customer-side still works.** Customer reads live ETA on their own order. No change from PARTNER-CARD.2.

**§B One-tap call:**
5. Partner has picked up. Customer opens partner sheet, sees single "📞 Call partner" button.
6. Tap once → spinner briefly → dialer opens with partner's number pre-filled. Total: one tap, one screen transition (to dialer).
7. Re-open sheet. Phone is cached in component state. Tap "📞 Call partner" → dialer opens immediately (no callable round-trip).
8. **Pre-pickup state still shows muted "Phone shared once order is picked up"** (no regression of privacy posture).

**§C Mandatory delivery proof:**
9. Partner tries to tap "Delivered" without uploading proof. Button is disabled with `📷 Upload delivery proof first` hint.
10. Partner taps the upload affordance → camera roll → photo uploaded. Hint disappears. Delivered button enables.
11. Tap Delivered → server validates proofPhotoUrl present → status flips. Customer + shop + admin get push as expected.
12. **Negative — server-side bypass attempt.** Directly invoke `markDelivered({orderId})` with proofPhotoUrl missing in Firestore. Returns `failed-precondition`.
13. **Legacy orders (pre-PR, no proofPhotoUrl field)** — partner uploads proof first, then Delivered enables. Same as new orders.

**Cloud Run IAM (Rule 11):**
14. After deploy:
    ```
    gcloud run services get-iam-policy getlivepartnereta --region=asia-south1
    gcloud run services get-iam-policy markdelivered --region=asia-south1
    ```
    Verify `allUsers / roles/run.invoker` on both. Add binding if missing.

**Test suite:**
15. `npx tsc --noEmit` clean (root + functions). `npm run test:unit` clean. `npm run test:full` clean. Suite +11 minimum.

## Out of scope

- **Admin-role access to `getLivePartnerEta`** — could add if there's a pilot signal admins want live tracking; not asked for in Sudhir's findings. Deferred.
- **Customer-side "Call shop" with the same one-tap pattern** — the Call shop button on OrderDetail already opens dialer directly. No change needed.
- **Proof photo retake flow** — once a proof is uploaded, partner can't retake without admin intervention. Out of scope; admin can manually delete proofPhotoUrl in Firestore to allow retake (rare).
- **Server-side scan of proof photo for sanity (is it actually a photo of the delivered package?)** — pilot scale; trust the partner. Defer.

## Deploy

```
# Server first (Rule 11)
cd functions; npm run build; cd ..
firebase deploy --only "functions:getLivePartnerEta,functions:markDelivered"

# IAM verify both
foreach ($svc in 'getlivepartnereta','markdelivered') {
  gcloud run services get-iam-policy $svc --region=asia-south1 --project=grocery-mvp-dev
}

# Client OTA
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "PR-NEXT-BUNDLE-B mid-flow UX: #9 #10 #13"
```

(Per Autonomous execution authorization, you must stop and ask before running any deploy command. Sudhir will deploy after reviewing the diff.)

## Doc trail (Cowork handles post-ship, per Rule W)

After ship, Claude in Cowork will:
- Append findings #9, #10, #13 to `docs/TESTING-FINDINGS-2026-05-30.md` with `✅ SHIPPED in PR-NEXT-BUNDLE-B`
- Update `CLAUDE.md` In-flight work
- Append `docs/SESSION_LOG.md` paragraph
- Cross-reference with PARTNER-CARD.2's two-step phone disclosure (now collapsed)
