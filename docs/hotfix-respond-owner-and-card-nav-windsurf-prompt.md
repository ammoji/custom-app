# HOTFIX-RESPOND-OWNER-AND-CARD-NAV-AND-AMEND — Three Bundle H/I follow-ups

**Source:** Sudhir's 2026-06-10 post-Bundle-I retest:

1. **Shop owner taps "Send response"** on a flagged_low order → server returns `permission-denied` with message *"Not the owner of this shop"* — despite the order being for the shop the caller actually owns.
2. **Tapping the "Reviews & Ratings" card** on either dashboard does nothing visible — partner / shop owner has to scroll and inspect every order to find the one needing action.
3. **Customer amends rating from 2★ to 4★** → display stays at 2★ "everywhere." Multiple stacked bugs in `amendRating` cause partial denormalization.

**Deploy class:** **server-first** (2 modified callables: `respondToReview`, `amendRating`) → IAM verify → client OTA. New screen + nav route on the client.

## Root cause (verified by Claude before this prompt)

### Bug 1 — Wrong shop-ownership pattern in `respondToReview`

`functions/src/index.ts:10362-10367`:

```ts
if (isShopOwner) {
  const shopSnap = await db.collection('shops').where('ownerUid', '==', uid).limit(1).get();
  if (shopSnap.empty || shopSnap.docs[0].id !== rev.shopId) {
    throw new HttpsError('permission-denied', 'Not the owner of this shop');
  }
}
```

This asks *"does the caller own SOME shop matching the review's shopId?"* by querying `where ownerUid == uid limit 1`. With Sudhir's multi-region test setup the same uid owns multiple shops; `limit(1)` returns whichever is first by document id, which usually isn't `rev.shopId` → fails.

The correct pattern is the inverse direction — look up the specific shop by id, then check its ownerUid (already used at `functions/src/index.ts:2240` in `recordShopKycUpload`):

```ts
const shopSnap = await db.doc(`shops/${rev.shopId}`).get();
if (!shopSnap.exists) throw new HttpsError('not-found', 'Shop not found');
const shop = shopSnap.data() as { ownerUid?: string };
if (shop.ownerUid !== uid) {
  throw new HttpsError('permission-denied', 'Not the owner of this shop');
}
```

**Same bug class as HOTFIX-5 + HOTFIX-RATING-RESPONSE.** Auth check using the wrong shape. The `authClaimNamesAudit` static guard catches `claims.is*` violations but doesn't catch this `where(ownerUid).limit(1)` antipattern.

### Bug 2 — Dashboard card tap is a no-op

`src/screens/delivery/DeliveryDashboardScreen.tsx:486-492`:

```ts
const handleCardTap = (cardId: string) => {
  if (cardId === 'attention') setShowAttention(true);
  else if (cardId === 'active') setShowMine(true);
  // ...
};
```

But `showAttention` initializes to `true` (line 144). Tapping the card sets a state that's already true → React no-op → no visible change.

Shop side is explicitly a no-op:

```ts
onCardPress={() => { /* shop cards scroll-to is a no-op for pilot */ }}
```

Even if the toggle DID flip, the section would already be visible inline on the dashboard. Sudhir's stated intent is *"take me to those orders where I need to take action"* — a focused filtered view, not an inline section he still has to scroll past everything else to find.

Right fix: a dedicated `AttentionQueueScreen` for both roles. Card tap → navigate to screen showing ONLY the flagged_low orders, tap row → OrderDetail to respond.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root AND `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `cd functions && npm run build`
- File edits to:
  - `functions/src/index.ts` (only the `respondToReview` block at line ~10330)
  - `functions/src/respondToReviewHelpers.ts` (if it exists; verify with grep)
  - `src/screens/delivery/DeliveryDashboardScreen.tsx` (only `handleCardTap`)
  - `src/screens/shop/ShopOwnerDashboardScreen.tsx` (only the `onCardPress` block)
  - `src/navigation/AppNavigator.tsx` (add new route)
- New file creation:
  - `src/screens/delivery/AttentionQueueScreen.tsx`
  - `src/screens/shop/ShopAttentionQueueScreen.tsx` (or single shared screen with role prop — see §B)
  - `functions/src/respondToReviewOwnerCheckHelpers.ts` (pure helper for the new auth pattern)
  - `tests/static/shopOwnerCheckAudit.test.ts` (new static guard)
  - Tests for the above

You MUST stop and ask before:
- Deploy commands (`firebase deploy`, `eas update`, `gcloud …`)
- Editing files NOT listed above
- Schema additions or new callables
- Touching the delivery-partner branch of `respondToReview` (already correct via PARTNER-CARD.1)
- Touching `_publishReview` or any HOTFIX-PUBLISH-TX-ORDER code

Default posture: **execute, report at end.**

## Schema audit-grep (Rule 5)

```
grep -rn "where.*ownerUid.*==.*uid\|where('ownerUid', '==', uid).limit(1)" functions/src
grep -rn "shops.*ownerUid\|shop.ownerUid" functions/src
grep -rn "AttentionQueue\|AttentionQueueScreen" src
grep -rn "navigation.navigate.*AttentionQueue\|nav.navigate.*Attention" src
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `shops/{shopId}.ownerUid` | Schema source-of-truth | Single owner per shop; lookup via direct doc read |
| Correct ownership-check pattern | `recordShopKycUpload` (functions/src/index.ts:2240) | Direct doc read + ownerUid comparison. Use as worked example. |
| Antipattern `where(ownerUid).limit(1)` | Only in `respondToReview` post audit-grep | Single instance; static guard prevents future drift |
| `claims.shopId` | NOT used in respondToReview — but exists on some accounts (Bundle E shop-side gate uses it) | Optional fast-path; defense-in-depth direct doc read still required |

## Plan

### §A — Server: fix shop-ownership check in `respondToReview`

`functions/src/index.ts` lines 10362-10367:

```ts
// BEFORE
if (isShopOwner) {
  const shopSnap = await db.collection('shops').where('ownerUid', '==', uid).limit(1).get();
  if (shopSnap.empty || shopSnap.docs[0].id !== rev.shopId) {
    throw new HttpsError('permission-denied', 'Not the owner of this shop');
  }
}

// AFTER (HOTFIX-RESPOND-OWNER — DO NOT REMOVE. Same auth bug class as
// HOTFIX-5 + HOTFIX-RATING-RESPONSE. Look up the SPECIFIC shop by
// rev.shopId, verify ownerUid matches. The previous indirect query
// pattern (`where ownerUid == uid limit 1`) returns an arbitrary shop
// when the caller owns multiple, breaking the comparison. Worked
// example: recordShopKycUpload at line 2240 uses this same pattern.)
if (isShopOwner) {
  const ownerCheck = await validateShopOwnerForReview({
    callerUid: uid,
    reviewShopId: rev.shopId,
    readShopDoc: async (shopId: string) => {
      const snap = await db.doc(`shops/${shopId}`).get();
      return snap.exists ? (snap.data() as { ownerUid?: string | null }) : null;
    },
  });
  if (!ownerCheck.ok) {
    throw new HttpsError('permission-denied', ownerCheck.message);
  }
}
```

### §B — Pure helper `validateShopOwnerForReview`

New file `functions/src/respondToReviewOwnerCheckHelpers.ts`:

```ts
/**
 * HOTFIX-RESPOND-OWNER — pure auth helper for the shop-owner branch
 * of respondToReview. Replaces the broken `where ownerUid == uid
 * limit 1` indirect lookup with a direct shop-by-id check, mirroring
 * the recordShopKycUpload pattern.
 *
 * Rule 14 — discriminated-union Result.
 * Pinned by tests/functions/respondToReviewOwnerCheckHelpers.test.ts.
 */

export type ShopOwnerCheckResult =
  | { ok: true }
  | { ok: false; code: 'shop_not_found' | 'not_owner'; message: string };

export async function validateShopOwnerForReview(args: {
  callerUid: string;
  reviewShopId: string;
  readShopDoc: (shopId: string) => Promise<{ ownerUid?: string | null } | null>;
}): Promise<ShopOwnerCheckResult> {
  const shop = await args.readShopDoc(args.reviewShopId);
  if (!shop) {
    return {
      ok: false,
      code: 'shop_not_found',
      message: 'Shop not found',
    };
  }
  if (shop.ownerUid !== args.callerUid) {
    return {
      ok: false,
      code: 'not_owner',
      message: 'Not the owner of this shop',
    };
  }
  return { ok: true };
}
```

Pin **+5 tests** on the helper:
- Shop exists + caller is owner → ok
- Shop exists + caller is NOT owner → not_owner
- Shop doesn't exist → shop_not_found
- Caller is owner but shop has null `ownerUid` (corrupted data) → not_owner
- Owner of a DIFFERENT shop (the failing case from Sudhir's screenshot — multi-shop owner) → not_owner if reviewShopId differs

### §C — Static-source guard: ban `where('ownerUid', '==', uid).limit(1)` pattern

New file `tests/static/shopOwnerCheckAudit.test.ts`:

```ts
/**
 * HOTFIX-RESPOND-OWNER — static guard banning the indirect
 * shop-ownership lookup pattern. The right pattern is direct shop
 * doc read + ownerUid comparison (see respondToReviewOwnerCheckHelpers.ts).
 * The wrong pattern is `where('ownerUid', '==', X).limit(1)` followed
 * by comparing the arbitrary first result's id to the intended shopId.
 *
 * Fourth permanent static guard after authClaimNames (Bundle G),
 * noStaleDeferralComments (Bundle H), transactionReadOrder
 * (HOTFIX-PUBLISH-TX-ORDER), and this one.
 */

describe('shop ownership check audit', () => {
  it('no callable uses where(ownerUid == X).limit(1) for auth', async () => {
    const files = await glob('functions/src/**/*.ts');
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      // Match `.where('ownerUid', '==', <something>).limit(1)`
      // Allowance: pure admin queries (clearly marked) can opt out
      // via a `// shop-owner-audit:allow` comment on the line above.
      const matches = src.match(
        /\.where\(['"]ownerUid['"],\s*['"]==['"],\s*[\w.]+\)[\s\S]{0,40}?\.limit\(1\)/g,
      );
      if (matches) {
        // Filter out allowlisted lines
        matches.forEach(m => {
          if (!src.includes('shop-owner-audit:allow')) {
            violations.push(`${file}: ${m}`);
          }
        });
      }
    }
    expect(violations).toEqual([]);
  });
});
```

Pin **+1 test** for the guard itself, plus **+2 detection-unit tests** to prove the regex catches the bad pattern and ignores the good pattern. Total **+3** for §C.

### §D — Pure helper for the new screen's view model

`src/utils/attentionQueueViewModel.ts`:

```ts
/**
 * HOTFIX-RESPOND-OWNER-AND-CARD-NAV — view model for the new
 * AttentionQueueScreen. Transforms the AttentionReviewRow[] from
 * the server into a render-ready list with formatted time, stars
 * display, and tap target metadata.
 */

export type AttentionQueueRow = {
  orderId: string;
  shopName: string | null;
  ratingStars: number;       // 1-5 for the role's rated dimension
  commentExcerpt: string | null;  // First 80 chars
  submittedAtMs: number | null;
  daysLeft: number | null;   // 7 - days since submitted (auto-publish countdown)
};

export function buildAttentionQueueRows(
  role: 'delivery' | 'shop',
  rawRows: Array<{
    orderId: string;
    shopName?: string | null;
    deliveryRating?: number | null;
    deliveryComment?: string | null;
    shopRating?: number | null;
    shopComment?: string | null;
    submittedAt?: number | null;
  }>,
  nowMs: number,
): AttentionQueueRow[] {
  return rawRows.map(r => {
    const stars = role === 'delivery'
      ? (r.deliveryRating ?? 0)
      : (r.shopRating ?? 0);
    const comment = role === 'delivery'
      ? (r.deliveryComment ?? null)
      : (r.shopComment ?? null);
    const submittedAtMs = r.submittedAt ?? null;
    const daysLeft = submittedAtMs != null
      ? Math.max(0, 7 - Math.floor((nowMs - submittedAtMs) / 86400000))
      : null;
    return {
      orderId: r.orderId,
      shopName: r.shopName ?? null,
      ratingStars: stars,
      commentExcerpt: comment ? comment.slice(0, 80) + (comment.length > 80 ? '…' : '') : null,
      submittedAtMs,
      daysLeft,
    };
  });
}
```

Pin **+5 tests** (delivery role / shop role / empty / 80-char excerpt cap / countdown clamp at 0).

### §E — New `AttentionQueueScreen`

Single shared screen at `src/screens/AttentionQueueScreen.tsx` accepting a `role: 'delivery' | 'shop'` route param. Same screen serves both via role-aware callable + view model.

```tsx
/**
 * HOTFIX-RESPOND-OWNER-AND-CARD-NAV §E — dedicated screen showing
 * only flagged_low orders awaiting this role's response. Reached by
 * tapping "Reviews & Ratings" on the dashboard card grid.
 */

export default function AttentionQueueScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'AttentionQueue'>>();
  const nav = useNavigation<any>();
  const { role } = route.params;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AttentionQueueRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRows = useCallback(async () => {
    const fn = role === 'delivery'
      ? orderService.listMyAttentionReviews
      : orderService.listShopAttentionReviews;
    const raw = await fn();
    setRows(buildAttentionQueueRows(role, raw, Date.now()));
  }, [role]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    setLoading(true);
    fetchRows().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fetchRows]));

  const handleRowPress = (orderId: string) => {
    const screenName = role === 'delivery' ? 'DeliveryOrderDetail' : 'ShopOrderDetail';
    nav.navigate(screenName, { orderId });
  };

  // ... loading + empty + list render ...
}
```

Header: "Reviews & Ratings · {count}". Empty state: "✨ No reviews need your attention right now."

Row layout: shop name (or order short id) + stars + comment excerpt + "{N} days left" badge + chevron. Tap → role-appropriate OrderDetail.

### §F — Wire navigation route

`src/navigation/AppNavigator.tsx` — add the new route:

```ts
AttentionQueue: { role: 'delivery' | 'shop' };
```

Register the screen in the stack navigator. Standard `<Stack.Screen name="AttentionQueue" component={AttentionQueueScreen} />` with a back-button header.

### §H — Fix `amendRating` denorm + delivery rolling-average gap

**Verified root cause:** `amendRating` (functions/src/index.ts:10446) has four stacked problems:

1. **Lines 10475-10485** write a redundant `amendedStars: { shopStars, deliveryStars }` subfield to the review doc. `_publishReview` already updates `review.shopStars` / `review.deliveryStars` directly via its `reviewPatch`. The `amendedStars` subfield is dead — anything reading it gets the post-amend values not the original-amend audit trail. Confuses downstream readers.
2. **Lines 10487-10503** recompute `shop.ratingAvg` OUTSIDE the transaction `_publishReview` runs inside. Race condition: between the outside-tx write and the in-tx read, a concurrent submit can land. Stale reads possible.
3. **Lines 10487-10503 only handle `newShopStars`.** If a customer amends `newDeliveryStars` (currently no UI path, but the callable signature accepts it for future symmetry), the partner's `deliveryRatingAvg` stays stale forever.
4. **Client-side `RatingAmendmentScreen.handleAmend`** (src/screens/customer/RatingAmendmentScreen.tsx:74) calls `amendRating` then shows an Alert + `nav.goBack()`. Doesn't trigger any explicit refetch on the underlying OrderDetailScreen. If `watchOrder` is poll-based on native and the tick hasn't fired yet, customer returns to a screen showing stale 2★ for several seconds → reports "still shows 2 everywhere."

**Fix — three coordinated parts:**

**§H.1 — Move rolling-average recompute INTO `_publishReview` transaction**

`functions/src/index.ts` `_publishReview` — inside the existing transaction body, AFTER the read phase, BEFORE the write phase, add rolling-average recompute logic for both shop AND partner when the input `newShopStars` / `newDeliveryStars` differs from the pre-amend value:

```ts
// Read phase already has shopSnap + partnerSnap.
const shopData = ...; // already exists
const partnerData = ...; // already exists from §A read phase

// HOTFIX-AMEND-RECOMPUTE — DO NOT REMOVE. Rolling-average recompute
// for changed stars belongs INSIDE the transaction so the shop+partner
// avg/count updates are atomic with the publish state cascade.
// Previously lived in amendRating outside the transaction → race with
// _publishReview's in-tx writes → stale shop.ratingAvg possible.
let shopAvgRecompute: { ratingAvg: number } | null = null;
if (
  args.newShopStars !== undefined &&
  typeof rev.shopStars === 'number' &&
  args.newShopStars !== rev.shopStars
) {
  const oldCount: number = typeof shopData.ratingCount === 'number' ? shopData.ratingCount : 1;
  const oldAvg: number = typeof shopData.ratingAvg === 'number' ? shopData.ratingAvg : rev.shopStars;
  if (oldCount > 0) {
    const oldSum = oldAvg * oldCount;
    const newAvg = (oldSum - rev.shopStars + args.newShopStars) / oldCount;
    shopAvgRecompute = { ratingAvg: newAvg };
  }
}

let partnerAvgRecompute: { deliveryRatingAvg: number } | null = null;
if (
  args.newDeliveryStars !== undefined &&
  typeof rev.deliveryStars === 'number' &&
  args.newDeliveryStars !== rev.deliveryStars &&
  partnerRef
) {
  const oldCount: number = typeof partnerData.deliveryRatingCount === 'number' ? partnerData.deliveryRatingCount : 1;
  const oldAvg: number = typeof partnerData.deliveryRatingAvg === 'number' ? partnerData.deliveryRatingAvg : rev.deliveryStars;
  if (oldCount > 0) {
    const oldSum = oldAvg * oldCount;
    const newAvg = (oldSum - rev.deliveryStars + args.newDeliveryStars) / oldCount;
    partnerAvgRecompute = { deliveryRatingAvg: newAvg };
  }
}
```

Then in the WRITE PHASE, merge these into the existing shop and partner `tx.set` calls:

```ts
tx.set(
  shopRef,
  {
    publicReviewCount: FieldValue.increment(1),
    publicReviewLatest: newLatest,
    ...(shopPublicDelta > 0 ? { publicRatingCount: FieldValue.increment(shopPublicDelta) } : {}),
    ...(shopAvgRecompute ?? {}),  // ← new: rolling-avg update merged into the existing write
  },
  { merge: true },
);

// ... partner write:
tx.set(
  partnerRef,
  {
    publicReviewCount: FieldValue.increment(1),
    publicReviewLatest: partnerNewLatest,
    ...(partnerPublicDelta > 0 ? { publicDeliveryRatingCount: FieldValue.increment(partnerPublicDelta) } : {}),
    ...(partnerAvgRecompute ?? {}),  // ← new: partner rolling-avg update
  },
  { merge: true },
);
```

Extract the recompute math into a pure helper `recomputeRollingAverageOnAmend(args: { oldAvg, oldCount, oldStars, newStars }): { newAvg: number } | null` in a new file `functions/src/recomputeRollingAverageHelpers.ts`. Returns `null` when `oldCount === 0` (defensive — should never happen but avoids NaN).

**§H.2 — Remove redundant writes from `amendRating`**

`functions/src/index.ts` `amendRating` callable (lines 10474-10503):

```ts
// BEFORE — sets correctionState='amended' + amendedStars subfield, then redundantly recomputes shop ratingAvg
await db.doc(`reviews/${ratingId}`).set(
  {
    correctionState: 'amended',
    amendedStars: { shopStars: newShopStars ?? null, deliveryStars: newDeliveryStars ?? null },
    amendedAt: nowMs,
  },
  { merge: true },
);
if (typeof newShopStars === 'number' && newShopStars !== rev.shopStars) {
  // ... 17 lines of outside-tx recompute ...
}
await _publishReview({ ratingId, reason: 'customer_amended', newShopStars, newDeliveryStars, nowMs });
```

```ts
// AFTER — single transactional call; _publishReview handles all writes atomically
// HOTFIX-AMEND-RECOMPUTE — DO NOT REMOVE. Rolling-average recompute moved INTO
// _publishReview's transaction. The redundant amendedStars subfield + outside-tx
// shop write are both gone. `amendedAt` stamp moves onto the review doc via
// reviewPatch extension in _publishReview (see §H.3).
await _publishReview({
  ratingId,
  reason: 'customer_amended',
  newShopStars,
  newDeliveryStars,
  nowMs,
});
```

**§H.3 — Stamp `amendedAt` on review doc inside `_publishReview`**

`_publishReview` `reviewPatch`:

```ts
const reviewPatch: Record<string, unknown> = {
  correctionState: 'published',
  publishedAt,
  publishedReason: args.reason,
};
if (args.newShopStars !== undefined) reviewPatch.shopStars = args.newShopStars;
if (args.newDeliveryStars !== undefined) reviewPatch.deliveryStars = args.newDeliveryStars;
// HOTFIX-AMEND-RECOMPUTE — stamp amendedAt when this publish came via amendRating
if (args.reason === 'customer_amended') reviewPatch.amendedAt = args.nowMs;
```

**§H.4 — Client-side: force a fresh fetch after amend success**

`src/screens/customer/RatingAmendmentScreen.tsx:74` `handleAmend`:

```ts
const handleAmend = async () => {
  if (newStars === null) {
    Alert.alert('Select stars', 'Tap a star rating to amend.');
    return;
  }
  setSaving(true);
  try {
    await orderService.amendRating({ ratingId, newShopStars: newStars });
    // HOTFIX-AMEND-RECOMPUTE — DO NOT REMOVE. Force an explicit
    // re-fetch of the order so the underlying OrderDetailScreen doesn't
    // show stale stars during the watcher's poll interval. The order
    // doc has order.shopRating denormalized; refetching primes the
    // cache so when the user navs back, the watcher's first callback
    // delivers fresh data.
    try {
      await orderService.getOrder(orderId);
    } catch {
      // Best-effort — watcher will eventually catch up.
    }
    Alert.alert(
      'Rating updated',
      `Your rating has been updated to ${newStars}★ and is now public.`,
      [{ text: 'OK', onPress: () => nav.goBack() }],
    );
  } catch (e: any) {
    Alert.alert('Could not update', e?.message ?? 'Please try again.');
  } finally {
    setSaving(false);
  }
};
```

Verify `orderService.getOrder` (or equivalent fetch-by-id) exists; if not, fall back to forcing an emit via the existing watch subscription invalidation pattern. Apply the same change to `handleKeepOriginal`.

Pin **+6 tests** on `recomputeRollingAverageHelpers`:
- Amend 2→4 on 1-rating shop: avg 2 → 4
- Amend 2→4 on 5-rating shop with avg 3: avg 3.0 → 3.4
- Amend 4→2 on 5-rating shop with avg 3: avg 3.0 → 2.6 (decrease path)
- No change requested (`oldStars === newStars`) — caller shouldn't invoke, but defensive: return null
- `oldCount === 0` defensive → return null
- Floating-point precision sanity (chain of 3 amends round-trips correctly to within 0.01)

### §G — Update dashboard card tap handlers

`src/screens/delivery/DeliveryDashboardScreen.tsx:486`:

```ts
// BEFORE
const handleCardTap = (cardId: string) => {
  if (cardId === 'attention') setShowAttention(true);
  else if (cardId === 'active') setShowMine(true);
  // ... other no-ops ...
};

// AFTER (HOTFIX-RESPOND-OWNER-AND-CARD-NAV §G — DO NOT REMOVE.
// Attention card navigates to the dedicated AttentionQueueScreen.
// Other cards stay as section-toggles for pilot; future PR can
// extend each to dedicated screens if needed.)
const handleCardTap = (cardId: string) => {
  if (cardId === 'attention') {
    nav.navigate('AttentionQueue', { role: 'delivery' });
    return;
  }
  if (cardId === 'active') setShowMine(true);
  else if (cardId === 'available') setShowAvailable(true);
  else if (cardId === 'coming') setShowHeadsUp(true);
  else if (cardId === 'history') setShowHistory(true);
};
```

`src/screens/shop/ShopOwnerDashboardScreen.tsx:367-369`:

```ts
// BEFORE
onCardPress={() => { /* shop cards scroll-to is a no-op for pilot */ }}

// AFTER
onCardPress={(cardId) => {
  if (cardId === 'attention') {
    nav.navigate('AttentionQueue', { role: 'shop' });
  }
  // Other shop cards stay no-op for pilot.
}}
```

Also pass `nav` ref into the existing dashboard component if not already accessible (likely via `useNavigation`).

## Discipline checklist

1. **Rule 1** — every new import / state carries "HOTFIX-RESPOND-OWNER-AND-CARD-NAV — DO NOT REMOVE" or "HOTFIX-AMEND-RECOMPUTE — DO NOT REMOVE" comments per the originating section.
2. **Rule 2** — `loading`, `rows`, `refreshing` useState above any conditional returns in `AttentionQueueScreen`.
3. **Rule 5** — schema audit-grep in header. **Worked example #10 for the discipline notes:** *"Auth pattern bugs come in TWO classes: shape bugs (wrong field name — caught by `authClaimNamesAudit`) AND direction bugs (asking 'does user own SOME matching shop?' instead of 'does THIS shop have user as owner?'). The direction bug requires a different audit pattern — the new `shopOwnerCheckAudit` is the institutional fix."* **Worked example #11:** *"Denormalization recompute logic belongs in the same transaction that triggers the state change. amendRating's outside-tx shop ratingAvg recompute (lines 10487-10503) raced with _publishReview's in-tx writes; the right fix is one atomic transaction. Same lesson as HOTFIX-REVIEW-DENORM — when state transitions cascade to N denormalized fields, all updates belong inside ONE transaction."*
4. **Rule 7** — auth.token shape unchanged.
5. **Rule 8** — FEATURES.md update in Doc trail. New rows for AttentionQueueScreen + lineage on amend rows.
6. **Rule 11** — IAM verify on `respondToReview` AND `amendRating` (modified). 2 services.
7. **Rule 13** — N/A.
8. **Rule 14** — server-side helpers return Result via `validateShopOwnerForReview` + `recomputeRollingAverageOnAmend` returns nullable.
9. **Schema-additive** — no new fields. Pure auth-pattern fix + UI navigation + denorm consolidation. **One legacy field removed** (`review.amendedStars` subfield — dead code).
10. **Test discipline:** §B +5, §C +3, §D +5, §H +6, **+19 tests minimum.** Suite ~1556 → ~1575.

## Acceptance checklist

1. **§A** As shop owner, open Reviews & Ratings card → tap an order → respond modal → type → Send → **success.** Review transitions to `responded`. No "Not the owner" error. Confirm same flow works when the shop owner test account owns multiple shops (multi-region setup).
2. **§A** Manually invoke `respondToReview` with `ratingId` of a shop the caller does NOT own → `permission-denied` with "Not the owner of this shop" message (regression guard).
3. **§E** Tap "Reviews & Ratings" card on Delivery dashboard → AttentionQueueScreen opens showing ONLY flagged_low orders for this partner. Each row: shop name + stars + comment excerpt + days-left badge.
4. **§E** Same flow on Shop dashboard → AttentionQueueScreen opens with the shop's flagged_low orders.
5. **§E** Empty state: when no flagged_low orders exist, screen shows "✨ No reviews need your attention right now."
6. **§E** Tap any row → opens the correct role-aware OrderDetail. Back button returns to AttentionQueueScreen, not all the way to dashboard.
7. **§C** Static guard test runs in `npm test` and passes. Manually re-introduce the old `where(ownerUid).limit(1)` pattern → guard test fails. Restore. Guard passes.
8. **§H** As customer, amend a 2★ rating to 4★ via RatingAmendmentScreen → "Rating updated" Alert → tap OK → return to OrderDetailScreen → **"You rated the shop ⭐⭐⭐⭐" displays 4 stars immediately**, not 2. No watcher-lag stale flash.
9. **§H** Check Firestore Console after the amend: `orders/{id}.shopRating` = 4, `shops/{shopId}.ratingAvg` = 4 (assuming this was the only rating), `reviews/{id}.shopStars` = 4, `reviews/{id}.amendedAt` is stamped. `reviews/{id}.amendedStars` subfield is GONE (removed by §H.2). No stale 2★ anywhere.
10. **§H** As customer, amend a delivery rating (when UI supports it — currently shop-only via RatingAmendmentScreen, but the server callable accepts `newDeliveryStars`). Manually invoke `amendRating({ratingId, newDeliveryStars: 4})` on a review where the original delivery stars were 1 → partner's `users/{uid}.deliveryRatingAvg` recomputes correctly. Without §H this currently silently no-ops.
11. **§H** Cumulative amends are atomic: amend 2 → 4, then amend 4 → 3, then amend 3 → 5. Final `shop.ratingAvg` reflects 5 (or weighted by other ratings). No intermediate stale state visible to customer between amends.
12. **Cloud Run IAM** verify on `respondToReview` AND `amendRating`. Re-bind `allUsers` if `etag: ACAB`.
13. `tsc` + tests clean. Suite +19 minimum.
14. **Deliberate-break demo (auth):** revert §A's helper call back to the inline `where(ownerUid).limit(1)` pattern. The `validateShopOwnerForReview` integration test must fail AND the static guard test must fail. Restore. All tests pass.
15. **Deliberate-break demo (amend):** revert §H.1's recompute block back to outside the transaction (in `amendRating`). Concurrent amend + submitOrderRating against the same shop → eventual `shop.ratingAvg` differs from expected by > 0.01 → the `_publishReview` integration test for amend atomicity must fail. Restore. Tests pass.

## Out of scope

- **Extending the dashboard's other 4 cards** (Active / Available / Coming Up / History) to dedicated screens. Pilot scale doesn't need this; the section-toggle behavior works inline. Future PR if Sudhir wants symmetric UX.
- **Pagination on AttentionQueueScreen.** Pilot has at most a handful of flagged_low orders per role; 50-row callable cap from Bundle I is plenty.
- **Real-time watch** on the attention queue. Pull-to-refresh + useFocusEffect re-fetch is sufficient.
- **Customer-side equivalent.** Customer has Bundle H's OrderDetail panel already.
- **Replacing the inline Reviews & Ratings section on the dashboard.** Leave it — the section provides at-a-glance summary while AttentionQueueScreen is the deep-dive surface. Two-tier UX is intentional.

## Deploy

```
cd functions; npm run build; cd ..
firebase deploy --only "functions:respondToReview,functions:amendRating"

foreach ($svc in 'respondtoreview','amendrating') {
  gcloud run services get-iam-policy $svc --region=asia-south1 --project=grocery-mvp-dev
}
# If etag: ACAB, re-bind:
# gcloud run services add-iam-policy-binding <svc> --region=asia-south1 --member=allUsers --role=roles/run.invoker --project=grocery-mvp-dev

eas update --branch production --message "HOTFIX-RESPOND-OWNER-AND-CARD-NAV-AND-AMEND — owner check + AttentionQueueScreen + amend atomicity"
```

## Doc trail (Cowork)

After ship:

- **TESTING-FINDINGS** — close shop-owner respond error + dashboard card no-op + amend display stale.
- **CLAUDE.md** In-flight strike.
- **SESSION_LOG** paragraph capturing: auth-pattern bugs come in TWO classes (shape + direction); denorm cascade discipline (Rule 5 #11) extended by amend atomicity work; static guards now cover four bug classes via separate audits.
- **PROMPT_AUTHORING_NOTES** — add **Rule 5 worked example #10** (auth pattern direction bugs vs shape bugs — separate audits). Add **Rule 5 worked example #11** (denormalization recompute belongs in the same transaction that triggers the state change — amendRating's outside-tx ratingAvg recompute was the worked example, now consolidated into _publishReview alongside the existing publicReviewCount/publicReviewLatest writes).
- **FEATURES.md** (per Rule 8 — mandatory):
  - **Delivery panel §3.3 Home / dashboard** — edit Bundle I's "Reviews & Ratings section" row to add `"; tap dashboard card opens dedicated AttentionQueueScreen with focused flagged_low list"`. Lineage HTML comment.
  - **Shop panel §2.2 Order management** — same edit on the shop equivalent.
  - **Shop panel §2.5 Reviews** — edit "Respond to low rating" row: lineage HTML comment `<!-- HOTFIX-RESPOND-OWNER 2026-06-10 — shop-id ownership check pattern fix -->`.
  - **Customer panel §1.9 Ratings & reviews** — edit "Low-rating correction workflow" row: append `"; amend recomputes shop.ratingAvg + partner.deliveryRatingAvg atomically in same publish transaction"`. Lineage HTML comment `<!-- HOTFIX-AMEND-RECOMPUTE 2026-06-10 -->`.
  - **Delivery panel §3.8 Reviews** — no row change.
  - **Last updated** stamps on Delivery §3.3, §3.8, Shop §2.2, §2.5, Customer §1.9 → 2026-06-10.
- **Static guard inventory** now: 4 permanent guards (authClaimNames + noStaleDeferralComments + transactionReadOrder + shopOwnerCheck). The HOTFIX-AMEND-RECOMPUTE fix is structurally protected by the existing `transactionReadOrderAudit` since it consolidates writes into the existing transaction — no new guard needed.
