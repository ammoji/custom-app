import { firebase as nativeFirebase } from '@react-native-firebase/app';
import '@react-native-firebase/functions';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { httpsCallable } from 'firebase/functions';
import { Platform } from 'react-native';
import { functions } from './firebase';
import { Sentry } from './sentry';

const isNative = Platform.OS !== 'web';

// Mirror orderService.ts — Cloud Functions are deployed in asia-south1
// and RNFB defaults to us-central1, so request the regional instance.
function getNativeFunctions() {
  return nativeFirebase.app().functions('asia-south1');
}

/**
 * Push notifications via expo-notifications + Expo Push relay.
 *
 * Why Expo Push instead of @react-native-firebase/messaging:
 *   - Avoids another RNFB framework-module rebuild battle (we already
 *     fought that for auth/functions; messaging adds more native deps).
 *   - Expo Push handles APNs+FCM credential routing for us.
 *
 * Token round-trip: client gets a `ExponentPushToken[…]` from
 * Notifications.getExpoPushTokenAsync(), then ships it to the
 * `registerPushToken` Cloud Function, which appends it to
 * users/{uid}.fcmTokens (deduped via arrayUnion). Server-side
 * `sendOrderStatusPush` reads those tokens on order updates.
 */

// Show banner + play sound even when the app is foregrounded.
// (Default behavior is to suppress in-foreground notifications.)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function getEasProjectId(): string | undefined {
  // Expo SDK 50+ surfaces eas.projectId on Constants.expoConfig.extra.
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    // Older fallback path some Expo builds still ship.
    (Constants as any).easConfig?.projectId
  );
}

export const pushService = {
  /**
   * Request notification permission and register the device's Expo push
   * token with the backend. Idempotent — safe to call on every app
   * launch; arrayUnion on the server dedupes.
   *
   * Returns null if:
   *   - running on web (we don't ship browser push — would need VAPID)
   *   - running in a simulator (no APNs/FCM)
   *   - user denied permission
   *   - we couldn't obtain an Expo project id
   */
  async registerForPushNotifications(): Promise<string | null> {
    // PR 45 — instrumented with Sentry breadcrumbs at every decision
    // point + captures at every real failure. Pre-PR-45 every branch
    // here exited via silent console.warn, so when push silently
    // broke (build 17, May 27 2026) there was no signal pointing at
    // the failure. Now every session leaves a trail in Sentry that
    // tells us EXACTLY where registration stopped — token mint,
    // permission, callable write, or never started.
    Sentry.addBreadcrumb({
      category: 'push',
      message: 'register: start',
    });

    // Web push would require VAPID configuration in app.json; we only
    // ship native push for now. Bail before touching expo-notifications
    // so we don't trigger its "missing vapidPublicKey" error.
    if (Platform.OS === 'web') {
      Sentry.addBreadcrumb({
        category: 'push',
        message: 'register: skip (web)',
      });
      return null;
    }
    if (!Device.isDevice) {
      Sentry.addBreadcrumb({
        category: 'push',
        message: 'register: skip (simulator)',
      });
      return null;
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      Sentry.addBreadcrumb({
        category: 'push',
        message: 'register: permission denied',
        data: { finalStatus },
      });
      // captureMessage at 'info' (not error) — permission denial is a
      // legitimate user choice, not a bug. We still want visibility
      // into how many sessions land here so adoption can be tracked.
      Sentry.captureMessage(
        'push registration: permission not granted',
        'info',
      );
      return null;
    }

    const projectId = getEasProjectId();
    if (!projectId) {
      // captureMessage at 'warning' — projectId missing IS a config
      // bug (eas init never ran or app.json got rewritten), but it's
      // recoverable with a redeploy, not a crash.
      Sentry.captureMessage(
        'push registration: no EAS projectId',
        'warning',
      );
      return null;
    }

    let token: string;
    try {
      const result = await Notifications.getExpoPushTokenAsync({ projectId });
      token = result.data;
      Sentry.addBreadcrumb({
        category: 'push',
        message: 'register: token obtained',
        // Prefix only — full token is sensitive (semi-secret URL the
        // Expo Push API uses to address the device). Prefix is enough
        // to confirm it's a real ExponentPushToken[...] shape in the
        // breadcrumb trail.
        data: { tokenPrefix: token.slice(0, 24) },
      });
    } catch (e) {
      // PR 45 — most likely failure point when push is broken (iOS APN
      // entitlement / provisioning / expired push key). Capture the
      // raw exception so Sentry surfaces the actual platform error
      // text. Tag with `push_stage` so dashboards can group all
      // token-mint failures together regardless of underlying cause.
      //
      // PR 45.1 hardening (kept post-cleanup) — `captureException`
      // on a non-Error throw (string, undefined, plain object)
      // historically gets dropped or mis-grouped by Sentry. Wrap
      // with `new Error(...)` to guarantee a real exception is
      // captured even when the native module throws a raw string
      // or rejects with `undefined`.
      const wrapped =
        e instanceof Error
          ? e
          : new Error(`getExpoPushTokenAsync threw non-Error: ${String(e)}`);
      Sentry.captureException(wrapped, {
        tags: { push_stage: 'getExpoPushTokenAsync' },
      });
      return null;
    }

    // Android needs a notification channel on API 26+ — without one,
    // notifications silently never show.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Order Updates',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#0E7C3A',
      });
      // PR 41 — admin alerts (new shop registration, new delivery
      // partner application) go on a separate channel so an admin
      // who is ALSO a customer or shop owner can mute one role's
      // notifications without muting the other. Order alerts stay
      // HIGH importance (they need to break through silent mode
      // because pilot delivery partners use the phone to wake up to
      // pickups); admin alerts are DEFAULT — should arrive promptly
      // but don't need to override silent mode.
      await Notifications.setNotificationChannelAsync('admin-alerts', {
        name: 'Admin Approval Queue',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 200, 200, 200],
        lightColor: '#0E7C3A',
      });
    }

    // Round-trip the token through a Cloud Function so the server has
    // it on users/{uid}. The function uses Admin SDK and dedupes via
    // arrayUnion, so re-registration is cheap.
    try {
      if (isNative) {
        const fn = getNativeFunctions().httpsCallable('registerPushToken');
        await fn({ token });
      } else {
        const fn = httpsCallable(functions, 'registerPushToken');
        await fn({ token });
      }
      Sentry.addBreadcrumb({
        category: 'push',
        message: 'register: backend write ok',
      });
    } catch (e) {
      // PR 45 — callable rejected. Could be IAM (allUsers binding
      // dropped), auth-context (request.auth missing), validation
      // (bad token shape). Capture so the dashboard tells us which.
      Sentry.captureException(e, {
        tags: { push_stage: 'registerPushToken_callable' },
      });
      // PR 45 KEY CHANGE — re-throw instead of swallowing. The
      // caller (AuthBootstrap) needs to know this failed so its
      // closure-gate can stay open and a later auth event will
      // retry. Pre-PR-45 the silent catch caused the gate to
      // latch closed on first failure for the entire session.
      throw e;
    }

    return token;
  },

  /**
   * PR 24 — Remove this device's Expo push token from the currently
   * authed user's fcmTokens server-side. Call BEFORE
   * firebase.auth().signOut() — the callable needs auth, and once
   * sign-out completes request.auth is null.
   *
   * Idempotent: server uses arrayRemove, so duplicate calls are
   * cheap. Returns silently in any of these cases (no throw):
   *   - running on web (no native push registered to begin with)
   *   - simulator/emulator (no token was ever obtained)
   *   - no permission granted (no token to remove)
   *   - cannot fetch the Expo token (transient network / Expo issue)
   *
   * Only throws if the callable itself rejects with something other
   * than "user is unauthenticated" — in which case the orchestrator
   * logs but does not abort sign-out.
   */
  async unregisterPushToken(): Promise<void> {
    if (Platform.OS === 'web') return;
    if (!Device.isDevice) return;

    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    const projectId = getEasProjectId();
    if (!projectId) return;

    let token: string;
    try {
      const result = await Notifications.getExpoPushTokenAsync({ projectId });
      token = result.data;
    } catch (e) {
      console.warn('[push] unregister: getExpoPushTokenAsync failed:', e);
      return;
    }

    try {
      if (isNative) {
        const fn = getNativeFunctions().httpsCallable('unregisterPushToken');
        await fn({ token });
      } else {
        const fn = httpsCallable(functions, 'unregisterPushToken');
        await fn({ token });
      }
      console.log('[push] token unregistered from backend');
    } catch (e) {
      console.warn('[push] unregisterPushToken call failed:', e);
    }
  },
};
