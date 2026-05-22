# PR 22 — Customer delivery instructions on address (Windsurf prompt)

## Why this PR exists

After PR 21 captured the "what to do when items are unavailable"
upfront, the other big mid-fulfillment interruption in kirana
delivery is **access**: "where do I leave it? ring the bell? gate
is locked? dog?" Today the delivery partner calls the customer
mid-route. Customer answers (maybe), gives instructions, partner
relays to themselves and proceeds. Time wasted, sometimes calls
dropped, sometimes wrong assumptions.

**PR 22 lets customers save their delivery instructions per address
and edit them at checkout if needed.** "Ring the second bell from
left," "leave at door, dog inside," "call when you reach the gate."
Shop owner + delivery partner see the instructions on order detail
when fulfilling — no calls needed for routine cases.

**Bilateral payoff:**
- Customer not interrupted by access-detail calls
- Delivery partner finishes routes faster
- Shop owner has fewer "where do I drop this" support pings

Schema-additive (one optional field on the existing Address type).
Server-first deploy discipline applies. ~2 hours.

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md`.
- `src/types/index.ts` — find the `Address` type (the one used as
  `Order.deliveryAddress` AND as entries in the user's saved
  address book). One new optional field added.
- `functions/src/profileHelpers.ts` — `validateAddressInput`
  already enforces field shape on saveAddress. Extend it to
  validate the new `deliveryInstructions` field length.
- `functions/src/index.ts` — `placeOrder` callable (~line 188+).
  Address is already accepted as-is; the new field flows through
  automatically once the type allows it, but server-side validation
  of length should be enforced too.
- `src/screens/AddressEditScreen.tsx` (or wherever the address
  form lives — check `src/screens/profile/` or grep for
  `saveAddress` calls). Add a text field for instructions.
- `src/screens/CheckoutScreen.tsx` — pre-fill from selected
  address's instructions + allow per-order override.
- `src/screens/OrderDetailScreen.tsx` (customer) — read-only
  display of the instructions they sent with this order.
- `src/screens/shop/ShopOrderDetailScreen.tsx` — prominent display
  (similar visual treatment as PR 21's substitution-preference
  card so it can't be missed).
- PR 21 prompt — same architectural pattern (small schema additive,
  bilateral display, server-first deploy).

## Critical lessons from PRs 12–21 (do not repeat)

1. **All `useState` calls in screens sit ABOVE conditional early
   returns.** AddressEditScreen, CheckoutScreen, both detail screens
   need new state hoisted. Add PR 22 to the comment lineage.
2. **Server-first deploy** for `saveAddress` + `placeOrder` updates.
   Both are existing callables being modified.
3. **Zero new `DO NOT REMOVE` markers expected.** 11 PRs clean.

## Scope (in)

### Part 1 — Schema additive change

In `src/types/index.ts`, extend the `Address` type:

```ts
// PR 22 — Delivery instructions. Free-form text the customer wants
// the delivery partner / shop to read before / during drop-off.
// Examples:
//   "Ring second bell from left"
//   "Leave at door, dog inside — call when you arrive"
//   "Gate locked after 9 PM; call to unlock"
//
// Saved per-address (so customer doesn't retype every order) but
// editable at checkout for one-off variations. The order doc
// snapshots whatever was at checkout into deliveryAddress, so the
// shop + delivery partner see the final value either way.
//
// Max 280 chars (Twitter-classic limit) keeps the field small
// enough to display in a single card on the shop order detail
// without truncation, and discourages essays the partner won't read.
export type Address = {
  // ...existing fields
  deliveryInstructions?: string;
};
```

Whichever variant (`Address` vs `SavedAddress`) is used as the
order's `deliveryAddress` AND in the user's address book, add the
field there. If both types exist as separate types in the codebase,
extend both. No Firestore rule changes needed.

### Part 2 — Pure helper for validation

New file `functions/src/deliveryInstructionsHelpers.ts`:

```ts
/**
 * PR 22 — pure helpers for delivery-instructions validation.
 *
 * Used by saveAddress + placeOrder to normalize incoming
 * instructions. Missing / undefined → undefined (the field is just
 * absent). Non-string or oversized → invalid-argument.
 *
 * Pure — no Firestore, no React, no clock. Pinned by
 * tests/functions/deliveryInstructionsHelpers.test.ts.
 */

export const MAX_INSTRUCTIONS_LEN = 280;

export type NormalizeResult =
  | { ok: true; value: string | undefined }
  | { ok: false; code: 'invalid-argument'; message: string };

/**
 * Normalize incoming delivery instructions from request data.
 * - undefined / null / '' → undefined (field absent on the stored doc)
 * - non-string → invalid-argument
 * - over MAX_INSTRUCTIONS_LEN chars → invalid-argument
 * - valid string → trimmed value
 */
export function normalizeDeliveryInstructions(
  raw: unknown,
): NormalizeResult {
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined };
  }
  if (typeof raw !== 'string') {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'deliveryInstructions must be a string',
    };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: undefined };
  }
  if (trimmed.length > MAX_INSTRUCTIONS_LEN) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: `deliveryInstructions too long (max ${MAX_INSTRUCTIONS_LEN} chars)`,
    };
  }
  return { ok: true, value: trimmed };
}
```

### Part 3 — Tests for the helper

New file `tests/functions/deliveryInstructionsHelpers.test.ts`:

```ts
import { describe, it, expect } from '@jest/globals';
import {
  normalizeDeliveryInstructions,
  MAX_INSTRUCTIONS_LEN,
} from '../../functions/src/deliveryInstructionsHelpers';

describe('normalizeDeliveryInstructions', () => {
  it('returns undefined for undefined input', () => {
    const r = normalizeDeliveryInstructions(undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeUndefined();
  });

  it('returns undefined for null input', () => {
    const r = normalizeDeliveryInstructions(null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    const r = normalizeDeliveryInstructions('');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeUndefined();
  });

  it('returns undefined for whitespace-only string', () => {
    const r = normalizeDeliveryInstructions('   ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeUndefined();
  });

  it('trims surrounding whitespace and returns', () => {
    const r = normalizeDeliveryInstructions('  Ring twice  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('Ring twice');
  });

  it('accepts a typical short instruction', () => {
    const r = normalizeDeliveryInstructions('Leave at door, dog inside');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('Leave at door, dog inside');
  });

  it('accepts exactly MAX_INSTRUCTIONS_LEN chars', () => {
    const max = 'x'.repeat(MAX_INSTRUCTIONS_LEN);
    const r = normalizeDeliveryInstructions(max);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(max);
  });

  it('rejects over MAX_INSTRUCTIONS_LEN chars', () => {
    const tooLong = 'x'.repeat(MAX_INSTRUCTIONS_LEN + 1);
    const r = normalizeDeliveryInstructions(tooLong);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('rejects non-string input (number)', () => {
    const r = normalizeDeliveryInstructions(42);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('rejects non-string input (object)', () => {
    const r = normalizeDeliveryInstructions({ note: 'ring twice' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('MAX_INSTRUCTIONS_LEN is the documented Twitter-classic 280', () => {
    expect(MAX_INSTRUCTIONS_LEN).toBe(280);
  });
});
```

### Part 4 — Wire into `saveAddress` + `placeOrder` callables

In `functions/src/index.ts`:

```ts
// PR 22 — DO NOT REMOVE (auto-formatter risk per code-discipline).
// Used by saveAddress + placeOrder to validate the new
// deliveryInstructions field on the Address payload.
import { normalizeDeliveryInstructions } from './deliveryInstructionsHelpers';
```

**In `saveAddress` callable** (or wherever address validation
happens — could be inside `validateAddressInput` helper):

After existing address-field validation, before the write:

```ts
const instructionsResult = normalizeDeliveryInstructions(
  request.data?.address?.deliveryInstructions,
);
if (!instructionsResult.ok) {
  throw new HttpsError(instructionsResult.code, instructionsResult.message);
}
const deliveryInstructions = instructionsResult.value;

// Then when writing the address, include this field only if defined:
const addressToStore = {
  ...validatedAddressFields,
  ...(deliveryInstructions !== undefined ? { deliveryInstructions } : {}),
};
```

**In `placeOrder` callable**, do the same validation on the
incoming address payload:

```ts
const instructionsResult = normalizeDeliveryInstructions(
  request.data?.address?.deliveryInstructions,
);
if (!instructionsResult.ok) {
  throw new HttpsError(instructionsResult.code, instructionsResult.message);
}
const deliveryInstructions = instructionsResult.value;

// Stamp onto order's deliveryAddress snapshot:
const order = {
  // ...existing fields
  deliveryAddress: {
    ...address, // existing fields
    ...(deliveryInstructions !== undefined ? { deliveryInstructions } : {}),
  },
};
```

### Part 5 — Client dispatcher

Existing `profileService.saveAddress` and `orderService.placeOrder`
take an address object. No new field needs to be added to their
signatures — the new field flows through as part of the address
type. Just verify TypeScript doesn't complain about the new field.

### Part 6 — AddressEditScreen integration

Find the screen where customers add/edit saved addresses (likely
`src/screens/profile/AddressEditScreen.tsx` or similar). Add a
text input for delivery instructions:

```tsx
// PR 22 — delivery instructions state. Hoisted with other address
// field state. Default value pulled from existing address when
// editing, empty for a new address.
const [deliveryInstructions, setDeliveryInstructions] = useState<string>(
  existingAddress?.deliveryInstructions ?? '',
);
```

UI: add a `TextInput` near the bottom of the form, after phone:

```tsx
<Text style={styles.label}>Delivery instructions (optional)</Text>
<TextInput
  value={deliveryInstructions}
  onChangeText={t => setDeliveryInstructions(t.slice(0, 280))}
  placeholder="e.g. Ring second bell, leave at door if no answer"
  placeholderTextColor={colors.textSecondary}
  multiline
  style={styles.instructionsInput}
/>
<Text style={styles.charCount}>
  {deliveryInstructions.length}/280
</Text>
```

When submitting, include `deliveryInstructions` in the address
payload:

```tsx
await profileService.saveAddress({
  // ...other fields
  deliveryInstructions: deliveryInstructions.trim() || undefined,
});
```

### Part 7 — CheckoutScreen integration

In `src/screens/CheckoutScreen.tsx`, when the customer picks a
saved address, pre-fill an editable instructions field:

```tsx
// PR 22 — instructions for THIS order. Pre-filled from the
// selected address's saved instructions; customer can edit
// per-order without touching the saved address. The override is
// captured on the order's deliveryAddress snapshot.
const [orderInstructions, setOrderInstructions] = useState<string>(
  selectedAddress?.deliveryInstructions ?? '',
);

// When selectedAddress changes, reset instructions to that
// address's saved value:
useEffect(() => {
  setOrderInstructions(selectedAddress?.deliveryInstructions ?? '');
}, [selectedAddress?.id]);
```

UI: small editable text area near the address picker:

```tsx
<Text style={styles.subTitle}>Delivery instructions</Text>
<TextInput
  value={orderInstructions}
  onChangeText={t => setOrderInstructions(t.slice(0, 280))}
  placeholder="Optional — e.g. Ring twice"
  placeholderTextColor={colors.textSecondary}
  multiline
  style={styles.instructionsInput}
/>
<Text style={styles.charCount}>{orderInstructions.length}/280</Text>
```

When placing the order, pass the (possibly-overridden) instructions
in the address payload:

```tsx
await orderService.placeOrder({
  shopId,
  items,
  address: {
    ...selectedAddress,
    deliveryInstructions: orderInstructions.trim() || undefined,
  },
  paymentMethod,
  substitutionPreference,
});
```

### Part 8 — Customer OrderDetailScreen display

In `src/screens/OrderDetailScreen.tsx`, show a read-only
confirmation card if instructions were included. Place near the
delivery address display:

```tsx
{order.deliveryAddress.deliveryInstructions && (
  <View style={styles.instructionsCard}>
    <Text style={styles.instructionsLabel}>Delivery instructions:</Text>
    <Text style={styles.instructionsValue}>
      {order.deliveryAddress.deliveryInstructions}
    </Text>
  </View>
)}
```

Silently omit when empty.

### Part 9 — Shop ShopOrderDetailScreen display

In `src/screens/shop/ShopOrderDetailScreen.tsx`, render a
**prominent** card (similar visual treatment to PR 21's
substitution-preference card) near the delivery address section.
Shop owner needs to see this BEFORE handing off to delivery partner.

```tsx
{order.deliveryAddress.deliveryInstructions && (
  <View style={styles.dropInstructionsCard}>
    <Text style={styles.dropInstructionsLabel}>
      📝 Delivery instructions:
    </Text>
    <Text style={styles.dropInstructionsValue}>
      {order.deliveryAddress.deliveryInstructions}
    </Text>
  </View>
)}
```

Styles (tinted background, left-border accent for visual weight —
same pattern as substitution preference):

```ts
dropInstructionsCard: {
  backgroundColor: '#FEF9E7', // soft yellow
  borderRadius: radii.md,
  padding: spacing.md,
  borderLeftWidth: 4,
  borderLeftColor: '#F4D03F',
  marginBottom: spacing.md,
},
dropInstructionsLabel: {
  ...typography.caption,
  color: colors.textSecondary,
  fontWeight: '700',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 4,
},
dropInstructionsValue: {
  ...typography.body,
  color: colors.textPrimary,
},
```

### Part 10 — Delivery partner OrderDetail display

In the delivery partner's order detail screen (likely
`src/screens/delivery/DeliveryOrderDetailScreen.tsx`), show the
SAME card pattern as the shop. The delivery partner is the actual
recipient of the instructions — they're the one ringing the bell.

### Part 11 — Backwards compatibility

- Addresses saved before PR 22 have no `deliveryInstructions`
  field. AddressEditScreen pre-fills with empty string for editing
  (handled by `?? ''`).
- Orders placed before PR 22 have no instructions on their
  `deliveryAddress` snapshot. Customer + shop + delivery displays
  silently omit the card.
- Old client without the UI still saves addresses + places orders
  fine. Server defaults missing field to undefined.

No migration needed.

## Scope (out)

- **Per-item delivery instructions** (e.g. "handle this one
  carefully"). Whole-order instructions are enough for MVP.
- **Voice-recorded instructions.** Pure text for now.
- **Suggested instructions / autocomplete.** Free-form text;
  customers know what to write.
- **Delivery partner can reply with "got it" or ask clarifying
  questions.** Out of scope — needs messaging infrastructure.
- **Mandatory instructions for some shops.** All optional in MVP.

## Acceptance checklist

- [ ] `Address` type (and `SavedAddress` if separate) extended
  with `deliveryInstructions?: string`.
- [ ] `functions/src/deliveryInstructionsHelpers.ts` exports
  `normalizeDeliveryInstructions` + `MAX_INSTRUCTIONS_LEN`.
- [ ] `tests/functions/deliveryInstructionsHelpers.test.ts` covers
  ≥10 cases.
- [ ] `saveAddress` callable validates + persists the new field.
- [ ] `placeOrder` callable validates + stamps the field onto
  `order.deliveryAddress`.
- [ ] AddressEditScreen has a text input with 280-char counter.
  State hoisted above early returns; comment cites PR 22 lineage.
- [ ] CheckoutScreen pre-fills from selected address, allows
  per-order override, sends the override in placeOrder payload.
- [ ] Customer OrderDetailScreen shows read-only confirmation
  card; silently omits when empty.
- [ ] Shop ShopOrderDetailScreen shows prominent yellow-tinted
  card with instructions.
- [ ] Delivery DeliveryOrderDetailScreen shows the same prominent
  card.
- [ ] Legacy addresses / orders render gracefully (no crashes, no
  empty cards).
- [ ] `npx tsc --noEmit`: 0 errors (root + functions).
- [ ] `npm test`: existing tests + 10+ new helper tests pass.
- [ ] `npm run audit` passes.
- [ ] Deliberate-break: change a "valid string" test to expect
  rejection, confirm red, revert.
- [ ] **Zero new `DO NOT REMOVE` markers added** (12-PR streak).

## Smoke tests (manual, after staged deploy)

1. **Save address with instructions** — Profile → Saved Addresses →
   Edit (or Add). Fill name + line1 + city + pincode + phone +
   "Ring second bell from left". Save. Reopen the address — text
   persisted.
2. **Char counter on AddressEdit** — type 280 chars. Counter shows
   `280/280`. Try to type more — input stops.
3. **Save address without instructions** — clear the field, save.
   Reopen — field is empty. No error.
4. **Checkout pre-fills from saved address** — start a new order.
   Pick the address from Test 1. Instructions field should show
   "Ring second bell from left" pre-filled.
5. **Checkout per-order override** — change instructions at
   checkout to "Today: leave at gate, ring is broken". Place order.
   Open the saved address again — saved value is still "Ring second
   bell from left" (not overwritten).
6. **Customer order detail shows instructions** — open the order
   from Test 5. Should see a read-only card: "Delivery instructions:
   Today: leave at gate, ring is broken".
7. **Shop owner sees prominent card** — Quick Switch to Shop
   Owner. Open the order detail. Yellow-tinted card prominently
   displays the instructions near the address.
8. **Delivery partner sees prominent card** — Quick Switch to
   Delivery Partner, claim the order, open detail. Same yellow
   card visible.
9. **Legacy order has no card** — open a pre-PR-22 order. No
   instructions card on customer / shop / delivery detail.
10. **Server rejects oversized** — try to send 281 chars via the
    API. Server returns invalid-argument. App's char limit should
    prevent this; only triggered if the API is called directly.
11. **Empty / whitespace-only saved as undefined** — save an
    address with "   " (only spaces). Server stores it without the
    field. Open address — empty field, no whitespace artifact.
12. **No screen crashes** — visit AddressEdit, Checkout, all three
    OrderDetail screens. No ErrorBoundary.

## Deploy plan

Server-first per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Server first — saveAddress + placeOrder both updated to
#    validate the new field.
cd functions
npm run build
cd ..
firebase deploy --only functions --project grocery-mvp-dev
firebase functions:list --project grocery-mvp-dev
# Both placeOrder + saveAddress should appear in the "Updated"
# section, not "Created".

# 2. Client OTA
npm test
eas update --branch production --message "PR 22 — Customer delivery instructions on address"
```

Tell testers to force-close + reopen TestFlight after publish.

## Estimated time

~2 hours Windsurf work:

- Part 1 (schema): 5 min
- Part 2 (helper): 15 min
- Part 3 (tests): 25 min — 10 cases
- Part 4 (callable updates): 25 min
- Part 5 (client dispatcher): 5 min — type passthrough only
- Part 6 (AddressEditScreen text field): 15 min
- Part 7 (CheckoutScreen pre-fill + override): 20 min
- Part 8 (customer display card): 10 min
- Part 9 (shop display card): 10 min
- Part 10 (delivery partner display card): 10 min
- Smoke + deliberate-break: 20 min

## Why this PR matters

Closes the other half of the "interrupt-the-customer-mid-order"
problem alongside PR 21:

| Friction point | Pre-PR | Post-PR |
|---|---|---|
| Stock-unavailable interruption | Shop calls customer | PR 21 — pre-stated substitution preference |
| Drop-off access interruption | Delivery calls customer | **PR 22 — pre-stated delivery instructions** |

After PR 22, the customer's full intent on both stock + access is
captured upfront. The shop + delivery partner have what they need
to fulfill without calling. Real-world impact: drop-off-time-per-
order should shrink by 1–2 minutes for routine deliveries (no
phone call round-trip + no waiting at the wrong door).

Bilateral payoff: customer respect (less interrupted), partner
productivity (faster routes), shop trust (fewer calls means happier
customers means better ratings — feeds into PR 20).
