# PR-NEXT-13d — Delivery proof photo CTA available on delivered orders too

**Source:** Finding #13 follow-up from Sudhir's HOTFIX-1 smoke testing: *"I think upload proof option is gone once it is delivered. I think we need that option available so by mistake if partner missed to capture before hitting button, still he has option to upload the photo."*

**Design decision locked:** **Window is forever, while partner is assigned.** Partner can upload any time after `pickedUpAt`, no upper time bound. Server gate stays `deliveryPersonId === auth.uid` + `pickedUpAt != null` (HOTFIX-1 normalization). Easy to tighten later if pilot disputes show late-upload abuse; for now, trust the partner.

**Deploy class:** pure client OTA. No callable change, no server change, no rules. Ships via `eas update --branch production`.

**Read first**

1. `CLAUDE.md` (full)
2. `docs/TESTING-FINDINGS-2026-05-30.md` — finding #13 entry + HOTFIX-1's sub-note
3. `docs/pr-next-6-delivery-proof-photo-windsurf-prompt.md` — parent PR; explains why photo is optional
4. `docs/pr-next-hotfix-1-photo-upload-timestamp-windsurf-prompt.md` — the Timestamp fix that just landed
5. `.windsurf/code-discipline.md` (Rules 1, 2)
6. `src/screens/delivery/DeliveryDashboardScreen.tsx`:
   - Lines 412–419 — `deliveredMine` useMemo (the delivered-orders slice that feeds Delivery History)
   - Lines 1200–1230 — `DeliveryHistoryCard` (read-only history card — insertion point for the photo CTA)
   - Lines 1232+ — `ActiveDeliveryCard` (template for the photo CTA block)
   - Wherever `handleAddDeliveryProof` is defined (search "handleAddDeliveryProof") — same handler, no new logic needed
7. `functions/src/deliveryProofHelpers.ts` — confirm there is NO `deliveredAt` gate on `validateDeliveryProofUploadAuth` (server already permits post-delivered upload as long as `pickedUpAt != null`)

---

## Why the server is already correct

`validateDeliveryProofUploadAuth` in `deliveryProofHelpers.ts` (post-HOTFIX-1) gates on:

1. Auth: `delivery` claim required
2. Assignment: `order.deliveryPersonId === auth.uid`
3. Pickup precondition: `pickedUpAt` is a valid timestamp (number or Timestamp-like, after HOTFIX-1's widening)

**No `deliveredAt` gate.** A delivered order whose `deliveryPersonId` matches the caller AND whose `pickedUpAt` is set will pass every check. Sudhir's testing reported the issue as the CLIENT hiding the button — the server is fine.

This means #13d is **pure client-side surface work**: re-expose the photo CTA on the post-delivery card.

---

## Plan

### §A — Add photo CTA + state pass-through to `DeliveryHistoryCard`

In `src/screens/delivery/DeliveryDashboardScreen.tsx`:

**A.1 — Extend the existing `DeliveryHistoryCard` signature** to accept the same photo-related props that `ActiveDeliveryCard` already takes:

```tsx
function DeliveryHistoryCard({
  order,
  onPress,
  // PR-NEXT-13d — same photo-upload props as ActiveDeliveryCard. The
  // server validator (post-HOTFIX-1) has no `deliveredAt` gate, so a
  // partner can upload a missed proof photo any time while still
  // assigned. Window is intentionally unbounded; revisit if pilot
  // disputes show late-upload abuse.
  onAddPhoto,
  uploadingPhoto,
  hasProof,
}: {
  order: Order;
  onPress: () => void;
  onAddPhoto: () => void;
  uploadingPhoto: boolean;
  hasProof: boolean;
}) {
  const when = formatRelativeDeliveryTime(order.deliveredAt ?? 0);
  return (
    <Pressable
      onPress={onPress}
      ...
    >
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.shopName} numberOfLines={1}>
            {order.shopName}
          </Text>
          <Text style={styles.subStatus}>✅ Delivered · {when}</Text>
        </View>
        <Text style={styles.cardChevron}>›</Text>
      </View>
      <Text style={styles.address} numberOfLines={1}>
        {order.deliveryAddress.line1} · {order.deliveryAddress.pincode}
      </Text>
      <Text style={styles.meta}>{formatRupees(order.total)}</Text>

      {/* PR-NEXT-13d — photo CTA stays available post-delivery so
          the partner can correct a missed capture. Mirrors the
          ActiveDeliveryCard pattern at lower visual weight (history
          cards are summary-tier; the button doesn't dominate). The
          `e.stopPropagation()` on the inner Pressable prevents the
          tap from bubbling to the parent card's onPress (which
          navigates to detail). */}
      <View style={{ marginTop: spacing.sm }}>
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            onAddPhoto();
          }}
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
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : (
            <Text style={styles.photoBtnText}>
              {hasProof
                ? '📸 Photo added — re-take?'
                : '📸 Add delivery proof (optional)'}
            </Text>
          )}
        </Pressable>
      </View>
    </Pressable>
  );
}
```

**Why `e.stopPropagation()`:** the card itself is a `Pressable` with `onPress` that navigates to the order detail. Tapping the photo button should NOT also fire the navigation. Inner Pressable's `stopPropagation` keeps the two actions independent.

**A.2 — Update the render call site** (around line 902) to pass through the photo state, mirroring how `ActiveDeliveryCard` is wired (search for the existing `<ActiveDeliveryCard ... onAddPhoto={...}` in the file and match the prop pass-through):

```tsx
{deliveredMine.map(o => (
  <DeliveryHistoryCard
    key={o.id}
    order={o}
    onPress={() => nav.navigate('DeliveryOrderDetail', { orderId: o.id })}
    onAddPhoto={() => handleAddDeliveryProof(o)}
    uploadingPhoto={photoUploading === o.id}
    hasProof={
      !!o.deliveryProofStoragePath || !!recentlyUploadedProof[o.id]
    }
  />
))}
```

(Verify the exact navigate target and the existing prop shape against the live `ActiveDeliveryCard` wiring; mirror that wiring identically — the goal is "same handler, same state, just a different render surface.")

The handler `handleAddDeliveryProof`, the parent state `photoUploading` and `recentlyUploadedProof`, and the optimistic-success haptic are all already in scope from PR-NEXT-6 — no new logic. Pure prop-wiring.

### §B — No server change

Confirmed in §A.1 comment. `validateDeliveryProofUploadAuth` already permits this. Do NOT add a `deliveredAt` gate (would tighten when we want to loosen) and do NOT remove the `pickedUpAt` gate (still meaningful — uploading before pickup is logically nonsensical).

### §C — No new tests

The photo-upload happy-path is already pinned by PR-NEXT-6's `tests/utils/uploadDeliveryProof.test.ts` (5 cases) and `tests/functions/deliveryProofHelpers.test.ts` (~25 cases post-HOTFIX-1). The render surface change is presentation-only; manual acceptance covers it.

---

## Discipline checklist

1. **Rule 1 — Imports stay.** `Pressable`, `ActivityIndicator`, `Text`, `View` are already imported in DeliveryDashboardScreen. No new imports.
2. **Rule 2 — Hooks above conditionals.** No new hooks; this is pure prop threading from existing parent state.
3. **No schema, no callable, no helper change.**
4. **No new tests.** PR-NEXT-6's existing test surface covers the contract; this is a presentation reuse.
5. **OTA classification.** Pure JS. No `app.json` change, no permission, no plugin. OTA-safe.

---

## Acceptance checklist

Need two test accounts: partner + customer (any shop with at least one item).

**Happy path — photo before delivered (regression):**

1. Place a test order. Walk through to ready_for_pickup. Partner picks up → uploads photo via the existing ActiveDeliveryCard CTA → marks Delivered.
2. Order disappears from active list, appears in Delivery History (collapsed by default — tap to expand).
3. Expand history. The card for that order shows `📸 Photo added — re-take?` (because `hasProof` is true via `deliveryProofStoragePath` from PR-NEXT-6).

**Primary fix — photo AFTER delivered (the new path):**

4. Place another test order. Walk through to ready_for_pickup. Partner picks up but **skips** the photo CTA. Marks Delivered.
5. Order disappears from active list, appears in Delivery History.
6. Expand history. The card now shows `📸 Add delivery proof (optional)`. Tap → camera opens → take photo → upload spinner → success haptic → card flips to `📸 Photo added — re-take?`.
7. Verify on customer + shop owner + admin order-detail screens: the proof photo appears (`DeliveryProofViewer` is wired on all three surfaces — PR-NEXT-6 + PR-NEXT-6.1).

**Re-take after delivered:**

8. From step 7's state (photo uploaded post-delivery), tap "Re-take?" → camera → new photo → upload. Storage path stays `delivery-proofs/{orderId}.jpg`; second photo overwrites. Customer/shop/admin viewer fetches a fresh signed-read URL on next render and shows the new image.

**Tap-target isolation:**

9. Verify that tapping the photo button on a history card does NOT also navigate to the detail screen (the `e.stopPropagation()` should isolate the tap). Tap the card OUTSIDE the photo button area → navigates to DeliveryOrderDetailScreen as before.

**Regression sweep:**

10. ActiveDeliveryCard's photo CTA still works (PR-NEXT-6 path unchanged).
11. Server gate still rejects: a partner who is NOT the assigned `deliveryPersonId` cannot upload (test by manually flipping the test order's `deliveryPersonId` in Firestore Console and re-trying — should fail with `permission-denied`).
12. `npx tsc --noEmit` clean
13. `npm run test:unit` clean (no new tests; existing should pass)

---

## Out of scope (explicit deferrals)

- **Time-windowed upload window** (e.g. expires 1h after delivered, or next-day-midnight). Decided in design: unbounded for v1. Add a window later if abuse surfaces.
- **Multi-photo / gallery picker.** Single photo per order, re-upload overwrites. v1 contract from PR-NEXT-6 is preserved.
- **Photo annotation / arrow markup.** Out of scope.
- **Photo upload affordance on a separate "Past deliveries" full screen.** Could move history out of the dashboard into its own route later, but inline-in-dashboard is sufficient for pilot scale.

---

## Deploy plan

Pure client OTA:

```
npx tsc --noEmit            # clean
npm run test:unit           # all green
git commit -m "PR-NEXT-13d: photo CTA on delivered history cards"
eas update --branch production --message "PR-NEXT-13d photo CTA on delivered"
```

Pull on installed partner device → run steps 1–8 of the acceptance checklist.

---

## Doc trail updates after ship

- `docs/TESTING-FINDINGS-2026-05-30.md` — under finding #13, flip the sub-(d) hint to `✅ SHIPPED in PR-NEXT-13d (June 1 2026)` with a one-paragraph note: photo CTA now appears on `DeliveryHistoryCard` too, server validator unchanged (no `deliveredAt` gate ever existed), window intentionally unbounded.
- `docs/SESSION_LOG.md` — one-paragraph entry covering the diagnosis (pure client visibility miss, server was already correct), the prop-threading fix, the `e.stopPropagation()` tap-isolation note.
- `CLAUDE.md` — bump date; brief note that the delivery-proof window is unbounded by design.
- `PRELAUNCH_CHECKLIST.md` — short addendum under PR-NEXT-6 block.
