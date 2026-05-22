/**
 * Client-side dispatch for the 5 profile / saved-address callables.
 *
 * All five are auth-required (no anon path), so unlike shopService
 * there's no Web SDK Firestore-read fallback — both web and native
 * call into the same Cloud Functions, the only difference is which
 * SDK package speaks to the callable layer:
 *   - native: @react-native-firebase/functions in asia-south1
 *   - web:    firebase/functions (the `functions` instance from
 *             services/firebase.ts is already pinned to asia-south1)
 *
 * The dispatch pattern mirrors orderService exactly. See the comment
 * block on orderService.placeOrder if you're confused why we don't
 * just always use the web SDK on native — short version: web SDK auth
 * state doesn't propagate to Cloud Functions on native, so anything
 * that needs request.auth.uid (i.e. all five of these) must go
 * through RNFB on native.
 */
import { httpsCallable } from '@firebase/functions';
import { firebase as nativeFirebase } from '@react-native-firebase/app';
import '@react-native-firebase/functions';
import { Platform } from 'react-native';
import type { SavedAddress, UserProfile } from '../types';
import { functions } from './firebase';

const isNative = Platform.OS !== 'web';

function getNativeFunctions() {
  return nativeFirebase.app().functions('asia-south1');
}

// Input shape accepted by saveAddress(). `id` distinguishes update
// (id present + matches) from create (id absent or unknown). The
// six required fields plus optional label/line2 mirror the server
// validator in functions/src/profileHelpers.ts. Keep the two in sync
// when adding fields.
export type SaveAddressInput = {
  id?: string;
  label?: string;
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  pincode: string;
  // PR 22 — optional free-text delivery instructions. Empty /
  // whitespace-only → caller should pass undefined (server treats
  // the field as absent in that case). Cap is 280 chars; server
  // re-validates via normalizeDeliveryInstructions.
  deliveryInstructions?: string;
};

export type ProfilePatch = {
  name?: string | null;
  email?: string | null;
};

// Server returns `{ profile }` for save/delete/setDefault so the
// client can replace its local copy in one round-trip without a
// separate getMyProfile follow-up. saveAddress also returns the new
// `id` for the caller's convenience (e.g. checkout's "save this for
// next time" prompt wants the id immediately to set defaultAddressId).
type SaveAddressResult = { id: string; profile: UserProfile };
type MutationResult = { profile: UserProfile };

export const profileService = {
  async getMyProfile(): Promise<UserProfile> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('getMyProfile');
      const result = await fn();
      return result.data as UserProfile;
    }
    const fn = httpsCallable<unknown, UserProfile>(functions, 'getMyProfile');
    const result = await fn();
    return result.data;
  },

  async updateMyProfile(patch: ProfilePatch): Promise<UserProfile> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('updateMyProfile');
      const result = await fn(patch);
      return result.data as UserProfile;
    }
    const fn = httpsCallable<ProfilePatch, UserProfile>(
      functions,
      'updateMyProfile',
    );
    const result = await fn(patch);
    return result.data;
  },

  async saveAddress(
    input: SaveAddressInput,
  ): Promise<{ id: string; profile: UserProfile }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('saveAddress');
      const result = await fn(input);
      return result.data as SaveAddressResult;
    }
    const fn = httpsCallable<SaveAddressInput, SaveAddressResult>(
      functions,
      'saveAddress',
    );
    const result = await fn(input);
    return result.data;
  },

  async deleteAddress(id: string): Promise<UserProfile> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('deleteAddress');
      const result = await fn({ id });
      return (result.data as MutationResult).profile;
    }
    const fn = httpsCallable<{ id: string }, MutationResult>(
      functions,
      'deleteAddress',
    );
    const result = await fn({ id });
    return result.data.profile;
  },

  async setDefaultAddress(id: string): Promise<UserProfile> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('setDefaultAddress');
      const result = await fn({ id });
      return (result.data as MutationResult).profile;
    }
    const fn = httpsCallable<{ id: string }, MutationResult>(
      functions,
      'setDefaultAddress',
    );
    const result = await fn({ id });
    return result.data.profile;
  },

  // PR 19 — toggle a per-shop menu-item favorite. Returns the fresh
  // profile (same posture as the address mutators) AND the post-
  // toggle isFavorite flag so the caller doesn't have to re-read
  // the map. The pure logic lives server-side in
  // `functions/src/favoritesHelpers.ts`; this is a thin dispatcher.
  async toggleFavorite(input: {
    shopId: string;
    menuItemId: string;
  }): Promise<{ profile: UserProfile; isFavorite: boolean }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('toggleFavorite');
      const result = await fn(input);
      return result.data as { profile: UserProfile; isFavorite: boolean };
    }
    const fn = httpsCallable<
      { shopId: string; menuItemId: string },
      { profile: UserProfile; isFavorite: boolean }
    >(functions, 'toggleFavorite');
    const result = await fn(input);
    return result.data;
  },
};

// Re-exports kept here so callers don't need to dig through types/.
export type { SavedAddress, UserProfile };
