# PR 31 — Shop KYC document upload (storefront + GST/FSSAI/owner-ID) (Windsurf prompt)

## Why this PR exists

The shop self-registration foundation already shipped in **Phase
12a-v2-i** — `registerShop` / `approveShop` / `rejectShop` callables
in `functions/src/index.ts`, plus `RegisterShopScreen` /
`WaitingForApprovalScreen` / `PendingShopsScreen` /
`ShopRegistrationDetailScreen` on the client. The roadmap's
original description of PR 31 ("the foundation") overstated the
gap; the actual gap is **document-level KYC.**

Today, when a real kirana owner registers:

- They type their GST number as a free-text string → admin has no
  way to verify it's a real GST registration.
- They type their FSSAI license number as a free-text string →
  same problem.
- There's no shop storefront photo → customer-facing shop card
  shows the generic placeholder image; admin has no visual context
  to KYC-approve.
- There's no owner-ID document (Aadhaar / PAN) → admin is approving
  someone they cannot identify if a dispute later arises.

**PRELAUNCH_CHECKLIST line 449** explicitly calls this out: "admin
reviews ID/address/vehicle docs" is part of the production approval
workflow, but the upload + storage + admin-side viewing of those
docs is unbuilt.

**Scope of PR 31:** add document/photo uploads to the existing
registration flow. Specifically:

1. Server: a new `getShopKycUploadUrl` callable that mints a v4
   signed PUT URL for a specific document slot (`storefront`,
   `gstDoc`, `fssaiDoc`, `ownerIdDoc`) on a shop the caller owns.
   Mirrors the PR 6.1 menu-image upload pattern.
2. Client: extend `RegisterShopScreen` with four photo-capture
   slots. `expo-image-picker` (already a dep) handles the actual
   camera / gallery pick.
3. Client: extend `ShopRegistrationDetailScreen` to display the
   uploaded images so an admin reviewing the pending shop can see
   what they're approving.
4. Schema: extend `ShopRegistrationData` with optional fields for
   each doc URL. Schema-additive — existing shops without docs
   keep working (they just show "Not uploaded" in admin review).
5. Rules: `storage.rules` allow writes only to a path owned by the
   shop's `ownerUid` for a pending shop.

~1 day. Server + client + rules + tests.

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md`.
- `functions/src/menuImageUploadHelpers.ts` + the corresponding
  callable in `functions/src/index.ts` (`getMenuImageUploadUrl`).
  PR 31 mirrors this exact pattern for documents. Same v4-signed-PUT
  flow, different bucket prefix + different auth gate.
- `functions/src/index.ts` lines ~2926–3092 — the existing
  `registerShop` + `approveShop` callables. PR 31 does NOT change
  them. The KYC upload is a separate callable called between
  registration and approval.
- `src/screens/roles/RegisterShopScreen.tsx` — the form. Add a
  "Documents & photos" section above the existing GST/FSSAI text
  inputs.
- `src/screens/admin/ShopRegistrationDetailScreen.tsx` — the admin
  review. Add a "Uploaded documents" section that renders each
  doc's signed-read URL as an Image / "tap to enlarge" card.
- `src/types/index.ts` — `ShopRegistrationData` is the type to
  extend. Schema-additive.
- `storage.rules` — read the existing `/menu/{shopId}/...` rule.
  PR 31 adds a sibling rule for `/shop-kyc/{shopId}/...` with
  matching posture but a different ownership check (caller is the
  ownerUid AND the shop is in `pending` state).
- `package.json` — `expo-image-picker ~17.0.11` is already a dep.
  No new deps. (For reading PDF docs, we deliberately scope this
  PR to images only — see Scope (out).)

## Critical lessons from PRs 6, 6.1, and the recent multi-PR streak

1. **Web SDK vs RNFB auth mismatch on Storage.** PR 6 originally
   used the Web SDK's `uploadBytes` and hit `storage/unauthorized`
   on native because RNFB's auth session was invisible to it. PR
   6.1 fixed this by minting signed PUT URLs server-side using the
   admin SDK (which bypasses rules at signing time). **PR 31 MUST
   use the same signed-PUT pattern, not direct SDK uploads.**
2. **Server controls the storage path.** The client never picks the
   filename or bucket key. The server mints
   `shop-kyc/{shopId}/{docKind}_{timestamp}_{rand6}.jpg` and
   returns both the URL and the materialized path. The client
   stores the path on the shop doc; reads use server-minted signed
   GET URLs.
3. **Pending shops only.** A shop owner can upload KYC docs only
   while their shop is in `status: 'pending'`. Once approved, the
   docs are frozen — re-uploading would let an owner swap evidence
   post-KYC. Future PR: an admin-side flow to request re-upload
   from a rejected shop.
4. **Never strip imports between edits in the same PR.** Touched
   files: `functions/src/index.ts` (one new callable),
   `functions/src/kycUploadHelpers.ts` (new file),
   `RegisterShopScreen.tsx` (new image-picker UI),
   `ShopRegistrationDetailScreen.tsx` (new image cards),
   `storage.rules` (new rule block), `src/types/index.ts` (extra
   fields). Keep all imports stable across the edit pass.
5. **Schema-additive only.** New fields on `ShopRegistrationData`
   are optional. No required-field additions. Existing pending
   shops (none in prod yet, but possible in dev) keep working.
6. **All `useState` calls in screens sit ABOVE conditional early
   returns.** `RegisterShopScreen` already has the "if anonymous,
   show empty state" branch — keep all new useState declarations
   above it.
7. **Server-first deploy** — the new callable MUST go live before
   the client OTA that references it. Otherwise `RegisterShopScreen`
   tapping "Upload" throws `functions/not-found`.
8. **Zero new `DO NOT REMOVE` markers expected.** 17-PR streak.

## Scope (in)

### Part 1 — Extend `ShopRegistrationData` schema

In `src/types/index.ts`:

```ts
export type ShopKycDocKind =
  | 'storefront'
  | 'gstDoc'
  | 'fssaiDoc'
  | 'ownerIdDoc';

export type ShopKycDocRef = {
  storagePath: string;   // shop-kyc/{shopId}/{kind}_<ts>_<rand>.jpg
  uploadedAt: number;    // epoch ms
};

export type ShopRegistrationData = {
  phone: string;
  hours: { open: string; close: string };
  gstNumber?: string | null;
  fssaiLicense?: string | null;
  submittedAt: number;

  // PR 31 — KYC documents. All optional; existing shops without
  // them just show "Not uploaded" in admin review. The storefront
  // photo is the most visually-impactful for the customer card and
  // should be encouraged in onboarding copy.
  kycDocs?: Partial<Record<ShopKycDocKind, ShopKycDocRef>>;
};
```

Mirror the same fields on the same path inside `functions/src/`
where the server reads/writes registration data.

### Part 2 — Helper: `functions/src/kycUploadHelpers.ts`

Pure logic. Mirrors `menuImageUploadHelpers.ts` exactly in shape:

```ts
/**
 * PR 31 — pure helpers for getShopKycUploadUrl callable.
 *
 * Mirrors menuImageUploadHelpers (PR 6.1): server mints a v4 signed
 * PUT URL for a controlled bucket path. The client uploads directly
 * to that URL; the server never receives the bytes.
 *
 * Authorization gate (stricter than menu-image upload):
 *  - Caller must be authenticated.
 *  - Caller must own a shop in status 'pending'. The shop's ownerUid
 *    must equal the caller's uid.
 *  - Once the shop is approved/rejected/suspended, KYC docs are
 *    frozen — caller cannot re-upload. Future PR may add an
 *    admin-requested re-upload window for rejected shops.
 *
 * Filename is server-generated. Format:
 *   shop-kyc/{shopId}/{kind}_{timestamp}_{rand6}.jpg
 *
 * Strict equality on the docKind whitelist defends against forged
 * payloads.
 */

export const VALID_DOC_KINDS = [
  'storefront',
  'gstDoc',
  'fssaiDoc',
  'ownerIdDoc',
] as const;

export type DocKind = (typeof VALID_DOC_KINDS)[number];

export type GetKycUploadUrlInput = {
  auth: { uid: string } | null | undefined;
  shopId: string | undefined;
  docKind: string | undefined;
  shop:
    | {
        ownerUid?: string;
        status?: string;
      }
    | null;
};

export type GetKycUploadUrlResult =
  | {
      ok: true;
      shopId: string;
      docKind: DocKind;
      filename: string;
      storagePath: string;
    }
  | {
      ok: false;
      code:
        | 'unauthenticated'
        | 'invalid-argument'
        | 'permission-denied'
        | 'failed-precondition'
        | 'not-found';
      message: string;
    };

export function validateGetKycUploadUrlInput(
  input: GetKycUploadUrlInput,
  now: number,
  rand: () => string,
): GetKycUploadUrlResult {
  const { auth, shopId, docKind, shop } = input;

  if (!auth || typeof auth.uid !== 'string' || !auth.uid) {
    return { ok: false, code: 'unauthenticated', message: 'Sign in required' };
  }
  if (!shopId || typeof shopId !== 'string') {
    return { ok: false, code: 'invalid-argument', message: 'shopId required' };
  }
  if (!docKind || !VALID_DOC_KINDS.includes(docKind as DocKind)) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: `docKind must be one of: ${VALID_DOC_KINDS.join(', ')}`,
    };
  }
  if (!shop) {
    return { ok: false, code: 'not-found', message: 'Shop not found' };
  }
  if (shop.ownerUid !== auth.uid) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'You are not the owner of this shop',
    };
  }
  if (shop.status !== 'pending') {
    return {
      ok: false,
      code: 'failed-precondition',
      message: `KYC uploads are only allowed on pending shops (status is '${shop.status}')`,
    };
  }

  const filename = `${docKind}_${now}_${rand()}.jpg`;
  const storagePath = `shop-kyc/${shopId}/${filename}`;
  return {
    ok: true,
    shopId,
    docKind: docKind as DocKind,
    filename,
    storagePath,
  };
}
```

### Part 3 — Callable `getShopKycUploadUrl`

In `functions/src/index.ts`, right after the existing
`getMenuImageUploadUrl` callable (find it via grep; ~line where the
helper is imported), add:

```ts
import {
  validateGetKycUploadUrlInput,
  VALID_DOC_KINDS,
  type DocKind,
} from './kycUploadHelpers';

// ... (later in the file, alongside other shop-related callables)

export const getShopKycUploadUrl = onCall<{
  shopId: string;
  docKind: string;
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const shopId = request.data?.shopId;
    const docKind = request.data?.docKind;

    let shop:
      | { ownerUid?: string; status?: string }
      | null = null;
    if (shopId) {
      const snap = await db.doc(`shops/${shopId}`).get();
      shop = snap.exists ? (snap.data() as any) : null;
    }

    const result = validateGetKycUploadUrlInput(
      { auth: request.auth ?? null, shopId, docKind, shop },
      Date.now(),
      () => Math.random().toString(36).slice(2, 8),
    );

    if (!result.ok) {
      throw new HttpsError(result.code, result.message);
    }

    // Mint v4 signed PUT URL. Mirrors PR 6.1's pattern.
    const bucket = admin.storage().bucket();
    const file = bucket.file(result.storagePath);
    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000, // 15 min
      contentType: 'image/jpeg',
    });

    return {
      ok: true,
      uploadUrl,
      storagePath: result.storagePath,
      docKind: result.docKind,
    };
  },
);
```

Plus a small companion callable to **record** the upload result
onto the shop doc once the client confirms the PUT succeeded:

```ts
export const recordShopKycUpload = onCall<{
  shopId: string;
  docKind: string;
  storagePath: string;
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');

    const { shopId, docKind, storagePath } = request.data ?? {};
    if (!shopId || !docKind || !storagePath) {
      throw new HttpsError(
        'invalid-argument',
        'shopId, docKind, storagePath required',
      );
    }
    if (!VALID_DOC_KINDS.includes(docKind as DocKind)) {
      throw new HttpsError('invalid-argument', 'invalid docKind');
    }

    // Re-verify the caller owns the pending shop AND the path is
    // under their shop's KYC folder. Defense-in-depth: a forged
    // recordShopKycUpload call with a path under a different shop's
    // folder must be rejected.
    const expectedPrefix = `shop-kyc/${shopId}/`;
    if (!storagePath.startsWith(expectedPrefix)) {
      throw new HttpsError(
        'permission-denied',
        'storagePath does not match the shop',
      );
    }

    const shopRef = db.doc(`shops/${shopId}`);
    const snap = await shopRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Shop not found');
    const shop = snap.data() as { ownerUid?: string; status?: string };
    if (shop.ownerUid !== auth.uid) {
      throw new HttpsError('permission-denied', 'Not the shop owner');
    }
    if (shop.status !== 'pending') {
      throw new HttpsError(
        'failed-precondition',
        'KYC docs are frozen once the shop leaves pending state',
      );
    }

    await shopRef.update({
      [`registrationData.kycDocs.${docKind}`]: {
        storagePath,
        uploadedAt: Date.now(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { ok: true };
  },
);
```

Plus a read callable for the admin to get signed-read URLs (since
the bucket is private):

```ts
export const getShopKycReadUrls = onCall<{ shopId: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    if (auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin role required');
    }
    const shopId = request.data?.shopId;
    if (!shopId) throw new HttpsError('invalid-argument', 'shopId required');

    const snap = await db.doc(`shops/${shopId}`).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Shop not found');
    const shop = snap.data() as any;
    const docs:
      | Partial<
          Record<DocKind, { storagePath: string; uploadedAt: number }>
        >
      | undefined = shop?.registrationData?.kycDocs;

    if (!docs) return { ok: true, urls: {} };

    const bucket = admin.storage().bucket();
    const out: Record<string, string> = {};
    for (const [kind, ref] of Object.entries(docs)) {
      if (!ref) continue;
      const file = bucket.file(ref.storagePath);
      const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000, // 1 hour
      });
      out[kind] = url;
    }
    return { ok: true, urls: out };
  },
);
```

### Part 4 — Storage rules

In `storage.rules`, add a sibling block to the existing `/menu/`
rule:

```
match /shop-kyc/{shopId}/{filename} {
  // All writes go through the signed PUT URL minted by
  // getShopKycUploadUrl. The Admin SDK signing bypasses rules at
  // signing time. We collapse the write rule here to false as
  // defense-in-depth: any direct write (not via signed URL) is
  // rejected regardless of auth state.
  allow write: if false;

  // Read is restricted to admins. Customers don't see KYC docs;
  // owners get their own via signed-read URL through
  // getShopKycReadUrls if we ever expose that to them (not in v1).
  allow read: if request.auth != null
              && request.auth.token.admin == true;
}
```

### Part 5 — Client `RegisterShopScreen` — document slots

In `src/screens/roles/RegisterShopScreen.tsx`, add a new "Documents
& photos" section above the existing GST/FSSAI text inputs.

State + helper:

```tsx
import * as ImagePicker from 'expo-image-picker';

// State: track upload status per slot.
type KycSlot = 'storefront' | 'gstDoc' | 'fssaiDoc' | 'ownerIdDoc';
type KycSlotState = {
  uploading: boolean;
  storagePath: string | null;
  localPreviewUri: string | null;
  error: string | null;
};

const initialSlotState: KycSlotState = {
  uploading: false,
  storagePath: null,
  localPreviewUri: null,
  error: null,
};

const [storefront, setStorefront] = useState<KycSlotState>(initialSlotState);
const [gstDoc, setGstDoc] = useState<KycSlotState>(initialSlotState);
const [fssaiDoc, setFssaiDoc] = useState<KycSlotState>(initialSlotState);
const [ownerIdDoc, setOwnerIdDoc] = useState<KycSlotState>(initialSlotState);
```

Keep these `useState` calls **above** the existing `isAnonymous`
early-return — Rules of Hooks discipline.

Upload helper (one function, take the slot kind):

```ts
async function pickAndUpload(
  shopId: string,
  docKind: KycSlot,
  setSlot: (s: KycSlotState) => void,
) {
  setSlot({ ...initialSlotState, uploading: true });

  // 1. Pick from camera/gallery.
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.7,
    allowsEditing: true,
  });
  if (picked.canceled || !picked.assets?.length) {
    setSlot(initialSlotState);
    return;
  }
  const asset = picked.assets[0];

  // 2. Get signed PUT URL.
  try {
    const { uploadUrl, storagePath } = await orderService.getShopKycUploadUrl({
      shopId,
      docKind,
    });

    // 3. PUT the bytes.
    const fileBytes = await fetch(asset.uri).then(r => r.blob());
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: fileBytes,
    });
    if (!putRes.ok) {
      throw new Error(`Upload failed: ${putRes.status}`);
    }

    // 4. Record on the shop doc.
    await orderService.recordShopKycUpload({
      shopId,
      docKind,
      storagePath,
    });

    setSlot({
      uploading: false,
      storagePath,
      localPreviewUri: asset.uri,
      error: null,
    });
  } catch (e: any) {
    setSlot({
      uploading: false,
      storagePath: null,
      localPreviewUri: null,
      error: e?.message ?? 'Upload failed',
    });
  }
}
```

UI layout — four slots arranged in a 2×2 grid (or stacked on narrow
screens) below the "Hours" inputs and above the GST/FSSAI text
fields. Each slot:

```tsx
<View style={styles.kycSection}>
  <Text style={styles.sectionTitle}>Documents & photos</Text>
  <Text style={styles.kycHint}>
    Help us verify your shop is genuine. Storefront photo is highly
    recommended — it appears on your shop card.
  </Text>
  <View style={styles.kycGrid}>
    <KycSlotCard
      label="Storefront photo"
      required
      state={storefront}
      onPress={() => pickAndUpload(submittedShopId, 'storefront', setStorefront)}
    />
    <KycSlotCard
      label="GST certificate"
      state={gstDoc}
      onPress={() => pickAndUpload(submittedShopId, 'gstDoc', setGstDoc)}
    />
    <KycSlotCard
      label="FSSAI license"
      state={fssaiDoc}
      onPress={() => pickAndUpload(submittedShopId, 'fssaiDoc', setFssaiDoc)}
    />
    <KycSlotCard
      label="Owner ID (Aadhaar/PAN)"
      state={ownerIdDoc}
      onPress={() => pickAndUpload(submittedShopId, 'ownerIdDoc', setOwnerIdDoc)}
    />
  </View>
</View>
```

**Important flow change:** the existing `RegisterShopScreen.handleSubmit`
calls `registerShop` to create the shop doc in `pending` state.
The document uploads need a `shopId` to upload against. So the
flow becomes a 2-step wizard:

1. **Step 1 — basic info.** Fill name/address/hours/etc., tap
   "Continue". `registerShop` creates the pending shop. Save the
   returned `shopId` in state (`submittedShopId`).
2. **Step 2 — documents.** Show the four upload slots. Each upload
   targets `submittedShopId`. "Finish" navigates to
   WaitingForApproval.

The "Step 2" docs can also be skipped (users can leave required
doc empty and submit — admin sees "Not uploaded" and either
rejects or approves on whatever evidence the GST/FSSAI text gives).

Track current step with `const [step, setStep] = useState<1 | 2>(1)`
above the early-return. Render conditionally inside the return.

Update `WaitingForApprovalScreen` to also surface "you can still
upload missing documents" with a "Back to upload" CTA, in case the
shopkeeper realizes they forgot one.

### Part 6 — Admin: render docs in `ShopRegistrationDetailScreen`

In `src/screens/admin/ShopRegistrationDetailScreen.tsx`, after the
existing shop-info section and before the Approve/Reject buttons,
add:

```tsx
const [kycUrls, setKycUrls] = useState<Record<string, string>>({});
const [kycLoading, setKycLoading] = useState(true);

useEffect(() => {
  let cancelled = false;
  orderService
    .getShopKycReadUrls({ shopId })
    .then(({ urls }) => {
      if (!cancelled) setKycUrls(urls);
    })
    .catch(e => {
      console.warn('[ShopRegDetail] getShopKycReadUrls failed:', e);
    })
    .finally(() => {
      if (!cancelled) setKycLoading(false);
    });
  return () => {
    cancelled = true;
  };
}, [shopId]);
```

Render section:

```tsx
<Text style={styles.sectionTitle}>Uploaded documents</Text>
{(['storefront', 'gstDoc', 'fssaiDoc', 'ownerIdDoc'] as const).map(kind => {
  const url = kycUrls[kind];
  return (
    <View key={kind} style={styles.kycReviewRow}>
      <Text style={styles.kycReviewLabel}>{labelFor(kind)}</Text>
      {url ? (
        <Pressable onPress={() => openImageZoom(url)}>
          <Image source={{ uri: url }} style={styles.kycReviewThumb} />
        </Pressable>
      ) : (
        <Text style={styles.kycReviewMissing}>Not uploaded</Text>
      )}
    </View>
  );
})}
```

`openImageZoom` can be a simple Modal with a full-screen Image and a
Close button — keep it inline; this is admin-only UX.

### Part 7 — Client service: `orderService` additions

In `src/services/orderService.ts`, add three new methods that wrap
the three new callables. Mirror the existing
`getMenuImageUploadUrl` pattern (web vs native callable dispatch).

```ts
async getShopKycUploadUrl(args: {
  shopId: string;
  docKind: 'storefront' | 'gstDoc' | 'fssaiDoc' | 'ownerIdDoc';
}): Promise<{ uploadUrl: string; storagePath: string; docKind: string }> { /* ... */ },

async recordShopKycUpload(args: {
  shopId: string;
  docKind: 'storefront' | 'gstDoc' | 'fssaiDoc' | 'ownerIdDoc';
  storagePath: string;
}): Promise<void> { /* ... */ },

async getShopKycReadUrls(args: {
  shopId: string;
}): Promise<{ urls: Record<string, string> }> { /* ... */ },
```

(Naming: `orderService` is a slight misnomer for shop-KYC, but it's
the canonical client-side wrapper around every callable in this
codebase. Future refactor can split into `shopService` if the
grouping gets unwieldy — out of scope for PR 31.)

### Part 8 — Tests

Create `tests/functions/kycUploadHelpers.test.ts`:

```ts
import {
  validateGetKycUploadUrlInput,
  VALID_DOC_KINDS,
} from '../../functions/src/kycUploadHelpers';

const NOW = 1_700_000_000_000;
const rand = () => 'abc123';

describe('PR 31 — validateGetKycUploadUrlInput', () => {
  const baseShop = { ownerUid: 'user-1', status: 'pending' };

  test('rejects unauthenticated caller', () => {
    const r = validateGetKycUploadUrlInput(
      { auth: null, shopId: 's1', docKind: 'storefront', shop: baseShop },
      NOW,
      rand,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  test('rejects missing shopId', () => {
    const r = validateGetKycUploadUrlInput(
      {
        auth: { uid: 'user-1' },
        shopId: undefined,
        docKind: 'storefront',
        shop: baseShop,
      },
      NOW,
      rand,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('rejects unknown docKind', () => {
    const r = validateGetKycUploadUrlInput(
      {
        auth: { uid: 'user-1' },
        shopId: 's1',
        docKind: 'passport',
        shop: baseShop,
      },
      NOW,
      rand,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('rejects caller who does not own the shop', () => {
    const r = validateGetKycUploadUrlInput(
      {
        auth: { uid: 'user-2' },
        shopId: 's1',
        docKind: 'storefront',
        shop: { ownerUid: 'user-1', status: 'pending' },
      },
      NOW,
      rand,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('rejects upload on non-pending shop (frozen post-approval)', () => {
    const r = validateGetKycUploadUrlInput(
      {
        auth: { uid: 'user-1' },
        shopId: 's1',
        docKind: 'storefront',
        shop: { ownerUid: 'user-1', status: 'active' },
      },
      NOW,
      rand,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('failed-precondition');
  });

  test('happy path returns ok + server-controlled filename', () => {
    const r = validateGetKycUploadUrlInput(
      {
        auth: { uid: 'user-1' },
        shopId: 's1',
        docKind: 'gstDoc',
        shop: baseShop,
      },
      NOW,
      rand,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.docKind).toBe('gstDoc');
      expect(r.filename).toBe(`gstDoc_${NOW}_abc123.jpg`);
      expect(r.storagePath).toBe(`shop-kyc/s1/gstDoc_${NOW}_abc123.jpg`);
    }
  });

  test('VALID_DOC_KINDS exposes the 4 expected kinds', () => {
    expect([...VALID_DOC_KINDS].sort()).toEqual(
      ['fssaiDoc', 'gstDoc', 'ownerIdDoc', 'storefront'].sort(),
    );
  });
});
```

If `tests/rules/` has a Firestore-rules test file for the `/shops/`
collection, add a sibling test for storage-rules verifying that:

- Direct PUT to `/shop-kyc/{shopId}/...` is denied regardless of
  auth.
- Direct READ of `/shop-kyc/{shopId}/...` is denied for non-admins,
  allowed for admins.

(Rules tests run only when `firestore.rules` or `storage.rules`
changed — this PR changes `storage.rules`, so run
`npm run test:rules` at acceptance time.)

### Part 9 — PRELAUNCH_CHECKLIST update

In `PRELAUNCH_CHECKLIST.md`:

- Flip the unchecked "Admin approval workflow ... admin reviews
  ID/address/vehicle docs" item (around line 449) to a partial
  state — the **upload + admin viewing** ship in PR 31, but the
  full delivery-partner KYC + vehicle docs are a different PR.
  Annotate: `[Partially shipped — PR 31 covers shop-side KYC docs;
  delivery-partner KYC remains an open item]`.
- Find the "real shop data" line (~line 179) and note that PR 31
  unblocks the first wave of real shops (with KYC) — but the
  actual seeding-with-real-data is a separate manual step, not
  this PR.
- Append a PR 31 section at the bottom documenting:
  - New callables: `getShopKycUploadUrl`,
    `recordShopKycUpload`, `getShopKycReadUrls`.
  - New helper: `functions/src/kycUploadHelpers.ts`.
  - Storage rule for `/shop-kyc/{shopId}/...`.
  - Client: RegisterShopScreen is now a 2-step wizard.
  - Admin: ShopRegistrationDetailScreen shows uploaded docs.
  - Follow-ups: (a) delivery-partner KYC variant of this flow,
    (b) admin-requested re-upload window for rejected shops,
    (c) PDF support (currently images only), (d) GST API
    verification (machine-check the entered GST against the
    portal — Phase B+).

## Scope (out)

- **PDF uploads.** Many shopkeepers have their GST as a PDF, not
  a photo. PR 31 ships images only (JPEG, .7 quality). A follow-up
  PR adds `application/pdf` support to the signed-PUT contentType
  and renders PDFs via `expo-document-picker` + `react-native-pdf`.
- **GSTIN format validation / GST portal verification.** Currently
  the GST number is a free-text field; PR 31 doesn't change that.
  A future PR can regex-validate the 15-char format client-side
  and (optionally) call the public GST search API server-side to
  confirm the GSTIN is real. Phase B+.
- **Delivery-partner KYC.** Same upload pattern, but the auth
  model and the doc kinds differ (driving license, vehicle RC,
  Aadhaar). Own PR.
- **AI photo-to-catalog.** That's PR 32 (separate). This PR ships
  raw doc uploads only; no AI extraction yet.
- **Re-upload after rejection.** When admin rejects a shop with
  reason ("ID is blurry"), the owner currently has to resubmit
  the whole registration. A follow-up PR adds an admin-initiated
  re-upload window without re-registration.
- **Multi-shop ownership.** Out of scope (Section 4 deferral).
- **Storage cleanup on shop rejection / deletion.** When a shop
  is rejected, its KYC docs stay in `shop-kyc/{shopId}/`. A
  scheduled cleanup function should delete them after N days for
  PII hygiene. Out of scope here; track as a follow-up.

## Acceptance checklist

- [ ] `functions/src/kycUploadHelpers.ts` exists. Pure logic,
  injected `now` + `rand`.
- [ ] `tests/functions/kycUploadHelpers.test.ts` has 7 tests
  covering unauth, missing args, unknown docKind, wrong owner,
  frozen-post-pending, happy path, and the VALID_DOC_KINDS export.
- [ ] `getShopKycUploadUrl`, `recordShopKycUpload`,
  `getShopKycReadUrls` callables added to
  `functions/src/index.ts`. Auth + claim gating per Part 3.
- [ ] `storage.rules` has a `/shop-kyc/{shopId}/{filename}` rule
  block: `write: false`, `read: admin only`.
- [ ] `src/types/index.ts` `ShopRegistrationData` extended with
  optional `kycDocs` and the supporting types
  `ShopKycDocKind` / `ShopKycDocRef`.
- [ ] `src/services/orderService.ts` has the three new methods
  wrapping the callables.
- [ ] `src/screens/roles/RegisterShopScreen.tsx`:
  - 2-step wizard (basic info → docs).
  - Four `KycSlotCard` slots.
  - Image picker via `expo-image-picker`.
  - All new `useState` calls sit above the `if (isAnonymous)`
    early-return.
- [ ] `src/screens/roles/WaitingForApprovalScreen.tsx` surfaces
  "Add missing documents" CTA if any slot is still empty (optional
  but recommended).
- [ ] `src/screens/admin/ShopRegistrationDetailScreen.tsx`
  fetches `getShopKycReadUrls` on mount and renders the four
  doc thumbnails with tap-to-zoom.
- [ ] `npx tsc --noEmit` (root + functions): 0 errors.
- [ ] `npm test` overall: green.
- [ ] `npm run test:rules` (rules emulator): green — including
  the new storage-rule tests.
- [ ] PRELAUNCH_CHECKLIST: PR 31 section appended + KYC-doc item
  flipped to partial.
- [ ] **Zero new `DO NOT REMOVE` markers added** (18-PR streak).

## Deliberate-break check (per `.windsurf/test-discipline.md`)

Before declaring done, temporarily change line in
`validateGetKycUploadUrlInput` from `shop.ownerUid !== auth.uid` to
`shop.ownerUid === auth.uid` (invert the ownership check). Run the
"rejects caller who does not own the shop" test — it must fail.
Revert. This proves the ownership check is genuinely test-pinned.

## Smoke tests (manual, after staged deploy)

1. **End-to-end happy path (mock shop owner)** — sign in as a
   tester. Tap "Register a shop". Fill basic info, "Continue".
   Step 2 shows four empty slots. Tap "Storefront photo" → camera
   picker. Take a photo of any object as a stand-in. Slot shows
   a thumbnail. Tap the other three slots in turn. All four
   uploaded. Tap "Finish". Routed to WaitingForApproval.
2. **Switch to admin account, review the shop** — sign in as
   admin. Pending shops list shows the new shop. Tap into it.
   "Uploaded documents" section shows four thumbnails (or partial,
   if you uploaded fewer in Test 1). Tap a thumbnail → zoom modal.
   Close. Tap Approve.
3. **Once approved, re-upload is rejected** — sign back into the
   shop owner account. RegisterShop → Step 2. Tap "Storefront" to
   re-upload. The PUT to the freshly-minted URL succeeds (you
   can't prevent that at the signed-URL level), BUT
   `recordShopKycUpload` rejects with `failed-precondition`
   ("KYC docs are frozen..."). The client shows the error in the
   slot's `error` field.
4. **Direct storage write is rejected** — using the Firebase
   Storage CLI or the Web SDK directly (NOT via signed PUT), try
   to upload to `shop-kyc/s1/test.jpg`. Rules deny with
   `storage/unauthorized`. Confirms the storage rule is correctly
   write-deny.
5. **Non-admin read is rejected** — try to read
   `shop-kyc/s1/storefront_<ts>_<rand>.jpg` via direct Storage
   SDK from a non-admin account. Rules deny.
6. **Web build works** — `npm run web`, register a shop, upload
   docs from a desktop browser using the file picker. Same flow.
   Bytes upload via PUT to the signed URL.
7. **Sentry quiet** — pass through the whole flow without
   triggering Sentry events. Network blips during upload should
   set the slot's `error` field without throwing to Sentry (the
   existing `try/catch` swallows; we want a clean dashboard).
8. **TypeScript clean** — `npx tsc --noEmit` shows zero errors
   across `root` and `functions`.

## Deploy plan

Server-first per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Audit + tests (full, since rules changed).
npm run test:full

# 2. Deploy storage rules FIRST.
firebase deploy --only storage:rules
firebase storage:rules:get | Select-String -Pattern "shop-kyc"
# Verify the new rule block is live.

# 3. Deploy the new Cloud Functions.
cd functions
npm run build
cd ..
firebase deploy --only functions:getShopKycUploadUrl
firebase deploy --only functions:recordShopKycUpload
firebase deploy --only functions:getShopKycReadUrls
firebase functions:list | Select-String -Pattern "(getShopKycUploadUrl|recordShopKycUpload|getShopKycReadUrls)"
# Should print three lines confirming all three are live.

# 4. Commit + push.
git add functions/src/kycUploadHelpers.ts functions/src/index.ts
git add storage.rules
git add src/types/index.ts src/services/orderService.ts
git add src/screens/roles/RegisterShopScreen.tsx
git add src/screens/roles/WaitingForApprovalScreen.tsx
git add src/screens/admin/ShopRegistrationDetailScreen.tsx
git add tests/functions/kycUploadHelpers.test.ts
git add tests/rules/<the-storage-rules-test-if-added>.test.ts
git add PRELAUNCH_CHECKLIST.md
git add docs/pr-31-shop-kyc-document-upload-windsurf-prompt.md
git commit -m "PR 31: shop KYC document upload (storefront + GST/FSSAI/owner-ID)"
git push origin main

# 5. Client OTA.
eas update --branch production --message "PR 31 - shop KYC document upload"
```

## Estimated time

~1 day (5–7 hours) Windsurf work:

- Part 1 (schema + types): 15 min
- Part 2 (kycUploadHelpers pure logic): 30 min
- Part 3 (3 callables in index.ts): 1 hr
- Part 4 (storage.rules): 15 min
- Part 5 (RegisterShopScreen 2-step wizard + image picker): 1.5 hr
- Part 6 (admin doc viewer + zoom modal): 1 hr
- Part 7 (orderService method wrappers): 30 min
- Part 8 (tests, 7 helper + 2 rules): 1 hr
- Part 9 (PRELAUNCH_CHECKLIST update): 15 min
- Smoke + deliberate-break: 45 min

## Why this PR matters

Without document-level KYC, every shop approval is admin guessing
from a free-text GST number. That's fine for family-test mode where
you know every owner personally. It does NOT survive the first
real-launch onboarding of a stranger kirana from Bandra who needs
to be verifiably real (and verifiably the actual proprietor)
before they take customer money.

PR 31 also lays the storage + signed-URL plumbing that **Phase A2's
AI photo-to-catalog (PR 32) reuses verbatim**. Same bucket prefix
pattern, same `validate → signed PUT → record` flow. PR 31 funds
the substrate; PR 32 layers Claude vision on top of it.

And it's the trust signal that makes the difference at admin
review: an approval decision based on a real storefront photo + a
real GST certificate image is one you can defend to a future
disputed-order email. Free-text only is not.

Also closes the dangling end of the Phase 12a-v2-i workstream:
the `registerShop`/`approveShop` pair shipped in May 2026, the
PRELAUNCH_CHECKLIST flagged "admin reviews ID/address/vehicle docs"
as the remaining gap, and PR 31 is the shop-side half of closing
that gap.
