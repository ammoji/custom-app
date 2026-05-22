# PR 20 — Customer order rating + Shop ratings (Windsurf prompt)

## Why this PR exists

Kirana customers in India trust the corner shop because they know
the owner. They know who's been there for 20 years, whose dal is
fresh, who'll cheerfully exchange a wrong-size atta pack. **Your
app strips that personal trust signal.** Customers landing on
ShopListScreen see a flat list of shop names with no quality cue.

Industry-standard fix that every food/grocery app uses: **star
ratings + count, denormalized onto shop cards.** A "4.7 ⭐ (200)"
shop carries the same in-app trust that "Mahesh-bhai, family-run
since 2005" carries IRL.

This PR adds:

1. **Rating prompt** on OrderDetail for any `delivered` order the
   customer hasn't rated yet. 1–5 stars + optional comment.
2. **Rolling average + count** denormalized on shop docs.
   Computed incrementally — no re-reading all past ratings.
3. **Star badge** on every shop display surface (browse, search,
   Order Again rail). "No ratings yet" when count is 0.

**Server-first rollout** (schema additive, new callable — same
discipline as PR 12 / PR 19). ~3–4 hours.

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md`.
- `src/types/index.ts` — `Order` and `Shop` types. We're adding
  optional fields to both.
- `functions/src/index.ts` — `cancelMyRecentPaidOrder` (PR 7) is
  the closest pattern: validates auth + reads the order doc + does
  an atomic transaction over two docs. Mirror that posture for
  `submitOrderRating`.
- `functions/src/auditLogHelpers.ts` + `functions/src/customerCancelWindowHelpers.ts`
  — reference for the pure-helper-with-discriminated-union pattern.
- `src/services/orderService.ts` — `retryPayment` is the cleanest
  example of a callable dispatcher returning structured data. Mirror
  that for `submitOrderRating`.
- `src/screens/OrderDetailScreen.tsx` — the rating prompt card slots
  in here for delivered orders. Existing PR 7 cancel-window card +
  recovery-card patterns are the closest visual references.
- `src/screens/ShopListScreen.tsx`, `src/screens/SearchScreen.tsx`
  — the surfaces showing shop cards. The new star badge component
  goes on each.
- `src/components/order/OrderAgainRail.tsx` (PR 14) — also a shop
  card surface (on Home). Same badge integration needed there.

## Critical lessons from PRs 12–19 (do not repeat)

1. **All `useState` calls in screens sit ABOVE conditional early
   returns.** OrderDetailScreen has existing hoisted state; add new
   rating state to the same block. Add PR 20 to the comment lineage.
2. **Server-first deploy ordering** for the new callable. Same
   discipline as PR 12 / PR 19.
3. **Zero new `DO NOT REMOVE` markers expected.** 9 PRs clean.
4. **No new native modules.** All client work uses existing deps.

## Scope (in)

### Part 1 — Schema additive changes

In `src/types/index.ts`, extend two types:

```ts
export type OrderRating = {
  stars: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  ratedAt: number; // epoch ms
};

export type Order = {
  // ...existing fields
  // PR 20 — customer-submitted rating. Set ONCE when the customer
  // rates a delivered order. Updates are NOT allowed in MVP (would
  // require recomputing the shop's rolling average from scratch).
  // Missing field means "not yet rated".
  rating?: OrderRating;
};

export type Shop = {
  // ...existing fields
  // PR 20 — rolling rating statistics. Updated atomically inside
  // submitOrderRating's transaction every time a customer rates an
  // order from this shop. Both fields are 0 / missing for a new
  // shop with no ratings yet.
  ratingAvg?: number;   // 0..5, rounded to 1 decimal place
  ratingCount?: number; // integer
};
```

Mirror on `functions/src/` types if duplicated. No Firestore rule
changes — existing per-order + per-shop rules cover the writes
(server-side admin SDK bypasses rules anyway).

### Part 2 — Pure helpers

New file `functions/src/ratingHelpers.ts`:

```ts
/**
 * PR 20 — pure helpers for order rating submission.
 *
 * Two responsibilities:
 *   1. Validate the submitOrderRating input (auth, shape, order
 *      state, prior rating).
 *   2. Compute the new rolling average for a shop given its current
 *      avg + count + the new stars.
 *
 * Pure — no Firestore, no React, no clock. Pinned by
 * tests/functions/ratingHelpers.test.ts.
 */

const MIN_STARS = 1;
const MAX_STARS = 5;
const MAX_COMMENT_LEN = 500;

export type SubmitRatingInput = {
  auth: { uid: string } | null | undefined;
  order:
    | {
        customerUid?: unknown;
        status?: unknown;
        rating?: unknown;
        shopId?: unknown;
      }
    | null
    | undefined;
  stars: unknown;
  comment: unknown;
};

export type SubmitRatingResult =
  | {
      ok: true;
      uid: string;
      shopId: string;
      stars: 1 | 2 | 3 | 4 | 5;
      comment?: string;
    }
  | {
      ok: false;
      code:
        | 'unauthenticated'
        | 'not-found'
        | 'permission-denied'
        | 'failed-precondition'
        | 'invalid-argument';
      message: string;
    };

export function validateRatingSubmission(
  input: SubmitRatingInput,
): SubmitRatingResult {
  const { auth, order, stars, comment } = input;
  if (!auth?.uid) {
    return { ok: false, code: 'unauthenticated', message: 'Sign in required' };
  }
  if (!order) {
    return { ok: false, code: 'not-found', message: 'Order not found' };
  }
  if (typeof order.customerUid !== 'string' || order.customerUid !== auth.uid) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Only the order customer can rate it',
    };
  }
  if (order.status !== 'delivered') {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Only delivered orders can be rated',
    };
  }
  if (order.rating !== undefined && order.rating !== null) {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'This order has already been rated',
    };
  }
  if (typeof order.shopId !== 'string' || order.shopId.length === 0) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'Order is missing shopId — cannot attribute rating',
    };
  }
  if (
    typeof stars !== 'number' ||
    !Number.isInteger(stars) ||
    stars < MIN_STARS ||
    stars > MAX_STARS
  ) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'stars must be an integer 1-5',
    };
  }
  let cleanComment: string | undefined;
  if (comment !== undefined && comment !== null && comment !== '') {
    if (typeof comment !== 'string') {
      return {
        ok: false,
        code: 'invalid-argument',
        message: 'comment must be a string',
      };
    }
    const trimmed = comment.trim();
    if (trimmed.length > MAX_COMMENT_LEN) {
      return {
        ok: false,
        code: 'invalid-argument',
        message: `comment too long (max ${MAX_COMMENT_LEN} chars)`,
      };
    }
    if (trimmed.length > 0) cleanComment = trimmed;
  }
  return {
    ok: true,
    uid: auth.uid,
    shopId: order.shopId,
    stars: stars as 1 | 2 | 3 | 4 | 5,
    comment: cleanComment,
  };
}

/**
 * Compute the new rolling average given the existing average +
 * count and the new stars value. Returns { newAvg, newCount }.
 *
 * Rounds avg to 1 decimal so customer-facing display stays clean
 * ("4.7" not "4.683333"). Underlying float drift across many
 * ratings is bounded because we always store the rounded value
 * back, so each new computation uses the rounded prior — small
 * error per step, but ratingCount also being tracked means we can
 * recompute exactly from scratch if needed.
 */
export function computeNewRollingAverage(
  currentAvg: number | undefined,
  currentCount: number | undefined,
  newStars: number,
): { newAvg: number; newCount: number } {
  const oldAvg = typeof currentAvg === 'number' && currentAvg >= 0 ? currentAvg : 0;
  const oldCount = typeof currentCount === 'number' && currentCount >= 0
    ? currentCount
    : 0;
  const newCount = oldCount + 1;
  const newAvgRaw = (oldAvg * oldCount + newStars) / newCount;
  const newAvg = Math.round(newAvgRaw * 10) / 10; // 1 decimal place
  return { newAvg, newCount };
}
```

### Part 3 — Tests for helpers

New file `tests/functions/ratingHelpers.test.ts`. Cover ≥12 cases:

```ts
import { describe, it, expect } from '@jest/globals';
import {
  validateRatingSubmission,
  computeNewRollingAverage,
} from '../../functions/src/ratingHelpers';

const BASE_ORDER = {
  customerUid: 'u1',
  status: 'delivered',
  shopId: 'shop_1',
};

describe('validateRatingSubmission', () => {
  it('rejects unauthenticated', () => {
    const r = validateRatingSubmission({
      auth: null,
      order: BASE_ORDER,
      stars: 5,
      comment: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  it('rejects missing order (not found)', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: null,
      stars: 5,
      comment: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not-found');
  });

  it('rejects rating an order belonging to a different customer', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u2' },
      order: BASE_ORDER,
      stars: 5,
      comment: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  it('rejects rating a non-delivered order', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: { ...BASE_ORDER, status: 'preparing' },
      stars: 5,
      comment: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('failed-precondition');
  });

  it('rejects re-rating an already-rated order', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: { ...BASE_ORDER, rating: { stars: 4, ratedAt: 1000 } },
      stars: 5,
      comment: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('failed-precondition');
  });

  it('rejects stars below 1', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: BASE_ORDER,
      stars: 0,
      comment: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('rejects stars above 5', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: BASE_ORDER,
      stars: 6,
      comment: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('rejects non-integer stars', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: BASE_ORDER,
      stars: 4.5,
      comment: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('rejects oversized comment', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: BASE_ORDER,
      stars: 5,
      comment: 'x'.repeat(501),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('accepts a clean valid submission with comment', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: BASE_ORDER,
      stars: 5,
      comment: '  Great service  ', // gets trimmed
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.stars).toBe(5);
      expect(r.comment).toBe('Great service');
      expect(r.shopId).toBe('shop_1');
    }
  });

  it('accepts a submission without comment', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: BASE_ORDER,
      stars: 3,
      comment: undefined,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.comment).toBeUndefined();
  });

  it('treats whitespace-only comment as empty (no field stored)', () => {
    const r = validateRatingSubmission({
      auth: { uid: 'u1' },
      order: BASE_ORDER,
      stars: 5,
      comment: '   ',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.comment).toBeUndefined();
  });
});

describe('computeNewRollingAverage', () => {
  it('handles first rating on a fresh shop', () => {
    expect(computeNewRollingAverage(undefined, undefined, 5)).toEqual({
      newAvg: 5,
      newCount: 1,
    });
    expect(computeNewRollingAverage(undefined, undefined, 3)).toEqual({
      newAvg: 3,
      newCount: 1,
    });
  });

  it('rolls a 5-star into an existing 4.0 / 3 ratings shop', () => {
    // (4.0*3 + 5) / 4 = 17/4 = 4.25 → rounds to 4.3
    const r = computeNewRollingAverage(4.0, 3, 5);
    expect(r.newCount).toBe(4);
    expect(r.newAvg).toBe(4.3);
  });

  it('rolls a 1-star into a 5.0 / 10 shop', () => {
    // (5.0*10 + 1) / 11 = 51/11 = 4.636... → rounds to 4.6
    const r = computeNewRollingAverage(5.0, 10, 1);
    expect(r.newCount).toBe(11);
    expect(r.newAvg).toBe(4.6);
  });

  it('treats negative/garbage avg + count as zero', () => {
    expect(computeNewRollingAverage(-1, -5, 5)).toEqual({
      newAvg: 5,
      newCount: 1,
    });
  });
});
```

Run once at end per test-discipline.md.

### Part 4 — `submitOrderRating` callable

Add to `functions/src/index.ts`:

```ts
// PR 20 — DO NOT REMOVE (auto-formatter risk). Used by
// submitOrderRating callable below.
import {
  computeNewRollingAverage,
  validateRatingSubmission,
} from './ratingHelpers';
```

Callable (place near `cancelMyRecentPaidOrder`):

```ts
export const submitOrderRating = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    const { orderId, stars, comment } = (request.data ?? {}) as {
      orderId?: string;
      stars?: number;
      comment?: string;
    };
    if (typeof orderId !== 'string' || orderId.length === 0) {
      throw new HttpsError('invalid-argument', 'orderId required');
    }

    const orderRef = db.doc(`orders/${orderId}`);
    const orderSnap = await orderRef.get();
    const orderData = orderSnap.exists ? (orderSnap.data() as any) : null;

    const check = validateRatingSubmission({
      auth: auth ? { uid: auth.uid } : null,
      order: orderData,
      stars,
      comment,
    });
    if (!check.ok) {
      throw new HttpsError(check.code, check.message);
    }
    const { shopId, stars: validStars, comment: validComment } = check;

    const shopRef = db.doc(`shops/${shopId}`);
    const now = Date.now();

    // Atomic transaction: write the rating onto the order doc AND
    // bump the shop's rolling stats. If either write fails, the
    // whole thing rolls back — no partial state.
    await db.runTransaction(async tx => {
      // Re-read inside the transaction to catch the double-submit
      // race (customer hits Submit twice quickly).
      const orderInTx = await tx.get(orderRef);
      if (!orderInTx.exists) {
        throw new HttpsError('not-found', 'Order vanished mid-rating');
      }
      const orderTxData = orderInTx.data() as any;
      if (orderTxData.rating) {
        throw new HttpsError(
          'failed-precondition',
          'This order has already been rated',
        );
      }
      const shopInTx = await tx.get(shopRef);
      const shopTxData = shopInTx.exists ? (shopInTx.data() as any) : {};

      const { newAvg, newCount } = computeNewRollingAverage(
        shopTxData.ratingAvg,
        shopTxData.ratingCount,
        validStars,
      );

      const ratingPayload: any = { stars: validStars, ratedAt: now };
      if (validComment) ratingPayload.comment = validComment;

      tx.update(orderRef, {
        rating: ratingPayload,
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        shopRef,
        {
          ratingAvg: newAvg,
          ratingCount: newCount,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    // Audit log (non-fatal — PR 8 wrapper pattern).
    await writeAuditLog({
      actorUid: auth!.uid,
      actorRole: 'customer',
      actionType: 'order.rate',
      targetType: 'order',
      targetId: orderId,
      metadata: { shopId, stars: validStars, hasComment: !!validComment },
    }).catch(e =>
      console.warn('[submitOrderRating] writeAuditLog failed:', e),
    );

    return { ok: true, stars: validStars, comment: validComment };
  },
);
```

### Part 5 — Client service dispatcher

In `src/services/orderService.ts`, add:

```ts
async submitOrderRating(input: {
  orderId: string;
  stars: 1 | 2 | 3 | 4 | 5;
  comment?: string;
}): Promise<{ ok: true; stars: number; comment?: string }> {
  if (isNative) {
    const fn = getNativeFunctions().httpsCallable('submitOrderRating');
    const result = await fn(input);
    return result.data as any;
  }
  const fn = httpsCallable(functions, 'submitOrderRating');
  const result = await fn(input);
  return result.data as any;
},
```

### Part 6 — RateOrderCard component

New file `src/components/order/RateOrderCard.tsx`. A card that
appears on OrderDetailScreen for delivered + unrated orders. Star
picker (5 tappable stars), optional comment field, Submit button.

UX:

- Header: "How was your order?"
- 5 outlined stars in a row. Tap a star → that star + all to its
  left turn filled gold (★). Repeated taps adjust selection.
- Optional textarea: "Add a comment (optional)" — max 500 chars,
  shows live counter.
- Submit button — disabled until at least one star is selected.
- On submit: optimistic local update (show "Thanks for rating!"
  + the chosen stars), then call the server.
- On failure: show error inline + re-enable Submit.

```tsx
import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Button from '../common/Button';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { orderService } from '../../services/orderService';

const MAX_COMMENT = 500;

type Props = {
  orderId: string;
  onRated: (stars: 1 | 2 | 3 | 4 | 5, comment?: string) => void;
};

export default function RateOrderCard({ orderId, onRated }: Props) {
  const [stars, setStars] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (stars === 0) return;
    setSubmitting(true);
    try {
      const trimmed = comment.trim();
      await orderService.submitOrderRating({
        orderId,
        stars,
        comment: trimmed || undefined,
      });
      onRated(stars, trimmed || undefined);
    } catch (err: any) {
      Alert.alert(
        'Could not submit rating',
        err?.message ?? 'Please try again in a moment.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>How was your order?</Text>
      <Text style={styles.subtitle}>
        Your rating helps other customers find good shops.
      </Text>
      <View style={styles.starsRow}>
        {[1, 2, 3, 4, 5].map(n => (
          <Pressable
            key={n}
            onPress={() => setStars(n as 1 | 2 | 3 | 4 | 5)}
            accessibilityRole="button"
            accessibilityLabel={`${n} star${n === 1 ? '' : 's'}`}
            accessibilityState={{ selected: stars >= n }}
            hitSlop={6}
            style={styles.starButton}
          >
            <Text style={[styles.star, stars >= n && styles.starFilled]}>
              {stars >= n ? '★' : '☆'}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={comment}
        onChangeText={t => setComment(t.slice(0, MAX_COMMENT))}
        placeholder="Add a comment (optional)"
        placeholderTextColor={colors.textSecondary}
        multiline
        style={styles.comment}
      />
      <Text style={styles.charCount}>
        {comment.length}/{MAX_COMMENT}
      </Text>
      <Button
        title={submitting ? 'Submitting…' : 'Submit rating'}
        onPress={onSubmit}
        disabled={stars === 0 || submitting}
        loading={submitting}
        fullWidth
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { ...typography.h3, marginBottom: spacing.xs },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  starsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  starButton: { padding: 4 },
  star: { fontSize: 40, color: colors.border },
  starFilled: { color: '#F59E0B' /* gold */ },
  comment: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: spacing.sm,
    minHeight: 80,
    textAlignVertical: 'top',
    ...typography.body,
    marginBottom: spacing.xs,
  },
  charCount: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'right',
    marginBottom: spacing.sm,
  },
});
```

### Part 7 — OrderDetailScreen integration

In `src/screens/OrderDetailScreen.tsx`:

**Add state (hoisted at the top, per discipline):**

```tsx
// PR 20 — local optimistic rating state. Once the customer submits
// a rating, we want the UI to flip immediately to "Thanks for
// rating!" without waiting for the watcher tick. The watcher will
// eventually overwrite this with the server's canonical
// order.rating field; both code paths render the same display.
const [optimisticRating, setOptimisticRating] = useState<{
  stars: number;
  comment?: string;
} | null>(null);
```

**Render logic (inside the existing render path, near the bottom
where the cancel/recovery cards live):**

```tsx
{order.status === 'delivered' && !order.rating && !optimisticRating && (
  <RateOrderCard
    orderId={order.id}
    onRated={(stars, comment) => setOptimisticRating({ stars, comment })}
  />
)}
{order.status === 'delivered' && (order.rating || optimisticRating) && (
  <View style={styles.ratedCard}>
    <Text style={styles.ratedTitle}>Thanks for rating!</Text>
    <Text style={styles.ratedStars}>
      {'★'.repeat((order.rating?.stars ?? optimisticRating?.stars) ?? 0)}
      {'☆'.repeat(5 - ((order.rating?.stars ?? optimisticRating?.stars) ?? 0))}
    </Text>
    {(order.rating?.comment ?? optimisticRating?.comment) && (
      <Text style={styles.ratedComment}>
        "{order.rating?.comment ?? optimisticRating?.comment}"
      </Text>
    )}
  </View>
)}
```

Plus minimal styles for `ratedCard`, `ratedTitle`, `ratedStars`,
`ratedComment`.

### Part 8 — ShopRatingBadge component

New file `src/components/shop/ShopRatingBadge.tsx`:

```tsx
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../../constants/theme';

type Props = {
  ratingAvg?: number;
  ratingCount?: number;
  size?: 'sm' | 'md';
};

export default function ShopRatingBadge({
  ratingAvg,
  ratingCount,
  size = 'sm',
}: Props) {
  if (!ratingCount || ratingCount === 0) {
    return <Text style={styles.newShop}>New shop</Text>;
  }
  const avgText = (ratingAvg ?? 0).toFixed(1);
  return (
    <View style={[styles.badge, size === 'md' && styles.badgeMd]}>
      <Text style={[styles.star, size === 'md' && styles.starMd]}>★</Text>
      <Text style={[styles.avg, size === 'md' && styles.avgMd]}>{avgText}</Text>
      <Text style={[styles.count, size === 'md' && styles.countMd]}>
        ({ratingCount})
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeMd: { gap: 6 },
  star: { color: '#F59E0B', fontSize: 12 },
  starMd: { fontSize: 16 },
  avg: { ...typography.caption, fontWeight: '700' },
  avgMd: { ...typography.body, fontWeight: '700' },
  count: { ...typography.caption, color: colors.textSecondary },
  countMd: { ...typography.caption, color: colors.textSecondary },
  newShop: { ...typography.caption, color: colors.textSecondary, fontStyle: 'italic' },
});
```

### Part 9 — Star badge integration on shop displays

Find every place a shop card renders. Likely places:

- `src/screens/ShopListScreen.tsx` — main browse list
- `src/screens/SearchScreen.tsx` — search result rows
- `src/components/order/OrderAgainRail.tsx` — Home rail (add `ratingAvg`
  + `ratingCount` to `FrequentShopEntry` if not already there; populate
  from the cached `recentOrders` shop info)
- `src/screens/ShopDetailScreen.tsx` — header on the shop's own page

In each, import `ShopRatingBadge` and render it where appropriate:

```tsx
<ShopRatingBadge
  ratingAvg={shop.ratingAvg}
  ratingCount={shop.ratingCount}
  size="sm"
/>
```

`size="md"` on the shop's own ShopDetailScreen header (more
prominent). `size="sm"` on list/rail cards.

### Part 10 — Backwards compatibility

Orders without `rating` field render the prompt card (default for
new behavior). Shops without `ratingAvg`/`ratingCount` render "New
shop" badge. No migration needed; both fields are optional.

## Scope (out)

- **Editing or deleting a rating after submission.** MVP is
  submit-once. Avoids rolling-average recompute complexity.
- **Per-item ratings** (rating individual products in an order).
  Future PR — Zomato's "rate each dish" pattern.
- **Separate delivery partner rating.** Single combined rating for
  MVP. Track delivery quality via order status latency instead.
- **Shop owner responses to ratings** ("Thanks for the feedback!").
  Future PR.
- **Hiding or moderating bad ratings as admin.** Audit log captures
  who rated what; admin can manually intervene via Firestore console
  if needed at MVP scale.
- **Showing individual rating comments on shop page.** Just avg +
  count visible for MVP. Detailed reviews page is a follow-up.
- **Rating prompt as push notification or modal interstitial.** The
  card on OrderDetail is enough for now. When push infrastructure
  ships, add a notification trigger.

## Acceptance checklist

- [ ] `Order` type has optional `rating?: OrderRating`.
- [ ] `Shop` type has optional `ratingAvg?: number` + `ratingCount?: number`.
- [ ] `functions/src/ratingHelpers.ts` created with
  `validateRatingSubmission` + `computeNewRollingAverage`.
- [ ] `tests/functions/ratingHelpers.test.ts` covers ≥12 cases.
- [ ] `submitOrderRating` callable in `functions/src/index.ts`:
  uses helpers, atomic transaction, writeAuditLog non-fatal wrapper.
- [ ] `orderService.submitOrderRating` dispatcher added.
- [ ] `RateOrderCard.tsx` component renders + submits + handles errors.
- [ ] OrderDetailScreen renders the card for delivered + unrated
  orders; flips to "Thanks for rating!" after submit (optimistic).
- [ ] OrderDetailScreen does NOT crash if `order.rating` exists
  before screen renders (e.g. user rated, navigated away, came back).
- [ ] `ShopRatingBadge.tsx` component renders avg + count OR
  "New shop".
- [ ] Star badge integrated on: ShopListScreen, SearchScreen,
  OrderAgainRail, ShopDetailScreen.
- [ ] All `useState` calls in OrderDetailScreen sit ABOVE early
  returns. Comment block extended to mention PR 20.
- [ ] `npx tsc --noEmit`: 0 errors (root + functions).
- [ ] `npm test`: existing tests + 12+ new helper tests, all pass.
- [ ] `npm run audit` passes.
- [ ] Deliberate-break: change "rolls a 5-star into existing 4.0 / 3"
  test to expect a different newAvg, confirm red, revert.
- [ ] **Zero new `DO NOT REMOVE` markers added** (10-PR streak).

## Smoke tests (manual, after staged deploy)

1. **Rate a delivered order** — complete an end-to-end order
   through to `delivered`. Open OrderDetail. RateOrderCard visible.
   Tap 5 stars + add comment "Great service" + Submit. Card flips
   to "Thanks for rating! ★★★★★ 'Great service'".
2. **Shop avg updates** — go to ShopListScreen. The shop just
   rated shows "★ 5.0 (1)" badge.
3. **Multiple ratings produce a rolling average** — as a different
   customer (Quick Switch), place + complete + rate the same shop's
   order with 3 stars. Shop card now shows "★ 4.0 (2)" — `(5+3)/2`.
4. **New shop badge** — shop with no ratings yet shows "New shop"
   instead of stars.
5. **Cannot rate non-delivered order** — open a `preparing` or
   `accepted` order. RateOrderCard is NOT visible.
6. **Cannot re-rate** — after submitting a rating, sign out + back
   in, return to OrderDetail. Should still show "Thanks for rating!"
   (server has the rating field set). RateOrderCard is NOT shown.
7. **Star integration on all surfaces** — verify the badge appears
   on Home's Order Again rail card, on Search results, on
   ShopDetailScreen header.
8. **Validation error path** — try to submit without picking a star.
   Submit button disabled. Try with comment > 500 chars. Server
   rejects with clear error.
9. **No screen crashes** (ErrorBoundary check) — visit OrderDetail
   for orders in every status, with + without rating. No hook
   regression.

## Deploy plan

Server-first (PR 12 / PR 19 discipline):

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Server first
cd functions
npm run build
cd ..
firebase deploy --only functions --project grocery-mvp-dev
firebase functions:list --project grocery-mvp-dev
# Look for "submitOrderRating" in the list.

# 2. Client OTA
npm test
eas update --branch production --message "PR 20 — Customer ratings + shop ratings"
```

Tell testers to force-close + reopen TestFlight after publish.

## Estimated time

~3.5–4 hours Windsurf work:

- Part 1 (schema): 5 min
- Part 2 (helpers): 30 min
- Part 3 (tests): 40 min — 12 cases
- Part 4 (callable + transaction): 35 min
- Part 5 (service dispatcher): 10 min
- Part 6 (RateOrderCard component): 50 min — biggest visual piece
- Part 7 (OrderDetailScreen integration): 25 min
- Part 8 (ShopRatingBadge component): 20 min
- Part 9 (badge integration across 4 surfaces): 40 min — mechanical
- Smoke + deliberate-break: 30 min

## Why this PR matters

The trust signal kirana customers lose when they move from "I know
Mahesh-bhai personally" to "I'm browsing an app full of shop names"
gets partially restored. After PR 20, a customer who's unsure which
shop to order from has the same data Swiggy/Zomato have shown them
for years: "4.7 ★ (200)" → trustworthy. "New shop" → take a chance
but informed. "3.2 ★ (50)" → maybe not.

Bonus: top-rated shops bubble up in any future sort/recommend logic
(future PR). The data starts accumulating from today, so by the
time you build that feature, you have real signal to rank against.

The metric to watch from family testing: **% of delivered orders
that get rated**. Industry benchmark: 30–50% for food delivery,
slightly lower for grocery (~25–40%). Below 15% = the prompt is
too easy to skip. Above 60% = unusually engaged tester pool.
