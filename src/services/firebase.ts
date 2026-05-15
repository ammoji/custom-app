/**
 * NOTE: Firebase web SDK runs in parallel with @react-native-firebase
 * on native. authService.ts + orderService.ts dispatch by Platform.OS:
 *   - web: uses this web SDK for everything (auth, db, functions,
 *     storage, app check).
 *   - native: uses @react-native-firebase for auth + functions only.
 *     Order READS on native go through Cloud Functions
 *     (listMyOrders, getOrder, listAllOrders) called via RNFB functions,
 *     because @react-native-firebase/firestore is incompatible with
 *     Expo SDK 54 + RN 0.81 + static frameworks (Swift module emit
 *     errors that no Podfile patch could fix). See PRELAUNCH_CHECKLIST
 *     for the migration target once upstream resolves it.
 *   - native: still uses this web SDK for storage AND for Firestore
 *     reads of world-readable collections (shops, products). Those work
 *     cross-SDK because their security rules don't gate on request.auth.
 *
 * Real-time snapshot listeners (onSnapshot) are replaced by polling on
 * native — see orderService.watchOrder / watchAllOrders. Cadence: 5s
 * for single-order detail, 10s for admin dashboard.
 *
 * Future native App Check / FCM features will use additional
 * @react-native-firebase packages alongside this web SDK.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApps, initializeApp } from 'firebase/app';
// @ts-ignore - getReactNativePersistence is exported but not in the public types
import { getFunctions } from '@firebase/functions';
import { getAuth, getReactNativePersistence, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
const REQUIRED_ENV_KEYS = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
] as const;

const missing = REQUIRED_ENV_KEYS.filter(key => !process.env[key]);
if (missing.length > 0) {
  throw new Error(
    `[firebase] Missing required env vars: ${missing.join(', ')}. ` +
      `Add them to .env at the project root and restart Expo with 'npx expo start -c'.`
  );
}

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY as string,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN as string,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID as string,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID as string,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID as string,
};

export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// App Check: web only for now. React Native needs native modules + EAS dev-client
// (Phase 5c). Expo Go on mobile bypasses App Check, which is acceptable for dev.
if (typeof document !== 'undefined') {
  try {
    // Enable debug provider in dev so the SDK prints a debug token to console
    // on first run. This MUST be set before initializeAppCheck runs in the
    // same module — App.js can't set it earlier because ESM imports are hoisted.
    if (process.env.NODE_ENV !== 'production' && typeof self !== 'undefined') {
      (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    // Dynamic require avoids bundling app-check into the native bundle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { initializeAppCheck, ReCaptchaV3Provider } = require('firebase/app-check');
    const siteKey = process.env.EXPO_PUBLIC_FIREBASE_RECAPTCHA_SITE_KEY;
    if (!siteKey) {
      console.warn(
        '[firebase] EXPO_PUBLIC_FIREBASE_RECAPTCHA_SITE_KEY not set; App Check disabled. ' +
          'Cloud Functions with enforceAppCheck will reject requests from this client.'
      );
    } else {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
      console.log('[firebase] App Check initialized (reCAPTCHA v3)');
    }
  } catch (err) {
    console.warn('[firebase] App Check initialization failed:', err);
  }
}

// initializeAuth must run exactly once; on Fast Refresh / re-import fall back to getAuth.
export const auth = (() => {
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(app);
  }
})();

export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, 'asia-south1');

console.log('[firebase] initialized:', app.name, 'project:', firebaseConfig.projectId);

// Analytics + Performance are web-only — the modular SDKs no-op gracefully
// in native bundles via `isSupported()`. We dynamic-require so native builds
// don't pull these chunks into the JS bundle at all.
export let analytics: import('firebase/analytics').Analytics | null = null;
export let perf: import('firebase/performance').FirebasePerformance | null = null;

if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getAnalytics, isSupported: isAnalyticsSupported } = require('firebase/analytics');
  isAnalyticsSupported()
    .then((supported: boolean) => {
      if (supported) {
        analytics = getAnalytics(app);
        console.log('[firebase] analytics initialized');
      }
    })
    .catch((err: unknown) => {
      console.warn('[firebase] analytics init check failed:', err);
    });
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getPerformance } = require('firebase/performance');
    perf = getPerformance(app);
    console.log('[firebase] performance monitoring initialized');
  } catch (e) {
    console.warn('[firebase] performance init failed:', e);
  }
}
