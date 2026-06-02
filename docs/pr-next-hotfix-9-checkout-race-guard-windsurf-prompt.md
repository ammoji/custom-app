# PR-NEXT-HOTFIX-9 — Checkout Place Order race guard (closes Bug 2 reintroduction window)

**Source:** Sudhir's June 2 testing. *"Place order button was active when I clicked on use current location for delivery, and it was still calculating the location point. I think when we use current location, place order button should be disabled until final location is calculated, otherwise it is picking default saved home location even customer is picking current location as an option."*

HOTFIX-8 fixed the form-stale-data path AT placeOrder time, but only when `liveCoords` are present. There's a race window between "customer taps 'Deliver to current location'" and "`liveCoords` resolved from GPS" — during that window the Place Order button is still enabled. A fast tap there ships an order with no `deliveryLocation` and falls through HOTFIX-8's reverse-geocode branch (which requires liveCoords) — landing in the legacy path that re-stamps the stale form (Bug 2 returns).

**Deploy class:** pure client OTA. No callable, no schema.

**Audit-grep (Rule 5):**

```
grep -n "deliveryTargetMode\|liveCoords\|capturingLive\|setPlacing" src/screens/CheckoutScreen.tsx
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `deliveryTargetMode` | line 138 | `'saved' \| 'current' \| null` |
| `liveCoords` | line 145 | `{ lat; lng; source: 'gps' \| 'fallback' } \| null` |
| `capturingLive` | line 151 | boolean, true during in-flight GPS call |
| `placing` | already used | boolean, true during placeOrder network call |

**Read first**

1. `CLAUDE.md`
2. `.windsurf/code-discipline.md` Rules 1, 2
3. `src/screens/CheckoutScreen.tsx:138-180` — state declarations
4. `src/screens/CheckoutScreen.tsx:613-770` — placeOrder + the existing button render
5. `src/screens/CheckoutScreen.tsx:486-505` — HOTFIX-8's race-window opening (validate() now permissive)

---

## Plan

### §A — Derived `canPlaceOrder` flag

Near the other derived flags (look for `savedAddressMissingCoords` at line 367), add:

```tsx
/**
 * PR-NEXT-HOTFIX-9 — gate Place Order during the GPS-capture race
 * window. HOTFIX-8 relaxed validate() in current-location mode so
 * the form-stale-fields don't block submit, but that exposed a
 * window where the customer can submit before `liveCoords` arrives.
 * The submitted order then has no deliveryLocation (resolveDeliveryLocation
 * returns null when liveCoords missing) and the reverse-geocode
 * path skips → Bug 2 returns. This flag locks the button until the
 * GPS-fix arrives OR the customer switches to saved.
 *
 *   - mode='current' + capturingLive          → block (in flight)
 *   - mode='current' + liveCoords == null    → block (never captured)
 *   - mode='current' + liveCoordsError        → block (won't recover
 *                                               without re-tap)
 *   - mode='saved' or anything else           → allow (existing behaviour)
 */
const blockingOnCurrentCapture =
  deliveryTargetMode === 'current' &&
  (capturingLive || !liveCoords);

const canPlaceOrder =
  !placing && !blockingOnCurrentCapture;
```

### §B — Wire into the button

Find the Place Order button (search for `title="Place Order"` or `title={\`Pay ` — there's a COD vs Razorpay split, so two CTAs need the same gate). Add `disabled={!canPlaceOrder}` to each.

Existing renders look something like:

```tsx
<Button
  title={paymentMethod === 'cod' ? 'Place Order' : `Pay ${formatRupees(total)}`}
  onPress={placeOrder}
  disabled={placing}  // ← extend this
  fullWidth
/>
```

Change to:

```tsx
<Button
  title={paymentMethod === 'cod' ? 'Place Order' : `Pay ${formatRupees(total)}`}
  onPress={placeOrder}
  disabled={!canPlaceOrder}
  fullWidth
/>
```

### §C — Inline hint above the CTA

Just above the button (inside the `ctaWrap` View), add a small status hint that only renders while blocking:

```tsx
{blockingOnCurrentCapture && (
  <Text style={styles.captureHint}>
    {liveCoordsError
      ? '⚠️ Couldn\'t get your location. Tap "Deliver to current location" again to retry.'
      : '📍 Capturing your location…'}
  </Text>
)}
```

Style:

```ts
captureHint: {
  ...typography.caption,
  color: colors.textSecondary,
  textAlign: 'center',
  marginBottom: spacing.sm,
},
```

### §D — Defensive guard inside placeOrder (belt + suspenders)

At the top of `placeOrder` (after the anonymous-user gate, before `validate()`), add a re-check in case the button-disable was bypassed (e.g., a stale ref kept fires after state flips):

```tsx
if (deliveryTargetMode === 'current' && (!liveCoords || capturingLive)) {
  // Race shouldn't be reachable from the UI (HOTFIX-9 disables the
  // button) but the cost of a defensive check is zero and a future
  // refactor could unintentionally re-expose it.
  console.warn('[Checkout] placeOrder fired during GPS capture; ignoring.');
  return;
}
```

This is Rule 1's spirit: the button-disable is the user-facing fix, the in-function check is the structural lock so a future regression can't ship Bug 2 again.

---

## Discipline checklist

1. **Rule 1** — All new computed values + state reads carry "PR-NEXT-HOTFIX-9 — DO NOT REMOVE" comments.
2. **Rule 2** — `canPlaceOrder` + `blockingOnCurrentCapture` sit with other derived flags, above any conditional return.
3. **Rule 5** (schema verification) — audit-grep table in header. No doc field references; all in-screen state.
4. **No schema, no callable.**
5. **No new tests required** — pure UI state guard. Acceptance is manual:

---

## Acceptance checklist

1. **The race itself** — open Checkout with a saved Home address auto-selected. Tap "Deliver to current location." **While the GPS spinner is up** (under 3s typically), the Place Order / Pay button is disabled with an inline hint `"📍 Capturing your location…"` above it. Tap the button → nothing happens.
2. After GPS resolves → hint disappears, button re-enables, tap → order ships with `deliveryLocation` set + reverse-geocoded `deliveryAddress`. Shopkeeper sees correct address (not Home).
3. **Permission-denied path** — disable Location permission system-wide, retry the flow. `liveCoordsError` populates; button stays disabled; hint flips to `"⚠️ Couldn't get your location. Tap … again to retry."` Customer taps the current-location radio again → retries.
4. **Saved-mode regression** — pick a saved address. Button enables immediately (no current-mode gate fires). Order ships against the saved address as before.
5. **Form-mode regression** — customer with zero saved addresses fills form, presses Place Order. Button enables when validate() passes. Order ships normally.
6. **Defensive guard fires the warn** — temporarily edit `disabled={!canPlaceOrder}` back to `disabled={placing}`, reproduce the race, confirm the `console.warn('[Checkout] placeOrder fired during GPS capture; ignoring.')` line fires. Revert.
7. `npx tsc --noEmit` clean; `npm run test:unit` clean (no test count change).

---

## Out of scope

- **A spinner inside the Place Order button itself** during GPS capture. The above-button hint is more visible + accessible. Skip.
- **Auto-retrying GPS capture** after `liveCoordsError`. Customer-driven retry is intentional — auto-retry can mask permission issues.

---

## Deploy

```
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "PR-NEXT-HOTFIX-9 checkout race guard closes Bug 2 reintroduction window"
```

## Doc trail

- `docs/TESTING-FINDINGS-2026-05-30.md` — append Sudhir's June 2 observation #5 → `✅ SHIPPED in PR-NEXT-HOTFIX-9` with the race-window root-cause analysis.
- `docs/SESSION_LOG.md` — one paragraph.
- `CLAUDE.md` — bump date.
