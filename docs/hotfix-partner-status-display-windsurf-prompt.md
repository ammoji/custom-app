# HOTFIX-PARTNER-STATUS-DISPLAY — Stale "On the way" on delivered orders

**Source:** Sudhir's 2026-06-10 post-amend-fix retest:

1. **Shop owner's order detail** after delivery completes — partner section still says "On the way to the customer" (stale).
2. **Customer's PartnerDetailsSheet** after delivery completes — header reads "🛵 On the way to you" + bike icon, but body row right below it shows "Status: ✅ Delivered" (contradictory).

Both are two-state subtitle/header copy that never got the third-state ("delivered" / "cancelled") branch added during Bundle H. Same gap pattern as PartnerIdentityCard pre-Bundle-H §C — that one was fixed; these two were missed by the same audit-grep because they don't use the `derivePartnerCardSubtitle` helper.

**Deploy class:** **pure client OTA.** No server changes. No new callable. Three-state helper from Bundle H §C is reused.

## Root cause (verified by Claude before this prompt)

### Bug 1 — `ShopOrderDetailScreen.tsx:358-361`

```ts
const pickedUp = order.pickedUpAt != null;
const statusLabel = pickedUp
  ? 'On the way to the customer'
  : 'Heading to your shop';
```

Two-state only. Once `pickedUpAt` is set, copy stays "On the way to the customer" forever — even after `order.status === 'delivered'`.

### Bug 2 — `PartnerDetailsSheet.tsx:200-202`

```ts
const stateText = isPickedUp
  ? `${trust.vehicleIcon} On the way to you`
  : `${trust.vehicleIcon} Heading to the shop`;
```

Same two-state. The component already has `isFinalized` defined at line 198 — `const isFinalized = isDelivered || isCancelled` — and uses it correctly for the body row at line 281. The header's `stateText` just doesn't read its own variable.

### Why Bundle H §C's audit missed both

Bundle H added `derivePartnerCardSubtitle` and applied it to `PartnerIdentityCard`. The audit-grep targeted callers of `formatPartnerAvatar` + the literal string "On the way to you". Both files hit "On the way to you" but the §C fix only touched the one component named in the prompt. The audit didn't enumerate every callsite.

**This justifies a stronger audit pattern.** §C below.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root)
- `npm test`, `npm run test:unit`, `npx jest`
- File edits to:
  - `src/screens/shop/ShopOrderDetailScreen.tsx` (only the partner-section render block at line ~358)
  - `src/components/order/PartnerDetailsSheet.tsx` (only the `stateText` block at line 200)
  - `tests/static/partnerStatusAudit.test.ts` (new file — §C static guard)
- No new dependencies

You MUST stop and ask before:
- Deploy commands (`eas update`, `firebase deploy`, `gcloud …`)
- Editing files NOT listed above
- Schema additions or server changes
- Touching `derivePartnerCardSubtitle` (Bundle H §C — already correct, just being reused)

Default posture: **execute, report at end.**

## Schema audit-grep (Rule 5)

```
grep -rn "On the way to" src --include="*.tsx" --include="*.ts"
grep -rn "Heading to" src --include="*.tsx" --include="*.ts"
grep -rn "derivePartnerCardSubtitle\|pickedUpAt.*[?:]" src --include="*.tsx"
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `derivePartnerCardSubtitle({orderStatus, pickedUpAt}): string` | `src/utils/derivePartnerCardSubtitle.ts` (Bundle H §C) | Already three-state — delivered / cancelled / picked-up / heading. REUSE for both fixes. |
| Stale two-state in `ShopOrderDetailScreen` | Line 358-361 | Direct two-state ternary on `pickedUp` |
| Stale two-state in `PartnerDetailsSheet` | Line 200-202 | Direct two-state ternary on `isPickedUp` |
| Audit-grep enumeration | NEW — required for any "missing-feature-across-surfaces" PR | §C below |

## Plan

### §A — `ShopOrderDetailScreen.tsx` partner-section status label

`src/screens/shop/ShopOrderDetailScreen.tsx` line 358-361:

```ts
// BEFORE
const pickedUp = order.pickedUpAt != null;
const statusLabel = pickedUp
  ? 'On the way to the customer'
  : 'Heading to your shop';
```

```ts
// AFTER
// HOTFIX-PARTNER-STATUS-DISPLAY §A — DO NOT REMOVE. Three-state via
// the shared helper from Bundle H §C. Adds 'delivered' and 'cancelled'
// branches so the partner section copy doesn't lie after handoff.
// Note: helper returns customer-side phrasing ("On the way to you").
// Shop-side reads as "...to the customer" — so we override the
// in-flight branches but reuse the finalized branches.
const subtitle = derivePartnerCardSubtitle({
  orderStatus: order.status ?? null,
  pickedUpAt: typeof order.pickedUpAt === 'number' ? order.pickedUpAt : null,
});
const statusLabel =
  subtitle === '🛵 On the way to you'
    ? '🛵 On the way to the customer'
    : subtitle === '📦 Heading to the shop'
      ? '📦 Heading to your shop'
      : subtitle; // delivered / cancelled — finalized copy is role-neutral
```

Import `derivePartnerCardSubtitle` at the top with the standard `// HOTFIX-PARTNER-STATUS-DISPLAY §A — DO NOT REMOVE` comment.

**Alternative cleaner approach (preferred if §C's helper extension is acceptable):** extend `derivePartnerCardSubtitle` to take an `audience: 'customer' | 'shop'` arg and return the role-appropriate copy. Then both call sites pass their audience. Drives one source of truth. Pin **+2 extra tests** on the helper for the new arg.

Use whichever is cleaner in context — both achieve the same correctness. The alternative is preferred.

### §B — `PartnerDetailsSheet.tsx` header `stateText`

`src/components/order/PartnerDetailsSheet.tsx` line 200-202:

```ts
// BEFORE
const stateText = isPickedUp
  ? `${trust.vehicleIcon} On the way to you`
  : `${trust.vehicleIcon} Heading to the shop`;
```

```ts
// AFTER
// HOTFIX-PARTNER-STATUS-DISPLAY §B — DO NOT REMOVE. Header text now
// reads its own isFinalized state. Body row at line 281 already
// branches correctly via the same flag; the header was the divergent
// surface.
const stateText = isFinalized
  ? isDelivered
    ? `✅ Delivered`
    : `❌ Order cancelled`
  : isPickedUp
    ? `${trust.vehicleIcon} On the way to you`
    : `${trust.vehicleIcon} Heading to the shop`;
```

The vehicle icon stays only in the in-flight branches — once delivered/cancelled, the icon is dropped (matches the body row's emoji-only treatment).

### §C — Static-source guard: enumerated audit for "in-flight only" subtitle strings

New file `tests/static/partnerStatusAudit.test.ts`:

```ts
/**
 * HOTFIX-PARTNER-STATUS-DISPLAY §C — fifth permanent static-source
 * guard. Any subtitle/label string containing "On the way" or
 * "Heading to" MUST be inside a render block that also checks for
 * finalized order status (delivered/cancelled). This catches
 * two-state subtitle bugs at npm test time, before they ship.
 *
 * Companion to:
 *   - authClaimNamesAudit (Bundle G)
 *   - noStaleDeferralComments (Bundle H)
 *   - transactionReadOrderAudit (HOTFIX-PUBLISH-TX-ORDER)
 *   - shopOwnerCheckAudit (HOTFIX-OWNER-CARD-AMEND)
 *   - partnerStatusAudit (this guard) ← NEW
 */

import { readFileSync } from 'fs';
import { glob } from 'glob';

describe('partner status display audit', () => {
  it('every "On the way" / "Heading to" usage sits below a delivered/cancelled branch', async () => {
    const files = await glob('src/**/*.{tsx,ts}', {
      ignore: ['**/*.test.*', 'src/utils/derivePartnerCardSubtitle.ts'],
    });
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      // Find lines containing "On the way" or "Heading to"
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!/On the way|Heading to/.test(line)) continue;
        // Walk backwards up to 20 lines looking for either:
        //   - "delivered" / "cancelled" in a conditional
        //   - "derivePartnerCardSubtitle(" call (helper consumes correctly)
        //   - "isFinalized" / "isDelivered" / "isCancelled" variable
        const windowStart = Math.max(0, i - 20);
        const windowText = lines.slice(windowStart, i).join('\n');
        const hasFinalizedGuard =
          /'delivered'|"delivered"|'cancelled'|"cancelled"|isFinalized|isDelivered|isCancelled|derivePartnerCardSubtitle\(/.test(
            windowText,
          );
        if (!hasFinalizedGuard) {
          violations.push(`${file}:${i + 1} ← "${line.trim()}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
```

Pin **+1 test** for the guard, plus **+2 detection-unit tests** proving the regex catches a known violation and ignores a known-good usage. Total **+3 for §C**.

The audit-grep is intentionally loose — false positives are easier to allowlist (via inline comment `// partner-status-audit:allow`) than false negatives are to detect post-ship.

## Discipline checklist

1. **Rule 1** — every new import / state carries "HOTFIX-PARTNER-STATUS-DISPLAY — DO NOT REMOVE" comments.
2. **Rule 2** — N/A (no new hooks).
3. **Rule 5** — schema audit-grep in header. **Worked example #12 for the discipline notes:** *"When fixing a missing-feature-across-surfaces bug (Bundle H §C added three-state subtitle to PartnerIdentityCard), the audit-grep MUST enumerate every callsite of the bad pattern (literal strings, not just helper consumers). A static guard from the start prevents the same gap from masking across two more screens."*
4. **Rule 7** — N/A.
5. **Rule 8** — FEATURES.md update in Doc trail. Lineage HTML comments on partner-status rows.
6. **Rule 11** — N/A (no server changes).
7. **Rule 13** — N/A.
8. **Rule 14** — N/A.
9. **Schema-additive** — N/A.
10. **Test discipline:** §A optional +2 if extending helper, §C +3 = **+3–5 tests.** Suite ~1575 → ~1578-1580.

## Acceptance checklist

1. **§A** Shop owner opens order detail for a delivered order → partner section reads "✅ Delivered" (or similar finalized copy), NOT "On the way to the customer."
2. **§A** Same screen for in-flight order → reads "On the way to the customer" (post-pickup) or "Heading to your shop" (pre-pickup). Regression guard.
3. **§B** Customer taps "Your delivery partner" card on a delivered order → bottom sheet header reads "✅ Delivered." Body row right below also says "Status: ✅ Delivered." No contradiction.
4. **§B** Customer opens same sheet on in-flight order → header reads "🛵 On the way to you" (post-pickup) with the vehicle icon. Regression guard.
5. **§C** Run `npm test` → `partnerStatusAudit` passes clean. Manually re-introduce a stale two-state copy in one screen → guard fails with file:line pinpoint. Restore. Guard passes.
6. `tsc` + tests clean. Suite +3–5 minimum.
7. **Deliberate-break demo:** revert §A's helper consumption back to the two-state ternary on `pickedUp`. The `partnerStatusAudit` guard test must fail. Restore. Guard passes.

## Out of scope

- **PartnerIdentityCard** — already fixed in Bundle H §C; verify with regression test that the existing fix still works post-this-PR (no changes expected, just confirm).
- **Other partner-related UX surfaces** — Bundle I's AttentionQueueScreen header etc. The audit in §C catches any new gap; current callsites are clean per my pre-prompt grep.
- **Server-side status copy** — push notifications include status text in some cases; this PR is client-only. Push title for "delivered" is already separate copy.

## Deploy

```
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "HOTFIX-PARTNER-STATUS-DISPLAY — three-state subtitle on shop OrderDetail + customer PartnerDetailsSheet header"
```

No server, no IAM, no backfill.

## Doc trail (Cowork)

After ship:

- **TESTING-FINDINGS** — close shop-side stale "On the way to the customer" + customer-side PartnerDetailsSheet header contradiction.
- **CLAUDE.md** In-flight strike.
- **SESSION_LOG** paragraph capturing: Bundle H §C's three-state pattern was applied to only one of three callsites; audit-grep enumeration is now a static guard.
- **PROMPT_AUTHORING_NOTES** — add **Rule 5 worked example #12** (audit-grep enumeration discipline + static guard for missing-feature-across-surfaces bug class).
- **FEATURES.md** (per Rule 8):
  - **Shop panel §2.2 Order management** — edit "Partner card on order detail" row: source column → `Bundle E §A + HOTFIX-PARTNER-STATUS-DISPLAY 2026-06-10`. Lineage HTML comment.
  - **Customer panel §1.8 Order tracking** — edit "Partner card" row: append `"; PartnerDetailsSheet header reads finalized state correctly (delivered/cancelled override in-flight copy)"`. Lineage HTML comment.
  - **Last updated** stamps on Customer §1.8, Shop §2.2 → 2026-06-10.
- **Static guard inventory** now: 5 permanent guards (authClaimNames + noStaleDeferralComments + transactionReadOrder + shopOwnerCheck + partnerStatus).
