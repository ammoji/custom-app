# PR-NEXT-6 — Delivery proof photo capture + multi-surface display + payment-method visibility

**Source:** Findings #13, #16(c), and #16(d) in `docs/TESTING-FINDINGS-2026-05-30.md`.

**Deploy class:** server-first + storage rules + client OTA. Three steps:

1. `firebase deploy --only "functions:getDeliveryProofUploadUrl,functions:recordDeliveryProofUpload,functions:getDeliveryProofReadUrl"` + IAM verify on all three new callables (recurring `allUsers` strip gotcha).
2. `firebase deploy --only storage` — adds the deny-all `/delivery-proofs/` rule. Has to land BEFORE the client OTA or a misbehaving client could try a direct upload during the gap.
3. `eas update --branch production --message "PR-NEXT-6 delivery proof photo"`.

No `app.json` change, no native module change, no permission change — `expo-image-picker` is already wired (PR 6 for menu images, PR 31 for KYC). The camera + photo-library permission strings are already in `Info.plist` / `AndroidManifest.xml`.

**Read first**

1. `CLAUDE.md` (full)
2. `docs/TESTING-FINDINGS-2026-05-30.md` — findings #13 + #16
3. `.windsurf/code-discipline.md` (Rules 2, 3, 4, 11)
4. `.windsurf/deploy-discipline.md` — "Cloud Run IAM" + "Signed-URL IAM" sections
5. `.windsurf/test-discipline.md`
6. `src/utils/imageUpload.ts` — existing `pickAndResizeImage` pipeline (reuse verbatim)
7. `src/utils/imageUpload.ts` callers: `src/screens/roles/RegisterShopScreen.tsx` (KYC) + `src/screens/shop/ScanMenuScreen.tsx` (menu scan) for the pick-flow pattern
8. `functions/src/menuImageUploadHelpers.ts` — pure helper template for the upload-URL auth gate
9. `functions/src/index.ts:1871-1925` — `getMenuImageUploadUrl` callable (the v4 signed-PUT pattern this PR mirrors)
10. `functions/src/index.ts:3600-3700` — `markDelivered` callable (we do NOT add a precondition here; photo is optional)
11. `functions/src/index.ts:3513-3598` — `markPickedUp` (where `pickedUpAt` gets stamped — the photo gate uses this as a precondition)
12. `src/screens/delivery/DeliveryDashboardScreen.tsx:506-563` (`handleDelivered`) and the `ActiveDeliveryCard` block around line 1161 — insertion point for the photo CTA
13. `storage.rules` — add a new `/delivery-proofs/` block alongside `/menu/` + `/shop-kyc/`
14. `src/screens/shop/ShopOrderDetailScreen.tsx` — insertion point for the proof viewer on the shop side
15. `src/screens/OrderDetailScreen.tsx` — customer-side display
16. `src/screens/admin/` — find the right admin screen for an order detail view (likely `OrderManagementScreen` or `AdminOrderDetailScreen` — grep for it; insertion point is wherever payment/delivery metadata renders)

---

## Why this PR exists

Three related gaps the pilot will hit on dispute day one:

1. **Finding #13 — Delivery proof photo.** When a customer says "they never delivered" or "items were missing," the only thing the operator can produce today is a `deliveredAt` timestamp. That's not evidence — it's a partner's self-attestation. A doorstep / handoff photo at the moment of delivery is the cheapest dispute-prevention tool we can ship.

2. **Finding #16(c) — Photo embedded in the delivery-complete flow.** Photo should sit alongside the existing Delivered CTA (and the new COD-confirm pills from PR-NEXT-3), not be a separate flow the partner has to remember.

3. **Finding #16(d) — Shop/admin order detail surfaces payment method + photo.** Today the shop sees only the order line items + the customer's rating. Without payment-method + proof visible on the order, the shop can't independently verify the partner's work. Surfacing both makes the order-detail screen a complete record of what happened.

### Design tensions resolved upfront

- **Photo is OPTIONAL, not required to deliver.** Real situations: customer asks the partner to leave at door and walk away; lighting / weather is uncooperative; partner's camera permission is denied. A required-photo gate would block legitimate deliveries. Trust the partner; the photo is a force-multiplier when present, not a guard. (Can revisit post-pilot if dispute volume warrants.)
- **Read access uses on-demand signed-READ URLs (KYC pattern), not public download tokens.** Delivery photos contain doorstep / building / customer-handoff imagery — PII-adjacent. Mirrors `getShopKycReadUrls` from PR 31. The trade-off is one extra callable round trip per render of the order detail screen; the security upside is that a leaked URL goes stale in 15 minutes instead of forever (the download-token pattern PR 42.0.2 chose for storefront photos is appropriate for genuinely public content, not for this).
- **Path is `delivery-proofs/{orderId}.jpg`** (single image per order; re-upload overwrites). One photo per order is enough for v1; multi-photo gallery is out of scope.
- **No upload window.** Anytime after pickup, indefinitely. A "freeze after delivered+1h" policy is theoretically tidier but adds complexity for a pilot-scale problem we don't have data on yet. If a partner uploads a misleading photo days later during a dispute, that's solvable via existing admin override + the rating system; doesn't justify the policy code now.

---

## Plan

### §A — Server: storage rules + signed-URL callables + record-confirm

Files touched:

- `storage.rules` (modify) — §A.1
- `functions/src/deliveryProofHelpers.ts` (new) — §A.2
- `functions/src/index.ts` (three new callables) — §A.3
- `tests/functions/deliveryProofHelpers.test.ts` (new) — §A.4

#### §A.1 — Storage rules: deny-all `/delivery-proofs/`

Add this block alongside the existing `/menu/` and `/shop-kyc/` blocks:

```
// PR-NEXT-6 — Delivery proof photos. Same signed-URL pattern as
// /menu/ and /shop-kyc/: writes go through
// `getDeliveryProofUploadUrl` (v4 signed PUT), reads through
// `getDeliveryProofReadUrl` (v4 signed READ), so direct client
// reads and writes are denied here. Read auth is role-mixed
// (customer of the order, shop owner of the shop, admin, the
// assigned delivery partner) which is too complex to express in
// rules — the callable evaluates it server-side from the order
// doc on every request.
match /delivery-proofs/{filename} {
  allow read: if false;
  allow write: if false;
}
```

#### §A.2 — Pure helpers `functions/src/deliveryProofHelpers.ts`

Three pure helpers — auth + precondition gates for the three new callables. Same posture as `menuImageUploadHelpers.ts` / `codPaymentHelpers.ts`: validators return tagged `{ok}` Results, the callable throws `HttpsError` from the code field. Allows the helper suite to pin every branch without spinning up `firebase-admin`.

```ts
/**
 * PR-NEXT-6 (findings #13, #16) — pure auth + precondition helpers
 * for the three delivery-proof callables.
 *
 * Mirrors the validator-Result pattern from `codPaymentHelpers` +
 * `menuImageUploadHelpers`: each helper returns a tagged union so
 * the wrapping callable in `index.ts` is a thin Firestore + HttpsError
 * shell and the auth/precondition matrix can be pinned without
 * booting firebase-admin.
 *
 * The three call-sites this serves:
 *   1. `validateDeliveryProofUploadAuth`  — `getDeliveryProofUploadUrl`
 *      mints a signed PUT for the assigned delivery partner of an
 *      already-picked-up order.
 *   2. `validateDeliveryProofRecordInput` — `recordDeliveryProofUpload`
 *      stamps the order doc; defends against a forged record-call
 *      carrying another order's storagePath via path-prefix check.
 *   3. `validateDeliveryProofReadAuth`    — `getDeliveryProofReadUrl`
 *      role-mixed: customer of the order, shop owner of the shop,
 *      admin, or the assigned delivery partner. None of those alone
 *      is sufficient — every one of them needs an independent gate.
 */

export type DeliveryProofUploadAuthInput = {
  auth:
    | {
        uid: string;
        token?: {
          delivery?: unknown;
        };
      }
    | null
    | undefined;
  order: {
    deliveryPersonId?: string | null;
    pickedUpAt?: number | null;
  } | null;
};

export type DeliveryProofUploadAuthResult =
  | { ok: true }
  | {
      ok: false;
      code: 'unauthenticated' | 'permission-denied' | 'failed-precondition' | 'not-found';
      message: string;
    };

export function validateDeliveryProofUploadAuth(
  input: DeliveryProofUploadAuthInput,
): DeliveryProofUploadAuthResult {
  const { auth, order } = input;
  if (!auth || typeof auth.uid !== 'string' || !auth.uid) {
    return { ok: false, code: 'unauthenticated', message: 'Sign in required' };
  }
  if (auth.token?.delivery !== true) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Only delivery partners can upload proof photos',
    };
  }
  if (!order) {
    return { ok: false, code: 'not-found', message: 'Order not found' };
  }
  if (order.deliveryPersonId !== auth.uid) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Not the assigned delivery partner',
    };
  }
  if (typeof order.pickedUpAt !== 'number' || order.pickedUpAt <= 0) {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Pick up the order before uploading a proof photo',
    };
  }
  return { ok: true };
}

/**
 * Storage path validator for the record-confirm callable. The client
 * passes back the `storagePath` the upload callable handed it; we
 * re-verify the path matches the expected scheme for the orderId.
 * Defends against a forged record-call from one shopper's session
 * pointing at another order's path.
 *
 * Expected format: `delivery-proofs/{orderId}.jpg` exactly. No
 * sub-paths, no extension variants. The upload callable mints the
 * same path so a legitimate flow always matches.
 */
export function validateDeliveryProofRecordInput(input: {
  orderId: string;
  storagePath: string;
}): { ok: true; storagePath: string } | { ok: false; code: 'invalid-argument'; message: string } {
  const { orderId, storagePath } = input;
  if (typeof orderId !== 'string' || !orderId) {
    return { ok: false, code: 'invalid-argument', message: 'orderId required' };
  }
  if (typeof storagePath !== 'string' || !storagePath) {
    return { ok: false, code: 'invalid-argument', message: 'storagePath required' };
  }
  const expected = `delivery-proofs/${orderId}.jpg`;
  if (storagePath !== expected) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'storagePath does not match the expected scheme for this order',
    };
  }
  return { ok: true, storagePath: expected };
}

export type DeliveryProofReadAuthInput = {
  auth:
    | {
        uid: string;
        token?: {
          admin?: unknown;
          shopOwner?: unknown;
          shopId?: unknown;
          delivery?: unknown;
        };
      }
    | null
    | undefined;
  order: {
    customerUid?: string | null;
    shopId?: string | null;
    deliveryPersonId?: string | null;
    deliveryProofStoragePath?: string | null;
  } | null;
};

export type DeliveryProofReadAuthResult =
  | { ok: true; storagePath: string }
  | {
      ok: false;
      code: 'unauthenticated' | 'permission-denied' | 'not-found';
      message: string;
    };

export function validateDeliveryProofReadAuth(
  input: DeliveryProofReadAuthInput,
): DeliveryProofReadAuthResult {
  const { auth, order } = input;
  if (!auth || typeof auth.uid !== 'string' || !auth.uid) {
    return { ok: false, code: 'unauthenticated', message: 'Sign in required' };
  }
  if (!order) {
    return { ok: false, code: 'not-found', message: 'Order not found' };
  }
  if (
    typeof order.deliveryProofStoragePath !== 'string' ||
    !order.deliveryProofStoragePath
  ) {
    return {
      ok: false,
      code: 'not-found',
      message: 'No proof photo on this order',
    };
  }
  const isAdmin = auth.token?.admin === true;
  const isCustomerOfOrder =
    typeof order.customerUid === 'string' && order.customerUid === auth.uid;
  const isShopOwnerOfShop =
    auth.token?.shopOwner === true &&
    typeof auth.token?.shopId === 'string' &&
    typeof order.shopId === 'string' &&
    auth.token.shopId === order.shopId;
  const isAssignedPartner =
    auth.token?.delivery === true &&
    typeof order.deliveryPersonId === 'string' &&
    order.deliveryPersonId === auth.uid;
  if (!(isAdmin || isCustomerOfOrder || isShopOwnerOfShop || isAssignedPartner)) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Not authorised to view this proof',
    };
  }
  return { ok: true, storagePath: order.deliveryProofStoragePath };
}
```

#### §A.3 — Callable wrappers in `index.ts`

Insert near the existing `markDelivered` + `markPickedUp` block. The three callables, in order:

```ts
import {
  validateDeliveryProofUploadAuth,
  validateDeliveryProofRecordInput,
  validateDeliveryProofReadAuth,
} from './deliveryProofHelpers';

// PR-NEXT-6 (findings #13, #16) — mint a v4 signed PUT URL for the
// delivery partner to upload a proof photo against an order they've
// picked up. Same signed-URL posture as `getMenuImageUploadUrl` (PR
// 6.1) + `getShopKycUploadUrl` (PR 31): admin SDK signing bypasses
// Storage rules at signing time, so `/delivery-proofs/` can stay
// write-deny. 15-min expiry. contentType bound to image/jpeg.
export const getDeliveryProofUploadUrl = onCall<{ orderId: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const orderId = request.data?.orderId;
    if (typeof orderId !== 'string' || !orderId) {
      throw new HttpsError('invalid-argument', 'orderId required');
    }
    const ref = db.doc(`orders/${orderId}`);
    const snap = await ref.get();
    const order = snap.exists ? (snap.data() as any) : null;

    const check = validateDeliveryProofUploadAuth({
      auth: request.auth
        ? {
            uid: request.auth.uid,
            token: request.auth.token as unknown as { delivery?: unknown },
          }
        : null,
      order,
    });
    if (!check.ok) {
      throw new HttpsError(check.code, check.message);
    }

    // Path is deterministic — one proof per order. Re-upload
    // overwrites cleanly. Mirrors the v4 signed-URL config from
    // getMenuImageUploadUrl.
    const storagePath = `delivery-proofs/${orderId}.jpg`;
    const bucket = getStorage().bucket();
    const file = bucket.file(storagePath);
    const expiresAt = Date.now() + 15 * 60 * 1000;
    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: expiresAt,
      contentType: 'image/jpeg',
    });
    return { uploadUrl, storagePath, expiresAt };
  },
);

// PR-NEXT-6 — stamp the order doc with the proof storagePath +
// timestamp once the PUT has succeeded. Re-runs the auth gate +
// validates the storagePath matches the expected scheme for the
// orderId (defends against forged record-calls). Does NOT mint or
// store a read URL — those are minted on demand by
// getDeliveryProofReadUrl so a leaked link goes stale.
export const recordDeliveryProofUpload = onCall<{
  orderId: string;
  storagePath: string;
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const inputCheck = validateDeliveryProofRecordInput({
      orderId: request.data?.orderId,
      storagePath: request.data?.storagePath,
    });
    if (!inputCheck.ok) {
      throw new HttpsError(inputCheck.code, inputCheck.message);
    }
    const { storagePath } = inputCheck;
    const ref = db.doc(`orders/${request.data.orderId}`);
    const snap = await ref.get();
    const order = snap.exists ? (snap.data() as any) : null;

    const authCheck = validateDeliveryProofUploadAuth({
      auth: request.auth
        ? {
            uid: request.auth.uid,
            token: request.auth.token as unknown as { delivery?: unknown },
          }
        : null,
      order,
    });
    if (!authCheck.ok) {
      throw new HttpsError(authCheck.code, authCheck.message);
    }
    await ref.update({
      deliveryProofStoragePath: storagePath,
      deliveryProofUploadedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  },
);

// PR-NEXT-6 — mint a v4 signed READ URL for the proof photo. Read
// auth is role-mixed (customer of the order, shop owner of the shop,
// admin, or the assigned delivery partner); each is checked
// independently in the pure helper. Same expiry tier as the upload
// URL — short enough that a leaked link goes stale, long enough to
// not flake on a slow re-render.
export const getDeliveryProofReadUrl = onCall<{ orderId: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const orderId = request.data?.orderId;
    if (typeof orderId !== 'string' || !orderId) {
      throw new HttpsError('invalid-argument', 'orderId required');
    }
    const ref = db.doc(`orders/${orderId}`);
    const snap = await ref.get();
    const order = snap.exists ? (snap.data() as any) : null;

    const check = validateDeliveryProofReadAuth({
      auth: request.auth
        ? {
            uid: request.auth.uid,
            token: request.auth.token as unknown as {
              admin?: unknown;
              shopOwner?: unknown;
              shopId?: unknown;
              delivery?: unknown;
            },
          }
        : null,
      order,
    });
    if (!check.ok) {
      throw new HttpsError(check.code, check.message);
    }
    const bucket = getStorage().bucket();
    const file = bucket.file(check.storagePath);
    const expiresAt = Date.now() + 15 * 60 * 1000;
    const [readUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: expiresAt,
    });
    return { readUrl, expiresAt };
  },
);
```

**Cloud Run IAM check after deploy (recurring gotcha):** verify `allUsers` / `roles/run.invoker` on all THREE new callables.

```
gcloud run services get-iam-policy getdeliveryproofuploadurl --region asia-south1
gcloud run services get-iam-policy recorddeliveryproofupload --region asia-south1
gcloud run services get-iam-policy getdeliveryproofreadurl --region asia-south1
```

If missing on any, add with `add-iam-policy-binding`. Document the verification in the commit message.

#### §A.4 — Tests `tests/functions/deliveryProofHelpers.test.ts`

Exhaustive pin of the three validators. Target ~25 cases. Highlights:

- **Upload auth:** unauthenticated → reject. No `delivery` claim → reject. Order missing → not-found. Wrong assignee → permission-denied. `pickedUpAt` null/missing/0/negative → failed-precondition. Happy path → ok.
- **Record input:** missing orderId → invalid-argument. Missing storagePath → invalid-argument. storagePath with sub-paths (e.g. `delivery-proofs/{orderId}/extra/file.jpg`) → invalid-argument. storagePath for a different orderId → invalid-argument. storagePath wrong extension (e.g. `.png`) → invalid-argument. Happy path → ok with normalised path.
- **Read auth:** Each of the four roles independently → ok. Admin without any other role → ok. Customer of a different order → permission-denied. Shop owner of a different shop → permission-denied. Delivery partner not assigned → permission-denied. Random signed-in user with no relevant relationship → permission-denied. Order missing → not-found. Order without proof yet → not-found.

Use `tests/functions/codPaymentHelpers.test.ts` as the style template — fixture builders for common shapes.

---

### §B — Schema additions on Order

Files touched:

- `src/types/index.ts` (modify) — §B.1
- `functions/src/types.ts` (if separate) — keep in sync

#### §B.1 — Two new optional fields on `Order`

```ts
// PR-NEXT-6 (findings #13, #16) — delivery proof photo. Storage
// path only; read URLs are minted on demand by
// getDeliveryProofReadUrl so leaked URLs go stale. Path scheme is
// `delivery-proofs/{orderId}.jpg` — one photo per order, re-upload
// overwrites cleanly.
deliveryProofStoragePath?: string;
// Timestamp of the most recent upload (millis). Updated by
// recordDeliveryProofUpload via serverTimestamp().
deliveryProofUploadedAt?: number | null;
```

**Schema-additive (code-discipline Rule 4).** Both fields optional, default-absent → unaffected. No migration needed.

Do NOT add `deliveryProofUrl` to the order doc. Storing a long-lived URL here would defeat the signed-read-URL security model.

---

### §C — Client upload pipeline

Files touched:

- `src/services/orderService.ts` (three new methods) — §C.1
- `src/utils/uploadDeliveryProof.ts` (new) — §C.2
- `src/screens/delivery/DeliveryDashboardScreen.tsx` (modify — `ActiveDeliveryCard` block) — §C.3
- `tests/utils/uploadDeliveryProof.test.ts` (new — minimal smoke pin) — §C.4

#### §C.1 — Three new service methods

Mirror the existing `getMenuImageUploadUrl` wrapper style in `orderService.ts`:

```ts
async getDeliveryProofUploadUrl(orderId: string): Promise<{
  uploadUrl: string;
  storagePath: string;
  expiresAt: number;
}>,

async recordDeliveryProofUpload(input: {
  orderId: string;
  storagePath: string;
}): Promise<{ ok: true }>,

async getDeliveryProofReadUrl(orderId: string): Promise<{
  readUrl: string;
  expiresAt: number;
}>,
```

Use whichever RNFB callable wrapper shape `orderService.ts` is already using for the existing menu / KYC upload methods — copy the local pattern, don't introduce a new one.

#### §C.2 — `uploadDeliveryProof` orchestration helper

New file `src/utils/uploadDeliveryProof.ts`. Mirrors `src/services/storage.ts` (`uploadMenuImage`) almost line-for-line:

```ts
/**
 * PR-NEXT-6 (finding #13) — orchestrate the three-step delivery
 * proof upload. Mirrors `uploadMenuImage` from PR 6.1.
 *
 * Flow:
 *   1. Caller has already picked + resized the image via
 *      `pickAndResizeImage` (same helper menu + KYC use).
 *   2. We call `getDeliveryProofUploadUrl` to mint a v4 signed PUT.
 *   3. PUT the resized JPEG bytes to that URL with Content-Type
 *      `image/jpeg` (v4 signatures bind contentType).
 *   4. Call `recordDeliveryProofUpload` to stamp the order doc.
 *
 * Returns the storagePath so the caller can immediately request a
 * read URL for the just-uploaded photo (UI confirmation thumbnail).
 *
 * Errors propagate verbatim — caller's catch handles toasts.
 */
import { orderService } from '../services/orderService';

export async function uploadDeliveryProof(input: {
  orderId: string;
  localUri: string;
}): Promise<{ storagePath: string }> {
  const { orderId, localUri } = input;

  const session = await orderService.getDeliveryProofUploadUrl(orderId);

  const blob = await (await fetch(localUri)).blob();
  const putResp = await fetch(session.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
  });
  if (!putResp.ok) {
    const errBody = await putResp.text().catch(() => '');
    throw new Error(
      `Upload failed (HTTP ${putResp.status}): ${errBody.slice(0, 200)}`,
    );
  }

  await orderService.recordDeliveryProofUpload({
    orderId,
    storagePath: session.storagePath,
  });
  return { storagePath: session.storagePath };
}
```

#### §C.3 — `ActiveDeliveryCard` photo CTA

Add to the existing `ActiveDeliveryCard` block (around line 1161 of `DeliveryDashboardScreen.tsx`). The photo button sits next to the existing Delivered CTA, NOT in place of it.

**State (hoisted at the parent `DeliveryDashboardScreen` level — same pattern as `pendingAction` from PR-NEXT-3):**

```ts
// PR-NEXT-6 (finding #13) — delivery proof photo. Per-order
// upload-in-flight state so the photo button can show a spinner
// without freezing the rest of the card. Stamped storage paths
// are tracked here too so the just-uploaded thumbnail can render
// without waiting for the watcher tick to bring the field back
// from the order doc.
const [photoUploading, setPhotoUploading] = useState<string | null>(null);
const [recentlyUploadedProof, setRecentlyUploadedProof] = useState<Record<string, string>>({});

const handleAddDeliveryProof = async (order: Order) => {
  const picked = await pickAndResizeImage('camera');
  if (!picked.ok) {
    if (picked.reason === 'cancelled') return;
    Alert.alert('Photo not added', picked.message || 'Please try again.');
    return;
  }
  setPhotoUploading(order.id);
  try {
    const { storagePath } = await uploadDeliveryProof({
      orderId: order.id,
      localUri: picked.uri,
    });
    setRecentlyUploadedProof(prev => ({ ...prev, [order.id]: storagePath }));
    // Light haptic confirmation — same posture as the new-order
    // arrival tick (PR 16). Best-effort; no rethrow.
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (e: any) {
    Alert.alert('Upload failed', e?.message || 'Please try again.');
  } finally {
    setPhotoUploading(null);
  }
};
```

**Render — add ONE button row above the existing Delivered CTA inside `ActiveDeliveryCard`:**

```tsx
<View style={styles.photoRow}>
  <Pressable
    onPress={() => onAddPhoto(order)}
    disabled={uploadingPhoto}
    style={({ pressed }) => [
      styles.photoBtn,
      uploadingPhoto && styles.photoBtnDisabled,
      pressed && { opacity: 0.85 },
    ]}
    accessibilityRole="button"
    accessibilityLabel={
      hasProof
        ? 'Replace delivery proof photo'
        : 'Add delivery proof photo (optional)'
    }
  >
    {uploadingPhoto ? (
      <ActivityIndicator size="small" />
    ) : (
      <Text style={styles.photoBtnText}>
        {hasProof ? '📸 Photo added — re-take?' : '📸 Add delivery proof (optional)'}
      </Text>
    )}
  </Pressable>
</View>
```

Wire `uploadingPhoto={photoUploading === order.id}`, `hasProof={!!order.deliveryProofStoragePath || !!recentlyUploadedProof[order.id]}`, and `onAddPhoto={handleAddDeliveryProof}` from the parent.

**Visual treatment:** a single full-width text button, lower visual weight than the Delivered CTA (it's optional). Slate-grey background, primary text colour. NO red error state — failures alert and reset; the button stays available.

**The Delivered CTA path is unchanged.** Photo capture is parallel to it; the partner can tap Delivered with or without a photo. No new precondition on the server `markDelivered` either (see §A — the photo is deliberately NOT a delivery gate).

#### §C.4 — Smoke pin for `uploadDeliveryProof`

Mock the three service methods + global `fetch`. Pin:

1. Happy path: get-url → PUT → record-confirm → returns the storage path.
2. PUT non-2xx → throws with HTTP code + body in message.
3. `get-url` throws → propagates verbatim (no swallow).
4. `record` throws → propagates verbatim.

Five-test smoke pin is enough; the real correctness lives in the server-side helper tests.

---

### §D — Display surfaces

Files touched:

- `src/components/order/DeliveryProofViewer.tsx` (new) — §D.1
- `src/screens/shop/ShopOrderDetailScreen.tsx` (modify) — §D.2
- `src/screens/OrderDetailScreen.tsx` (modify) — §D.3
- Admin order detail screen (modify) — §D.4 (grep for the right file — `OrderManagementScreen` or `AdminOrderDetailScreen` under `src/screens/admin/`)

#### §D.1 — Reusable `DeliveryProofViewer` component

One component, used by all three display surfaces. Renders nothing when `order.deliveryProofStoragePath` is absent; renders a labelled thumbnail when present; tap → full-screen modal with the image at native size + a Close affordance. Fetches the read URL on mount via `orderService.getDeliveryProofReadUrl(orderId)`.

```tsx
/**
 * PR-NEXT-6 — Delivery proof photo viewer for ShopOrderDetail /
 * AdminOrderDetail / customer OrderDetail. Returns null when the
 * order has no proof; otherwise mints a 15-min signed read URL on
 * mount and renders a labelled thumbnail with tap-to-zoom.
 *
 * Auth boundary lives in `getDeliveryProofReadUrl` — this component
 * does not check role; if the callable returns permission-denied
 * the thumbnail silently fails to render (caller's audience is
 * already correctly scoped by virtue of being on a detail screen).
 */
import React from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { orderService } from '../../services/orderService';

export default function DeliveryProofViewer({ orderId, hasProof }: {
  orderId: string;
  hasProof: boolean;
}) {
  const [readUrl, setReadUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [zoomed, setZoomed] = React.useState(false);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  React.useEffect(() => {
    if (!hasProof) {
      setReadUrl(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    orderService
      .getDeliveryProofReadUrl(orderId)
      .then(({ readUrl: url }) => {
        if (cancelled) return;
        setReadUrl(url);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e?.message || 'Could not load photo');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasProof, orderId]);

  if (!hasProof) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Delivery proof</Text>
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : readUrl ? (
        <>
          <Pressable
            onPress={() => setZoomed(true)}
            accessibilityRole="button"
            accessibilityLabel="View full delivery proof photo"
          >
            <Image source={{ uri: readUrl }} style={styles.thumb} />
          </Pressable>
          <Modal
            visible={zoomed}
            transparent
            animationType="fade"
            onRequestClose={() => setZoomed(false)}
          >
            <Pressable style={styles.zoomOverlay} onPress={() => setZoomed(false)}>
              <Image
                source={{ uri: readUrl }}
                style={{ width: screenWidth, height: screenHeight }}
                resizeMode="contain"
              />
              <View style={styles.zoomCloseHint}>
                <Text style={styles.zoomCloseText}>Tap anywhere to close</Text>
              </View>
            </Pressable>
          </Modal>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginVertical: spacing.md, paddingHorizontal: spacing.lg },
  sectionTitle: { ...typography.bodyBold, marginBottom: spacing.sm },
  loadingBox: { padding: spacing.lg, alignItems: 'center' },
  errorText: { ...typography.caption, color: colors.danger },
  thumb: {
    width: 120,
    height: 120,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  zoomOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomCloseHint: { position: 'absolute', bottom: 40 },
  zoomCloseText: { color: '#fff', ...typography.caption },
});
```

#### §D.2 — Shop order detail integration

In `ShopOrderDetailScreen.tsx`, find the existing payment block (around line 386–391: `order.paymentMethod === 'online'` etc.) and add directly below it:

1. **Explicit payment-method line** (finding #16(d)):

   ```tsx
   <Text style={styles.metaRow}>
     Paid via{' '}
     <Text style={styles.metaValueBold}>
       {formatPaymentMethod(order.paymentMethod, order.paidMethod, order.paymentStatus)}
     </Text>
   </Text>
   ```

   Add a small pure helper `formatPaymentMethod` in `src/utils/formatPaymentMethod.ts`:

   ```ts
   export function formatPaymentMethod(
     paymentMethod?: string | null,
     paidMethod?: 'cash' | 'online' | null,
     paymentStatus?: string | null,
   ): string {
     if (paymentStatus !== 'paid') return 'Not yet paid';
     if (paymentMethod === 'cod') {
       if (paidMethod === 'online') return 'Cash on delivery — paid online (converted)';
       if (paidMethod === 'cash') return 'Cash on delivery — paid in cash';
       return 'Cash on delivery — paid'; // legacy COD without paidMethod stamp
     }
     if (paymentMethod === 'online') return 'Online (paid up front)';
     return 'Paid';
   }
   ```

   Pin with 5 unit tests in `tests/utils/formatPaymentMethod.test.ts`.

2. **Delivery proof viewer:**

   ```tsx
   <DeliveryProofViewer
     orderId={order.id}
     hasProof={!!order.deliveryProofStoragePath}
   />
   ```

#### §D.3 — Customer order detail integration

`src/screens/OrderDetailScreen.tsx`: same `<DeliveryProofViewer />` + same `formatPaymentMethod` line. Customer benefits from seeing "yes, my order was delivered at [door photo]" both for transparency and for backing their own complaints.

#### §D.4 — Admin order detail integration

Grep `src/screens/admin/` for the order detail screen (likely `OrderManagementScreen.tsx` or `AdminOrderDetailScreen.tsx`). Same insertion: payment line + proof viewer. Admin already sees the most data; this completes the picture.

---

## Discipline checklist

1. **Rule 2 — Hooks above conditionals.** `useState` in `DeliveryProofViewer` is above the `if (!hasProof) return null` guard. `useState` + `useEffect` in any modified screen sit above existing role-guards.
2. **Rule 3 — Server-first deploy.** The three callables deploy + IAM-verify BEFORE the storage rules deploy BEFORE the client OTA. Mid-deploy a client without the OTA will neither display nor upload proof (existing screens render fine without it).
3. **Rule 4 — Schema additive only.** Two new optional `Order` fields. No migration.
4. **Rule 11 — Identity-aware gating.** Every callable validates auth + claims server-side. Hook/UI gates are belt-and-braces.
5. **Storage rules deploy explicitly.** `firebase deploy --only storage` after `firebase deploy --only "functions:..."`. Easy to forget; if forgotten, direct-client uploads stay write-deny by default (existing rules don't include `/delivery-proofs/` yet so the catch-all denies — but explicit rule keeps intent visible).
6. **Cloud Run IAM verification on ALL THREE new callables.** Recurring gotcha — do not skip. Sample commands in §A.3.
7. **OTA classification.** Pure JS client + 3 new callables + storage rules. No `app.json`, no permissions (`expo-image-picker` already wired), no plugins. OTA-safe for client.
8. **Test discipline.** §A.4 (~25 cases) + §C.4 (5 cases) + §D.2 helper tests (5 cases) → aim for suite count +35.

---

## Acceptance checklist

Run on iOS first, then Android. Need three test accounts: customer, shop owner, delivery partner.

**Upload happy path (delivery partner):**

1. Place a test order. Shop accepts, prepares, marks ready_for_pickup. Partner accepts pickup, marks picked-up.
2. On partner's dashboard, the ACTIVE order card shows the optional photo button `📸 Add delivery proof (optional)` above the Delivered CTA.
3. Tap → camera opens. Take a photo. Resize completes in <2s on a mid-range phone.
4. Button shows spinner; flips to `📸 Photo added — re-take?` on success. Haptic success tick.
5. Tap Delivered. Order completes as normal. No new precondition error.

**Photo gate enforcement (auth):**

6. Open the callable directly with a customer's account token via curl/manual call — `getDeliveryProofUploadUrl({orderId: <a real order id>})` → returns `permission-denied` ("Only delivery partners can upload proof photos").
7. As a delivery partner who is NOT the assigned partner for the order → `permission-denied` ("Not the assigned delivery partner").
8. As the assigned partner BEFORE marking picked-up → `failed-precondition` ("Pick up the order before uploading…").

**Re-upload overwrites:**

9. Take a second photo on the same order. Storage path stays `delivery-proofs/{orderId}.jpg`; first photo is overwritten. Viewer on any consumer screen shows the second photo on next render (signed-read URL re-fetches each mount).

**Display on shop side:**

10. Sign in as shop owner. Open the same order in `ShopOrderDetailScreen`. New "Delivery proof" section appears with a 120×120 thumbnail.
11. Tap thumbnail → full-screen modal with the image scaled to fit. Tap anywhere to close.
12. Above the proof section, a new line reads `Paid via Cash on delivery — paid in cash` (or `paid online (converted)`, or `Online (paid up front)`, depending on the test order's payment flow).

**Display on customer side:**

13. Sign in as customer. Open same order. Same proof section + payment line visible.

**Display on admin side:**

14. Sign in as admin. Open same order in admin order detail. Same proof section + payment line.

**Read-auth gates:**

15. Sign in as a different customer (not the order's customer) and try to mint a read URL via direct callable invocation → `permission-denied`.
16. Sign in as a different shop owner (different shopId) → `permission-denied`.
17. Sign in as a different delivery partner (not the assigned one) → `permission-denied`.

**No proof case:**

18. Open an order where the partner skipped the photo step. `DeliveryProofViewer` renders nothing (no empty box, no error). The payment line still renders.

**Regression checks:**

19. `markDelivered` still works without a proof photo (the partner can deliver "blind" — by design). Confirm by completing a delivery without tapping the photo button.
20. Menu image uploads via `getMenuImageUploadUrl` still work (we didn't touch that path).
21. KYC uploads via `getShopKycUploadUrl` still work.
22. `npx tsc --noEmit` clean (both root + functions/).
23. `npm run test:unit` clean; suite count up by §A.4 + §C.4 + helper tests.
24. **Cloud Run IAM check** on all three new callables (per discipline rule 6).

---

## Out of scope (explicit deferrals)

- **Multi-photo capture** (per-item or per-corner-of-doorstep photos). v1 is single-photo. Defer.
- **Photo annotation / pinning** (e.g. arrow on the door, written note). Defer.
- **Upload-window enforcement** (e.g. "only within 1 hour after delivered"). v1 allows any time after pickup; revisit if pilot disputes show evidence of after-the-fact upload abuse.
- **Photo required to deliver.** Deliberate non-feature — see "Design tensions" above.
- **Migration to public download tokens** (PR 42.0.2 pattern) for cheaper reads. v1 prioritises privacy via signed-read; revisit if call volume becomes a real cost.
- **Gallery picker** alongside camera. Camera-only is correct posture for "proof of delivery RIGHT NOW" — picking a gallery photo defeats the freshness premise. Stay camera-only.
- **AI verification** (e.g. "does this look like a doorstep?"). Out of scope; the photo is for human dispute review, not automated rejection.

---

## Doc trail updates after ship

- `docs/TESTING-FINDINGS-2026-05-30.md` — flip findings #13 and the sub-(c) + sub-(d) of #16 to `✅ SHIPPED in PR-NEXT-6 (May 31 2026)` with a one-paragraph summary covering the three callables + viewer component + payment-method copy.
- `docs/SESSION_LOG.md` — append the standard entry covering callables + storage rules + viewer + payment helper, suite delta, server-first deploy classification.
- `CLAUDE.md` — bump the "Current state" date and add PR-NEXT-6 to the testing-findings cleanup wave list.
- `PRELAUNCH_CHECKLIST.md` — add a section under the existing "Testing findings cleanup wave" block noting #13 + #16(c/d) closed.
