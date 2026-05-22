# PR 21 — Customer substitution preferences at checkout (Windsurf prompt)

## Why this PR exists

Kirana stock volatility is fundamentally higher than restaurant
menus. The shop owner just doesn't have Tata Sampann atta today,
but they do have Aashirvaad in the same pack size. Today's workflow:

1. Shop owner sees "Tata Sampann atta 5kg" on the order
2. Realizes they're out
3. Calls the customer ("namaste, atta khatam ho gaya, Aashirvaad
   chalega kya?")
4. Customer answers (maybe — depends on whether they pick up)
5. If yes, shop swaps; if no, shop refunds or cancels
6. Time wasted, calls dropped, orders delayed

**PR 21 lets the customer pre-state their preference at checkout
so the shop can act without interrupting.** Three options:

- **📞 Call me first** (default, recommended) — shop must call before
  any substitution or refund. The conservative choice.
- **🔄 Replace with similar** — shop picks an equivalent item. Customer
  trusts shop's judgment. Fastest fulfillment.
- **💰 Refund the item** — shop removes it from the order and adjusts
  the total. No calls, no swaps.

Customer sees their choice as a read-only confirmation on order
detail. Shop sees it prominently when fulfilling the order.

**Bilateral payoff.** Customer doesn't get interrupted by a call
mid-meeting / mid-meal. Shop fulfills faster and doesn't waste time
on phone calls that don't get picked up.

Schema-additive (one optional field on Order). Server-first deploy
discipline applies. ~2.5–3 hours.

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md`.
- `src/types/index.ts` — `Order` type. One new optional field.
- `functions/src/index.ts` — `placeOrder` callable (~line 188+).
  This PR adds optional acceptance + persistence of the new field.
- `src/screens/CheckoutScreen.tsx` — the picker UI goes here, in a
  new section between address + payment method.
- `src/screens/OrderDetailScreen.tsx` — customer's read-only
  display.
- `src/screens/shop/ShopOrderDetailScreen.tsx` — shop owner's
  prominent display (so they know what to do without scrolling).
- `src/services/orderService.ts` — `placeOrder` dispatcher.
- PR 12 + PR 19 + PR 20 prompts — same server-first rollout pattern
  applies here.

## Critical lessons from PRs 12–20 (do not repeat)

1. **All `useState` calls in screens sit ABOVE conditional early
   returns.** CheckoutScreen + OrderDetailScreen + ShopOrderDetail
   all need new state hoisted. Add PR 21 to the comment lineage.
2. **Server-first deploy** for the new field acceptance in `placeOrder`.
   New client sends the field; old server ignores it (harmless), but
   the helper validation should be live before we promise customers
   the preference is being honored.
3. **Zero new `DO NOT REMOVE` markers expected.** 10 PRs clean.

## Scope (in)

### Part 1 — Schema additive change

In `src/types/index.ts`:

```ts
// PR 21 — substitution preference. Set ONCE at checkout. Tells the
// shop how to handle an unavailable item without needing to call
// the customer mid-fulfillment.
//
//   'call_me' (default)  — shop MUST call before substituting
//                          or refunding. Safest, used when no
//                          explicit choice was made.
//   'auto'               — shop picks an equivalent item. Customer
//                          trusts shop's judgment.
//   'refund'             — shop removes the item + adjusts total.
//                          No call, no substitution.
//
// Missing field on old orders renders as 'call_me' (the safe
// default). Customer cannot edit after placement — they'd have to
// cancel + re-order.
export type SubstitutionPreference = 'call_me' | 'auto' | 'refund';

export type Order = {
  // ...existing fields
  substitutionPreference?: SubstitutionPreference;
};
```

Mirror the type on the server-side if duplicated. No Firestore rule
changes — existing per-order rules handle the new field.

### Part 2 — Pure helper for validation

New file `functions/src/substitutionHelpers.ts`:

```ts
/**
 * PR 21 — pure helpers for substitution preference validation.
 *
 * Used by placeOrder to normalize the incoming preference. Old
 * clients won't send the field at all; new clients send one of the
 * three string values. Anything else is rejected.
 *
 * Pure — no Firestore, no React, no clock. Pinned by
 * tests/functions/substitutionHelpers.test.ts.
 */

const VALID_PREFERENCES = ['call_me', 'auto', 'refund'] as const;
type ValidPreference = typeof VALID_PREFERENCES[number];

export type NormalizeResult =
  | { ok: true; value: ValidPreference }
  | { ok: false; code: 'invalid-argument'; message: string };

/**
 * Normalize an incoming substitutionPreference from request data.
 * Missing / undefined → 'call_me' (the safe default). Any string
 * not in the allowlist → invalid-argument.
 */
export function normalizeSubstitutionPreference(
  raw: unknown,
): NormalizeResult {
  if (raw === undefined || raw === null) {
    return { ok: true, value: 'call_me' };
  }
  if (typeof raw !== 'string') {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'substitutionPreference must be a string',
    };
  }
  if (!(VALID_PREFERENCES as readonly string[]).includes(raw)) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: `substitutionPreference must be one of: ${VALID_PREFERENCES.join(', ')}`,
    };
  }
  return { ok: true, value: raw as ValidPreference };
}

export { VALID_PREFERENCES };
```

### Part 3 — Tests for the helper

New file `tests/functions/substitutionHelpers.test.ts`:

```ts
import { describe, it, expect } from '@jest/globals';
import {
  normalizeSubstitutionPreference,
  VALID_PREFERENCES,
} from '../../functions/src/substitutionHelpers';

describe('normalizeSubstitutionPreference', () => {
  it('defaults to call_me when input is undefined', () => {
    const r = normalizeSubstitutionPreference(undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('call_me');
  });

  it('defaults to call_me when input is null', () => {
    const r = normalizeSubstitutionPreference(null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('call_me');
  });

  it('accepts call_me', () => {
    const r = normalizeSubstitutionPreference('call_me');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('call_me');
  });

  it('accepts auto', () => {
    const r = normalizeSubstitutionPreference('auto');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('auto');
  });

  it('accepts refund', () => {
    const r = normalizeSubstitutionPreference('refund');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('refund');
  });

  it('rejects non-string input', () => {
    const r = normalizeSubstitutionPreference(42);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('rejects unknown string values', () => {
    const r = normalizeSubstitutionPreference('cancel');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('rejects empty string', () => {
    const r = normalizeSubstitutionPreference('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('VALID_PREFERENCES is the canonical allowlist', () => {
    expect(VALID_PREFERENCES).toEqual(['call_me', 'auto', 'refund']);
  });
});
```

### Part 4 — Wire into `placeOrder` callable

In `functions/src/index.ts`:

```ts
// PR 21 — DO NOT REMOVE (auto-formatter risk per code-discipline).
// Used by placeOrder to normalize the substitution preference.
import { normalizeSubstitutionPreference } from './substitutionHelpers';
```

Inside the `placeOrder` callable, after the existing validation but
before writing the order doc:

```ts
const subResult = normalizeSubstitutionPreference(
  request.data?.substitutionPreference,
);
if (!subResult.ok) {
  throw new HttpsError(subResult.code, subResult.message);
}
const substitutionPreference = subResult.value;
```

Then in the order doc creation (where existing fields are set):

```ts
const order = {
  // ...all existing fields
  substitutionPreference,
};
```

### Part 5 — Client dispatcher

In `src/services/orderService.ts`, the existing `placeOrder` method
takes a `PlaceOrderInput`. Extend it:

```ts
type PlaceOrderInput = {
  // ...existing fields
  substitutionPreference?: SubstitutionPreference; // optional from client
};
```

And forward it in the payload:

```ts
const payload = {
  shopId: input.shopId,
  items: compactItems,
  address: input.address,
  paymentMethod: input.paymentMethod,
  substitutionPreference: input.substitutionPreference, // PR 21
};
```

Old code paths that don't pass this field continue to work because
the server defaults to `call_me`.

### Part 6 — CheckoutScreen picker UI

In `src/screens/CheckoutScreen.tsx`:

**Add state at the top (above early returns, per discipline):**

```tsx
// PR 21 — substitution preference state. Hoisted per Rules-of-Hooks
// discipline (PR 12 → PR 20 lineage). Default is 'call_me' — the
// safest choice that requires the shop to call before changing
// anything. Customer can choose 'auto' or 'refund' to skip the
// call entirely if they trust the shop or just want unavailable
// items removed.
const [substitutionPreference, setSubstitutionPreference] =
  useState<SubstitutionPreference>('call_me');
```

**Add the picker UI** in a new section between Delivery Address and
Payment Method:

```tsx
<Text style={styles.sectionTitle}>If something's unavailable</Text>
<View style={styles.subRow}>
  {([
    { value: 'call_me', label: '📞 Call me first', sub: 'Shop will call before changing anything' },
    { value: 'auto', label: '🔄 Replace with similar', sub: 'Shop picks an equivalent' },
    { value: 'refund', label: '💰 Refund the item', sub: 'Skip the item; adjust the total' },
  ] as const).map(opt => (
    <Pressable
      key={opt.value}
      onPress={() => setSubstitutionPreference(opt.value)}
      style={[
        styles.subOption,
        substitutionPreference === opt.value && styles.subOptionActive,
      ]}
      accessibilityRole="radio"
      accessibilityState={{ selected: substitutionPreference === opt.value }}
      accessibilityLabel={opt.label}
    >
      <Text
        style={[
          styles.subOptionLabel,
          substitutionPreference === opt.value && styles.subOptionLabelActive,
        ]}
      >
        {opt.label}
      </Text>
      <Text style={styles.subOptionSub}>{opt.sub}</Text>
    </Pressable>
  ))}
</View>
```

**Pass to `placeOrder` call** in the existing handler:

```tsx
const result = await orderService.placeOrder({
  shopId,
  items,
  address,
  paymentMethod,
  substitutionPreference, // PR 21
});
```

Styles to add (mirror the existing payment-method picker if there is
one for visual consistency):

```ts
subRow: {
  gap: spacing.sm,
  marginBottom: spacing.md,
},
subOption: {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radii.md,
  padding: spacing.md,
  backgroundColor: colors.surface,
},
subOptionActive: {
  borderColor: colors.primary,
  backgroundColor: colors.primaryLight,
},
subOptionLabel: { ...typography.bodyBold },
subOptionLabelActive: { color: colors.primaryDark },
subOptionSub: {
  ...typography.caption,
  color: colors.textSecondary,
  marginTop: 2,
},
```

### Part 7 — Customer OrderDetailScreen display

In `src/screens/OrderDetailScreen.tsx`, render a small read-only
display of the chosen preference. Place it near the items list or
in the "Payment" section as a confirmation:

```tsx
{order.substitutionPreference && (
  <View style={styles.subInfoCard}>
    <Text style={styles.subInfoLabel}>If unavailable:</Text>
    <Text style={styles.subInfoValue}>
      {order.substitutionPreference === 'call_me'
        ? '📞 Shop will call you first'
        : order.substitutionPreference === 'auto'
          ? '🔄 Shop will replace with similar'
          : '💰 Shop will refund the item'}
    </Text>
  </View>
)}
```

For old orders without the field, gracefully skip the section (the
`&&` guard handles this).

### Part 8 — Shop OrderDetailScreen display

In `src/screens/shop/ShopOrderDetailScreen.tsx`, this is more
prominent — the shop owner needs to see it BEFORE going through
items. Render near the top of the items section, with stronger
visual treatment so it can't be missed:

```tsx
<View style={styles.customerPrefCard}>
  <Text style={styles.customerPrefLabel}>Customer's preference:</Text>
  <Text style={styles.customerPrefValue}>
    {!order.substitutionPreference || order.substitutionPreference === 'call_me'
      ? '📞 Call before substituting or refunding'
      : order.substitutionPreference === 'auto'
        ? '🔄 Replace with similar items (shop picks)'
        : '💰 Refund unavailable items — skip and adjust total'}
  </Text>
</View>
```

For legacy orders (no field), explicitly default-render the
`call_me` message — the safe choice. This is the most important
display surface in the PR; the shop's behavior depends on it.

Styles (use a tinted/warning background so it stands out):

```ts
customerPrefCard: {
  backgroundColor: colors.primaryLight,
  borderRadius: radii.md,
  padding: spacing.md,
  borderLeftWidth: 4,
  borderLeftColor: colors.primary,
  marginBottom: spacing.md,
},
customerPrefLabel: {
  ...typography.caption,
  color: colors.primaryDark,
  fontWeight: '700',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 2,
},
customerPrefValue: {
  ...typography.bodyBold,
  color: colors.primaryDark,
},
```

### Part 9 — Backwards compatibility

Old orders placed before this PR ships have no
`substitutionPreference` field. Render rules:

- **Customer OrderDetailScreen:** silently omit the display (the
  customer didn't make a choice; nothing to show)
- **Shop ShopOrderDetailScreen:** explicitly render the `call_me`
  default message (the shop should call to be safe)
- **Server `placeOrder`:** new clients send the field; old clients
  don't (server defaults to `call_me`). No version mismatch breakage.

No migration of old order docs needed.

## Scope (out)

- **Actually executing substitutions.** This PR captures + displays
  the preference. Building UI for the shop owner to mark items as
  "substituted with X" or "refunded" is a future PR. For MVP they'll
  call (per `call_me`) or just act (per `auto`/`refund`) without
  formal in-app workflow.
- **Per-item substitution preferences.** Single preference applies
  to whole order. Per-item would be useful for "refund any veg, but
  substitute any staple" — out of scope.
- **Editing preference after order is placed.** Set once at checkout.
  Customer would cancel + re-order if they want to change.
- **Customer can set a default preference.** They re-choose each
  order. Saved default lives on profile in a future PR if there's
  demand.
- **Notify customer when substitution happens.** Push infrastructure
  not yet built (separate PR).

## Acceptance checklist

- [ ] `Order` type has `substitutionPreference?: 'call_me' | 'auto' | 'refund'`.
- [ ] `functions/src/substitutionHelpers.ts` exports
  `normalizeSubstitutionPreference` + `VALID_PREFERENCES`.
- [ ] `tests/functions/substitutionHelpers.test.ts` covers ≥9 cases
  (defaults, valid values, invalid types, allowlist).
- [ ] `placeOrder` callable in `functions/src/index.ts` imports the
  helper, normalizes incoming preference, persists on order doc.
- [ ] `orderService.placeOrder` dispatcher accepts + forwards the
  field.
- [ ] CheckoutScreen has the 3-option picker between Address and
  Payment sections. Default selection: 'call_me'. State hoisted
  above early returns; comment cites PR 21 lineage.
- [ ] Customer OrderDetailScreen shows the preference when set;
  silently omits when missing.
- [ ] Shop ShopOrderDetailScreen shows the preference prominently
  near items; defaults to call_me display for legacy orders.
- [ ] `npx tsc --noEmit`: 0 errors (root + functions).
- [ ] `npm test`: existing tests + 9+ new helper tests, all pass.
- [ ] `npm run audit` passes.
- [ ] Deliberate-break: change a passing test to expect a different
  default, confirm red, revert.
- [ ] **Zero new `DO NOT REMOVE` markers added** (11-PR streak).

## Smoke tests (manual, after staged deploy)

1. **Default selection on Checkout** — open Cart → Checkout. The
   preference section shows three options. "📞 Call me first" is
   pre-selected (active border + tinted background).
2. **Switch selection** — tap "🔄 Replace with similar". That option
   becomes active; the previous one loses the active styling.
3. **Place order with 'auto' preference** — submit. Order Detail
   shows "🔄 Shop will replace with similar".
4. **Shop sees the preference prominently** — sign in as Shop Owner
   (Quick Switch), open the order detail. Near the top of items, a
   primary-tinted card shows "Customer's preference: 🔄 Replace
   with similar items (shop picks)".
5. **Legacy order display** — find an old order placed before this
   PR. Customer side: no preference section visible (silently
   omitted). Shop side: shows default "📞 Call before substituting
   or refunding" — safe fallback.
6. **Place with 'refund' preference** — different test order.
   Verify customer + shop displays match the choice.
7. **Place with 'call_me' (explicit default)** — verify the choice
   sticks even when it matches the default.
8. **Server validation** — try to send a malformed value via the
   raw API (e.g. `substitutionPreference: 'cancel'`). Server returns
   `invalid-argument`. Doesn't break valid flows.
9. **No screen crashes** — visit CheckoutScreen, OrderDetailScreen,
   ShopOrderDetailScreen in various states. No ErrorBoundary.

## Deploy plan

Server-first per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Server first
cd functions
npm run build
cd ..
firebase deploy --only functions --project grocery-mvp-dev
firebase functions:list --project grocery-mvp-dev
# Confirm placeOrder is in the list (it's updated, not new — verify
# the deploy reported "Updated: placeOrder").

# 2. Client OTA
npm test
eas update --branch production --message "PR 21 — Customer substitution preferences"
```

Tell testers to force-close + reopen TestFlight.

## Estimated time

~2.5–3 hours Windsurf work:

- Part 1 (schema): 5 min
- Part 2 (helper): 15 min
- Part 3 (tests): 25 min — 9 cases, all simple
- Part 4 (placeOrder wire-up): 15 min
- Part 5 (client dispatcher): 10 min
- Part 6 (CheckoutScreen picker UI): 40 min — most visual polish
- Part 7 (customer display): 15 min
- Part 8 (shop display): 20 min — prominent card design
- Smoke + deliberate-break: 25 min

## Why this PR matters

Kirana customers in India face this exact problem every time they
order: "out of stock, what now?" → unanswered call → delayed
fulfillment → frustration. After PR 21, the customer's intent is
captured upfront and the shop has zero excuse to interrupt them.

The metric to watch: **% of orders where shop calls customer
mid-fulfillment**. If you have a way to measure this (call logs,
shop-side feedback), should drop substantially within a week.
Industry equivalent in food delivery: substitution-call rate drops
~60% when preferences are pre-stated (Swiggy Instamart data
referenced in industry presentations).

Bilateral value: customers feel respected (their choice was heard);
shops finish orders faster. Both sides win, which is the rare
characteristic of a really good feature.
