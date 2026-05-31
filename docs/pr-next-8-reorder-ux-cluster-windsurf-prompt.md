# PR-NEXT-8 — Reorder UX cluster: dismissable ✕ on unavailable rows + accurate "Order again" rail copy

**Source:** Findings #14 (unavailable-item ✕ is dead) and #15 ("Order again" card subtitle misleads) in `docs/TESTING-FINDINGS-2026-05-30.md`.

**Deploy class:** pure client OTA. No callable changes. No `app.json` change. No native module change. Ships via `eas update --branch production`.

**Read first**

1. `CLAUDE.md` (full)
2. `docs/TESTING-FINDINGS-2026-05-30.md` — findings #14 and #15
3. `.windsurf/code-discipline.md` (full — especially Rules 1, 2, 8, 10, 11)
4. `.windsurf/test-discipline.md`
5. `src/components/order/ReorderModal.tsx` (existing modal — Section §A patches lines 234–257)
6. `src/utils/buildReorderPlan.ts` — for the ReorderLine/ReorderPlan shape (no changes here; reference only)
7. `src/components/order/OrderAgainRail.tsx` (existing rail — Section §B patches line 78–80 subtext)
8. `src/utils/pickFrequentlyOrderedShops.ts` (pure helper — Section §B extends the FrequentShopEntry shape)
9. `tests/utils/pickFrequentlyOrderedShops.test.ts` (existing — Section §B extends pins)

---

## Why this PR exists

Two reorder-flow UX bugs surfaced during Android testing on May 30. Both are small but each breaks the user's mental model on first encounter.

### Finding #14 — ✕ glyph reads as a button, but does nothing

Smoking gun, `src/components/order/ReorderModal.tsx` line 255:

```tsx
<Text style={[styles.rowIcon, styles.rowIconMuted]}>✕</Text>
```

It's a static `<Text>` — not a `Pressable`, no `onPress` handler. The reorder modal's "Unavailable" section lists items that *cannot* be added to the cart (either `out_of_stock` or `removed_from_menu`); the ✕ was intended as a visual cue that "this row will be skipped." But every UI convention in the world reads "red ✕" as "tap to dismiss / remove from list." Customers tap, nothing happens, the modal feels broken.

The underlying behavior is already correct — `planToCartItems` in `buildReorderPlan.ts` already filters out anything that doesn't `status.startsWith('available_')`. The fix is purely about giving the ✕ a meaning that matches what users expect when they tap it.

**Decision: make ✕ a real Pressable that dismisses the row from view.** Local modal state only (no persistence across modal close/open — each reorder is a fresh decision). The "Available" section and the cart-add CTA are unaffected; only the "Unavailable" section visually shrinks as the customer acknowledges each missing item.

### Finding #15 — "{N} orders" suggests a list, tap reveals a bundle

`src/components/order/OrderAgainRail.tsx` line 78–80:

```tsx
<Text style={styles.subtext}>
  {entry.orderCount}{' '}
  {entry.orderCount === 1 ? 'order' : 'orders'}
</Text>
```

`entry.orderCount` is the LIFETIME count of delivered orders the customer has placed at that shop (computed in `pickFrequentlyOrderedShops.ts` line 87). The card subtext says "3 orders." Customer mental model: "I'll see my 3 past orders and pick which to repeat." But tap → `ReorderModal` opens, and it's showing the items from a SINGLE order (the most recent one, via `entry.lastOrderId`), with a CTA "Add 4 items to cart." The "3" → "4" mismatch and the missing list-of-orders are two layers of the same confusion.

**Decision: change the subtext to be action-predictive — "Last order · {M} items" — and drop the lifetime count from the card.** Lifetime frequency is still implicit in the rail ordering itself (most-frequent shop comes first; PR 14's sort is unchanged), so no information is lost. The CTA "Order again →" already telegraphs "tap = repeat last order."

This requires a new `lastOrderItemCount` field on `FrequentShopEntry`, populated from `mostRecent.items.length` inside the pure helper.

---

## Plan

Two independent parts. Either can land alone, but they ship together (both small, both pure-client OTA, both reorder-flow).

### Part A — Dismissable ✕ on unavailable rows (Finding #14)

Files touched:

- `src/components/order/ReorderModal.tsx` (modify) — §A.1
- `tests/components/order/ReorderModal.test.tsx` (modify or create) — §A.2

#### §A.1 — Wire the ✕ to a real dismissal

In `ReorderModal.tsx`:

1. Add modal-local state at the top of the component:

   ```tsx
   const [dismissedIds, setDismissedIds] = React.useState<Set<string>>(
     () => new Set(),
   );
   ```

   **Hooks discipline (Rule 2):** This `useState` goes ABOVE any conditional render. The current `ReorderModal` has no early returns inside the component body (only the JSX `loading ? ... : plan ? ... : ...` ternary), so this is straightforward — put the hook right after the function-body opening brace.

2. Reset the dismissed set whenever the modal opens with a new plan (different reorder = fresh slate):

   ```tsx
   const planKey = plan
     ? `${plan.shopId}:${plan.lines.map(l => l.menuItemId).join(',')}`
     : null;

   React.useEffect(() => {
     setDismissedIds(new Set());
   }, [planKey]);
   ```

   We key on a stable string built from shopId + line IDs, not on the `plan` reference itself, because the parent (`HomeScreen` / `OrdersScreen`) may re-create the same plan object across renders. Keying on identity-stable contents avoids spurious resets when the modal re-renders for any other reason.

3. Derive the visible unavailable lines:

   ```tsx
   const allUnavailableLines = plan
     ? plan.lines.filter(l => !l.status.startsWith('available_'))
     : [];
   const visibleUnavailableLines = allUnavailableLines.filter(
     l => !dismissedIds.has(l.menuItemId),
   );
   const visibleUnavailableCount = visibleUnavailableLines.length;
   ```

4. Update the existing "Unavailable" section render (currently lines 117–128) to:
   - Use `visibleUnavailableCount` for the section title (so "Unavailable (3)" → "(2)" → "(1)" → section hides when 0)
   - Use `visibleUnavailableLines` as the map source
   - Pass an `onDismiss` callback into `UnavailableRow`

   ```tsx
   {visibleUnavailableCount > 0 && (
     <Section
       title={`Unavailable (${visibleUnavailableCount})`}
       muted
     >
       {visibleUnavailableLines.map(l => (
         <UnavailableRow
           key={l.menuItemId}
           line={l}
           onDismiss={() =>
             setDismissedIds(prev => {
               const next = new Set(prev);
               next.add(l.menuItemId);
               return next;
             })
           }
         />
       ))}
     </Section>
   )}
   ```

5. Update `UnavailableRow` signature + the ✕ render (current lines 234–257). The ✕ becomes a `Pressable` with hit-slop and a11y:

   ```tsx
   function UnavailableRow({
     line,
     onDismiss,
   }: {
     line: ReorderLine;
     onDismiss: () => void;
   }) {
     const name = line.currentMenuItem?.name ?? line.pastName;
     const pack = line.currentMenuItem?.packLabel ?? line.pastPackLabel;
     const image = line.currentMenuItem?.imageUrl ?? line.pastImageUrl;
     return (
       <View style={[styles.row, styles.rowMuted]}>
         <Image source={{ uri: image }} style={[styles.thumb, styles.thumbMuted]} />
         <View style={styles.rowBody}>
           <Text style={[styles.rowName, styles.rowNameMuted]} numberOfLines={1}>
             {name}
           </Text>
           <Text style={styles.rowMeta} numberOfLines={1}>
             {pack} · Qty {line.oldQuantity}
           </Text>
           <Text style={styles.unavailableReason}>
             {line.reason ?? 'Unavailable'}
           </Text>
         </View>
         <Pressable
           onPress={onDismiss}
           hitSlop={12}
           accessibilityRole="button"
           accessibilityLabel={`Dismiss ${name}`}
           style={({ pressed }) => [
             styles.dismissBtn,
             pressed && { opacity: 0.6 },
           ]}
         >
           <Text style={[styles.rowIcon, styles.rowIconMuted]}>✕</Text>
         </Pressable>
       </View>
     );
   }
   ```

   Add a `dismissBtn` style — small padded touch target:

   ```ts
   dismissBtn: {
     padding: spacing.xs,
     marginLeft: spacing.sm,
   },
   ```

   (And drop the now-redundant `marginLeft: spacing.sm` from the existing `rowIcon` style if it'd double up — verify against the actual style block; the goal is the same visual spacing the row has today.)

6. **Behavior preserved:**
   - `availableCount` and `planToCartItems` are unchanged — the CTA still says "Add N items to cart" with N = available items, and dismissing unavailable rows does NOT change N.
   - `unavailableCount` on the underlying `plan` object is left alone (it's a derived count on the immutable plan; the visible count is a presentation-only thing).
   - The whole "Unavailable" section disappears when all unavailable rows are dismissed (cleaner UX than an empty header).

7. **What we deliberately don't do:**
   - We do NOT add a "Show dismissed" toggle or any undo affordance. If a customer wants the row back, closing and reopening the modal restores everything (the `planKey` effect resets the set). This matches the principle of "modal state lives only as long as the modal is open."
   - We do NOT animate the row removal. RN's `LayoutAnimation` is finicky on Android and the rows are small; instant removal is fine for a quick-fix PR.

#### §A.2 — Tests for the dismissal

If `tests/components/order/ReorderModal.test.tsx` doesn't already exist, create it. Render the modal with a plan that has 2 available + 2 unavailable lines and pin:

1. Both unavailable rows visible initially; section title shows `Unavailable (2)`.
2. Tap the dismiss button on one unavailable row → section title now shows `Unavailable (1)`; only the other unavailable row is rendered.
3. Tap the second dismiss → entire "Unavailable" section is removed from the DOM (no title at all).
4. Throughout the dismissal sequence, the CTA copy stays `Add 2 items to cart` and `onConfirm` is NOT called.
5. Re-render the modal with a fresh `plan` reference (simulating closing + reopening for a different shop) → both unavailable rows are visible again (the dismissal state reset).

Use `@testing-library/react-native`. The existing test patterns in `tests/components/order/` (look for any sibling) should be the style guide.

If no existing component test setup exists in `tests/components/order/`, only ship the helper pin via a smaller test that exercises just the dismissal-set behavior (pull the set update into a tiny pure helper if needed to make it testable without rendering). Prefer the component test if the harness already exists in the repo.

---

### Part B — Action-predictive subtext on the "Order again" rail (Finding #15)

Files touched:

- `src/utils/pickFrequentlyOrderedShops.ts` (modify) — §B.1
- `tests/utils/pickFrequentlyOrderedShops.test.ts` (modify) — §B.2
- `src/components/order/OrderAgainRail.tsx` (modify) — §B.3

#### §B.1 — Add `lastOrderItemCount` to FrequentShopEntry

In `pickFrequentlyOrderedShops.ts`:

1. Extend `FrequentShopEntry`:

   ```ts
   export type FrequentShopEntry = {
     shopId: string;
     shopName: string;
     lastOrderId: string;
     orderCount: number;
     mostRecentDeliveredAt: number;
     // NEW: item count of the most recent delivered order — the order
     // that the reorder modal will actually surface when this card is
     // tapped. Used by OrderAgainRail to keep the card subtext
     // action-predictive ("Last order · 4 items") rather than carrying
     // the lifetime frequency count ("3 orders"), which the modal
     // does not honor.
     lastOrderItemCount: number;
     // ... (existing rating fields unchanged)
     ratingAvg?: number;
     ratingCount?: number;
   };
   ```

2. Populate it inside the existing loop (around current line 83–92):

   ```ts
   entries.push({
     shopId: group.shopId,
     shopName: group.shopName,
     lastOrderId: mostRecent.id,
     orderCount: group.orders.length,
     mostRecentDeliveredAt:
       typeof mostRecent.deliveredAt === 'number'
         ? mostRecent.deliveredAt
         : mostRecent.createdAt,
     lastOrderItemCount: Array.isArray(mostRecent.items)
       ? mostRecent.items.length
       : 0,
   });
   ```

   The `Array.isArray` guard handles the (extremely unlikely) malformed order doc without crashing the rail — defensive consistent with how the rest of the file treats missing fields.

3. **Schema is additive (code-discipline Rule 4 — schema-additive only).** No callable change, no Firestore document change. The field is computed client-side from existing order data already read by `listMine`.

#### §B.2 — Update the pure-helper tests

In `tests/utils/pickFrequentlyOrderedShops.test.ts`:

1. Every existing test that builds an `Order` fixture should already set `items: CartItem[]`. Confirm and adjust any tests whose expected output asserts on `FrequentShopEntry` to include the new `lastOrderItemCount` field.
2. Add at least two new pins:
   - **Most-recent-order item count is what populates the field** — give a shop two orders, one with 3 items (older) and one with 5 items (newer). Assert `lastOrderItemCount === 5`.
   - **Missing/non-array items field doesn't crash** — feed an order with `items: undefined as any`. Assert `lastOrderItemCount === 0`.

#### §B.3 — Update the rail subtext copy

In `OrderAgainRail.tsx`, replace the current subtext block (lines 77–80):

```tsx
<Text style={styles.subtext}>
  {entry.orderCount}{' '}
  {entry.orderCount === 1 ? 'order' : 'orders'}
</Text>
```

with:

```tsx
<Text style={styles.subtext} numberOfLines={1}>
  Last order ·{' '}
  {entry.lastOrderItemCount}{' '}
  {entry.lastOrderItemCount === 1 ? 'item' : 'items'}
</Text>
```

(Add `numberOfLines={1}` so a fixed-card-width truncation is graceful on very small phones.)

Edge case: when `lastOrderItemCount === 0` (malformed order — should never happen for a delivered order, but defensive), the copy renders `"Last order · 0 items"`, which is honest and won't crash. The card itself still routes through `buildReorderPlan` on tap; an empty plan surfaces the existing `availableCount === 0 → CTA "No items available"` state in the modal. Acceptable.

Update the existing `OrderAgainRail` component test (if any exists in `tests/components/order/`) to assert on the new copy. If no such test exists, add a minimal one that mounts the rail with one `FrequentShopEntry`-shaped entry and asserts the rendered text contains `"Last order ·"`.

---

## Discipline checklist (must be ticked off before declaring done)

1. **Rule 1 — Imports stay.** No symbol that another part of the PR touches gets auto-stripped between edits. Particularly: keep `Pressable` imported in `ReorderModal.tsx` after the §A patches.
2. **Rule 2 — Hooks above conditionals.** New `useState` + `useEffect` in `ReorderModal` sit above any JSX ternary that could conditionally render different trees. The existing `ReorderModal` has no `if`-returns inside the component body, but follow the rule defensively.
3. **Rule 4 — Schema additive only.** `FrequentShopEntry.lastOrderItemCount` is a new field on a client-only derived type. No Firestore schema, no callable contract changes.
4. **Rule 10 — Reads before writes (transactional).** N/A — no Firestore transactions touched.
5. **Rule 11 — Identity-aware gating.** N/A — no auth-gated callbacks touched.
6. **Test discipline — every PR adds tests.** §A.2 + §B.2 above. Aim: suite count goes up.
7. **Deploy discipline — server-first.** N/A — pure client; no callable contract change. OTA-only.
8. **OTA vs `eas build`.** Pure JS; no `expo-*` plugin, no `app.json`, no permission, no runtime version change → OTA-only. Document in the deploy plan that no native rebuild is needed.

---

## Acceptance checklist

Run all of these on iOS first, then Android (Android has fewer pixels per row — verify the new touch target is still tappable comfortably).

**Part A — ✕ dismissal:**

1. Place a test order at a shop. From shop-owner side, mark 2 items unavailable (or use `bulkUpdateMenuAvailability` fixed in PR-NEXT-4). Wait for an order to appear in the customer's frequent-shops rail (or use Orders screen reorder if the rail isn't populated yet).
2. Open the reorder modal. Confirm the Unavailable section shows N items with ✕ glyphs.
3. Tap the ✕ on one unavailable row. Row disappears. Section title decrements (e.g. "Unavailable (2)" → "Unavailable (1)").
4. Tap the ✕ on the last remaining unavailable row. Section header disappears entirely.
5. CTA text throughout step 3–4 stays `Add N items to cart` where N = number of available items (unchanged). Confirm by reading the CTA before and after each tap.
6. Close the modal (tap Cancel or tap outside). Open again from the same rail card. All unavailable rows are visible again (state reset on reopen).
7. Confirm + verify cart contents on the Cart screen — only the available items present, dismissal had no effect on the cart.

**Part B — rail subtext:**

8. On Home, scroll to the "Order again" rail. Each card now reads `Last order · {M} items` (where M matches the item count of the most recent order from that shop), not `{N} orders`.
9. Tap a card. The modal shows exactly `{M}` rows in the available + unavailable sections combined (matching the card's M).
10. Verify the rail still sorts by lifetime frequency (most-frequently-ordered-from shop first) — that signal moved from copy to position, but it's still there.

**Regression checks:**

11. Reorder modal still renders empty-menu, all-unavailable, and price-drift cases correctly (no change to `buildReorderPlan` / `planToCartItems`).
12. `OrderAgainRail` still hides itself entirely when there are no frequent shops.
13. `npm run test:unit` — all tests pass; suite count increased by at least §A.2 + §B.2 additions.
14. `npx tsc --noEmit` — clean.

---

## Out of scope for this PR (explicit deferrals)

- **Showing a list of past orders to pick from on tap.** Finding #15 had a second fix option — make the card destination an actual orders list. That's a bigger UX change (new screen or new modal layout), and once Part B is shipped the copy honestly describes what happens. If pilot feedback insists on a real list, file as PR-NEXT-N+ later. For now, action-predictive copy is the proportionate fix.
- **Undo for dismissed unavailable rows.** Close-and-reopen restores; no need for an undo affordance in v1.
- **Animating row removal** on dismissal. Instant is fine for a quick-fix PR; can polish later if customers report jankiness.
- **In-shop search** (Finding #6 / PR-NEXT-9) — separate, larger PR.

---

## Deploy plan

This is a pure client OTA. No Firebase deploy needed.

1. `npx tsc --noEmit` clean
2. `npm run test:unit` — all tests pass; record new suite count in commit message
3. Commit on `main` with message `PR-NEXT-8: reorder UX cluster (dismissable ✕ + rail copy)`
4. `eas update --branch production --message "PR-NEXT-8 reorder UX cluster"`
5. Pull on installed device; run the 14-step acceptance checklist above.

No Firebase secrets, no IAM steps, no `eas build`. If a smoke step fails, hotfix on top via the same OTA channel; do not rebuild natively.

---

## Doc trail updates after ship

- `docs/TESTING-FINDINGS-2026-05-30.md` — flip findings #14 and #15 to `✅ SHIPPED in PR-NEXT-8 (May 31 2026)` with a one-paragraph summary each.
- `docs/SESSION_LOG.md` — append the standard one-paragraph entry covering both parts, the suite-count delta, and the OTA-only deploy classification.
- `CLAUDE.md` — bump the "Current state" date and add PR-NEXT-8 to the rolled-up list of shipped PRs in this testing-findings cleanup wave.
- `PRELAUNCH_CHECKLIST.md` — add a short section under the existing "Testing findings cleanup wave" entry (or wherever PR-NEXT-1…5 are catalogued) noting #14 + #15 closed.
