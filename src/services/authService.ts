import nativeAuth, {
    FirebaseAuthTypes,
} from '@react-native-firebase/auth';
import {
    signOut as fbSignOut,
    linkWithCredential,
    onAuthStateChanged,
    PhoneAuthProvider,
    RecaptchaVerifier,
    signInAnonymously,
    signInWithCredential,
    signInWithPhoneNumber,
    User,
    ConfirmationResult as WebConfirmationResult,
} from 'firebase/auth';
import { Platform } from 'react-native';
import { auth } from './firebase';

const isNative = Platform.OS !== 'web';

export type AuthUser = {
  uid: string;
  isAnonymous: boolean;
  phoneNumber: string | null;
  // Multi-role flags from custom claims. Customer is implicit.
  isAdmin: boolean;
  isShopOwner: boolean;
  shopId: string | null; // populated iff isShopOwner is true
  isDelivery: boolean;
};

// Unified ConfirmationResult shape for callers. Both SDKs expose
// .verificationId and .confirm(otp) so callers don't need to branch.
export type ConfirmationResult =
  | WebConfirmationResult
  | FirebaseAuthTypes.ConfirmationResult;

async function toAuthUser(
  user: User | FirebaseAuthTypes.User | null,
  forceRefresh = false,
): Promise<AuthUser | null> {
  if (!user) return null;
  let isAdmin = false;
  let isShopOwner = false;
  let shopId: string | null = null;
  let isDelivery = false;
  try {
    const tokenResult = await user.getIdTokenResult(forceRefresh);
    const claims = tokenResult.claims;
    isAdmin = claims.admin === true;
    isShopOwner = claims.shopOwner === true;
    shopId = typeof claims.shopId === 'string' ? claims.shopId : null;
    isDelivery = claims.delivery === true;
  } catch (err) {
    console.warn('[auth] failed to read custom claims:', err);
  }
  return {
    uid: user.uid,
    isAnonymous: user.isAnonymous,
    phoneNumber: user.phoneNumber,
    isAdmin,
    isShopOwner,
    shopId,
    isDelivery,
  };
}

// Module-level cache for the invisible reCAPTCHA verifier. Re-using one
// instance across attempts avoids reCAPTCHA's "already rendered" error.
let recaptchaVerifier: RecaptchaVerifier | null = null;

function getRecaptchaVerifier(): RecaptchaVerifier {
  if (typeof document === 'undefined') {
    throw new Error(
      'Phone auth via reCAPTCHA is web-only. Native mobile uses Phase 9c.',
    );
  }
  if (recaptchaVerifier) return recaptchaVerifier;
  // The container <div id="recaptcha-container" /> must exist in the DOM
  // (rendered by LoginScreen) before this is called.
  recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
    size: 'invisible',
  });
  return recaptchaVerifier;
}

export const authService = {
  async signInAnonymouslyIfNeeded(): Promise<void> {
    if (isNative) {
      if (nativeAuth().currentUser) return;
      await nativeAuth().signInAnonymously();
      return;
    }
    if (auth.currentUser) return;
    await signInAnonymously(auth);
  },

  async signOut(): Promise<void> {
    if (isNative) {
      await nativeAuth().signOut();
      return;
    }
    await fbSignOut(auth);
  },

  subscribe(cb: (user: AuthUser | null) => void): () => void {
    if (isNative) {
      return nativeAuth().onAuthStateChanged(async user => {
        cb(await toAuthUser(user));
      });
    }
    return onAuthStateChanged(auth, async user => {
      cb(await toAuthUser(user));
    });
  },

  // Force-refresh the ID token and re-read all custom claims. Call this
  // after a role claim (admin, shopOwner, delivery) is set server-side
  // so the client picks it up without requiring sign-out / sign-in.
  async refreshClaims(): Promise<AuthUser | null> {
    if (isNative) {
      return toAuthUser(nativeAuth().currentUser, true);
    }
    return toAuthUser(auth.currentUser, true);
  },

  // Legacy alias retained so existing callers (AuthBootstrap) keep working.
  // Prefer refreshClaims for new code.
  async refreshAdminClaim(): Promise<AuthUser | null> {
    if (isNative) {
      return toAuthUser(nativeAuth().currentUser, true);
    }
    return toAuthUser(auth.currentUser, true);
  },

  // Step 1 of phone auth: trigger SMS.
  // phoneE164 must be in E.164 format e.g. +911234567890.
  // Web uses invisible reCAPTCHA; native uses APNs (iOS) / Play Integrity
  // (Android) silently — no reCAPTCHA on native.
  async startPhoneAuth(phoneE164: string): Promise<ConfirmationResult> {
    if (isNative) {
      return nativeAuth().signInWithPhoneNumber(phoneE164);
    }
    const verifier = getRecaptchaVerifier();
    return signInWithPhoneNumber(auth, phoneE164, verifier);
  },

  // Step 2 of phone auth: verify the OTP.
  // If the current user is anonymous, we LINK the phone credential to
  // the existing anon uid (so cart/orders/admin-claim survive). Otherwise
  // we fall back to a regular sign-in (re-auth or lost anon session).
  //
  // Returns the refreshed AuthUser. NOTE: linkWithCredential mutates
  // auth.currentUser in place but does NOT reliably fire
  // onAuthStateChanged — so the caller must push this result into
  // useAuthStore manually for the upgrade path. Force-refreshing the ID
  // token also re-reads custom claims (admin survives the link).
  async confirmOtp(
    confirmation: ConfirmationResult,
    otp: string,
  ): Promise<AuthUser | null> {
    if (isNative) {
      const nConfirmation =
        confirmation as FirebaseAuthTypes.ConfirmationResult;
      const current = nativeAuth().currentUser;
      if (current && current.isAnonymous && nConfirmation.verificationId) {
        const credential = nativeAuth.PhoneAuthProvider.credential(
          nConfirmation.verificationId,
          otp,
        );
        try {
          await current.linkWithCredential(credential);
        } catch (err: any) {
          if (err?.code === 'auth/credential-already-in-use') {
            await nativeAuth().signInWithCredential(credential);
          } else {
            throw err;
          }
        }
      } else {
        await nConfirmation.confirm(otp);
      }
      return toAuthUser(nativeAuth().currentUser, true);
    }

    const wConfirmation = confirmation as WebConfirmationResult;
    const credential = PhoneAuthProvider.credential(
      wConfirmation.verificationId,
      otp,
    );
    const currentUser = auth.currentUser;
    if (currentUser && currentUser.isAnonymous) {
      try {
        await linkWithCredential(currentUser, credential);
      } catch (err: any) {
        // Phone number is already attached to a different Firebase user
        // (e.g. user previously signed in on another device, or a prior
        // test run linked it to a now-orphaned anon uid). Abandon the
        // current anon session and sign in as the existing phone user.
        // The anon uid's Firestore docs (if any) are orphaned — acceptable
        // because checkout is gated on phone auth, so there shouldn't be
        // any pre-auth orders to lose.
        if (err?.code === 'auth/credential-already-in-use') {
          await signInWithCredential(auth, credential);
        } else {
          throw err;
        }
      }
    } else {
      await wConfirmation.confirm(otp);
    }
    return toAuthUser(auth.currentUser, true);
  },
};
