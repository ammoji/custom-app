# PR-NEXT-BUNDLE-A — Pilot regressions (4 fixes, one OTA)

**Source:** Sudhir's 2026-06-09 e2e retest. Four findings bundled because each is independently small and they ship as one client OTA. Original e2e finding numbers in parens.

**Deploy class:** pure client OTA. No callable changes, no schema changes.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root and `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `npm run lint`, `npx eslint`
- `cd functions && npm run build` (compiles TS → lib/, does NOT deploy)
- File edits to files explicitly named in §A–§D below
- New file creation in directories explicitly named in the plan
- Re-running any of the above to verify after fixing an error

You MUST stop and ask before:

- Deploy commands: `firebase deploy …`, `eas update`, `eas build`, `gcloud run …`
- File deletes
- Force-push, rebase, branch ops
- Editing files NOT named in §A–§D
- Adding NEW dependencies not listed in the plan
- Schema additions / migrations not in the spec

Default posture: **execute, report at end.** Final summary should include: files changed, test count delta, tsc clean confirmation, any decisions made autonomously inside the green-light zone, any items deferred to a human decision.

## Schema audit-grep (Rule 5)

```
grep -rn "useLivePartnerEta\|enabled" src/hooks src/screens
grep -rn "displayDeliveryCharge" src
grep -rn "orderEtaDisplay\|readyByEstimate" src
grep -rn "KeyboardAvoidingView" src/screens
```

| Symbol | Location | Notes |
| --- | --- | --- |
| `useLivePartnerEta(orderId, enabled)` | `src/hooks/useLivePartnerEta.ts` | Current signature: 2 args. Bundle adds a 3rd for status gating. |
| `displayDeliveryCharge(shop, customerLocation)` | `src/utils/displayDeliveryCharge.ts` | Currently uses customer's live GPS. Bundle changes call sites to prefer customer's default saved address pin. |
| `orderEtaDisplay` | `src/utils/orderEtaDisplay.ts` (Finding #17) | Already suppresses ETA countdown on `ready_for_pickup`. Bundle extends to suppress the sub-message text too. |
| `readyByEstimate` | order doc field | The "Pickup ready in 15 minutes" line reads this. Bundle adds a render gate. |

## Plan

### §A — #2 Cart consistency (use default-address pin as canonical reference)

**Root cause:** `displayDeliveryCharge` on ShopCard/ShopDetail/CartScreen uses customer's **live GPS** distance. CheckoutScreen uses the customer's **selected delivery target** distance. When the customer is physically far from where they'll be delivered (e.g. saved Home address), the two surfaces disagree.

**Fix:** Change `displayDeliveryCharge`'s caller-side input to prefer customer's **default saved address pin**, falling back to live GPS only when no default exists. Now Cart + ShopDetail + Checkout all use the same reference point, so the numbers match.

**Files:**
- `src/utils/displayDeliveryCharge.ts` — extend signature to accept `customerReference` instead of just `customerLocation`. Helper picks the right pin internally. Update docblock to explain the "single canonical reference" design choice.
- `src/screens/CartScreen.tsx` line ~17–35 — change `customerLocation` selector to read `useProfileStore.profile?.defaultAddressPin` first, then fall back to `useLocationStore.location`.
- `src/components/shop/ShopCard.tsx` — same change at the call site (props pass-through).
- `src/screens/ShopDetailScreen.tsx` line ~287 — same change.

**Pure helper extraction:** `resolveCustomerDeliveryReference(profile, liveLocation)` in a new `src/utils/resolveCustomerDeliveryReference.ts`. Returns `{ lat, lng }` per priority order: profile.addresses.find(a => a.id === profile.defaultAddressId)?.pin → liveLocation → null. Pinned by **6 unit tests** (default present with coords, default present without coords, no default fall back to GPS, no default no GPS, profile loading, malformed pin).

### §B — #6 Status message confusion ("Out for delivery" + "Pickup ready in 15 minutes")

**Root cause:** Customer's OrderDetail header shows the status pill ("Out for delivery") AND the `readyByEstimate` sub-message ("Pickup ready in 15 minutes"). Once status is `ready_for_pickup` or beyond, the readyByEstimate is in the past and meaningless. Finding #17 suppressed the ETA countdown but not this sub-message.

**Fix:** Add a render gate to the sub-message. Hide the `readyByEstimate` line when `order.status` is `'ready_for_pickup'`, `'delivered'`, or `'cancelled'`. Show only during `'accepted'` and `'preparing'`.

**Files:**
- `src/screens/OrderDetailScreen.tsx` — find the `readyByEstimate` render (grep `Pickup ready`). Gate the JSX block on `(order.status === 'accepted' || order.status === 'preparing')`.
- Add inline comment referencing this PR + Finding #17's same-spirit suppression.

No test pin needed — presentational gate. Manual acceptance covers it.

### §C — #12a Polling stop on `delivered`/`cancelled`

**Root cause:** `useLivePartnerEta(orderId, enabled)` gates polling on `enabled` (sheet open/closed). When customer opens sheet after delivery, polling continues firing 30s requests against a finalized order, returning "Arriving now" because partner→drop distance is ~0.

**Fix:** Add `orderStatus` as a 3rd arg to the hook. Polling stops (and clears state to null) when status is `'delivered'` or `'cancelled'`. Sheet shows static "Delivered at HH:MM" or "Order cancelled" copy instead of live ETA.

**Files:**
- `src/hooks/useLivePartnerEta.ts` — extend signature; add status check inside useEffect; clear state on finalized status.
- `src/components/order/PartnerDetailsSheet.tsx` — accept `orderStatus`; render "Delivered" / "Cancelled" footer in those states instead of the live row.
- `src/screens/OrderDetailScreen.tsx` line ~145 — pass `order.status` to the hook call and to the sheet.

**Test pin (3 cases) in a new `tests/hooks/useLivePartnerEta.test.ts`:**
1. `enabled=true, status='ready_for_pickup'` → polls
2. `enabled=true, status='delivered'` → does NOT poll, state cleared
3. `enabled=true, status='cancelled'` → does NOT poll, state cleared

Use a fake timer (`jest.useFakeTimers()`) + mock `orderService.getLivePartnerEta` to verify no call after status flip.

### §D — #14 Keyboard covers feedback text field

**Root cause:** The rating-submit screen has a "comments" `TextInput` near the bottom. On Android, the soft keyboard covers the input. No `KeyboardAvoidingView` wraps the form.

**Fix:** Wrap the rating form in `KeyboardAvoidingView` with `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}` and `keyboardVerticalOffset` tuned for the screen's header height.

**Files:**
- Grep `OrderRating\|submitRating\|RatingScreen\|ratingScreen` to find the actual file name. Wrap its outer scroll/form in `KeyboardAvoidingView`.
- **Bonus audit (in-scope):** grep for `TextInput` across all customer-side screens. List any that aren't wrapped in `KeyboardAvoidingView` in the final summary. Do NOT auto-fix them (scope creep) — just report the list so we can decide whether to bundle a follow-up.

No test pin — presentational. Manual acceptance: open the rating screen on Android, tap the comments field, type — input stays visible.

## Discipline checklist

1. **Rule 1** — all new imports + state reads carry "PR-NEXT-BUNDLE-A — DO NOT REMOVE" comments.
2. **Rule 2** — `useLivePartnerEta`'s status check sits with other top-level hook logic (no conditional return before it).
3. **Rule 5** — schema audit-grep table in header. Field name `readyByEstimate`, status enum values, useProfileStore.profile.defaultAddressId all confirmed via grep.
4. **Rule 7** — `useLivePartnerEta.test.ts` fixtures use actual `order.status` enum values (`'ready_for_pickup'`, `'delivered'`, `'cancelled'`) not made-up strings.
5. **No schema, no callable, no server changes.**
6. **Test discipline:** +6 (`resolveCustomerDeliveryReference`) + 3 (`useLivePartnerEta` status gating) = **+9 tests minimum.** Suite trajectory roughly 1342 → ~1351.

## Acceptance checklist

**§A Cart consistency:**
1. Customer with default Home address (with GPS pin). Open ShopDetail → shows tier charge against Home distance. Cart → same. Checkout → same. All three numbers match.
2. Customer with NO default address. Open ShopDetail → uses live GPS (legacy behavior). Cart → same. Checkout uses delivery-target (may differ if customer picks current-location at checkout — by design, documented in helper).

**§B Status message:**
3. Order in `accepted` status. OrderDetail shows status pill + "Pickup ready in HH:MM".
4. Order in `ready_for_pickup`. Status pill shows "Out for delivery". "Pickup ready" sub-line HIDDEN.
5. Order in `delivered`. Status pill shows "Delivered". "Pickup ready" sub-line HIDDEN.

**§C Polling stop:**
6. Open partner sheet during `ready_for_pickup`. Polling fires every 30s (verify via console or React DevTools).
7. Order flips to `delivered`. Polling stops immediately. Sheet (if open) shows "Delivered" copy. Reopen sheet — does not poll.
8. Order cancelled mid-flow. Same as #7 — polling stops, "Cancelled" copy.

**§D Keyboard:**
9. Android: open rating screen, tap comments field, keyboard appears. Comments field stays visible above keyboard. Type — text remains visible.
10. iOS: same. Padding mode keeps field above keyboard.
11. Bonus audit: report any `TextInput`-bearing screens NOT wrapped in `KeyboardAvoidingView` in final summary.

**General:**
12. `npx tsc --noEmit` clean (root + functions, though no functions changes).
13. `npm run test:unit` clean. Suite +9 minimum.

## Out of scope

- **Auto-fixing other `KeyboardAvoidingView` gaps** found in §D's bonus audit. Reported only; bundle into a follow-up if list is long.
- **Migrating ShopList screen to use the new `resolveCustomerDeliveryReference`** — same-spirit improvement but ShopList already shows distance via a different code path (rankShopsByDistance). Separate PR.
- **Server-side `markDelivered` proof gate** — covered in Bundle B.

## Deploy

```
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "PR-NEXT-BUNDLE-A pilot regressions: #2 #6 #12a #14"
```

(Deploy command listed for reference but per Autonomous execution authorization, you must stop and ask before running it. Sudhir will deploy after reviewing the diff.)

## Doc trail (Cowork handles post-ship, per Rule W)

After ship, Claude in Cowork will:
- Append findings #2, #6, #12a, #14 to `docs/TESTING-FINDINGS-2026-05-30.md` with `✅ SHIPPED in PR-NEXT-BUNDLE-A`
- Update `CLAUDE.md` In-flight work
- Append `docs/SESSION_LOG.md` paragraph
