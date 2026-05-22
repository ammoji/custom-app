/**
 * PR 19 — Zustand store for the customer's UserProfile, hydrated by
 * AuthBootstrap on sign-in and kept in sync by mutating callables
 * (`saveAddress`, `toggleFavorite`, …) that return a fresh profile.
 *
 * Why a separate store rather than living on `useAuthStore`:
 *   - useAuthStore is the auth-state slice (uid, claims). Profile is
 *     a different concern with a different lifetime — the AuthUser
 *     can be present (anonymous) without a profile doc, and signing
 *     out should clear the profile independent of the anon
 *     re-bootstrap.
 *   - ProfileScreen (PR 10) keeps its OWN local profile copy via
 *     `useFocusEffect` + `getMyProfile`. That continues to work — it
 *     just doesn't read/write THIS store. Surfaces that need a
 *     globally-readable profile slice (HomeScreen tile, FavoriteHeart,
 *     FavoritesScreen) read from here.
 *
 * Hydration contract:
 *   - AuthBootstrap calls `loadFromServer()` once per real (non-
 *     anonymous) auth state.
 *   - Mutating callables (`profileService.toggleFavorite`) replace
 *     the local copy via `setProfile(result.profile)`.
 *   - Sign-out clears via `setProfile(null)`.
 *
 * Optimistic updates: FavoriteHeart and FavoritesScreen flip the
 * heart instantly, then reconcile with the server's response when
 * the callable resolves. The store's `setProfile` is the single
 * write surface for both.
 */
import { create } from 'zustand';
import { profileService } from '../services/profileService';
import type { UserProfile } from '../types';

type ProfileState = {
  profile: UserProfile | null;
  // Whether the FIRST load has completed — surfaces can use this to
  // decide between rendering a skeleton vs a "no favorites yet"
  // empty state.
  loaded: boolean;
  setProfile: (p: UserProfile | null) => void;
  loadFromServer: () => Promise<void>;
  // Convenience selector. Reads the latest map without subscribing —
  // for components that only need a one-shot read (e.g. inside a
  // useCallback), not a re-render trigger.
  isFavorite: (shopId: string, menuItemId: string) => boolean;
};

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: null,
  loaded: false,
  setProfile: p => set({ profile: p, loaded: true }),
  loadFromServer: async () => {
    try {
      const fresh = await profileService.getMyProfile();
      set({ profile: fresh, loaded: true });
    } catch (err) {
      // Best-effort hydrate — surfaces fall back to "no favorites"
      // state if the load fails. ProfileScreen has its own retry
      // posture; this store doesn't need one.
      console.warn('[useProfileStore] loadFromServer failed:', err);
      set({ loaded: true });
    }
  },
  isFavorite: (shopId, menuItemId) => {
    const fav = get().profile?.favorites;
    return !!fav?.[shopId]?.includes(menuItemId);
  },
}));
