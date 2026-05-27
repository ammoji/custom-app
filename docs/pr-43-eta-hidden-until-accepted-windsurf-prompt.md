# PR 43 — Hide ETA until shop accepts + KYC mandatory enforcement (Windsurf prompt)

## Why this PR exists

PR 43 bundles two customer-trust changes that surfaced from the
May 26 2026 smoke test. Both ship together because they touch
adjacent surfaces (order display + shop registration) and share
the same deploy posture (OTA-eligible, client-only changes plus
a minor schema additive update).

### Part A — Hide delivery ETA until shop accepts

Sudhir's May 26 2026 smoke test surfaced Issue 6:

> "When order placed, by default it says Arriving in ~29 minutes,
> I think right now it should be shown based on when order is
> accepted. If we need to show some default hours, I would prefer
> to show 1 hours window instead of 30 minutes."

Decision locked: **Option A — hide the ETA entirely until the shop
accepts the order.** No "1-hour default fallback." Customer copy
during the `pending` state reads "Awaiting shop confirmation"
(or equivalent), not a misleading minute count.

The current behavior shows a customer-facing ETA the instant they
tap "Place Order" — based on `estimatedDeliveryAt = createdAt +
shop.etaMinutes * 60s` (computed from the shop's default ETA
field, which is just a wish, not a commitment). The customer reads
"Arriving in 29 min" and starts the clock. Two things go wrong:

1. **The number isn't a commitment yet.** The shop owner hasn't
   even seen the order. They might accept in 30s or 30 min.
   Once they accept, they set their own ETA via PR 12's workflow
   (`readyByEstimate`), which can be different from the default.
   The early number is a guess presented as a fact.

2. **It anchors customer expectation against reality.** If the
   default says 29 min and the shop accepts 5 min later setting
   a 45-min ETA, the customer feels the order is "late" before
   anything has actually happened. Trust Principle 2 (close the
   loop with honest signals) violation.

The fix is small in code but meaningful in UX. Hide pre-acceptance
ETA on three customer-facing surfaces; replace with copy that
acknowledges the shop's role in the loop.

This is a **pilot-relevant polish PR** — not pilot-blocking, but
ships cleanly before pilot launch since the first real shopkeeper
will be the first to set a "real" ETA, and we don't want that
to feel like a downgrade compared to the default.

### Part B — KYC mandatory enforcement (GST + Identity Proof)

Today the shop registration flow (post-PR-31 + PR-42) requires:

- Aadhaar (was optional in original PR 31 spec; effectively
  optional in practice — gate checks don't enforce it strictly
  in all branches)
- Storefront photo (mandatory as of PR 42)
- GST Certificate (optional)

This is wrong for the Indian e-commerce regulatory environment.
**Section 24 of the CGST Act (post-Sept 2018 amendments) requires
GST registration for all suppliers selling through e-commerce
operators**, regardless of the standard ₹20-40 lakh turnover
threshold. As HamaraSetu is positioned as an e-commerce operator,
every shop on the platform must have GSTIN.

**Owner identity** is also a baseline KYC posture for any
business platform — without proof of identity, the platform has
no recourse if a shop submits fraudulent listings or doesn't
deliver paid orders.

PR 43 Part B enforces:

1. **GST Certificate — hard-required.** No "pending submission"
   mode; shop cannot submit registration without GST upload.
   This is the cleaner compliance posture and matches Section 24
   literally.
2. **Identity Proof — hard-required.** Owner uploads either
   **Aadhaar OR PAN** (their choice). Either fulfills the gate;
   uploading both is fine too. UI shows two upload tiles in an
   "Identity Proof (one required)" section.
3. **Existing shop is grandfathered.** The Sudhir Grocery Store
   approved on May 26 doesn't get retroactively forced into the
   new requirements. PR 43 enforces only on the registration
   form; already-active shops are untouched.

Net friction: real-world kiranas without GSTIN must register
GST before HamaraSetu onboarding (online via gst.gov.in,
3-7 working days). For the pilot shop #1 this is a known
expected step; for shop #5+ at scale it becomes a real
onboarding-flow dependency that operations needs to anticipate.

## Read first

- `.windsurf/code-discipline.md` — Rules 1-9 standard checklist.
- `src/screens/OrderConfirmationScreen.tsx` line 63-65, 110 —
  the immediate post-placement ETA row. This screen is shown
  ONCE right after order placement; status is always
  `'pending'` here.
- `src/screens/OrderDetailScreen.tsx` line 269 (computes
  `minutesLeft`), lines 313-346 (the status-driven ETA copy
  block). The fallback "Arriving in ~N min" at line 343-344
  is what surfaces when `readyByEstimate` is not yet set.
- `src/components/order/ActiveOrdersRail.tsx` line 56-66 —
  the helper that builds "Arriving in ~X min" copy for the
  HomeScreen active-orders rail. Falls back from
  `readyByEstimate` to `estimatedDeliveryAt` (line 60-62).
- `src/utils/orderStateMachine.ts` — order status enum is
  `pending → accepted → preparing → ready_for_pickup →
  delivered` (`cancelled` terminal). **The pre-acceptance
  state is `'pending'`, not `'placed'`.** Customer-facing copy
  may say "Order placed" but the schema enum is `'pending'`.
  Verified by Windsurf during PR 41.
- `src/utils/formatRelativeTime.ts` (PR 36.1) — countdown
  helper used when `readyByEstimate` is present.

## Scope of changes

### A. New pure helper: `src/utils/orderEtaDisplay.ts`

Centralize the ETA display state machine in a single pure
function so all three surfaces (and any future ones) share one
contract. This file is pure — no React, no clock, no store —
unit-testable with vanilla Jest.

```ts
/**
 * PR 43 — ETA display state machine.
 *
 * Tells callers WHAT to render in the "time-to-arrival" slot
 * for a given order, based on its current status and whether
 * the shop has set a `readyByEstimate` yet.
 *
 * Why: pre-PR-43 the customer saw "Arriving in ~29 min" the
 * instant they placed an order, based on `estimatedDeliveryAt
 * = createdAt + shop.etaMinutes * 60s`. That number was just
 * the shop's default ETA wish — not a commitment, not what
 * the shop owner sees, sometimes very different from the ETA
 * the shop will actually set on acceptance. PR 43 hides the
 * minute count until the shop has accepted; until then,
 * customer sees "Awaiting shop confirmation" instead.
 *
 * Used by:
 *   - OrderConfirmationScreen (immediate post-placement view)
 *   - OrderDetailScreen (live tracking)
 *   - ActiveOrdersRail on HomeScreen (in-flight order summary)
 *
 * Pure — exclusively a function of (order, nowMs). Tests pin
 * every branch.
 */
export type OrderEtaDisplay =
  | { kind: 'awaiting_confirmation' }
  | { kind: 'ready_by'; readyByEstimate: number }
  | { kind: 'eta_fallback'; minutesLeft: number }
  | { kind: 'arriving_soon' }
  | { kind: 'hidden' };

export type EtaInput = {
  status:
    | 'pending'
    | 'accepted'
    | 'preparing'
    | 'ready_for_pickup'
    | 'delivered'
    | 'cancelled';
  readyByEstimate?: number;
  estimatedDeliveryAt?: number;
};

export function orderEtaDisplay(
  order: EtaInput,
  nowMs: number,
): OrderEtaDisplay {
  if (order.status === 'delivered' || order.status === 'cancelled') {
    return { kind: 'hidden' };
  }
  if (order.status === 'pending') {
    // PR 43 — gate the minute count behind shop acceptance.
    // No ETA shown; copy is set by the rendering surface
    // ("Awaiting shop confirmation" / equivalent).
    return { kind: 'awaiting_confirmation' };
  }

  // Status is accepted / preparing / ready_for_pickup.
  // Prefer the shop's accepted ETA; fall back to the order's
  // creation-time estimate ONLY if the shop's accepted ETA is
  // somehow missing (legacy orders, defensive).
  if (
    typeof order.readyByEstimate === 'number' &&
    order.readyByEstimate > 0
  ) {
    return {
      kind: 'ready_by',
      readyByEstimate: order.readyByEstimate,
    };
  }
  if (
    typeof order.estimatedDeliveryAt === 'number' &&
    order.estimatedDeliveryAt > 0
  ) {
    const minutesLeft = Math.round(
      (order.estimatedDeliveryAt - nowMs) / 60_000,
    );
    if (minutesLeft <= 0) {
      return { kind: 'arriving_soon' };
    }
    return { kind: 'eta_fallback', minutesLeft };
  }
  return { kind: 'hidden' };
}
```

Three branch outcomes the helper resolves:

- **`awaiting_confirmation`** — status `pending`. Renderer shows
  "Awaiting shop confirmation" (or per-surface variant).
- **`ready_by`** — status accepted+ AND shop has set
  `readyByEstimate`. Renderer uses PR 36.1's
  `formatRelativeTime` countdown.
- **`eta_fallback`** — status accepted+ AND shop has NOT set
  `readyByEstimate` (rare; defensive). Renderer shows
  "Arriving in ~N min" using the order's creation-time
  estimate.
- **`arriving_soon`** — same as fallback but `minutesLeft <= 0`.
  Renderer shows "Arriving soon."
- **`hidden`** — delivered / cancelled. Renderer renders
  nothing (already-finished states).

### B. Apply helper to `OrderConfirmationScreen`

The current line 63-65:

```ts
const etaMinutes = Math.max(
  1,
  Math.round((order.estimatedDeliveryAt - order.createdAt) / 60_000),
);
```

…and line 110:

```tsx
<Row label="ETA" value={`~${etaMinutes} min`} />
```

Replace with helper-driven logic. Since OrderConfirmationScreen
is shown immediately post-placement (status is always
`'pending'` here), the helper will always return
`awaiting_confirmation` on this screen — but using the helper
keeps the surface consistent in case the screen is ever shown
in other states.

```tsx
const eta = orderEtaDisplay(order, Date.now());

// Replace the existing ETA Row with status-aware rendering:
{eta.kind === 'awaiting_confirmation' && (
  <Row label="Status" value="Awaiting shop confirmation" />
)}
{eta.kind === 'ready_by' && (
  <Row label="Ready by" value={formatOrderTime(eta.readyByEstimate)} />
)}
{eta.kind === 'eta_fallback' && (
  <Row label="ETA" value={`~${eta.minutesLeft} min`} />
)}
{eta.kind === 'arriving_soon' && (
  <Row label="ETA" value="Arriving soon" />
)}
{eta.kind === 'hidden' && null}
```

The `etaMinutes` computation at line 63-65 can be removed
entirely — no longer needed.

### C. Apply helper to `OrderDetailScreen`

Current logic at lines 313-346 is a nested ternary that combines
status check + readyByEstimate gate + minutesLeft fallback.
Replace with a single switch on the helper output:

```tsx
{(() => {
  const eta = orderEtaDisplay(order, nowMs);
  switch (eta.kind) {
    case 'awaiting_confirmation':
      return (
        <View style={styles.pickupRow}>
          <Text style={styles.pickupPrimary}>
            Awaiting shop confirmation
          </Text>
          <Text style={styles.pickupSecondary}>
            {/* Shop name is on order.shopName per existing usage */}
            {order.shopName ?? 'The shop'} will confirm shortly
          </Text>
        </View>
      );
    case 'ready_by':
      return (
        <View style={styles.pickupRow}>
          <Text style={styles.pickupPrimary}>
            {formatRelativeTime(
              eta.readyByEstimate,
              nowMs,
              { label: 'Pickup ready' },
            ).primary}
          </Text>
          <Text style={styles.pickupSecondary}>
            by {formatOrderTime(eta.readyByEstimate)} ·
            delivery partner brings it to you
          </Text>
        </View>
      );
    case 'eta_fallback':
      return (
        <Text style={styles.eta}>
          Arriving in ~{eta.minutesLeft} min
        </Text>
      );
    case 'arriving_soon':
      return <Text style={styles.eta}>Arriving soon</Text>;
    case 'hidden':
      return null;
  }
})()}
```

The `minutesLeft` computation at line 269 can be removed —
helper computes it internally.

Preserve the existing nested-ternary comment lineage on PR 12
+ PR 36.1; add a PR 43 line:

```tsx
{/* PR 12 → PR 36.1 → PR 43 — ETA copy varies by status:
    - pending: hide ETA, show "Awaiting shop confirmation"
      (PR 43 — anchors customer expectation only after shop
      commits)
    - accepted / preparing with readyByEstimate:
      PR 36.1 two-line countdown
    - accepted / preparing without readyByEstimate (legacy):
      legacy "Arriving in ~N min" fallback
    - delivered / cancelled: hidden
    State machine logic in `src/utils/orderEtaDisplay.ts`. */}
```

### D. Apply helper to `ActiveOrdersRail`

`src/components/order/ActiveOrdersRail.tsx` lines 56-66:

The current helper function (inline, computes minsLeft directly)
should be replaced by a call to `orderEtaDisplay()`:

```ts
function etaCopy(order: Order, nowMs: number): string {
  const eta = orderEtaDisplay(order, nowMs);
  switch (eta.kind) {
    case 'awaiting_confirmation':
      return 'Awaiting shop confirmation';
    case 'ready_by': {
      const minsLeft = Math.round(
        (eta.readyByEstimate - nowMs) / 60_000,
      );
      if (minsLeft <= 0) return 'Arriving soon';
      return `Ready in ~${minsLeft} min`;
    }
    case 'eta_fallback':
      return `Arriving in ~${eta.minutesLeft} min`;
    case 'arriving_soon':
      return 'Arriving soon';
    case 'hidden':
      return '';
  }
}
```

The HomeScreen active-orders rail copy now consistently reads:

- "Awaiting shop confirmation" (status: pending)
- "Ready in ~22 min" (status: accepted/preparing with
  readyByEstimate)
- "Arriving in ~25 min" (status: accepted/preparing without
  readyByEstimate)
- "Arriving soon" (overshot the estimate)
- "" → caller hides the rail row (delivered / cancelled)

### E. Wherever `<Text style={styles.eta}>...` exists, sanity-pass

A grep for `styles.eta` or "Arriving in" should catch every
surface. If any other screen has its own ETA copy logic, route
it through `orderEtaDisplay` so the contract stays in one place.

Don't change shop-owner or delivery-partner surfaces — they
have legitimate reasons to see the minute count even before
acceptance (shop owner: to plan; delivery partner: to know
what's pending). PR 43 Part A is customer-side only.

---

## Part B scope of changes — KYC mandatory enforcement

### F. Schema additions (additive, non-breaking)

`src/types/index.ts` — extend the `Shop.kycDocs` shape with
a new optional `pan` field. Existing fields unchanged.

```ts
// Existing structure (pre-PR-43):
kycDocs?: {
  aadhaar?: { storagePath: string; uploadedAt: number };
  storefront?: { storagePath: string; uploadedAt: number };
  gst?: { storagePath: string; uploadedAt: number };
};

// Post-PR-43:
kycDocs?: {
  aadhaar?: { storagePath: string; uploadedAt: number };
  pan?: { storagePath: string; uploadedAt: number };       // NEW
  storefront?: { storagePath: string; uploadedAt: number };
  gst?: { storagePath: string; uploadedAt: number };
};
```

Server-side: `recordShopKycUpload` callable (the function that
writes KYC paths into the shop doc) likely takes a `docType`
parameter. Verify it accepts `'pan'` as a valid value, or extend
the allowlist if there's an explicit check. Grep for the
allowlist around the callable definition — typically a const
like `VALID_KYC_DOC_TYPES = ['aadhaar', 'storefront', 'gst']`
or similar.

No client storage-rules change needed — KYC uploads use a
shared `shop-kyc/{shopId}/{filename}` path, no doctype-specific
rule.

### G. Update `RegisterShopScreen` validation gates

`src/screens/roles/RegisterShopScreen.tsx`:

The submit gate currently (post-PR-42) checks:

```ts
const canSubmit = !!kycDocs.storefront && ... other gates ...;
```

Extend to:

```ts
// PR 43 Part B — KYC mandatory enforcement.
// Identity Proof: Aadhaar OR PAN satisfies the gate; uploading
// both is fine. GST hard-required (no provisional mode).
// Storefront already required from PR 42.
const hasIdentityProof = !!kycDocs.aadhaar || !!kycDocs.pan;
const hasStorefront = !!kycDocs.storefront;
const hasGst = !!kycDocs.gst;

const canSubmit =
  hasIdentityProof &&
  hasStorefront &&
  hasGst &&
  ... other gates (name, address, phone, etc.) ...;
```

The defensive double-guard pattern Windsurf used in PR 42 (button
`disabled` + alert on tap) should be replicated for the new
checks, since the async upload writes can race with the user's
tap:

```ts
const handleFinish = async () => {
  if (!hasIdentityProof) {
    Alert.alert(
      'Identity Proof required',
      'Please upload either your Aadhaar or PAN card before submitting.',
    );
    return;
  }
  if (!hasStorefront) {
    Alert.alert(
      'Storefront photo required',
      'Please upload a photo of your storefront.',
    );
    return;
  }
  if (!hasGst) {
    Alert.alert(
      'GST Certificate required',
      'Please upload your GST registration certificate. ' +
      'HamaraSetu requires GST registration for all shops per ' +
      'Section 24 of the CGST Act.',
    );
    return;
  }
  // ... existing submit flow ...
};
```

### H. UI section: "Identity Proof" with two tiles

The current registration screen has a KYC documents section
with three tiles (Aadhaar / Storefront / GST). Restructure as:

```
[Section heading] Identity Proof (one required)
  [Upload Aadhaar]      ← either fulfills the gate
  [Upload PAN]          ← either fulfills the gate
  ↑ Subtle helper text: "Upload Aadhaar OR PAN. Either works."

[Section heading] Storefront photo (required) ← from PR 42
  [Upload photo]

[Section heading] GST Certificate (required)
  [Upload certificate]
  ↑ Subtle helper text: "All shops on HamaraSetu need GST
    registration. Don't have one yet? Register free at
    gst.gov.in (takes 3-7 working days)."
```

Visual treatment of the Identity Proof section:

- Two-tile row OR stacked tiles (whatever fits the screen's
  existing pattern). Each tile has its own thumbnail + remove
  button (matching the existing aadhaar/storefront/gst tile
  pattern).
- When one is uploaded, the "(one required)" label can change
  to a check mark or "(uploaded ✓)" to give the user feedback.

If an upload fails (network drop mid-upload), the partial state
is recoverable — user just re-taps the upload tile.

### I. Label changes on all KYC tiles

Match the PR 42 pattern of explicit "(required)" / "(one
required)" labels:

- Old: "Aadhaar" → New: "Aadhaar (one of Aadhaar/PAN required)"
- New tile: "PAN Card (one of Aadhaar/PAN required)"
- Old: "Storefront photo" → unchanged from PR 42, still
  "Storefront photo (required)"
- Old: "GST Certificate (optional)" → New: "GST Certificate
  (required)"

### J. Helper text additions

Under the GST upload tile, add a small helper line in
`typography.caption` style:

> "Don't have GST yet? Register free at gst.gov.in.
> Takes 3-7 working days."

This is the friction-mitigation hint for owners who don't have
GSTIN. Helps a shopkeeper unblock themselves without a support
call.

### K. Existing shop is grandfathered (no migration)

The Sudhir Grocery Store from May 26 is already `status:
'active'` without GST or PAN. PR 43 enforces only on the
registration submit flow; it does NOT retroactively scan or
flag existing shops. No migration script. No admin alert.

The shop continues to function. If at some point operations
wants to retroactively compliance-check active shops, that's
a separate workflow (admin UI surface or a script) — out of
scope here.

## Updated Tests to add (Parts A + B)

Add to the Part A test list:

3. `tests/screens/RegisterShopScreen.test.tsx` — if it exists,
   add tests for the new gates:
   - Submit disabled when neither Aadhaar nor PAN uploaded
   - Submit enabled when only Aadhaar uploaded
   - Submit enabled when only PAN uploaded
   - Submit enabled when both Aadhaar and PAN uploaded
   - Submit disabled when GST not uploaded (other fields OK)
   - Alert fires on tap with helpful copy when gate fails
4. If `recordShopKycUpload` has a docType allowlist, extend its
   test to include `'pan'` as a valid type.

Aim for ~8 new test cases for Part B on top of ~10 for Part A,
so ~18 total new cases. Full suite should be ~767+ after this
PR.

## Updated Smoke acceptance (Parts A + B)

Part A items stay the same (7 items, items 1-7).

Add Part B items (8-12):

8. **Identity Proof required to submit.** As a fresh shop
   owner test phone, complete RegisterShop fields except KYC.
   Skip both Aadhaar and PAN. Storefront and GST uploaded.
   Tap Finish → alert "Identity Proof required" → upload
   Aadhaar OR PAN → Finish enables → submission succeeds.
9. **Either Aadhaar or PAN fulfills the gate.** Upload PAN
   only (no Aadhaar). Submit succeeds. Sign in as admin →
   the shop's pending registration shows the PAN file
   uploaded; Aadhaar slot is empty (not flagged).
10. **GST required to submit.** Upload all other KYC docs but
    not GST. Tap Finish → alert "GST Certificate required"
    with the gst.gov.in helper line. Upload GST → Finish
    enables → submission succeeds.
11. **GST helper text visible on the upload tile.** Before
    uploading GST, the helper line below the tile reads
    "Don't have GST yet? Register free at gst.gov.in."
12. **Existing Sudhir Grocery Store not retroactively
    affected.** Admin views the existing approved shop in
    Shop Management — no GST flag, no Identity Proof flag, no
    "non-compliant" indicator. Shop continues to function
    normally; customers can browse and order.

## Updated Discipline checklist

Existing Part A checklist stays. Add for Part B:

- [ ] `Shop.kycDocs.pan` field added to type — additive only,
      no breaking changes to existing data.
- [ ] `recordShopKycUpload` accepts `'pan'` as a doc type;
      extend allowlist if present.
- [ ] No retroactive enforcement against existing approved
      shops — gates apply to RegisterShopScreen submit only.
- [ ] Defensive double-guard pattern (button disabled + alert
      on tap) applied to all three new gates (Identity Proof,
      GST, plus the existing Storefront from PR 42).

## Updated Deploy plan

Still OTA-eligible. No server callable changes EXCEPT possibly
the `recordShopKycUpload` allowlist (if it needs to accept
`'pan'`):

1. `npm run test:unit` — green.
2. If `recordShopKycUpload` needs the allowlist extension:
   `firebase deploy --only functions:recordShopKycUpload`.
   Verify Cloud Run IAM after (mandatory per discipline rule):
   ```powershell
   gcloud run services get-iam-policy recordshopkycupload --region=asia-south1 --project=grocery-mvp-dev
   ```
3. **Client OTA** — `eas update --branch production --message
   "PR 43 hide ETA until accepted + KYC mandatory enforcement
   (Issues 6 + new compliance)"`.
4. Force-quit + reopen app twice on TestFlight to load the
   new bundle.

## Out of scope updates

Defer items now include:

- **Retroactive KYC compliance scan against existing shops.**
  Admin tool to flag already-approved shops missing GST or
  Identity Proof. Future PR if operations wants it.
- **GST validation against the GSTIN registry.** Today we
  accept whatever file the owner uploads; not verifying that
  the GSTIN actually matches a registered business. The
  GSTN portal has an API for verification but it requires
  agreement / paid access. Defer.
- **PAN validation** — same posture; format check only is
  fine for pilot.

## Updated Definition of done

- Part A (ETA helper + 3 surfaces routed through it) complete.
- Part B (KYC mandatory enforcement) complete:
  - `Shop.kycDocs.pan` schema addition merged
  - `recordShopKycUpload` accepts `'pan'` (if allowlist exists)
  - RegisterShopScreen has 3 mandatory gates with double-guard
    (disabled button + alert on tap)
  - Identity Proof section renders two upload tiles
  - GST tile has the gst.gov.in helper line
  - Labels updated to "(required)" / "(one of...required)" on
    every KYC tile
- Existing Sudhir Grocery Store untouched, no retroactive
  flag.
- Full unit suite green (~767+).
- 12 smoke acceptance items pass on device.
- Doc trail: CLAUDE.md + SESSION_LOG.md + ROADMAP.md updated
  with PR 43 shipped (mentioning both Parts A + B).
  PILOT_SMOKE_TEST_PLAN.md Phase 6 (customer ETA) + Phase 4
  (shop registration) updated with respective new acceptance
  items.

## Copy decisions to make at implementation time

Three copy slots Windsurf picks based on layout / character
budget. Suggested defaults:

- **OrderConfirmationScreen Row value**: "Awaiting shop
  confirmation" (formal — fits the Row layout)
- **OrderDetailScreen primary line**: "Awaiting shop
  confirmation"
- **OrderDetailScreen secondary line**: `${order.shopName ??
  'The shop'} will confirm shortly`
- **ActiveOrdersRail single line**: "Awaiting shop confirmation"

Hindi/bilingual treatment is deferred to PR 40 (theme +
Devanagari font). For PR 43, English copy only.

## Tests to add

1. `tests/utils/orderEtaDisplay.test.ts` — pure helper. Cover:
   - `status === 'pending'` → `awaiting_confirmation`
   - `status === 'accepted'` + `readyByEstimate` present →
     `ready_by` with the timestamp
   - `status === 'preparing'` + `readyByEstimate` present →
     `ready_by`
   - `status === 'accepted'` + no `readyByEstimate` + valid
     `estimatedDeliveryAt` → `eta_fallback` with computed minutes
   - `status === 'ready_for_pickup'` + `readyByEstimate` present
     → `ready_by`
   - `status === 'delivered'` → `hidden`
   - `status === 'cancelled'` → `hidden`
   - `eta_fallback` with `minutesLeft <= 0` → `arriving_soon`
   - Missing both `readyByEstimate` and `estimatedDeliveryAt` →
     `hidden`
   - Defensive: negative or NaN `estimatedDeliveryAt` → `hidden`
2. Update existing tests that hit ETA logic if they exist —
   especially `tests/screens/OrderDetailScreen.test.tsx` and
   `tests/components/ActiveOrdersRail.test.tsx` if those exist
   to verify the new branches render.

Aim for ~10 new test cases. Full suite should be ~759+ after
this PR (assuming PR 42 + PR 42.1 already landed; otherwise
adjust the baseline).

## Discipline checklist

- [ ] All hooks at the top of components — no new hooks added,
      just removing computations. Watch for accidentally
      stripping the `nowMs` state if it's only referenced
      inside the new helper.
- [ ] Comment lineage preserved on OrderDetailScreen
      (PR 12 → 36.1 → 43).
- [ ] No new schema fields. The pure helper reads existing
      `status`, `readyByEstimate`, `estimatedDeliveryAt`
      fields.
- [ ] `firestore.rules` unchanged.
- [ ] No new Firebase Functions deploys — this is pure client
      work.
- [ ] Shop-owner and delivery-partner surfaces unchanged.
      Verify by grepping that no edits in `src/screens/shop/`
      or `src/screens/delivery/`.
- [ ] No native rebuild — OTA-eligible.

## Deploy plan

Pure client OTA. No server / Cloud Functions changes.

Sequence:

1. `npm run test:unit` — green.
2. **Client OTA** — `eas update --branch production --message
   "PR 43 hide ETA until shop accepts (Issue 6)"`.
3. Force-quit + reopen app twice on TestFlight to load the
   new bundle.

No Cloud Run IAM verification needed (no callable touched).

## Smoke acceptance (add to PILOT_SMOKE_TEST_PLAN.md Phase 6)

1. **Place a fresh order** as a customer. OrderConfirmation
   shows the order summary with a "Status: Awaiting shop
   confirmation" row instead of "ETA: ~30 min."
2. **Open OrderDetailScreen** for that pending order. The
   status card shows "Awaiting shop confirmation" primary
   text and "{Shop name} will confirm shortly" secondary
   text. No minute count visible.
3. **Open Customer HomeScreen.** The active-orders rail shows
   "Awaiting shop confirmation" instead of "Arriving in ~28
   min."
4. **As shop owner, accept the order and set a ready ETA.**
   Customer's OrderDetailScreen now switches to the PR 36.1
   countdown ("Ready in 22 min by 7:30 PM"). Active-orders
   rail on Home updates to "Ready in ~22 min."
5. **Don't set a ready ETA explicitly** (if the shop accepts
   without committing a time — edge case). Customer should
   see the legacy "Arriving in ~N min" fallback. (Hard to
   trigger without a shop-side bug; skip if not feasible.)
6. **Cancel an order** before it's accepted. Customer's
   OrderDetailScreen shows the cancelled status; no ETA copy
   at all (helper returns `hidden`).
7. **Delivered order.** Past Orders tab → tap order → ETA
   line is gone (no longer relevant).

## Out of scope (defer)

- **Push notification when shop accepts** ("Sharma Kirana
  has accepted your order — ETA 25 min"). Useful UX, but
  separate work tied to PR 41 / push infrastructure.
  Consider as PR 43.1 if customer feedback during pilot says
  the silent transition from "Awaiting..." → "Ready in..." is
  confusing.
- **Hindi/Devanagari copy.** PR 40 territory.
- **Estimated delivery time on shop browse cards.** Shop
  cards still show `shop.etaMinutes` as a marketing default
  ("30 min delivery"). That's fine — the shop's published
  ETA is a separate concept from an order-specific ETA, and
  customers expect to see the shop's general promise before
  ordering. Don't touch ShopCard.

## Definition of done

- `orderEtaDisplay` pure helper merged with 10+ test cases.
- Three surfaces (OrderConfirmation, OrderDetail,
  ActiveOrdersRail) route through the helper.
- No shop-owner / delivery-partner surface touched.
- Customer no longer sees a minute count while order status
  is `pending`.
- Full unit suite green.
- 7 smoke acceptance items pass on device.
- Doc trail: CLAUDE.md + SESSION_LOG.md + ROADMAP.md updated
  with PR 43 shipped. PILOT_SMOKE_TEST_PLAN.md Phase 6 gets
  the 7 acceptance items.
