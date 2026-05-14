import {
  ConfirmationResult,
  signOut as fbSignOut,
  linkWithCredential,
  onAuthStateChanged,
  PhoneAuthProvider,
  RecaptchaVerifier,
  signInAnonymously,
  signInWithCredential,
  signInWithPhoneNumber,
  User,
} from 'firebase/auth';
import { auth } from './firebase';

export type AuthUser = {
  uid: string;
  isAnonymous: boolean;
  phoneNumber: string | null;
  isAdmin: boolean;
};

async function toAuthUser(user: User | null, forceRefresh = false): Promise<AuthUser | null> {
  if (!user) return null;
  let isAdmin = false;
  try {
    const tokenResult = await user.getIdTokenResult(forceRefresh);
    isAdmin = tokenResult.claims.admin === true;
  } catch (err) {
    console.warn('[auth] failed to read custom claims:', err);
  }
  return {
    uid: user.uid,
    isAnonymous: user.isAnonymous,
    phoneNumber: user.phoneNumber,
    isAdmin,
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
    if (auth.currentUser) return;
    await signInAnonymously(auth);
  },

  async signOut(): Promise<void> {
    await fbSignOut(auth);
  },

  subscribe(cb: (user: AuthUser | null) => void): () => void {
    return onAuthStateChanged(auth, async user => {
      cb(await toAuthUser(user));
    });
  },

  // Force-refresh the ID token and re-read custom claims. Use this after
  // an admin claim is set server-side so the client picks it up without
  // requiring sign-out / sign-in.
  async refreshAdminClaim(): Promise<AuthUser | null> {
    return toAuthUser(auth.currentUser, true);
  },

  // Step 1 of phone auth: trigger SMS via invisible reCAPTCHA.
  // phoneE164 must be in E.164 format e.g. +911234567890.
  async startPhoneAuth(phoneE164: string): Promise<ConfirmationResult> {
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
    const credential = PhoneAuthProvider.credential(
      confirmation.verificationId,
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
      await confirmation.confirm(otp);
    }
    return toAuthUser(auth.currentUser, true);
  },
};
