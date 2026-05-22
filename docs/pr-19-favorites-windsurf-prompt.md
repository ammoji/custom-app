# PR 19 — Shopping list / Favorites (Windsurf prompt)

## Why this PR exists

Kirana customers shop in patterns. They have **the same atta brand,
the same dal, the same milk every week**. PR 13 made "repeat the
whole last order" possible. PR 14 made "reorder from my usual shop"
discoverable on Home. PR 19 closes the third behavioral loop:
**"these specific items are my essentials — let me grab them
quickly without rebuilding the cart."**

Industry alignment: every major Indian grocery app (Zepto, BlinkIt,
Swiggy Instamart, Zomato grocery) has a heart icon on items. The
gesture is muscle memory. Not having it makes your app feel less
polished than what users compare against.

UX target:

1. Customer on shop menu → taps heart on atta → it's saved
2. Next week, customer opens app → Home shows "❤ 8 favorites" tile
3. Customer taps tile → FavoritesScreen lists their items grouped by
   shop, with current prices + +/- to add to cart
4. One-tap-per-item to refill the cart with their essentials

Server change: small additive field on UserProfile. New callable for
toggling. **Server-first rollout** (new client + old server would
fail because the callable doesn't exist yet — same discipline as
PR 12).

~3–4 hours.

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md`.
- `src/types/index.ts` — `UserProfile` type. We're adding one
  optional field.
- `functions/src/profileHelpers.ts` — pattern for pure helpers used
  by profile callables. Mirror the posture for the new toggle helper.
- `functions/src/index.ts` — `getMyProfile`, `saveAddress`, etc.
  patterns for callables that read + update the profile doc. The
  new `toggleFavorite` callable follows the same shape.
- `src/services/profileService.ts` — Platform-dispatch wrapper for
  profile callables. New `toggleFavorite` method goes here.
- `src/store/useAuthStore.ts` — `UserProfile` is loaded into auth
  state. The favorites map lives in the same state slice.
- `src/screens/ShopDetailScreen.tsx` — the menu list with `+/-`
  buttons. The heart icon goes next to each menu item.
- `src/screens/HomeScreen.tsx` — add the "❤ N favorites" indicator
  tile (gated on having any favorites). PR 14/15/17 set the pattern
  for hoisting state at the top.
- `src/services/orderService.ts` — `listShopMenuPublic` returns a
  shop's current menu. Used by `FavoritesScreen` to fetch live
  prices + availability per shop.
- Reference modal pattern: `src/components/order/ReorderModal.tsx`
  (PR 13). FavoritesScreen is structurally similar (list of items
  with per-line +/- and price display).

## Critical lessons from PRs 12–18 (do not repeat)

1. **All `useState` calls in screens sit ABOVE conditional early
   returns.** HomeScreen, ShopDetailScreen, the new FavoritesScreen
   all need the same hoisting discipline. Comment block cites the
   full PR 12 → PR 18 lineage.
2. **Breaking server-side changes deploy server-first.** PR 12
   taught us this hard. PR 19's `toggleFavorite` callable is a new
   surface — server MUST be deployed before client OTA, otherwise
   client gets "function not found" on every heart tap.
3. **Zero new `DO NOT REMOVE` markers expected.** 8 PRs clean. Keep
   the streak.

## Scope (in)

### Part 1 — Schema additive change

In `src/types/index.ts`, extend `UserProfile`:

```ts
export type UserProfile = {
  // ...existing fields
  // PR 19 — Per-shop favorites. Map of shopId → array of
  // menuItemIds the customer has favorited at that shop. Missing
  // key = no favorites at that shop. Empty array means "all were
  // unfavorited, key cleared on next write."
  //
  // Why per-shop instead of flat: a customer might favorite "Tata
  // Sampann atta 5kg" at Mahesh Kirana. If Mahesh stops carrying
  // it, the favorite is gone. But the customer's separate favorite
  // for "Aashirvaad atta 5kg" at Test Kirana 2 keeps working.
  // Per-shop scoping makes this natural.
  favorites?: Record<string, string[]>;
};
```

Mirror this on the server-side type if there's a duplicated
`UserProfile` in `functions/src/`.

No Firestore rule change needed — existing /users/{uid} rules
already allow the owner to read/write their own profile.

### Part 2 — Pure helper for toggle logic

New file `functions/src/favoritesHelpers.ts`:

```ts
/**
 * PR 19 — pure helpers for favorites management.
 *
 * Why pure: the toggle logic (add if missing, remove if present,
 * clean up empty arrays) is gnarly enough to deserve dedicated tests.
 * Mirror posture of cancelPaidOrderHelpers + auditLogHelpers — pure
 * helpers tested without firebase-admin, then wired into the callable.
 *
 * Pinned by tests/functions/favoritesHelpers.test.ts.
 */

export type ToggleFavoriteInput = {
  shopId: unknown;
  menuItemId: unknown;
};

export type ToggleFavoriteResult =
  | { ok: true; shopId: string; menuItemId: string }
  | {
      ok: false;
      code: 'unauthenticated' | 'invalid-argument';
      message: string;
    };

export function validateToggleFavoriteInput(
  auth: { uid: string } | null | undefined,
  input: ToggleFavoriteInput,
): ToggleFavoriteResult {
  if (!auth?.uid) {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    };
  }
  if (typeof input.shopId !== 'string' || input.shopId.length === 0) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'shopId required (non-empty string)',
    };
  }
  if (
    typeof input.menuItemId !== 'string' ||
    input.menuItemId.length === 0
  ) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'menuItemId required (non-empty string)',
    };
  }
  return { ok: true, shopId: input.shopId, menuItemId: input.menuItemId };
}

/**
 * Apply a toggle to a favorites map. Returns the NEW map (immutable);
 * the caller writes it back to the profile doc.
 *
 * Rules:
 * - If menuItemId is NOT in favorites[shopId] → add it (creates the
 *   array if shopId key doesn't exist).
 * - If menuItemId IS in favorites[shopId] → remove it.
 * - If removing makes favorites[shopId] empty → delete the shopId
 *   key entirely (keeps the map clean; saves Firestore index work).
 *
 * Returns: { favorites, isFavorite } — the new map AND whether the
 * item is now favorited (so the client can confirm the UI state).
 */
export function applyFavoriteToggle(
  currentFavorites: Record<string, string[]> | undefined,
  shopId: string,
  menuItemId: string,
): { favorites: Record<string, string[]>; isFavorite: boolean } {
  const current = { ...(currentFavorites ?? {}) };
  const shopFavorites = current[shopId] ?? [];
  const existingIndex = shopFavorites.indexOf(menuItemId);

  if (existingIndex >= 0) {
    // Remove.
    const next = shopFavorites.filter(id => id !== menuItemId);
    if (next.length === 0) {
      delete current[shopId];
    } else {
      current[shopId] = next;
    }
    return { favorites: current, isFavorite: false };
  } else {
    // Add.
    current[shopId] = [...shopFavorites, menuItemId];
    return { favorites: current, isFavorite: true };
  }
}
```

### Part 3 — Tests for the helper

New file `tests/functions/favoritesHelpers.test.ts`:

```ts
import { describe, it, expect } from '@jest/globals';
import {
  validateToggleFavoriteInput,
  applyFavoriteToggle,
} from '../../functions/src/favoritesHelpers';

describe('validateToggleFavoriteInput', () => {
  it('rejects unauthenticated callers', () => {
    const r = validateToggleFavoriteInput(null, {
      shopId: 'shop_1',
      menuItemId: 'm_1',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  it('rejects missing shopId', () => {
    const r = validateToggleFavoriteInput(
      { uid: 'u1' },
      { shopId: '', menuItemId: 'm_1' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('rejects non-string menuItemId', () => {
    const r = validateToggleFavoriteInput(
      { uid: 'u1' },
      { shopId: 'shop_1', menuItemId: 42 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  it('returns ok with valid input', () => {
    const r = validateToggleFavoriteInput(
      { uid: 'u1' },
      { shopId: 'shop_1', menuItemId: 'm_1' },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.shopId).toBe('shop_1');
      expect(r.menuItemId).toBe('m_1');
    }
  });
});

describe('applyFavoriteToggle', () => {
  it('adds first favorite to empty map', () => {
    const result = applyFavoriteToggle(undefined, 'shop_1', 'm_1');
    expect(result.isFavorite).toBe(true);
    expect(result.favorites).toEqual({ shop_1: ['m_1'] });
  });

  it('adds favorite to existing shop array', () => {
    const result = applyFavoriteToggle({ shop_1: ['m_1'] }, 'shop_1', 'm_2');
    expect(result.isFavorite).toBe(true);
    expect(result.favorites).toEqual({ shop_1: ['m_1', 'm_2'] });
  });

  it('removes favorite from existing array', () => {
    const result = applyFavoriteToggle(
      { shop_1: ['m_1', 'm_2'] },
      'shop_1',
      'm_1',
    );
    expect(result.isFavorite).toBe(false);
    expect(result.favorites).toEqual({ shop_1: ['m_2'] });
  });

  it('deletes shop key when removing the last favorite', () => {
    const result = applyFavoriteToggle({ shop_1: ['m_1'] }, 'shop_1', 'm_1');
    expect(result.isFavorite).toBe(false);
    expect(result.favorites).toEqual({});
    expect(result.favorites.shop_1).toBeUndefined();
  });

  it('does not mutate input map', () => {
    const input = { shop_1: ['m_1'] };
    applyFavoriteToggle(input, 'shop_1', 'm_2');
    expect(input).toEqual({ shop_1: ['m_1'] }); // unchanged
  });

  it('handles multiple shops independently', () => {
    const result = applyFavoriteToggle(
      { shop_1: ['m_1'], shop_2: ['m_a'] },
      'shop_2',
      'm_b',
    );
    expect(result.favorites).toEqual({
      shop_1: ['m_1'],
      shop_2: ['m_a', 'm_b'],
    });
  });
});
```

### Part 4 — `toggleFavorite` callable

Add to `functions/src/index.ts`:

```ts
// PR 19 — DO NOT REMOVE (auto-formatter risk per code-discipline.md).
// Used by the toggleFavorite callable below.
import {
  applyFavoriteToggle,
  validateToggleFavoriteInput,
} from './favoritesHelpers';
```

Callable (place near saveAddress / getMyProfile):

```ts
export const toggleFavorite = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    const check = validateToggleFavoriteInput(
      auth ? { uid: auth.uid } : null,
      request.data ?? {},
    );
    if (!check.ok) {
      throw new HttpsError(check.code, check.message);
    }
    const { shopId, menuItemId } = check;

    const userRef = db.doc(`users/${auth!.uid}`);
    const snap = await userRef.get();
    const profile = snap.exists ? (snap.data() as any) : {};
    const currentFavorites = profile.favorites as
      | Record<string, string[]>
      | undefined;

    const { favorites, isFavorite } = applyFavoriteToggle(
      currentFavorites,
      shopId,
      menuItemId,
    );

    await userRef.set(
      { favorites, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    return {
      profile: { ...profile, favorites },
      isFavorite,
    };
  },
);
```

Note: this callable doesn't validate that the menuItemId actually
exists in the shop's menu. That's a deliberate choice — if a shop
removes an item, the customer's favorite for it should silently
become "unavailable" on the FavoritesScreen (handled in Part 7),
not throw at toggle time. Cheaper, simpler, more forgiving UX.

### Part 5 — Client: profileService method + auth store integration

In `src/services/profileService.ts`, add the dispatcher:

```ts
async toggleFavorite(input: {
  shopId: string;
  menuItemId: string;
}): Promise<{ profile: UserProfile; isFavorite: boolean }> {
  if (isNative) {
    const fn = getNativeFunctions().httpsCallable('toggleFavorite');
    const result = await fn(input);
    return result.data as { profile: UserProfile; isFavorite: boolean };
  }
  const fn = httpsCallable(functions, 'toggleFavorite');
  const result = await fn(input);
  return result.data as { profile: UserProfile; isFavorite: boolean };
},
```

In `src/store/useAuthStore.ts`, the existing profile state already
holds a `UserProfile`. Add a derived selector:

```ts
// PR 19 — convenience for components that just want to know if a
// specific item is favorited without unpacking the map themselves.
isFavorite: (shopId: string, menuItemId: string): boolean => {
  const fav = get().profile?.favorites;
  return !!fav?.[shopId]?.includes(menuItemId);
},
```

And a setter for optimistic updates:

```ts
setProfile: (profile: UserProfile) => set({ profile }),
```

(May already exist — verify and reuse.)

### Part 6 — Heart icon component

New file `src/components/common/FavoriteHeart.tsx`:

```tsx
import React, { useState } from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useAuthStore } from '../../store/useAuthStore';
import { profileService } from '../../services/profileService';
import { colors } from '../../constants/theme';

type Props = {
  shopId: string;
  menuItemId: string;
  size?: number;
};

export default function FavoriteHeart({ shopId, menuItemId, size = 24 }: Props) {
  const isFavorite = useAuthStore(s =>
    !!s.profile?.favorites?.[shopId]?.includes(menuItemId),
  );
  const setProfile = useAuthStore(s => s.setProfile);
  const profile = useAuthStore(s => s.profile);
  const [busy, setBusy] = useState(false);

  const onPress = async () => {
    if (busy || !profile) return;
    setBusy(true);
    // Optimistic toggle so the heart flips instantly.
    const currentFav = profile.favorites ?? {};
    const shopFav = currentFav[shopId] ?? [];
    const newFav = { ...currentFav };
    if (isFavorite) {
      const next = shopFav.filter(id => id !== menuItemId);
      if (next.length === 0) delete newFav[shopId];
      else newFav[shopId] = next;
    } else {
      newFav[shopId] = [...shopFav, menuItemId];
    }
    setProfile({ ...profile, favorites: newFav });
    try {
      const result = await profileService.toggleFavorite({
        shopId,
        menuItemId,
      });
      // Reconcile with server's truth.
      setProfile(result.profile);
    } catch (err) {
      // Roll back to pre-toggle state.
      setProfile(profile);
      console.warn('[FavoriteHeart] toggle failed:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      accessibilityState={{ selected: isFavorite, busy }}
      style={styles.button}
    >
      <Text style={[styles.icon, { fontSize: size }, isFavorite && styles.filled]}>
        {isFavorite ? '❤️' : '🤍'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { padding: 4 },
  icon: { lineHeight: 28 },
  filled: { color: colors.danger },
});
```

The emoji approach (`❤️` / `🤍`) avoids needing an icon library.
If your project already has a vector-icons setup (lucide-react,
expo-vector-icons, etc.), prefer that for crispness — adapt
accordingly.

### Part 7 — Integrate heart icon on ShopDetailScreen

In `src/screens/ShopDetailScreen.tsx`, find the menu item row render.
Each item already shows name, price, pack, +/- buttons. Add the
heart icon to the right of the price (or wherever fits the existing
layout):

```tsx
import FavoriteHeart from '../components/common/FavoriteHeart';
// ...
// In the menu item row JSX, near the price/quantity controls:
<FavoriteHeart shopId={shop.id} menuItemId={item.id} />
```

Visible regardless of cart state. Anonymous users see the heart but
tapping it should silently no-op (or show a "Sign in to save
favorites" alert — check existing patterns for anon-user actions
and mirror them).

### Part 8 — Home indicator tile

In `src/screens/HomeScreen.tsx`, add a derived count:

```tsx
// PR 19 — total favorite count across all shops. Used to decide
// whether to render the tile + as the badge value.
const favoritesCount = useAuthStore(s => {
  const fav = s.profile?.favorites;
  if (!fav) return 0;
  return Object.values(fav).reduce((sum, ids) => sum + ids.length, 0);
});
```

Render the tile only when count > 0, in the "Become more" or "Your
Roles" section vicinity:

```tsx
{favoritesCount > 0 && (
  <Pressable
    style={styles.favoritesTile}
    onPress={() => nav.navigate('Favorites')}
    accessibilityRole="button"
    accessibilityLabel={`Open ${favoritesCount} favorites`}
  >
    <Text style={styles.favoritesText}>
      ❤️  {favoritesCount} {favoritesCount === 1 ? 'favorite' : 'favorites'}
    </Text>
    <Text style={styles.favoritesChevron}>›</Text>
  </Pressable>
)}
```

### Part 9 — FavoritesScreen

New file `src/screens/FavoritesScreen.tsx`:

State + effect: read `profile.favorites` from useAuthStore. For each
shopId in the map, fetch that shop's current menu via
`orderService.listShopMenuPublic(shopId)`. Render the favorited
items grouped by shop with current prices + availability + +/-
buttons.

Render shape:

```
[Shop A — Mahesh Kirana]
  ❤️ Tata Sampann atta 5kg · ₹275 · [+ -]
  ❤️ Amul milk 1L · ₹62 · [+ -]
  ❤️ Britannia bread · Out of stock

[Shop B — Test Kirana 2]
  ❤️ Aashirvaad atta 5kg · ₹290 · [+ -]
```

Each item's heart can be tapped to unfavorite (uses the same
`FavoriteHeart` component, which auto-updates the list when the
underlying state changes).

The `+/-` uses existing `useCartStore.addMenuItem` (handles the
multi-shop cart blocker automatically — adding from a second shop
shows the existing "Replace cart?" prompt).

For items that no longer exist in the current menu (shop removed
them), show them dimmed with "No longer available" + a small Remove
button that unfavorites them. Keeps the map clean.

For shops that no longer exist (admin suspended them), gracefully
show "[Shop name] is no longer available" + bulk Remove favorites
from this shop button.

Wire into navigation: `src/navigation/AppNavigator.tsx` gets a new
Stack.Screen entry:

```tsx
<Stack.Screen name="Favorites" component={FavoritesScreen} />
```

And in the RootStackParamList type:

```ts
Favorites: undefined;
```

### Part 10 — Anonymous user handling

If anonymous user taps a heart icon on ShopDetailScreen, the
optimistic update tries to write to a profile that doesn't exist
server-side. Two paths:

**Option A (preferred):** silently no-op on tap, OR show an Alert
"Sign in to save favorites" with a Sign in CTA.

**Option B:** allow optimistic favorite locally, but don't persist
until they sign in.

Pick Option A for MVP simplicity. Implementation: in the
`FavoriteHeart` `onPress`, check `useAuthStore.isAnonymous` early
and either skip silently or show the alert.

## Scope (out)

- **Bulk "Add all favorites from this shop to cart" button.** Future
  PR if customers ask. Single-item +/- is enough for MVP.
- **Reordering favorites manually** (drag to reorder). Default
  ordering (most-recently-added first) is fine.
- **Multiple named lists** ("Weekly groceries", "Office snacks").
  Distinct feature; the favorites map structure could be extended
  to support it in a future PR.
- **Sharing favorites with family members.** Out of scope.
- **Push notification "We have your favorite atta back in stock"**.
  Needs push infrastructure not yet built.
- **Favorites on HomeScreen showing actual items** (not just a
  count). Defer to a follow-up; the count tile + tap-through to
  FavoritesScreen is the MVP path.

## Acceptance checklist

- [ ] `UserProfile` type extended with `favorites?: Record<string, string[]>`.
- [ ] `functions/src/favoritesHelpers.ts` created with
  `validateToggleFavoriteInput` + `applyFavoriteToggle` exports.
- [ ] `tests/functions/favoritesHelpers.test.ts` covers ≥10 cases
  (4 validation + 6 toggle); all pass.
- [ ] `toggleFavorite` callable in `functions/src/index.ts` uses the
  helpers + writes to `users/{uid}` with merge.
- [ ] `profileService.toggleFavorite` dispatcher added (native + web).
- [ ] `useAuthStore` exposes an `isFavorite(shopId, menuItemId)`
  selector and a `setProfile` setter.
- [ ] `FavoriteHeart` component renders, toggles optimistically,
  rolls back on failure.
- [ ] Heart icon visible on every menu item in `ShopDetailScreen`.
- [ ] Anonymous users see the heart but tapping it either no-ops
  with an Alert OR is hidden entirely — pick one and document.
- [ ] HomeScreen shows "❤️ N favorites" tile only when `favoritesCount > 0`.
  Hoisted with PR 12–18 Rules-of-Hooks comment lineage.
- [ ] `FavoritesScreen.tsx` created, renders items grouped by shop
  with current prices + availability badges + +/- buttons.
- [ ] FavoritesScreen handles missing items (no longer in menu) +
  missing shops (suspended) gracefully.
- [ ] Navigation wired: `Stack.Screen name="Favorites"` in
  `AppNavigator.tsx` + type added to `RootStackParamList`.
- [ ] `npx tsc --noEmit`: 0 errors (root + functions).
- [ ] `npm test`: all existing tests pass + the 10+ new helper tests.
- [ ] `npm run audit` passes.
- [ ] Deliberate-break demo: change the "deletes shop key when
  removing the last favorite" test to expect a non-empty map,
  confirm red, revert.
- [ ] **Zero new `DO NOT REMOVE` markers added** (9-PR streak).

## Smoke tests (manual, after staged deploy)

1. **Heart visible, tap to favorite** — open ShopDetailScreen, tap
   the heart on atta. Heart turns red immediately. Reload — still
   red (persisted server-side).
2. **Tap again to unfavorite** — heart flips back to outline. Reload
   confirms.
3. **Home tile appears** — after favoriting at least one item, Home
   shows "❤️ N favorites" tile. Tap → FavoritesScreen opens.
4. **FavoritesScreen lists items grouped by shop** — verify each
   shop section, current prices, +/- buttons. Tap + on an item →
   added to cart.
5. **Multi-shop cart blocker still works** — favorite items from
   Shop A and Shop B. Add from Shop A → cart has it. From
   FavoritesScreen tap + on Shop B item → "Replace cart?" prompt
   (existing PR 4 behavior).
6. **Unavailable item handling** — as shop owner, mark a favorited
   item unavailable. As customer, open FavoritesScreen → item shows
   "Out of stock" badge, + button disabled.
7. **Removed-from-menu handling** — as shop owner, delete a
   favorited item. As customer, FavoritesScreen → item shows "No
   longer available" + small Remove button. Tap Remove → unfavorited.
8. **Anonymous user** — sign out. Open a shop, try to tap heart.
   Either nothing happens OR alert prompts to sign in. No crash.
9. **No screen crashes** (ErrorBoundary check) — visit each modified
   screen, force-close + reopen, repeat several times.

## Deploy plan

Server-first rollout (lessons from PR 12). Per
`.windsurf/deploy-discipline.md`: one `--only` per command.

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Server first — toggleFavorite callable must exist before any
#    client OTA goes out, or every heart tap returns "function not found".
cd functions
npm run build
cd ..
firebase deploy --only functions --project grocery-mvp-dev

# 2. Verify
firebase functions:list --project grocery-mvp-dev
# Look for toggleFavorite in the list.

# 3. Smoke test the server (optional but recommended):
#    sign in as admin, navigate to a shop, manually test the helper
#    via Firebase console + curl.

# 4. Client OTA
npm test
eas update --branch production --message "PR 19 — Favorites + Shopping list"

# 5. Tell testers: force-close + reopen TestFlight.
```

Rollback plan if server breaks: `git revert` the callable +
favoritesHelpers commits + redeploy functions. Client rollback:
`eas update --branch production --republish --group <prev-group-id>`.

**Order matters:** server before client. If you skip the server
deploy and OTA the client, every heart tap on the new client will
error out.

## Estimated time

~3.5–4 hours Windsurf work:

- Part 1 (schema): 5 min
- Part 2 (helper): 20 min
- Part 3 (tests): 30 min — 10 cases
- Part 4 (callable): 20 min
- Part 5 (profileService + store): 25 min
- Part 6 (heart component): 30 min
- Part 7 (ShopDetailScreen integration): 20 min
- Part 8 (Home tile): 20 min
- Part 9 (FavoritesScreen): 60–90 min — the biggest single piece,
  with shop-grouping + availability badges + cart wiring
- Part 10 (anon handling): 10 min
- Smoke + deliberate-break: 30 min

## Why this PR matters

Three behavioral loops, three PRs:

| Pattern | UX surface | PR |
|---|---|---|
| "Reorder my whole last cart" | Button on past orders | PR 13 |
| "Reorder from my usual shop" | Rail on Home | PR 14 |
| "These specific items are my essentials" | Heart icon + Favorites screen | PR 19 |

After PR 19 lands, the customer side of the app handles all three
common kirana shopping patterns. The cart-creation primitive
(`replaceCartWithItems` from PR 13) has now been composed across
three distinct features.

The metric to watch from family testing: **% of cart-add events
that originate from a favorite tap** (vs. fresh-browse +/-).
Industry numbers from Zepto/BlinkIt suggest 35–45% within 4 weeks
of consistent customer use. Below 15% = customers aren't
discovering favorites. Above 50% = customers have settled into
their routine, which is the goal.
