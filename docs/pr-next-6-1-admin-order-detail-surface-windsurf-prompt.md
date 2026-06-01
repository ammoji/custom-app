# PR-NEXT-6.1 — Admin order-card: payment-method line + delivery-proof disclosure

**Source:** Closes the gap PR-NEXT-6 §D.4 deferred — admins today have read auth on the proof callable but no UI surface to view the photo or the new payment-method line in the app.

**Deploy class:** **pure client OTA.** No callable, no Firestore rule, no Storage rule, no schema. One file touched. Ships via `eas update --branch production` alone.

**Read first**

1. `CLAUDE.md` (full)
2. `docs/pr-next-6-delivery-proof-photo-windsurf-prompt.md` — the parent PR; §D.4 is what this PR closes
3. `.windsurf/code-discipline.md` (Rules 1, 2)
4. `src/screens/admin/AdminOrdersScreen.tsx` — the only file modified. The two existing inline-disclosure patterns (`overrideExpandedId` lines 75–78, 372–421; `timelineExpandedId` lines 80–86, 423–460) are the templates this PR mirrors.
5. `src/components/order/DeliveryProofViewer.tsx` — reusable component from PR-NEXT-6; renders the thumbnail + tap-to-zoom modal; fetches signed-read URL on mount. Reused verbatim here.
6. `src/utils/formatPaymentMethod.ts` — pure helper from PR-NEXT-6 that turns `(paymentMethod, paidMethod, paymentStatus)` into the audience-correct copy. Reused verbatim.

---

## Why this PR exists

PR-NEXT-6 shipped delivery-proof capture + viewing on the partner / shop / customer surfaces, but admin UI was deferred because there's no dedicated admin order-detail screen — `AdminOrdersScreen` is a flat card list. Admins still hold read auth via `getDeliveryProofReadUrl` (pinned by tests), so today they can technically grab the photo by hitting the callable from Firebase Console or a script. That works for solo-operator dispute lookup but doesn't scale to a second admin (Aman) and creates friction the first time a real dispute happens during pilot.

Right after PR-NEXT-9 I noted the gap should be tracked rather than left in the comments. Sudhir picked it as the next PR.

### Why this is genuinely small

The original PR-NEXT-6 prompt scoped §D.4 as "medium effort" assuming a new `AdminOrderDetailScreen` would have to be created (mirror of `ShopOrderDetailScreen`). On re-investigation, that assumption is wrong — `AdminOrdersScreen` already uses an inline-disclosure pattern (Manual override + Timeline are both per-card expandables with one-at-a-time semantics). The right shape for PR-NEXT-6.1 is **a third disclosure** that matches the existing two, plus a single inline line for the payment-method copy.

That collapses the effort to a one-file change with both reusable bits already shipped:
- `DeliveryProofViewer` — drop-in component
- `formatPaymentMethod` — pure helper, already tested

No new helpers, no new component, no new tests beyond manual acceptance.

---

## Plan

### §A — Inline "Paid via …" line on every admin card

Insert one `<Text>` line in the card body, between the existing `phone` line (line 313) and the `PaymentStatusBanner` (line 316). The new line shows the authoritative settlement-method copy from `formatPaymentMethod`. This is **additive** to the existing `PaymentStatusBanner` — the banner handles `amount_mismatch` / `refund_pending` / `refunded` / `refund_failed` alerting; the new line answers the simple "how was this order paid?" question that admins need on every card, not just the error cases.

Imports (add at top of file, with existing imports):

```ts
import { formatPaymentMethod } from '../../utils/formatPaymentMethod';
```

Render (insert after line 315, before line 316 `<PaymentStatusBanner …>`):

```tsx
{/* PR-NEXT-6.1 — explicit "Paid via …" line so admins see the
    authoritative settlement (cash / online up-front / COD converted
    online) on every card, not just the error-state alerts that
    PaymentStatusBanner handles. Same helper the shop/customer detail
    screens use, so all three audiences see consistent copy. */}
<Text style={styles.paidVia}>
  Paid via {formatPaymentMethod({
    paymentMethod: item.paymentMethod,
    paidMethod: item.paidMethod,
    paymentStatus: item.paymentStatus,
  })}
</Text>
```

Add a `paidVia` style entry to the existing `styles` block (mirror the visual treatment of the `phone` style at whatever line it lives — find by grep — same `typography.caption` + `colors.textSecondary` shape):

```ts
paidVia: {
  ...typography.caption,
  color: colors.textSecondary,
  marginTop: 2,
},
```

(Verify against the actual `phone` style by reading the styles block; the goal is visual consistency with the other meta lines, not exact reproduction of these values.)

### §B — Third disclosure: "Delivery proof"

Add state alongside the two existing disclosure-state hooks (near line 84):

```ts
// PR-NEXT-6.1 (closes PR-NEXT-6 §D.4) — delivery-proof disclosure.
// Same one-card-at-a-time semantics as overrideExpandedId +
// timelineExpandedId. The DeliveryProofViewer fetches its own
// signed-read URL on mount; if we collapse + re-expand we'll re-mint
// (acceptable — 15-min URL validity means most pilot-scale interactions
// land within a single mint). Only renders the trigger row when the
// order actually has a proof on it.
const [proofExpandedId, setProofExpandedId] = useState<string | null>(null);
```

Imports (add at top):

```ts
import DeliveryProofViewer from '../../components/order/DeliveryProofViewer';
```

Render — insert a new disclosure block AFTER the existing Timeline disclosure (after the `</View>` that closes the timeline block, somewhere around line 460+). Mirrors the override + timeline pattern verbatim:

```tsx
{/* PR-NEXT-6.1 — Delivery proof disclosure. Only show the trigger
    when the order actually has a proof stamped; partners can
    deliver without one (photo is optional in PR-NEXT-6 by design)
    and we don't want a dead disclosure row on those cards.
    Auth + signed-read URL handled inside DeliveryProofViewer. */}
{item.deliveryProofStoragePath && (
  <View style={styles.proofSection}>
    <Pressable
      onPress={() =>
        setProofExpandedId(
          proofExpandedId === item.id ? null : item.id,
        )
      }
      accessibilityRole="button"
      accessibilityLabel={
        proofExpandedId === item.id
          ? 'Hide delivery proof photo'
          : 'Show delivery proof photo'
      }
      style={styles.disclosureRow}
    >
      <Text style={styles.disclosureText}>
        {proofExpandedId === item.id ? '▾' : '▸'}{'  '}
        📸 Delivery proof
      </Text>
    </Pressable>
    {proofExpandedId === item.id && (
      <DeliveryProofViewer
        orderId={item.id}
        hasProof={!!item.deliveryProofStoragePath}
      />
    )}
  </View>
)}
```

Add a `proofSection` style entry mirroring `overrideSection` (find it in the styles block; same `marginTop` / padding shape):

```ts
proofSection: {
  // Mirror overrideSection — match the actual values in the existing
  // block, not a guess. Likely something like:
  // marginTop: spacing.sm,
  // borderTopWidth: 1,
  // borderTopColor: colors.border,
  // paddingTop: spacing.sm,
},
```

### §C — Optional polish: one-disclosure-at-a-time across all three

Today `overrideExpandedId` and `timelineExpandedId` are independent — you can open both on the same card. PR-NEXT-6.1 introduces a third disclosure. **Do NOT change the independence semantics** — keep `proofExpandedId` as its own state. Rationale:

- The override + timeline pattern was deliberate (they're complementary contexts: timeline says "what happened", override says "what should happen next").
- Forcing exclusivity across three disclosures would create a UX where the admin can't have the timeline open while reviewing the proof — exactly the cross-reference flow that dispute resolution needs.
- The one-card-at-a-time rule (opening a disclosure on a different card collapses the first card's same-disclosure) is preserved per-state.

No changes to the existing state. Just add the third.

---

## Discipline checklist

1. **Rule 1 — Imports stay.** `formatPaymentMethod` and `DeliveryProofViewer` imports must persist through edits. The file's auto-formatter has eaten imports before (PR 11's `findOriginalEta`, PR 12's helpers — see the inline comments).
2. **Rule 2 — Hooks above conditionals.** The new `useState` for `proofExpandedId` sits with the other `useState` calls (around lines 64–90), all of which are above the `if (loading) return …` and `if (!isAdmin) return …` early returns.
3. **No schema, no callable, no helper.** Reuses everything from PR-NEXT-6.
4. **No new tests.** The `formatPaymentMethod` matrix is already pinned in `tests/utils/formatPaymentMethod.test.ts`; the `DeliveryProofViewer` behavior is exercised by PR-NEXT-6 acceptance. The wiring here is single-screen plumbing; manual acceptance covers it.
5. **OTA classification.** Pure JS. No `app.json` change, no permission, no plugin. OTA-safe.

---

## Acceptance checklist

Need admin account + at least one order in each of these states:
- Online prepaid + delivered (no COD; proof may or may not exist)
- COD paid in cash + delivered + proof uploaded
- COD converted online via PR-NEXT-3 Part A + delivered (Razorpay-blocked today — skip if not available)
- Delivered without a proof photo

**Payment-method line:**

1. Sign in as admin. Open `AdminOrdersScreen`. Every card now shows a `Paid via …` line below the phone row, above `PaymentStatusBanner`.
2. Online prepaid order → `Paid via Online (paid up front)`.
3. COD paid in cash → `Paid via Cash on delivery — paid in cash`.
4. COD pending (not yet paid) → `Paid via Not yet paid`.
5. (If Razorpay is restored) COD converted via `payCodOrder` → `Paid via Cash on delivery — paid online (converted)`.

**Delivery proof disclosure:**

6. Order WITHOUT `deliveryProofStoragePath` (partner skipped the optional capture) → the `📸 Delivery proof` row is **not rendered at all**. Confirm: no empty/dead trigger on those cards.
7. Order WITH proof → row appears. Tap → expands → `DeliveryProofViewer` mounts → signed-read URL is fetched → thumbnail renders inline.
8. Tap thumbnail → full-screen modal (same as shop/customer surfaces from PR-NEXT-6). Tap anywhere to close.
9. Tap the disclosure trigger again → collapses. Re-expand → viewer re-mounts → fresh signed-read URL is minted (15-min validity → no UX issue).
10. Open the proof disclosure on card A. Open the timeline disclosure on the SAME card A → both expanded simultaneously (independent state — by design).
11. Open the proof disclosure on card A. Open the proof disclosure on card B → card A's proof disclosure collapses (one-card-at-a-time per disclosure type, mirrors existing override + timeline behavior).

**Regression checks:**

12. Existing Manual override disclosure still works (toggle open / close; one-card-at-a-time semantics intact).
13. Existing Timeline disclosure still works.
14. `PaymentStatusBanner` still renders for `amount_mismatch` / `refund_pending` / etc. — the new `Paid via …` line is ADDITIVE, not replacing.
15. `CancelAndRefundModal` flow unchanged — refund target still triggers from existing handlers.
16. `npx tsc --noEmit` clean.
17. `npm run test:unit` — suite still passes (no new tests added; no existing tests should break).

---

## Out of scope (explicit deferrals)

- **Dedicated `AdminOrderDetailScreen`** — current inline-disclosure pattern is the established admin UX; introducing a separate detail screen would diverge from it without clear benefit. Defer until admin needs (e.g. multi-tab investigation, side-by-side compare across orders) actually surface.
- **Admin override of the proof itself** — admin cannot replace, delete, or annotate the photo via UI. If a partner uploads a misleading photo, admin works around via Firebase Storage Console for pilot. Defer the in-app override until disputes prove the need.
- **Proof history / versioning** — current model is "one photo per order, re-upload overwrites." No audit log of which photo replaced which.
- **Bulk proof export** — for end-of-day reconciliation. Out of scope; admin can grab via Storage Console.
- **Filter / sort by "has proof"** — could be useful for dispute triage but adds query-shape complexity for pilot-scale benefit. Defer.

---

## Deploy plan

Pure client OTA. No Firebase deploy.

```
npx tsc --noEmit            # clean
npm run test:unit           # all green; no new tests so suite count unchanged
git commit -m "PR-NEXT-6.1: admin order-card payment line + delivery-proof disclosure"
eas update --branch production --message "PR-NEXT-6.1 admin order-card proof + payment line"
```

Pull on installed admin device (your phone + Aman's once distributed); run the 17-step acceptance checklist.

---

## Doc trail updates after ship

- `docs/TESTING-FINDINGS-2026-05-30.md` — the entry for finding **#16** notes `Sub-(c) photo capture + sub-(d) order-detail evidence view → PR-NEXT-6` for shop/customer + `→ PR-NEXT-6.1` (now shipped) for admin. Flip the admin portion to `✅ SHIPPED in PR-NEXT-6.1 (May 31 2026)`.
- `docs/SESSION_LOG.md` — append the standard one-paragraph entry covering the inline `Paid via …` line + the third `proofExpandedId` disclosure, no new helpers / no new tests, OTA-only.
- `CLAUDE.md` — add PR-NEXT-6.1 to the testing-findings cleanup wave list with a one-line note that admin surface is now closed.
- `PRELAUNCH_CHECKLIST.md` — short addendum under the existing PR-NEXT-6 block noting admin coverage closed.
