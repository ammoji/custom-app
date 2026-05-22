/**
 * PR 19 — heart-icon toggle for per-shop menu-item favorites.
 *
 * Used in two places at ship time:
 *   - ShopDetailScreen menu rows (next to ADD / +/-).
 *   - FavoritesScreen rows (so customers can unfavorite from the
 *     dedicated screen too).
 *
 * Behaviour:
 *   - Reads `isFavorite` from `useProfileStore` (subscribes — flips
 *     state on remote sync too, e.g. when FavoritesScreen unfavorites
 *     an item that's also visible on a deep-linked ShopDetailScreen).
 *   - On press: optimistic flip via `setProfile(...)`, then call
 *     `profileService.toggleFavorite`, then reconcile with the
 *     server's response. Roll back on failure.
 *   - For anonymous users (no profile doc): show a one-line "Sign
 *     in to save favorites" Alert. Picking Option A from the prompt
 *     §Part 10 — explicit feedback so the user understands why the
 *     tap didn't stick. Choosing the alert over a silent no-op
 *     because empty no-op = "did the app freeze?" anxiety.
 *
 * Emoji approach (`❤️` / `🤍`) avoids pulling in a vector-icons dep.
 * If a future PR adopts lucide / @expo/vector-icons project-wide,
 * swap the Text glyph for the corresponding component.
 */
import React, { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { profileService } from '../../services/profileService';
import { useAuthStore } from '../../store/useAuthStore';
import { useProfileStore } from '../../store/useProfileStore';

type Props = {
  shopId: string;
  menuItemId: string;
  size?: number;
};

function showAnonAlert() {
  const title = 'Sign in to save favorites';
  const message =
    'Create or sign in to your account to keep a shopping list across visits.';
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // eslint-disable-next-line no-alert
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

export default function FavoriteHeart({
  shopId,
  menuItemId,
  size = 22,
}: Props) {
  const isAnonymous = useAuthStore(s => s.isAnonymous);
  const uid = useAuthStore(s => s.uid);
  const profile = useProfileStore(s => s.profile);
  const setProfile = useProfileStore(s => s.setProfile);
  const isFavorite = useProfileStore(
    s => !!s.profile?.favorites?.[shopId]?.includes(menuItemId),
  );
  const [busy, setBusy] = useState(false);

  const onPress = async () => {
    if (busy) return;
    // Anonymous (or no uid yet) → can't write a profile doc.
    if (!uid || isAnonymous) {
      showAnonAlert();
      return;
    }

    setBusy(true);
    // Compute the optimistic next map locally so the heart flips
    // instantly. Mirrors the pure helper's logic — see
    // `functions/src/favoritesHelpers.ts:applyFavoriteToggle`.
    const baseline = profile;
    const currentMap = baseline?.favorites ?? {};
    const shopArr = currentMap[shopId] ?? [];
    const nextMap: Record<string, string[]> = { ...currentMap };
    if (isFavorite) {
      const next = shopArr.filter(id => id !== menuItemId);
      if (next.length === 0) delete nextMap[shopId];
      else nextMap[shopId] = next;
    } else {
      nextMap[shopId] = [...shopArr, menuItemId];
    }

    if (baseline) {
      setProfile({ ...baseline, favorites: nextMap });
    }

    try {
      const result = await profileService.toggleFavorite({
        shopId,
        menuItemId,
      });
      // Reconcile with server's authoritative shape.
      setProfile(result.profile);
    } catch (err) {
      console.warn('[FavoriteHeart] toggle failed:', err);
      // Roll back to the pre-toggle baseline so the heart re-flips
      // and the customer doesn't see a phantom "favorited" state
      // they'll lose on next refresh.
      if (baseline) setProfile(baseline);
      Alert.alert(
        'Could not save favorite',
        'Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={
        isFavorite ? 'Remove from favorites' : 'Add to favorites'
      }
      accessibilityState={{ selected: isFavorite, busy }}
      style={styles.button}
    >
      <Text style={[styles.icon, { fontSize: size }]}>
        {isFavorite ? '❤️' : '🤍'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { padding: 4 },
  // lineHeight matches the largest expected fontSize so single
  // glyph rows don't get clipped on Android. If you bump `size`
  // above ~28 in a future caller, bump this too.
  icon: { lineHeight: 28 },
});
