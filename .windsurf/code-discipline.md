# Code editing discipline for Windsurf

This document is referenced by every Windsurf prompt under `docs/`.
Read it once; the rules apply to every PR.

## Why this doc exists

Across PRs 1, 2, 4, 5, 6, 6.1, 7, and 8 — every single PR — Windsurf
has stripped imports between its own multi-edit passes. The pattern
is always the same: the agent removes one call site of a helper as
part of a refactor, the import becomes momentarily unused before the
next edit chunk re-adds the call site, and the agent's TypeScript
LSP fires `source.removeUnusedImports` to "clean up" the now-orphan
import. The next chunk then fails to compile, the agent re-adds the
import, and we ship — but in PR 6 the strip persisted into the
final commit and shipped a regression to TestFlight (image picker UI
replaced by the old URL text input).

This is a real maintenance hazard. These rules exist to make it
impossible to repeat.

## Rule 1 — Never strip imports between edits in the same PR

If a function, type, or value is imported at the top of a file and
later referenced in code that this PR is editing, **the import stays
until the PR is complete.** Even if a momentary intermediate state
makes the import look unused, do not remove it. The next edit chunk
almost always re-introduces the usage; removing and re-adding burns
tokens and risks shipping the strip.

If the import is **genuinely** dead at the end of the PR (no
reference anywhere in the final file), it can be removed in a
separate, explicit "cleanup" pass at the end — never as a side
effect of an unrelated edit.

## Rule 2 — Defensive imports are sacred

When a PR adds an import that the agent's own tooling has stripped
before, mark it explicitly:

```ts
// PR N — DO NOT REMOVE. Auto-formatter stripped this once during
// PR M development. Used by <callable/function name> below. If
// tsc complains "Cannot find name 'X'", re-add this line.
import { X } from './someHelpers';
```

The marker comment is not decorative. It is read by
`scripts/audit-integrity.js` as part of `npm run audit`, which fails
the build if the marker exists without a following import statement
within the next 10 lines.

**Never delete a DO-NOT-REMOVE marker without also removing the
import it protects.** And never remove a protected import without
also removing the marker. They travel together.

## Rule 3 — Read before write, always

Before editing any file, read its current state in full. Do not
issue a `replace` or `multi_edit` based on a stale snapshot of the
file from earlier in the session. The agent's own previous edit may
have changed line numbers, added imports, or modified the very
section you're about to touch.

A read costs a tool call. A bad write costs the user's trust and
sometimes a deploy roll-back.

## Rule 4 — After multi-edits, re-read the file

After issuing a `multi_edit` or several sequential `replace`s on the
same file, **read the file back** before reporting the change as
done. This is the cheapest way to catch:

- An import the agent's LSP stripped during the edit
- A `replace` that landed at the wrong location because the snapshot
  was stale
- A JSX block that got truncated mid-statement
- A trailing comma or brace the agent forgot to add

If anything looks wrong, fix it BEFORE the deliberate-break demo and
the final test run. Discovering a corrupted file during deploy is
five orders of magnitude more expensive than discovering it during
edit.

## Rule 5 — `npm run audit` is the safety net, not a substitute

`npm run audit` runs `scripts/audit-integrity.js`, which (a) checks
every source file ends cleanly (not truncated mid-statement) and
(b) verifies every `DO NOT REMOVE` marker has a following import
within 10 lines. It is the **last** line of defense, not the first.

If audit catches a stripped import, that means rules 1, 2, 3, and 4
all failed in sequence. Don't celebrate the catch — investigate why
it slipped through the earlier layers.

## Rule 6 — IDE settings are layered defense, not the cure

`.vscode/settings.json` in this repo disables
`source.organizeImports` and `source.removeUnusedImports` on save.
That covers the case of a human (or the agent) accidentally
triggering Format on Save in the IDE.

It does NOT cover the agent's internal multi-edit pipeline, which
runs outside of save events. Rules 1–4 are still the primary
defense. The IDE settings are the safety net for the safety net.

## Rule 7 — Image URLs for React Native must specify a raster format

React Native's `<Image>` component renders PNG, JPG, GIF, and WebP.
**It does NOT render SVG.** Any external URL that might serve SVG
(placehold.co, some CDNs that do content negotiation, SVG icon
sets) must specify a raster format explicitly:

- `placehold.co`: add `.png` at the **END of the path** (right
  before `?text=`), e.g.
  `https://placehold.co/400x400/F5E6D3/8B4513.png?text=...`.
  **Position matters** — placing `.png` after the size segment
  (`/400x400.png/<bg>/<fg>?text=...`) still serves SVG. Verified
  on-device in PR 32.2.
- Other placeholder services: check their docs for the format
  query param or path segment
- Icon CDNs: prefer `.png` exports over the SVG default

When writing or reviewing any PR that adds external image URLs,
verify the format is explicit. **The failure mode is silent** —
RN's `<Image>` renders nothing, logs nothing, captures nothing
in Sentry. The bug only surfaces on visual inspection of the
device.

**First instance:** PR 32.1 shipped category placeholders with
SVG-flavor placehold.co URLs; every placeholder rendered as an
empty box on device. PR 32.2 fixed it by adding `.png` to each
URL. This rule exists so future placeholder/icon work doesn't
recur the same class of bug.

## Rule 8 — Zustand selectors must return stable references

PR 41 smoke testing (May 26 2026) surfaced a "Maximum update
depth exceeded" crash on ShopListScreen for any account where
`profile.favorites` was undefined (typical for fresh accounts
post-`reset-pilot-data`).

The culprit was a one-line selector that looked innocent:

```ts
// BUG — creates a new {} on every render
const favorites = useProfileStore(s => s.profile?.favorites ?? {});
```

Zustand compares selector results with `Object.is`. When the
selected field is undefined, `?? {}` returns a brand-new empty
object on every render. New ref → store treats as changed →
re-render → new ref → re-render → infinite loop.

**The fix:** hoist the empty default to a module-level constant
so the fallback returns the same reference every time.

```ts
// FIX — module-level constant, stable reference
const EMPTY_FAVORITES: Record<string, string[]> = {};

// inside the component:
const favorites = useProfileStore(s => s.profile?.favorites ?? EMPTY_FAVORITES);
```

The same rule applies to `?? []` (empty array fallbacks) and
`?? new Map()` or any other reference-typed fallback.

**Symptom that should make you grep for this**: an
ErrorBoundary firing with "Maximum update depth exceeded" or
"Too many re-renders" anywhere in the app. Run:

```
grep -rn "use\\w*Store(s => .*\\?\\? [{\\[]" src/
```

If results appear, each one is a latent infinite-loop landmine
waiting for a user whose underlying field is undefined.

## Rule 9 — `<Image source={{ uri }} />` must guard against empty strings

PR 41 smoke testing (same incident) found that React Native's
`<Image>` on iOS in Expo SDK 54 throws an unhandled exception
when given an empty-string URI. Empty string is NOT treated the
same as null/undefined.

```tsx
// BUG — crashes ShopCard render if imageUrl is ""
<Image source={{ uri: shop.imageUrl }} style={styles.image} />

// FIX — guard explicitly for truthy URI
{shop.imageUrl ? (
  <Image source={{ uri: shop.imageUrl }} style={styles.image} />
) : (
  <View style={[styles.image, styles.imagePlaceholder]}>
    <Text style={styles.imagePlaceholderText}>🏪</Text>
  </View>
)}
```

The empty-string case is common in this app because shop /
menu-item docs can carry `imageUrl: ""` from data flows that
haven't yet wired KYC uploads or product photos to the
customer-facing field. Don't assume the field is either
"a valid URL" or "missing" — the third "empty string" case
breaks iOS rendering.

**Symptom that should make you grep for this**: render-time
crashes in a screen that contains a list of items pulled from
Firestore, especially after a fresh registration flow has
landed empty defaults in the data.

```
grep -rn "Image source={{ uri:" src/components src/screens
```

Verify each call site either guards on truthy URI or asserts
upstream that the field is never empty.

## Rule 10 — Firestore transactions: all reads before any writes

PR 42.1.1 (May 27 2026). Firestore's transaction model requires
every `tx.get()` to come BEFORE any `tx.set()` / `tx.update()` /
`tx.delete()`. A read after a write throws at runtime — and only
on the code path that actually executes the late read.

PR 42.1's `submitOrderRating` did `tx.get(orderRef)` →
`tx.get(shopRef)` → writes → THEN a gated `tx.get(userRef)` for
the delivery partner. Shop-only ratings worked (the gated read
never ran); dual ratings 500'd the instant the delivery read
fired after the writes.

```ts
// BUG — conditional read AFTER writes
tx.update(orderRef, ...);
tx.update(shopRef, ...);
if (deliveryRating) {
  const userSnap = await tx.get(userRef);  // ← throws
}

// FIX — hoist ALL reads (incl. conditional ones) to the top
const orderSnap = await tx.get(orderRef);
const shopSnap = await tx.get(shopRef);
const userSnap = deliveryRating ? await tx.get(userRef) : null;
// ...then all writes
```

**Why pure-helper tests don't catch it:** the helpers are pure;
the transaction shape is glue-only. Only an emulator-backed
integration test exercises the real read-then-write ordering.
For conditional reads, the data shape that triggers the gate
(here: a dual rating with a delivery dimension) must be in the
test matrix or the bug ships.

**Symptom:** a callable 500s for ONE specific data shape but
works for others — the shape that hits the gated read.

## Rule 11 — "register-once" gates must be keyed to identity, not a session boolean

PR 45.2 (May 27 2026). Push registration latched a session-wide
boolean (`pushRegisteredOk`) on the FIRST successful
registration. On app launch the anonymous user (Firebase
`signInAnonymouslyIfNeeded`) registered first, flipped the gate,
and the real user — signing in milliseconds later — was
short-circuited. The push token ended up on the throwaway
anonymous user's doc; the real account's `fcmTokens` stayed
empty forever. Push silently broke.

```ts
// BUG — boolean gate latches on the first (anonymous) user
let pushRegisteredOk = false;
if (user && !pushRegisteredOk) { register(); pushRegisteredOk = true; }

// FIX — gate keyed to WHICH uid was registered + skip anonymous
let lastRegisteredUid: string | null = null;
if (user && !user.isAnonymous && lastRegisteredUid !== user.uid) {
  register().then(ok => { if (ok) lastRegisteredUid = user.uid; });
}
```

Any "do this once per X" gate where X can change within a
session (user identity, shop, address) must key on X, not a
bare boolean. Otherwise the first value to satisfy the gate
poisons every subsequent one. Bonus: skip throwaway/anonymous
identities entirely if the side-effect is meaningless for them.

**Symptom:** a per-user side-effect (push token, analytics
identity, cache key) attaches to the wrong user — usually the
anonymous launch session or whoever was signed in first.

## Rule 12 — Firestore `Timestamp` reads are NOT plain millis numbers

PR-NEXT-HOTFIX-1 (May 31 2026) and PR-NEXT-HOTFIX-2 (June 1 2026).
Twice in two days the same bug class shipped to production:
a server-side validator gated on `typeof someTimestampField !== 'number'`,
the corresponding write was `FieldValue.serverTimestamp()`, and
the Admin SDK handed back a Firestore `Timestamp` object on
read — not millis. Every real production attempt was rejected
even though the underlying state was correct.

- HOTFIX-1: `validateDeliveryProofUploadAuth` gated on
  `typeof order.pickedUpAt !== 'number'`. `markPickedUp` writes
  `pickedUpAt` via `FieldValue.serverTimestamp()`. Every photo
  upload returned `failed-precondition: "Pick up the order before…"`
  on demonstrably picked-up orders.
- HOTFIX-2: `canCustomerCancelPaidOrder` gated on
  `typeof order.paidAt !== 'number'`. The Razorpay webhook writes
  `paidAt` via `FieldValue.serverTimestamp()`. Every customer's
  in-window cancel attempt would have returned
  `failed-precondition: "Order has no paid timestamp"` — only
  Razorpay's pilot suspension kept this latent.

Both shipped against test fixtures that used plain millis numbers
(`paidAt: 1_000_000`), so the unit suite was green while
production was 100% broken on the gated path. The fixture didn't
match the production shape.

```ts
// BUG — typeof gate rejects every Firestore Timestamp read
if (typeof order.someField !== 'number') return failedPrecondition;

// FIX — normalize-then-narrow; accept both shapes
const raw: unknown = order.someField;
const millis: number | null =
  typeof raw === 'number'
    ? raw
    : typeof (raw as { toMillis?: unknown })?.toMillis === 'function'
      ? (raw as { toMillis: () => number }).toMillis()
      : null;
if (millis === null || !Number.isFinite(millis) || millis <= 0) {
  return failedPrecondition;
}
```

**The rule:**

1. **Any server-side validator that gates on a server-written
   timestamp field MUST normalize via `.toMillis()`** (or accept
   both shapes via the `toMillis()`-narrowing pattern) BEFORE the
   gate check. Fields covered: `paidAt`, `pickedUpAt`,
   `deliveredAt`, `createdAt`, `updatedAt`, anything written via
   `FieldValue.serverTimestamp()` or upgraded from a millis number
   later.
2. **New validator fields comparing against server timestamps
   require a Firestore-shape fixture in the test suite**, not just
   a numeric fixture. Add a Timestamp-like
   (`{ toMillis: () => N }`) test alongside the numeric one.
3. Any future validator that does
   `typeof someTimestampField !== 'number'` is **suspect on review**.
   Either it's wrong now or the field is purely millis-on-write
   (rare for server timestamps); the burden is on the author to
   show which.

**Symptom:** a callable returns `failed-precondition` with a
"missing/invalid timestamp" message on orders that demonstrably
have the timestamp set. Client-side UI (which gets RNFB's
flattened-millis serialization) shows the field correctly; only
the Admin-SDK server path mis-types it.

## Rule 13 — bottom-anchored modals use `BottomSheet`

Any modal that anchors to the bottom of the screen (slide-up
"sheet" pattern, where the outer container has
`justifyContent: 'flex-end'` on the backdrop) MUST be built via
`src/components/common/BottomSheet.tsx` or, if it can't be (rare),
MUST use `useSafeAreaInsets().bottom` for its bottom padding.

Hardcoded `paddingBottom: spacing.xl` / `spacing.xxl` does NOT
clear Android gesture-nav pills on tall-pill devices. The CTA at
the bottom of the sheet gets clipped. This bug class shipped in
PR-NEXT-HOTFIX-3 (`CartScreen`, fixed locally with
`edges={['top','bottom']}`), PR-NEXT-PARTNER-CARD (sheet survived
because no CTA at the very bottom), and PR-NEXT-ADDRESS-UX.1
(visibly broken per Sudhir's June 1 retest screenshot — Save
button clipped). Fixed structurally in PR-NEXT-HOTFIX-7. Sudhir's
words on why this rule exists: *"Whenever we add anything new in
the app, this issue always comes. Can we make sure fix is applied
at first place instead of applying a fix. It wasted so much time."*

**Audit-grep before any PR that adds a bottom-anchored Modal:**

```
grep -r "justifyContent: 'flex-end'" src
```

Every result must either be the shared `BottomSheet` itself or a
caller of it (or one of the four admin screens flagged for a
future migration: `DeliveryRequestDetailScreen`,
`ShopDetailManagementScreen`, `ShopRegistrationDetailScreen`,
`UserDetailScreen`).

**Acceptance checklist addition for any PR that adds a
bottom-anchored modal:** *"Verified on an Android device with
3-button mode AND gesture-nav mode that the bottom-most CTA /
interactive element is fully tappable (not clipped by system
bars)."*

**`BottomSheet` API:**

| Prop | Default | Purpose |
|---|---|---|
| `visible` | required | Controls modal visibility. |
| `onClose` | required | Backdrop tap + hardware-back handler. |
| `children` | required | Sheet content. |
| `keyboardAvoid` | `true` | Wraps body in `KeyboardAvoidingView`; set `false` for sheets without text inputs. |
| `showHandle` | `true` | Renders the centered drag-handle bar. Set `false` when the sheet has its own dismissal affordance and the handle would mislead. |
| `onBackdropPress` | `onClose` | Override for sheets that should NOT dismiss on backdrop tap (e.g. `CancelAndRefundModal` uses this to dismiss only the keyboard, preserving half-typed reasons). |

## Quick reference

| Layer | What it does | When it fires |
|---|---|---|
| Rules 1–4 | Discipline on the agent | During edits |
| Rule 7 | RN image URLs specify raster format | During edits / review |
| Rule 8 | Zustand `??` fallbacks must be stable refs | During edits / review |
| Rule 9 | `<Image>` URIs must guard against empty strings | During edits / review |
| Rule 10 | Firestore tx: all reads before any writes | During edits / review |
| Rule 11 | "Register-once" gates keyed to identity, not a bool | During edits / review |
| Rule 12 | Firestore Timestamp reads need `.toMillis()`-narrowing | During edits / review |
| Rule 13 | Bottom-anchored modals use `BottomSheet` (safe-area-aware) | During edits / review |
| `.vscode/settings.json` | Disables organize-imports on save | On IDE save |
| `npm run audit` | Grep for stripped DO-NOT-REMOVE imports | Before deploy |
| `tsc --noEmit` | Compile check | Before deploy |

All must pass before a PR ships.
