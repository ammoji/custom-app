# PR 37 — Digital Udhaar / Khata ledger (Windsurf prompt)

> ⛔ **DEFERRED FROM PILOT (Sudhir's call, 2026-05-24).** Build
> on demand if pilot shop owners request credit-tracking. The
> full design below is preserved so this can be picked up in a
> single Windsurf session when demand surfaces — no re-design
> needed. The pilot ships with Customer CRM (PR 36) as the
> primary merchant daily-use hook; this remains the
> documented second hook if the pilot shows CRM alone is
> insufficient. See `docs/ROADMAP.md` Section 4 deferrals
> table for the reasoning. PR 37.1 (customer-side udhaar
> payment integration) is the natural follow-up and is also
> deferred.

## Why this PR exists

Every kirana shop in India runs a **khata** — a notebook of
customers who buy on credit (udhaar). The shopkeeper jots down
"Amit ₹250" when Amit walks in for atta and dal but pays later,
and "Amit ₹0" when Amit settles. The notebook is universal,
load-bearing for trust between shopkeeper and regular, and
*entirely paper-based*.

PR 37 digitizes it. After PR 37 a shop owner can:

- See a list of customers who owe them money, with a running
  total receivables tile.
- Tap a customer to see every transaction (charged + settled)
  with timestamps and optional notes.
- Add a new charge ("Amit took 5kg atta + 1L oil — ₹420").
- Settle a customer's balance (full or partial).
- Find a customer by phone instantly.

**Crucial design choice — keyed by phone, not by app user uid.**
Most kirana customers are NOT app users. They walk in, buy on
credit, walk out. The khata can't depend on the customer having
the app. Phone number is the universal customer identifier the
shopkeeper already knows.

This is the second "merchant daily-use hook" alongside PR 36's
CRM — the kind of feature that earns a shop owner opening the
app even when no online order has arrived. Strategic
Principle 4. Pilot-critical.

**What ships:**

- Server: new `shops/{shopId}/khata/{khataId}` subcollection +
  `transactions/{txnId}` sub-subcollection. Three callables:
  `listShopKhata`, `addKhataTransaction` (creates the khata
  entry if it doesn't exist), `listKhataTransactions`.
- Client: `ShopKhataListScreen` (list + receivables tile) +
  `ShopKhataDetailScreen` (transactions + add/settle CTAs) +
  `AddKhataTransactionModal` (phone + amount + note + save).
- Firestore rules for the new collection paths.
- Strategic Principle 8 analytics events.

~2 days. Server-first deploy. OTA-eligible (no native
changes).

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md` (OTA-vs-build check applies;
  PR 37 is OTA-only).
- `docs/ROADMAP.md` — Strategic Principle 4 (merchant daily-use
  hooks), Phase B PR 37 entry.
- `functions/src/index.ts`:
  - `listShopOrders` callable (~line 2642) — pattern to mirror
    for shop-scoped queries via the `validateShopOrdersAccess`
    helper.
  - `getShopKycReadUrls` (~PR 31) — pattern for "callable that
    reads from a shop subcollection."
  - Existing `addCustomMenuItem` callable — pattern for "create
    a document under shops/{shopId}/..." with claim validation.
- `functions/src/shopOrdersHelpers.ts` — the
  `validateShopOrdersAccess` helper PR 37 reuses for auth.
- `src/screens/shop/ShopOwnerDashboardScreen.tsx` — entry-point
  tile lives here, next to PR 36's "My customers" tile.
- `firestore.rules` — existing `shops/{shopId}/menu/{menuItemId}`
  block (~line 102) is the template for the new khata block.
- `src/services/analytics.ts` — add the PR 37 events alongside
  PR 36's `shop_customers_*` family.

## Critical lessons from PRs 25–38 (do not repeat)

1. **OTA-eligible.** Per the OTA-vs-build table: no plugin,
   no permission, no native dep. OTA-only deploy.
2. **Server-first.** Three new callables + rules change.
   Deploy rules FIRST, then each callable one `--only` per
   command. OTA last.
3. **Atomicity matters.** `addKhataTransaction` must update
   the parent khata's `balance` + `lastActivityAt` +
   `transactionCount` AND create the transaction doc in a
   single Firestore transaction. Otherwise concurrent
   additions race and the balance drifts.
4. **Never strip imports.** Files touched: `index.ts` (3 new
   callables + imports), new `khataHelpers.ts`, `firestore.rules`,
   `firestore.indexes.json`, `orderService.ts` (3 wrappers),
   `analytics.ts` (3 events), `src/types/index.ts` (KhataEntry
   + KhataTransaction types), new
   `ShopKhataListScreen.tsx`, new `ShopKhataDetailScreen.tsx`,
   new `AddKhataTransactionModal.tsx`, `ShopOwnerDashboardScreen.tsx`
   (+1 tile), `AppNavigator.tsx` (+2 routes).
5. **All `useState` above conditional early returns** in all
   three new screens/modal.
6. **Schema-additive only.** New paths under shops/{shopId}/
   don't touch existing shop fields or order data.
7. **Phone normalization is load-bearing.** Same customer
   entered as "9876543210", "+919876543210", "919876543210"
   must collide into one khata entry. Canonicalize on every
   write: strip non-digits, prefer `+91XXXXXXXXXX` shape.
   Pure helper + tests.
8. **`firestore.rules` change → run `npm run test:rules`.**
9. **No `DO NOT REMOVE` markers expected.**
10. **Trust Principle 1 (visible undo):** every charge added
    is reversible by adding an offsetting settle. There's no
    `delete transaction` API in v1 — the audit trail is
    append-only. This is the kirana-notebook way; matches
    how real shops handle "oh wait, I miscounted" (they cross
    out and write the correction below, never erase).

## Scope (in)

### Part 0 — Shop-level `acceptsUdhaar` toggle (opt-in)

The khata feature must be **opt-in per shop**. Some shops don't
offer credit and shouldn't see the bookkeeping tile cluttering
their dashboard. Some shops will adopt it later. Default is
opt-in (`acceptsUdhaar: false` or undefined → disabled).

**Schema (additive):** new field on the `shops/{shopId}` doc:

```ts
acceptsUdhaar?: boolean; // PR 37 — opt-in. undefined/false → khata feature hidden.
```

Add to `src/types/index.ts` `Shop` type as an optional field.

**Server-side enable:** extend the existing shop-settings update
flow. Look for the callable that updates shop settings
(probably `updateShopSettings` in `functions/src/index.ts`,
which the existing `ShopSettingsScreen` writes through). Add
`acceptsUdhaar` to the accepted payload + writes; reuse the
existing shop-owner-claim gate.

If a dedicated callable is cleaner than extending the existing
one, add a small `setShopAcceptsUdhaar` callable next to it.
Keep the auth pattern identical (shopOwner claim + shopId
match via the existing helper).

**Server-side gate on the khata callables:** at the top of each
of the three callables in Part 2 below, after the auth check,
verify that `shop.acceptsUdhaar === true`. If not, throw
`failed-precondition` with a friendly message:

```ts
const shopSnap = await db.doc(`shops/${targetShopId}`).get();
const shopData = shopSnap.data() ?? {};
if (shopData.acceptsUdhaar !== true) {
  throw new HttpsError(
    'failed-precondition',
    'Udhaar (khata) is not enabled for this shop. Enable it in Shop Settings first.',
  );
}
```

**Client-side toggle:** add to `src/screens/shop/ShopSettingsScreen.tsx`
a new section "Udhaar / Khata" with a switch:

```tsx
<View style={styles.settingsRow}>
  <View style={{ flex: 1 }}>
    <Text style={styles.settingsLabel}>Accept Udhaar (Khata)</Text>
    <Text style={styles.settingsHint}>
      Track customer credit in a digital notebook. You'll see a
      "Udhaar / Khata" tile on your dashboard when this is on.
    </Text>
  </View>
  <Switch
    value={acceptsUdhaar}
    onValueChange={onToggleAcceptsUdhaar}
    disabled={savingUdhaar}
  />
</View>
```

State + handler at the top of the component (above any
conditional return per hooks discipline). On toggle:
optimistically flip local state, call the server, revert on
error with a toast.

**Client-side tile visibility gate:** in
`src/screens/shop/ShopOwnerDashboardScreen.tsx`, the "📒 Udhaar
/ Khata" tile from Part 8 only renders when
`shop?.acceptsUdhaar === true`. Read the shop doc the same way
the dashboard already does for other shop fields.

**Analytics:** add one event for the toggle so we can see
adoption rate per Strategic Principle 8:

```ts
shop_accepts_udhaar_toggled: (params: {
  shop_id: string;
  enabled: boolean;
}) => track('shop_accepts_udhaar_toggled', params),
```

**Smoke note:** the first 5–10 pilot shops will be told about
the feature explicitly during onboarding. They opt in (or
not) from settings. Existing shops with the field undefined
correctly see the tile hidden.

**This is the gate that everything below depends on.** All of
Parts 1–11 are scoped to "this shop has acceptsUdhaar = true."

---

### Part 1 — Pure helpers in `functions/src/khataHelpers.ts`

```ts
/**
 * PR 37 — pure helpers for the khata (digital udhaar) ledger.
 * No SDK calls, no Firestore. Tested in isolation.
 *
 * Responsibilities:
 *   1. Phone normalization to a canonical key (so the same
 *      customer entered different ways collides into one
 *      khata entry).
 *   2. Validation of transaction inputs.
 *   3. Pure balance recomputation from a transaction list
 *      (used as a sanity check + by a future "rebuild
 *      counter" admin tool if drift is ever observed).
 */

export type KhataTransactionType = 'charge' | 'settle';

export type KhataTransactionInput = {
  amount: unknown;
  type: unknown;
  note?: unknown;
};

export type ValidatedTransaction = {
  amount: number; // always positive, in INR
  type: KhataTransactionType;
  note: string | null;
};

export type ValidationResult =
  | { ok: true; value: ValidatedTransaction }
  | { ok: false; reason: string };

/**
 * Normalize an Indian phone number to canonical `+91XXXXXXXXXX`.
 * Rejects anything that doesn't reduce to 10 digits after
 * stripping country code / leading 0.
 */
export function canonicalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  let ten: string;
  if (digits.length === 10) ten = digits;
  else if (digits.length === 11 && digits.startsWith('0')) ten = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith('91')) ten = digits.slice(2);
  else if (digits.length === 13 && digits.startsWith('091')) ten = digits.slice(3);
  else return null;
  if (!/^\d{10}$/.test(ten)) return null;
  // Reject obvious garbage (all same digit, all zeros, etc.)
  if (/^0+$/.test(ten)) return null;
  return `+91${ten}`;
}

/**
 * The khata document ID is derived from the canonical phone so
 * a second write for the same customer hits the same document
 * (idempotency at the path level).
 *
 * `+919876543210` → `91_9876543210` (Firestore document IDs
 * can't contain `+`; we encode it as `91_` prefix).
 */
export function khataIdFromPhone(canonicalPhone: string): string {
  // canonicalPhone is "+91XXXXXXXXXX"; strip the + and turn
  // the country code into a prefix with an underscore for
  // readability.
  if (!canonicalPhone.startsWith('+91') || canonicalPhone.length !== 13) {
    throw new Error('khataIdFromPhone: expected canonical +91XXXXXXXXXX');
  }
  return `91_${canonicalPhone.slice(3)}`;
}

const MIN_AMOUNT_INR = 1;
const MAX_AMOUNT_INR = 100_000; // ₹1 lakh; cap on a single transaction
const MAX_NOTE_LENGTH = 200;

export function validateKhataTransaction(
  input: KhataTransactionInput,
): ValidationResult {
  const { amount, type, note } = input;

  if (typeof type !== 'string' || (type !== 'charge' && type !== 'settle')) {
    return { ok: false, reason: 'type must be "charge" or "settle"' };
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return { ok: false, reason: 'amount must be a number' };
  }
  if (amount < MIN_AMOUNT_INR) {
    return { ok: false, reason: `amount must be at least ₹${MIN_AMOUNT_INR}` };
  }
  if (amount > MAX_AMOUNT_INR) {
    return {
      ok: false,
      reason: `amount cannot exceed ₹${MAX_AMOUNT_INR.toLocaleString('en-IN')} per transaction`,
    };
  }
  // Round to 2 decimals; reject anything finer.
  const rounded = Math.round(amount * 100) / 100;
  if (Math.abs(rounded - amount) > 0.001) {
    return { ok: false, reason: 'amount can have at most 2 decimal places' };
  }

  let normalizedNote: string | null = null;
  if (note !== undefined && note !== null) {
    if (typeof note !== 'string') {
      return { ok: false, reason: 'note must be a string if provided' };
    }
    const trimmed = note.trim();
    if (trimmed.length > MAX_NOTE_LENGTH) {
      return {
        ok: false,
        reason: `note cannot exceed ${MAX_NOTE_LENGTH} characters`,
      };
    }
    normalizedNote = trimmed || null;
  }

  return {
    ok: true,
    value: { amount: rounded, type: type as KhataTransactionType, note: normalizedNote },
  };
}

/**
 * Recompute balance from a transaction list. Used as a sanity
 * check by the dashboard if drift is ever observed; not used
 * on the hot path (the parent's `balance` field is the source
 * of truth, updated atomically with each transaction).
 *
 * Convention: charges INCREASE balance (customer owes more);
 * settles DECREASE balance. A positive balance = customer
 * owes the shop.
 */
export function recomputeBalance(
  transactions: Array<{ amount: number; type: KhataTransactionType }>,
): number {
  let balance = 0;
  for (const t of transactions) {
    if (t.type === 'charge') balance += t.amount;
    else balance -= t.amount;
  }
  return Math.round(balance * 100) / 100;
}
```

### Part 2 — Callables in `functions/src/index.ts`

Three callables, all auth-gated via `validateShopOrdersAccess`
(the same helper PR 36 and `listShopOrders` use).

**Callable 1: `addKhataTransaction`** — creates the khata
entry if it doesn't exist, appends a transaction, updates
parent counters atomically.

```ts
import {
  canonicalizePhone,
  khataIdFromPhone,
  validateKhataTransaction,
} from './khataHelpers';

export const addKhataTransaction = onCall<{
  shopId?: string;
  customerPhone: string;
  customerName?: string;
  amount: number;
  type: 'charge' | 'settle';
  note?: string;
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');

    const access = validateShopOrdersAccess({
      claims: auth.token ?? {},
      requestedShopId: request.data?.shopId,
    });
    if (!access.ok) throw new HttpsError(access.code, access.message);
    const { targetShopId } = access;

    const { customerPhone, customerName, amount, type, note } =
      request.data ?? ({} as any);

    const phone = canonicalizePhone(customerPhone);
    if (!phone) {
      throw new HttpsError(
        'invalid-argument',
        'customerPhone must be a valid 10-digit Indian phone number',
      );
    }
    const valid = validateKhataTransaction({ amount, type, note });
    if (!valid.ok) {
      throw new HttpsError('invalid-argument', valid.reason);
    }

    const trimmedName =
      typeof customerName === 'string' && customerName.trim()
        ? customerName.trim().slice(0, 100)
        : null;

    const khataId = khataIdFromPhone(phone);
    const khataRef = db.doc(`shops/${targetShopId}/khata/${khataId}`);
    const txnRef = khataRef.collection('transactions').doc();

    // Atomic: read parent (if exists), compute new balance,
    // write parent + new transaction in one transaction.
    await db.runTransaction(async tx => {
      const snap = await tx.get(khataRef);
      const now = FieldValue.serverTimestamp();
      const delta = valid.value.type === 'charge' ? valid.value.amount : -valid.value.amount;

      if (!snap.exists) {
        tx.set(khataRef, {
          id: khataId,
          shopId: targetShopId,
          customerPhone: phone,
          customerName: trimmedName,
          balance: delta,
          transactionCount: 1,
          createdAt: now,
          lastActivityAt: now,
        });
      } else {
        const data = snap.data() ?? {};
        const currentBalance =
          typeof data.balance === 'number' ? data.balance : 0;
        const newBalance = Math.round((currentBalance + delta) * 100) / 100;
        const currentCount =
          typeof data.transactionCount === 'number' ? data.transactionCount : 0;
        const update: Record<string, unknown> = {
          balance: newBalance,
          transactionCount: currentCount + 1,
          lastActivityAt: now,
        };
        // Update displayName only if shop just provided one
        // and existing is null (don't overwrite an existing
        // displayName silently — shop may have customized it).
        if (trimmedName && !data.customerName) {
          update.customerName = trimmedName;
        }
        tx.update(khataRef, update);
      }

      tx.set(txnRef, {
        id: txnRef.id,
        khataId,
        shopId: targetShopId,
        amount: valid.value.amount,
        type: valid.value.type,
        note: valid.value.note,
        createdAt: now,
        createdBy: auth.uid,
      });
    });

    return { ok: true, khataId };
  },
);
```

**Callable 2: `listShopKhata`** — returns all khata entries
for the shop, sorted by `lastActivityAt` desc, with summary
totals.

```ts
export const listShopKhata = onCall<{
  shopId?: string;
  filter?: 'all' | 'with_balance';
  limit?: number;
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');

    const access = validateShopOrdersAccess({
      claims: auth.token ?? {},
      requestedShopId: request.data?.shopId,
    });
    if (!access.ok) throw new HttpsError(access.code, access.message);
    const { targetShopId } = access;

    const filter = request.data?.filter ?? 'all';
    const limit = Math.min(request.data?.limit ?? 200, 500);

    let q = db.collection(`shops/${targetShopId}/khata`)
      .orderBy('lastActivityAt', 'desc')
      .limit(limit);

    const snap = await q.get();
    const entries = snap.docs.map(d => {
      const data = d.data();
      return {
        ...data,
        createdAt: data.createdAt?.toMillis?.() ?? data.createdAt ?? null,
        lastActivityAt:
          data.lastActivityAt?.toMillis?.() ?? data.lastActivityAt ?? null,
      };
    });

    // Filter in memory — Firestore doesn't index balance != 0 cheaply.
    const filtered =
      filter === 'with_balance'
        ? entries.filter(e => typeof e.balance === 'number' && e.balance !== 0)
        : entries;

    // Summary tile data.
    const totalReceivables = entries
      .filter(e => typeof e.balance === 'number' && e.balance > 0)
      .reduce((sum, e) => sum + (e.balance as number), 0);
    const totalPrepaid = entries
      .filter(e => typeof e.balance === 'number' && e.balance < 0)
      .reduce((sum, e) => sum + (e.balance as number), 0); // negative

    return {
      ok: true,
      entries: filtered,
      totalCustomers: entries.length,
      totalReceivables: Math.round(totalReceivables * 100) / 100,
      totalPrepaid: Math.round(totalPrepaid * 100) / 100,
      truncated: snap.size === limit,
    };
  },
);
```

**Callable 3: `listKhataTransactions`** — for the detail screen.

```ts
export const listKhataTransactions = onCall<{
  shopId?: string;
  khataId: string;
  limit?: number;
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');

    const access = validateShopOrdersAccess({
      claims: auth.token ?? {},
      requestedShopId: request.data?.shopId,
    });
    if (!access.ok) throw new HttpsError(access.code, access.message);
    const { targetShopId } = access;

    const khataId = request.data?.khataId;
    if (typeof khataId !== 'string' || !khataId) {
      throw new HttpsError('invalid-argument', 'khataId required');
    }
    const limit = Math.min(request.data?.limit ?? 100, 500);

    // Read parent for balance + name.
    const khataSnap = await db
      .doc(`shops/${targetShopId}/khata/${khataId}`)
      .get();
    if (!khataSnap.exists) {
      throw new HttpsError('not-found', 'Khata not found');
    }
    const khataData = khataSnap.data() ?? {};

    const txnsSnap = await db
      .collection(`shops/${targetShopId}/khata/${khataId}/transactions`)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const transactions = txnsSnap.docs.map(d => {
      const data = d.data();
      return {
        ...data,
        createdAt: data.createdAt?.toMillis?.() ?? data.createdAt ?? null,
      };
    });

    return {
      ok: true,
      khata: {
        ...khataData,
        createdAt:
          khataData.createdAt?.toMillis?.() ?? khataData.createdAt ?? null,
        lastActivityAt:
          khataData.lastActivityAt?.toMillis?.() ??
          khataData.lastActivityAt ?? null,
      },
      transactions,
    };
  },
);
```

### Part 3 — Firestore rules

In `firestore.rules`, add a new block under the existing
`shops/{shopId}` match group (sibling to the `menu/` subcollection
rule near line 102):

```
match /shops/{shopId}/khata/{khataId} {
  // Reads and writes go through callables only — they enforce
  // the shopOwner claim match against shopId. The callables use
  // the Admin SDK, which bypasses these rules. Direct client
  // access is denied to defend against forged writes that skip
  // the validation helpers.
  allow read, write: if false;

  match /transactions/{txnId} {
    allow read, write: if false;
  }
}
```

Same posture as the `pendingMenuExtractions` / `aiAuditLog` /
`featureUsageLog` collections — server-mediated only, no direct
client access. The `validateShopOrdersAccess` helper inside each
callable is the actual gate.

### Part 4 — Firestore indexes

No new indexes needed if you only query at the document level
(`shops/{shopId}/khata` ordered by `lastActivityAt`, transactions
ordered by `createdAt`). These are subcollection queries that
Firestore handles with auto-generated single-field indexes.

If a future PR adds cross-shop khata queries (admin-side
analytics), composite indexes would be needed — out of scope
here.

### Part 5 — Types in `src/types/index.ts`

```ts
export type KhataEntry = {
  id: string;
  shopId: string;
  customerPhone: string; // canonical +91XXXXXXXXXX
  customerName: string | null;
  balance: number; // positive = customer owes; negative = customer prepaid
  transactionCount: number;
  createdAt: number; // epoch ms
  lastActivityAt: number; // epoch ms
};

export type KhataTransaction = {
  id: string;
  khataId: string;
  shopId: string;
  amount: number; // always positive
  type: 'charge' | 'settle';
  note: string | null;
  createdAt: number; // epoch ms
  createdBy: string; // uid of the shop owner who recorded it
};
```

### Part 6 — Client wrappers in `orderService.ts`

Three new methods, mirror the existing dispatch pattern (web + native).

```ts
async addKhataTransaction(args: {
  shopId?: string;
  customerPhone: string;
  customerName?: string;
  amount: number;
  type: 'charge' | 'settle';
  note?: string;
}): Promise<{ ok: true; khataId: string }> { /* ... */ },

async listShopKhata(args: {
  shopId?: string;
  filter?: 'all' | 'with_balance';
  limit?: number;
}): Promise<{
  ok: true;
  entries: KhataEntry[];
  totalCustomers: number;
  totalReceivables: number;
  totalPrepaid: number;
  truncated: boolean;
}> { /* ... */ },

async listKhataTransactions(args: {
  shopId?: string;
  khataId: string;
  limit?: number;
}): Promise<{
  ok: true;
  khata: KhataEntry;
  transactions: KhataTransaction[];
}> { /* ... */ },
```

### Part 7 — Three screens / one modal

**`src/screens/shop/ShopKhataListScreen.tsx`** — the main list.

Layout:
- Header: "Khata / Udhaar" + back button
- Top stats card (2 mini-tiles):
  - **Total outstanding ₹** (positive `totalReceivables`)
  - **Number of customers with balance** (count where `balance !== 0`)
- Filter pills: "With balance" (default) / "All customers"
- Search box: search by name or phone (client-side filter on
  the loaded `entries` array)
- Floating "+ Add transaction" button (bottom-right) → opens
  AddKhataTransactionModal
- List: each row shows customerName (or phone if no name),
  phone, balance (color-coded: red if owing, green if prepaid,
  grey if zero), "Last activity: X days ago"
- Empty state: friendly explanation + "+ Add first customer"
  CTA

**`src/screens/shop/ShopKhataDetailScreen.tsx`** — single
customer view.

Layout:
- Header: customer name (or phone) + back button
- Top: phone (with tap-to-call), balance prominently displayed
  with color, total transaction count, member-since date
- Action buttons row:
  - **"+ Add charge"** (red-tinted primary) — opens
    AddKhataTransactionModal pre-filled with this customer,
    `type='charge'`
  - **"💸 Settle"** (green-tinted) — opens modal pre-filled
    with `type='settle'` and `amount = current balance` (user
    can edit to partial settlement)
- Transaction list: each transaction shows amount (color-coded
  by type), date, note (if any), and "by [shop-owner-name]"
- Empty state if zero transactions: shouldn't happen since the
  parent doc is created on first transaction, but defensive.

**`src/components/shop/AddKhataTransactionModal.tsx`** —
reusable modal.

Inputs:
- Phone (10-digit, with +91 prefix label)
- Name (optional)
- Amount (number; pre-filled if opened from detail-screen
  settle flow)
- Type (charge / settle radio; pre-filled if opened from a
  specific CTA)
- Note (optional, 200 char limit, multiline)
- Save button (loading state) + Cancel

`usePressGuard` (PR 27) on the Save handler. On success: close
modal, refresh list/detail screen on focus.

### Part 8 — Tile + navigation

In `src/screens/shop/ShopOwnerDashboardScreen.tsx`, add a tile
next to PR 36's "My customers":

```tsx
<Pressable onPress={() => nav.navigate('ShopKhataList')} style={styles.tile}>
  <Text style={styles.tileEmoji}>📒</Text>
  <Text style={styles.tileTitle}>Udhaar / Khata</Text>
  <Text style={styles.tileSubtitle}>Track customer credit</Text>
</Pressable>
```

Register both new routes in `src/navigation/AppNavigator.tsx`:

```tsx
<Stack.Screen name="ShopKhataList" component={ShopKhataListScreen} />
<Stack.Screen
  name="ShopKhataDetail"
  component={ShopKhataDetailScreen}
  // Pass khataId via params
/>
```

### Part 9 — Analytics events in `src/services/analytics.ts`

```ts
// PR 37 — Digital udhaar / khata ledger. Three events for the
// merchant-daily-use signal.
shop_khata_viewed: (params: {
  shop_id: string;
  filter: 'all' | 'with_balance';
  customer_count: number;
  total_receivables_bucket: '0' | '1-1k' | '1k-10k' | '10k-50k' | '50k+';
}) => track('shop_khata_viewed', params),

shop_khata_transaction_added: (params: {
  shop_id: string;
  type: 'charge' | 'settle';
  amount_bucket: '1-100' | '100-500' | '500-2k' | '2k-10k' | '10k+';
  is_new_customer: boolean;
}) => track('shop_khata_transaction_added', params),

shop_khata_customer_viewed: (params: {
  shop_id: string;
  transaction_count: number;
  balance_bucket: 'zero' | 'positive_low' | 'positive_high' | 'negative';
}) => track('shop_khata_customer_viewed', params),
```

Note the **bucketed amounts** — sending the exact rupee value
to Firebase Analytics + the parallel-write `featureUsageLog/`
would be a PII / sensitive-financial leak. Bucketing keeps the
behavior signal (was this a big or small transaction) without
exposing the actual amount. Same posture as the
`transcript_length` bucketing in PR 34.

### Part 10 — Tests

`tests/functions/khataHelpers.test.ts` — pure helper tests
(~10 cases):

- `canonicalizePhone` accepts 10-digit, 11-digit-with-0,
  12-digit-with-91, 13-digit-with-091; rejects non-string,
  too-short, too-long, all-zeros.
- `khataIdFromPhone` produces the expected `91_XXXXXXXXXX`
  format; throws on invalid input.
- `validateKhataTransaction` rejects: missing type, invalid
  type, missing amount, negative amount, amount < 1, amount >
  100000, more than 2 decimal places, oversized note.
- `validateKhataTransaction` accepts: valid charge, valid
  settle, valid with optional note, valid without note.
- `recomputeBalance` correctly sums + signs (charges positive,
  settles negative); returns 0 for empty list.

Plus rules test (`tests/rules/khataRules.test.ts` or sibling):

- Direct client write to `shops/{id}/khata/{khataId}` is
  denied for everyone (including the shop owner). Callable-
  only.
- Direct client read of the same path is denied.
- Same for the `transactions/{txnId}` subcollection.

### Part 11 — PRELAUNCH_CHECKLIST

Append a PR 37 entry. Key follow-ups to log:

- **PR 37.1 — Customer-side udhaar payment + per-customer
  approval.** PR 37 ships the *shop owner's bookkeeping*
  surface only. The natural follow-up is letting an
  **approved customer** select udhaar as a payment method at
  checkout, which automatically posts a `charge` to the
  khata. Includes: (a) new `shops/{shopId}/khataApprovedCustomers/
  {uid}` subcollection with optional `creditLimit`,
  `approvedAt`, `approvedBy`, (b) customer-side "Request
  udhaar at this shop" flow → pushes request to shop owner,
  (c) shop-owner approval queue (new tile / inbox row),
  (d) udhaar appears as a 3rd payment option at checkout
  for approved customers at udhaar-accepting shops,
  (e) `placeOrder` auto-posts the `charge` transaction
  using PR 37's existing `addKhataTransaction` helper,
  (f) push notification to customer on approval/rejection,
  (g) settle-via-payment-link follow-up. ~3 days. Designed
  on top of PR 37's foundation — `acceptsUdhaar` toggle from
  Part 0 is the prerequisite, and the existing khata
  callables become reused with a different caller path.
- **SMS reminder to customer** ("you owe Sharma Kirana
  ₹520, settle anytime"). Twilio integration + Hindi SMS
  templates. Phase B+ polish.
- **WhatsApp deep link** for the same purpose — opens
  WhatsApp with a pre-written message to the customer phone.
  Cheaper than SMS; trivial to add.
- **Khata to App-user matching** — if the khata phone happens
  to match an app customer's phone, surface their order
  history alongside the khata. Future cross-table view.
- **Settle with payment link** — generate a Razorpay payment
  link the shop can text to the customer. Phase C+.
- **Per-customer photo / IOU image** — shop owner snaps a
  picture of the handwritten note before the customer
  walks out, attaches to the transaction. Disputed
  transactions get a paper trail. Future PR.
- **Export khata to CSV** — for shop owners who want to
  bookkeep externally. Phase D (admin reports + exports,
  PR 56) territory.
- **Undo / void transaction (admin-only)** — currently
  append-only with offsetting settles. If shops report this
  is too cumbersome for typos, add an admin-only void.
- **Audit-log writes** for each `addKhataTransaction` so
  `auditLog/` shows who-what-when even for non-admin shop
  actions. Currently the transaction doc itself has
  `createdBy: uid` so the trail exists; an audit-log
  rollup is a polish add.

## Scope (out)

- **Customer-side khata visibility.** Shopkeeper-only in v1.
  If the customer happens to be an app user, a future PR can
  show them their own khata across all shops they buy from.
- **Multi-shop khata.** Each shop's khata is independent. A
  customer who has credit at three shops sees three separate
  ledgers (one per shop).
- **Khata transfer between customers** (e.g., son takes over
  father's account). Out of scope; manual settle + new charge
  handles this acceptably.
- **Interest on outstanding balance.** Some shops charge late
  fees. Out of scope; can be added as a charge if needed.
- **SMS / WhatsApp / payment link** integrations. Future PRs
  per the follow-ups above.
- **Cross-shop admin view of all khata.** Privacy concern;
  intentionally not in v1.

## Acceptance checklist

- [ ] **Part 0 — shop-level toggle:**
  - `Shop` type in `src/types/index.ts` has optional
    `acceptsUdhaar?: boolean`.
  - Server-side write path accepts and persists
    `acceptsUdhaar` (either via extension to existing
    `updateShopSettings` or a new `setShopAcceptsUdhaar`
    callable).
  - All three khata callables (Part 2) check
    `shop.acceptsUdhaar === true` after auth and throw
    `failed-precondition` with a friendly message otherwise.
  - `ShopSettingsScreen.tsx` shows the new "Accept Udhaar
    (Khata)" toggle with hint copy.
  - `ShopOwnerDashboardScreen.tsx` hides the "📒 Udhaar /
    Khata" tile when `acceptsUdhaar !== true`.
  - `shop_accepts_udhaar_toggled` analytics event fires on
    every switch flip.
- [ ] `functions/src/khataHelpers.ts` — pure functions:
  `canonicalizePhone`, `khataIdFromPhone`,
  `validateKhataTransaction`, `recomputeBalance`.
- [ ] `addKhataTransaction` callable: phone canonicalization +
  validation + atomic transaction (parent + child write).
- [ ] `listShopKhata` callable: shop-scoped query + total
  receivables computed server-side.
- [ ] `listKhataTransactions` callable: shop-scoped + parent
  doc + transactions.
- [ ] `firestore.rules`: new `shops/{shopId}/khata/{khataId}`
  + `transactions/{txnId}` blocks with `read, write: if false`.
- [ ] `src/types/index.ts`: `KhataEntry` + `KhataTransaction`
  types exported.
- [ ] `src/services/orderService.ts`: 3 new wrappers.
- [ ] `src/services/analytics.ts`: 3 new events with
  bucketed amounts.
- [ ] `src/screens/shop/ShopKhataListScreen.tsx`: stats card
  + filter pills + search + scrollable list + floating add
  CTA. All `useState` above conditional returns.
- [ ] `src/screens/shop/ShopKhataDetailScreen.tsx`: balance
  header + add-charge + settle CTAs + transaction list.
  `usePressGuard` on the two CTAs.
- [ ] `src/components/shop/AddKhataTransactionModal.tsx`:
  reusable, opens with pre-fill from either entry point,
  `usePressGuard` on Save.
- [ ] `src/screens/shop/ShopOwnerDashboardScreen.tsx`: new
  "📒 Udhaar / Khata" tile.
- [ ] `src/navigation/AppNavigator.tsx`: ShopKhataList +
  ShopKhataDetail routes registered.
- [ ] `tests/functions/khataHelpers.test.ts`: ~10 tests, pass.
- [ ] `tests/rules/<khataRules>.test.ts`: rules tests pass.
- [ ] `npx tsc --noEmit` (root + functions): 0 errors.
- [ ] `npm test`: green (+10 helper tests).
- [ ] `npm run test:rules`: green (rules suite passes).
- [ ] PRELAUNCH_CHECKLIST: PR 37 entry appended.
- [ ] **No new `DO NOT REMOVE` markers.**
- [ ] **No PII in analytics payloads** — verified by grep:
  `git grep "amount: amount" src/screens/shop/ShopKhata` returns
  zero matches (amount must be bucketed before tracking).

## Deliberate-break check

Before declaring done, temporarily change `canonicalizePhone`
to strip the leading `+` from the return value. Run
`npm test -- --testPathPattern="khataHelpers"`. The
"canonicalizePhone returns +91..." tests must fail. Revert.

## Smoke tests (after server-first deploy + OTA)

0. **Toggle gates the feature correctly** — sign in as approved
   shop owner. By default, dashboard does NOT show the Udhaar
   tile. Go to Shop Settings → flip "Accept Udhaar (Khata)" ON
   → return to dashboard → tile now visible. Tap it → screen
   loads. Flip the setting OFF → tile disappears again.
   Try calling `orderService.listShopKhata({...})` directly
   when the toggle is OFF — server rejects with
   `failed-precondition` and the friendly message.
1. **Add first transaction (new customer)** — with the toggle
   ON: Dashboard → "📒 Udhaar / Khata" → "+ Add transaction"
   → enter phone "9876543210", name "Amit", amount 250, type
   charge, note "atta + dal". Save. Modal closes; list now
   shows Amit with balance ₹250.
2. **Add another transaction for the same customer (existing
   khata)** — repeat with the same phone, amount 100,
   charge. List should show Amit with balance ₹350 (updated,
   not duplicated). `transactionCount` should be 2.
3. **Partial settle** — tap into Amit → "💸 Settle" →
   modal pre-fills amount=350 → change to 200 → save. Balance
   drops to ₹150.
4. **Settle to zero** — settle the remaining ₹150. Balance is
   ₹0. With "With balance" filter active, Amit drops out of
   the list.
5. **Phone normalization** — add a transaction with
   "+919876543210" — should merge into the existing Amit
   khata (same canonical phone). Test "0 9876543210" too.
6. **Reject invalid phone** — try "98765" or "0" — modal
   shows the validation error inline.
7. **Reject huge amount** — try amount 999999. Validation
   error: "cannot exceed ₹1,00,000 per transaction".
8. **Cross-shop privacy** — try `orderService.listShopKhata(
   { shopId: '<some-other-shop-id>' })` from a console.
   Should throw `permission-denied`.
9. **Direct Firestore write rejected** — try writing to
   `shops/{my-shop}/khata/{phone}` via the Web SDK directly.
   Rules deny.
10. **Analytics events fire** — Firebase Analytics DebugView
    shows `shop_khata_viewed`, `shop_khata_transaction_added`,
    `shop_khata_customer_viewed` at the right funnel points.
    Amount field is the BUCKET label, not the raw value.

## Deploy plan

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm run test:full

# Rules first (since they changed).
firebase deploy --only firestore:rules
firebase firestore:rules:get | Select-String -Pattern "khata"

# Then functions, one per command.
cd functions; npm run build; cd ..
firebase deploy --only functions:addKhataTransaction
firebase deploy --only functions:listShopKhata
firebase deploy --only functions:listKhataTransactions
firebase functions:list | Select-String -Pattern "Khata"

git add functions/src/khataHelpers.ts functions/src/index.ts
git add firestore.rules
git add src/services/orderService.ts src/services/analytics.ts
git add src/types/index.ts
git add src/screens/shop/ShopKhataListScreen.tsx
git add src/screens/shop/ShopKhataDetailScreen.tsx
git add src/components/shop/AddKhataTransactionModal.tsx
git add src/screens/shop/ShopOwnerDashboardScreen.tsx
git add src/navigation/AppNavigator.tsx
git add tests/functions/khataHelpers.test.ts
git add tests/rules/<khataRules-file>.test.ts
git add PRELAUNCH_CHECKLIST.md
git add docs/pr-37-digital-udhaar-khata-ledger-windsurf-prompt.md
git commit -m "PR 37: digital udhaar / khata ledger (phone-keyed customer credit + transaction history)"
git push origin main

eas update --branch production --message "PR 37 - khata ledger"
```

OTA-eligible. No native build needed.

## Estimated time

~2–2.5 days Windsurf work:

- Part 0 (shop-level toggle: schema + callable extension +
  settings UI + gate in 3 callables + dashboard
  conditional): 1.5–2 hr
- Part 1 (pure helpers): 45 min
- Part 2 (3 callables): 1.5 hr
- Part 3 (rules): 15 min
- Part 4 (indexes): N/A
- Part 5 (types): 10 min
- Part 6 (3 wrappers): 20 min
- Part 7 (3 screens + modal — biggest chunk): 4–5 hr
- Part 8 (tile + routes): 20 min
- Part 9 (analytics events): 15 min
- Part 10 (tests, 10 helper + 5 rules): 1 hr
- Part 11 (PRELAUNCH_CHECKLIST): 15 min
- Deliberate-break + final test run: 20 min

## Why this PR matters

The khata is the most universal feature of Indian retail
commerce. Every kirana keeps one. Every regular customer is on
one. **Digitizing it without making it feel like an
"app feature" is the difference between a tool the shop owner
loves and one they tolerate.**

PR 37 specifically does not try to be clever. It mirrors the
paper notebook exactly:
- Append-only (no delete; corrections via offsetting entries
  like the notebook tradition)
- Phone is the customer key (not email, not an account ID)
- The shop owner is the source of truth (no customer-side
  approval flow that could block a real-world transaction)
- Open-and-write fast (you're standing at the counter with a
  customer in front of you)

The retention case is strongest here of any feature in the
roadmap. A shop owner with a digital khata becomes someone who
opens the app **multiple times a day** — every time a customer
buys on credit, every time someone settles. That's the deepest
"merchant weekly active" signal you can get.

Combined with PR 36's Customer CRM and PR 38's observability,
PR 37 completes the pilot's merchant-side daily-use surface.
After these three, the pilot can start with confidence that
shops will actually open the app — and the dashboard will
prove it (or disprove it, and we'll fix what needs fixing).
