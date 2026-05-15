import { firebase as nativeFirebase } from '@react-native-firebase/app';
import '@react-native-firebase/functions';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { httpsCallable } from 'firebase/functions';
import { Platform } from 'react-native';
import { functions } from './firebase';

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
    // Web push would require VAPID configuration in app.json; we only
    // ship native push for now. Bail before touching expo-notifications
    // so we don't trigger its "missing vapidPublicKey" error.
    if (Platform.OS === 'web') {
      console.log('[push] web platform — skipping (native-only feature)');
      return null;
    }
    if (!Device.isDevice) {
      console.log('[push] simulator/emulator — skipping registration');
      return null;
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('[push] permission denied');
      return null;
    }

    const projectId = getEasProjectId();
    if (!projectId) {
      console.warn(
        '[push] no EAS projectId in Constants.expoConfig.extra.eas — ' +
          'cannot fetch Expo push token. Run `eas init` if missing.',
      );
      return null;
    }

    let token: string;
    try {
      const result = await Notifications.getExpoPushTokenAsync({ projectId });
      token = result.data;
    } catch (e) {
      console.warn('[push] getExpoPushTokenAsync failed:', e);
      return null;
    }
    console.log('[push] token:', token);

    // Android needs a notification channel on API 26+ — without one,
    // notifications silently never show.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Order Updates',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
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
      console.log('[push] token registered with backend');
    } catch (e) {
      console.warn('[push] registerPushToken call failed:', e);
    }

    return token;
  },
};
