# HOTFIX-K1-CATALOG-FILTER-AND-CONTINUOUS-VOICE

**Cascade-on-Sonnet handoff prompt** · Author: Claude · Drafted: 2026-06-13 (Sat afternoon, CST)

Two follow-up changes on top of just-completed Bundle K.1. Both are
small. Both ship in the **same `eas update`** that delivers K.1 itself —
do not deploy K.1 alone; bundle these in.

---

## Why this exists

Sudhir's review of Devin's Bundle K.1 report flagged two pilot-UX
issues, both directly from his words:

1. **"Once an item is added from catalog, that items should not be
   visible to shopkeeper again as if they need to change anything for
   that time, they can change from their menu only. Catalog is only
   used to select items that they own and add prices that time."**

   → CategoryListScreen must **hide items already in the shop's menu**
   on every mount. Catalog = picker for new items. Menu = manage
   existing items. Separation of concerns; no state leakage between
   the two surfaces.

2. **"No need to tap multiple times, I want you to design in a way
   that it is easy for shopkeepers and less clicks."**

   → Voice mode must be **one tap per category, not one tap per
   utterance.** After each successful transcript, recorder auto-
   restarts so the shopkeeper can speak the next price without
   touching the screen. Stop only on (a) user says "stop"/"बंद"
   /"done", (b) user taps the stop button, or (c) safety timeout
   (no speech detected for 8 seconds while idle between captures).

---

## Read first

1. `CLAUDE.md` — current state shows Bundle K.1 complete + deferred §10
   pre-fill behavior.
2. `docs/pr-next-bundle-k1-catalog-table-view-windsurf-prompt.md` —
   the K.1 prompt this hotfix lives on top of.
3. `src/screens/shop/catalog/CategoryListScreen.tsx` — just-shipped K.1
   screen. §A patches mount behavior.
4. `src/components/catalog/VoicePriceCapture.tsx` — just-shipped K.1
   top-bar. §B patches its capture loop.
5. `src/components/VoiceInputButton.tsx` — PR 34 primitive. **§B
   adds a `continuous` mode without changing existing consumers'
   behavior.** RegisterShopScreen (the other VoiceInputButton consumer
   at lines 554 and 1043) must remain on the existing single-shot mode.
6. `src/utils/catalogBrowseHelpers.ts` — `classifyVoiceUtterance`
   already returns `'stop'` for stop-words; we just need to wire that
   to actually stop the loop instead of stopping a one-shot recording.

---

## Discipline checklist

- [ ] **Rule 5**: every new field added to VoiceInputButton's Props
      gets audited against every existing call site (grep
      `<VoiceInputButton`). Defaulting `continuous` to `false`
      preserves all current behavior — but the grep MUST appear in
      the completion report verifying RegisterShopScreen's two
      consumers see the same single-shot UX as before.
- [ ] **Rule 5 #14**: required completion-report verification block
      (see §F below).
- [ ] **Rule 5 #15**: silent-catch guard. Any new `.catch` must be
      explicit. Auto-restart loop errors MUST surface to the user
      (chip + Sentry).
- [ ] **Rule W**: complete the PR autonomously — apply the
      deliberate-break demo at the end.
- [ ] **Rule 13** (BottomSheet): not applicable; no bottom-sheet
      surfaces touched.
- [ ] **PROMPT_AUTHORING_NOTES Rule 8**: FEATURES.md update
      instructions in §G.

---

## §A — Hide items already in shop's menu

**File:** `src/screens/shop/catalog/CategoryListScreen.tsx`

Current behavior (post-K.1): on mount, the screen reads the master
catalog `products/` collection where `category == categoryId AND
status == 'approved'`, maps to `CategoryListItemRow[]`, renders the
table.

New behavior: on mount, additionally read the shop's
`shops/{shopId}/menu` collection, build a `Set<productId>` of all
masterCatalogIds the shop already has, and filter the catalog list
to exclude those.

Concretely:

1. New service-layer call in `src/services/shopService.ts` (or wherever
   shop menu reads live — confirm via grep `shops/.*menu` before
   adding):

   ```ts
   /**
    * HOTFIX-K1 §A — Returns the set of masterCatalogIds already
    * present in the shop's menu. Used by CategoryListScreen to
    * hide items the shop has already added (catalog is for new
    * items only; existing items are edited via ShopMenuScreen).
    *
    * Cached for the session via the existing menu store; if no
    * such store exists, this is a single Firestore read per
    * CategoryListScreen mount.
    */
   export async function listShopMenuMasterCatalogIds(
     shopId: string,
   ): Promise<Set<string>>;
   ```

   Implementation: query `shops/{shopId}/menu` where
   `masterCatalogId != null`, collect the IDs.

2. In `CategoryListScreen.tsx`'s mount effect, after fetching the
   master catalog list:

   ```ts
   const existingIds = await listShopMenuMasterCatalogIds(shopId);
   const visible = catalog.filter(item => !existingIds.has(item.productId));
   setRows(visible);
   ```

3. Empty-state copy: if `visible.length === 0` and `catalog.length > 0`,
   the table is empty because **everything in this category is already
   in the shop's menu**. Show empty-state text:

   ```
   ✓ You've already added every item in this category to your shop.

   To change prices on items you already have, go to your Menu.

   [Go to Menu]
   ```

   The "Go to Menu" button navigates to the existing
   `ShopMenuScreen` (route name confirmed via grep before adding).

4. Loading state: while fetching the shop menu, show the same loader
   the catalog list already uses — no new spinner.

5. **Pure helper to add to `catalogBrowseHelpers.ts`:**

   ```ts
   /**
    * HOTFIX-K1 §A — Filter master catalog rows by existing menu
    * presence. Pulled out as a pure helper so the filter logic
    * is unit-testable without React.
    */
   export function filterCatalogByExistingMenu(
     catalog: ReadonlyArray<CategoryListItemRow>,
     existingMasterCatalogIds: ReadonlySet<string>,
   ): CategoryListItemRow[] {
     return catalog.filter(row => !existingMasterCatalogIds.has(row.productId));
   }
   ```

6. **BuildCatalogScreen tile count update** (`src/screens/shop/catalog/BuildCatalogScreen.tsx`):
   currently each category tile shows total catalog items for that
   category. Update to show *remaining* items — i.e. `totalInCatalog
   - inShopMenu`. If the shop has 12 of 18 atta items already, the
   tile shows "6 to add". If they have all 18, tile shows "All added
   ✓". Pure helper `computeRemainingByCategory(catalog, existingIds)`
   added to `catalogBrowseHelpers.ts`.

**Audit-grep for Rule 5:** before completion, verify every consumer
of `CategoryListScreen` props handles the empty-visible case (just
the BuildCatalogScreen navigation entry today — easy).

---

## §B — Continuous voice mode

**Two files touched:** `src/components/VoiceInputButton.tsx` and
`src/components/catalog/VoicePriceCapture.tsx`.

### §B.1 — VoiceInputButton: add `continuous` prop

Add a new optional prop to VoiceInputButton:

```ts
type Props = {
  // ... existing props
  /**
   * HOTFIX-K1 §B — Continuous capture mode. When true, after each
   * onResult fires, the recorder auto-restarts a new recording
   * for the next utterance. Caller stops via `stopSignal` prop
   * change (set externally when classifyVoiceUtterance returns
   * 'stop' or when user taps the parent's stop button).
   *
   * Default false — preserves RegisterShopScreen's single-shot
   * behavior unchanged.
   *
   * Safety: even in continuous mode, the 30-second MAX_DURATION_SEC
   * cap still fires per utterance. The component also stops the
   * outer loop after 8 seconds of detected silence between captures
   * (idle timeout) so a forgotten mic doesn't drain battery.
   */
  continuous?: boolean;
  /** When `continuous`, parent toggles this true to stop the loop. */
  stopSignal?: boolean;
};
```

Implementation:

- After upload-and-transcribe completes successfully in continuous
  mode, immediately call the start-recording function again. Same
  microphone permission already granted; no re-prompt.
- `stopSignal` becoming `true` exits the loop (stop current recording,
  do not restart).
- Idle timeout: a `setTimeout(8000)` ref set after each successful
  onResult fires. If the next recording's onSpeechDetected (use the
  expo-audio `useAudioRecorderState().isMeteringAboveSilence` if
  available, otherwise a simple "no recording started yet after 8s
  of mic idle") doesn't fire in time, exit the loop. **This is the
  forgotten-mic safety net.**
- Errors during the auto-restart: catch them, surface to onError,
  exit the loop (don't blast retry-loop on a busted mic).
- Recording-permission revocation mid-loop: catch the
  `requestRecordingPermissionsAsync` re-check inside each restart,
  exit cleanly.

**Critical:** RegisterShopScreen consumers (lines 554 and 1043) MUST
keep identical behavior. The prop defaults to `continuous: false`;
do not change those call sites. The completion-report grep proves
this (§F).

### §B.2 — VoicePriceCapture: own the stop signal + classify in-loop

Edit `src/components/catalog/VoicePriceCapture.tsx`:

- Add internal state `stopSignal: boolean` initialized `false`.
- Pass `continuous={active}` and `stopSignal={stopSignal}` to the
  underlying `<VoiceInputButton>`.
- In `handleVoiceResult`, when `decideVoiceCapture` returns
  `'stop'`: set `stopSignal = true` (this stops the underlying
  recorder loop) AND `onActiveChange(false)` (the parent unstops UI).
- When user taps the stop button on the top-bar, same: set
  `stopSignal = true` + `onActiveChange(false)`.
- When `active` flips from true → false externally (e.g. screen
  unmount), reset `stopSignal` to false so the next session starts
  fresh.

User flow after this change (per Sudhir's intent):

```
1. Shopkeeper taps "🎙 Start voice" once at top of category.
2. Speaks "525" → captured to Row 1, focus auto-advances to Row 2.
3. Speaks "190" → captured to Row 2, focus auto-advances to Row 3.
4. Speaks "350" → captured to Row 3, focus auto-advances to Row 4.
   ... (no taps between utterances)
5. Says "स्किप" → skip current row, focus to Row 5.
6. Speaks "75" → captured to Row 5.
7. Says "stop" / "बंद" / "done" → recorder stops, top-bar shows
   "🎙 Start voice" again.

Total taps for a 50-item category: 1 (start) + 0 (between captures)
+ optional 1 (manual stop, if user didn't say stop-word) = 1–2.
```

vs the current K.1 behavior of N taps (one per item).

### Known trade-off — call it out

Between utterances there is a ~5–15s server round-trip (recording
→ upload → transcribe → response). Continuous mode auto-restarts
the recorder as soon as transcribe returns, so the shopkeeper sees:

- Speak "525"
- Brief pause (~5–15s) while server processes
- Floating chip shows "₹525 captured", focus moves to next row
- Mic ready again — speak "190"
- Brief pause...

This is the cost of not adding a streaming-STT dependency. For pilot,
the trade-off is "1 tap per category, slow between captures" vs
"50 taps per category, instant per capture." Per Sudhir's clear
priority on fewer taps, we pick the former.

If first-shop retest shows the gap is intolerable, follow-up adds
`@react-native-voice/voice` for true streaming. Out of scope for this
hotfix.

---

## §C — Pure helpers (unit-testable, no React)

`src/utils/catalogBrowseHelpers.ts` additions:

```ts
export function filterCatalogByExistingMenu(
  catalog: ReadonlyArray<CategoryListItemRow>,
  existingMasterCatalogIds: ReadonlySet<string>,
): CategoryListItemRow[];

export function computeRemainingByCategory(
  catalogByCategory: ReadonlyMap<string, ReadonlyArray<CategoryListItemRow>>,
  existingMasterCatalogIds: ReadonlySet<string>,
): Map<string, { total: number; remaining: number; allAdded: boolean }>;

/**
 * HOTFIX-K1 §B — Continuous-mode state machine summary. Pure
 * function that takes (currentDecision, currentStopSignal) and
 * returns the new stopSignal value. Lets us unit-test the
 * stop-word handling without mounting VoicePriceCapture.
 */
export function nextStopSignal(
  decision: VoiceCaptureDecision,
  currentStop: boolean,
): boolean;
```

---

## §D — Tests (forecast: +18 tests minimum)

`tests/utils/catalogBrowseHelpers.test.ts` extensions — **+10 tests**:

- `filterCatalogByExistingMenu` — empty set → all items returned
- `filterCatalogByExistingMenu` — set covers all → empty array
- `filterCatalogByExistingMenu` — partial overlap → correct subset
- `filterCatalogByExistingMenu` — set has IDs not in catalog → ignored
- `computeRemainingByCategory` — single category, partial overlap → correct counts
- `computeRemainingByCategory` — all 10 categories, mixed coverage
- `computeRemainingByCategory` — `allAdded: true` when remaining === 0
- `nextStopSignal` — decision='stop' → returns true
- `nextStopSignal` — decision='commit' → returns currentStop (unchanged)
- `nextStopSignal` — decision='skip'/'retry' → returns currentStop

`tests/components/CategoryListScreen.test.ts` extensions — **+4 tests**:

- Mounts with 18 catalog items + 12 in shop's menu → 6 rows rendered
- Mounts with all 18 in shop's menu → empty-state with "Go to Menu" CTA
- BuildCatalogScreen mount → tile shows "6 to add" for partial-coverage category
- BuildCatalogScreen mount → tile shows "All added ✓" for fully-covered category

`tests/components/VoiceInputButton.test.ts` (new or extend) — **+4 tests**:

- `continuous={false}` (default) → after one onResult, no auto-restart
- `continuous={true}` → after one onResult, recorder auto-starts again
- `continuous={true}` + `stopSignal` flips to `true` mid-loop → loop exits
- `continuous={true}` + 8s idle timeout → loop exits with onError code
  `'idle_timeout'`

Run targets:
- `npx jest tests/utils/catalogBrowseHelpers tests/components/CategoryListScreen tests/components/VoiceInputButton` → +18 pass
- Full `npx jest` → 1747 → ≥1765 (no regressions, both projects green)
- `tsc --noEmit` clean in both `src/` and `functions/`
- All 6 static guards pass

---

## §E — Deploy plan

**Pure client OTA. No server, no rules, no schema changes. Bundle
with the K.1 deploy:**

```powershell
eas update --branch production --message "Bundle K.1 + HOTFIX-K1 (filter already-added + continuous voice)"
```

No `firebase deploy` step needed.

---

## §F — Required completion-report verification block

```
=== HOTFIX-K1 verification ===

# §A — filter helper + service call
$ grep -n "export function filterCatalogByExistingMenu" src/utils/catalogBrowseHelpers.ts
<line>:export function filterCatalogByExistingMenu(

$ grep -n "export function computeRemainingByCategory" src/utils/catalogBrowseHelpers.ts
<line>:export function computeRemainingByCategory(

$ grep -n "listShopMenuMasterCatalogIds" src/services/shopService.ts
<line>:export async function listShopMenuMasterCatalogIds(

# §A — CategoryListScreen filters on mount
$ grep -n "listShopMenuMasterCatalogIds\|filterCatalogByExistingMenu" src/screens/shop/catalog/CategoryListScreen.tsx
<lines showing both used>

# §A — BuildCatalogScreen tile uses remaining count
$ grep -n "computeRemainingByCategory\|allAdded" src/screens/shop/catalog/BuildCatalogScreen.tsx
<lines>

# §B.1 — VoiceInputButton continuous prop
$ grep -n "continuous\?\: boolean\|stopSignal\?\: boolean" src/components/VoiceInputButton.tsx
<lines showing both prop declarations>

# §B.1 — Existing RegisterShopScreen consumers unchanged
$ grep -B1 -A6 "<VoiceInputButton" src/screens/roles/RegisterShopScreen.tsx
<output — verify neither call passes `continuous` or `stopSignal`, both
 remain on the default single-shot mode>

# §B.2 — VoicePriceCapture wires stopSignal + continuous
$ grep -n "stopSignal\|continuous=" src/components/catalog/VoicePriceCapture.tsx
<lines>

# Pure-helper test counts
$ grep -c "test(\|it(" tests/utils/catalogBrowseHelpers.test.ts
<should be ≥ 50 (40 baseline + 10 new)>

$ grep -c "test(\|it(" tests/components/CategoryListScreen.test.ts
<should be ≥ 16 (12 baseline + 4 new)>

# Voice button test file
$ ls -la tests/components/VoiceInputButton.test.ts
<file info>

$ grep -c "test(\|it(" tests/components/VoiceInputButton.test.ts
<should be ≥ 4>

# Full suite
$ npx jest 2>&1 | tail -5
<output showing PASS, suites count, total tests ≥ 1765>

# Type check
$ npx tsc --noEmit && echo "src clean"
src clean

# Static guards
$ npx jest tests/audits 2>&1 | tail -3
<all 6 static guards pass>
```

Without this block the PR is **not considered complete** (Rule 5 #14
+ HOTFIX-ATTENTION-CALLABLES-MISSING precedent).

---

## §G — Deliberate-break demo

Apply, run tests to confirm failure, restore. Three demos:

**Demo 1: filterCatalogByExistingMenu actually filters**
1. Temporarily change `filterCatalogByExistingMenu` to return
   `catalog` unfiltered (i.e. `return [...catalog]`).
2. Run `npx jest tests/utils/catalogBrowseHelpers.test.ts` —
   expect the "set covers all → empty array" test to FAIL.
3. Restore.
4. Re-run → PASS.

**Demo 2: VoiceInputButton continuous default false**
1. Temporarily change the default in VoiceInputButton from
   `continuous = false` to `continuous = true`.
2. Run `npx jest tests/components/VoiceInputButton.test.ts` — expect
   the "default → no auto-restart" test to FAIL.
3. Restore.
4. Re-run → PASS.

**Demo 3: stopSignal exits loop**
1. Temporarily remove the `stopSignal` check inside the auto-restart
   block.
2. Run the "stopSignal flips true → loop exits" test → expect FAIL.
3. Restore → re-run → PASS.

---

## §H — FEATURES.md updates (Rule 8)

`docs/FEATURES.md` §2.3 (shop catalog onboarding):

- Update existing K.1 entry: "Catalog browse now hides items already
  in the shop's menu. Catalog is purely a picker for new items;
  existing items are edited via the Menu screen. Category tiles show
  'X to add' / 'All added ✓' counts based on shop's current menu
  state."
- Update voice entry: "Voice price capture is single-tap-per-category.
  Tap once to start, speak prices for each row in turn (focus auto-
  advances after each capture), say 'stop' / 'बंद' / 'done' or tap
  stop to end. Safety auto-stop after 8 seconds of silence to prevent
  forgotten-mic battery drain."

§5.10 (static guards): no new guards.

§5.11 (test infrastructure): bump test count.

---

## §I — Out of scope

- **True streaming STT** (e.g. `@react-native-voice/voice`). The
  chunked auto-restart approach incurs a ~5–15s gap between utterances.
  If first-shop retest finds this intolerable, follow-up adds the dep
  in a separate PR. Out of scope today.
- **Hindi stop-word audit beyond the existing classifier.**
  `classifyVoiceUtterance` already handles English + Hindi stop-words
  per Bundle K.1. We rely on it; we do not extend it.
- **Customer-facing search of master catalog by status filter.** Out
  of scope — Bundle K shipped that.
- **Edit/remove items already in the shop's menu from this screen.**
  Per Sudhir: "they can change from their menu only." Catalog never
  edits existing items; it only adds new.

---

## Test count forecast

**+18 minimum.** Total at completion: 1747 → ≥1765.
`tsc --noEmit` clean. All 6 static guards pass.

---

## Estimated Devin quota burn

Small: ~3–5% of weekly quota. Two pure-helper additions, one Props
extension with default-false safety, one mount-effect change, one
state-machine bit in VoicePriceCapture. The K.1 baseline this lives
on top of is solid; the modifications are surgical.

---

End of prompt.
