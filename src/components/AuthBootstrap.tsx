import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { authService } from '../services/authService';
import { pushService } from '../services/pushService';
import { useAuthStore } from '../store/useAuthStore';
import { useLocationStore } from '../store/useLocationStore';

/**
 * Renders nothing. Subscribes to Firebase auth state on mount and keeps
 * useAuthStore in sync. Provisions an anonymous uid if none exists after
 * a short grace period (lets AsyncStorage-persisted sessions rehydrate first).
 * Also kicks off a location fetch so most screens have it ready on mount.
 */
export default function AuthBootstrap() {
  const fetchLocation = useLocationStore(s => s.fetch);

  useEffect(() => {
    let refreshedOnce = false;
    let pushRegistered = false;
    const unsubscribe = authService.subscribe(async user => {
      useAuthStore.getState().setUser(user);
      useAuthStore.getState().setReady(true);

      // Once we have a real user, force-refresh the ID token ONCE so any
      // newly-granted admin claim shows up without requiring sign-out.
      if (user && !refreshedOnce) {
        refreshedOnce = true;
        try {
          const refreshed = await authService.refreshAdminClaim();
          if (refreshed) useAuthStore.getState().setUser(refreshed);
        } catch (err) {
          console.warn('[auth] refreshAdminClaim failed:', err);
        }
      }

      // Register for push notifications once we have an authed user.
      // The callable requires request.auth, so we can't run this earlier.
      // Idempotent on the server (arrayUnion dedupes), but we still gate
      // to one call per app session to avoid permission-prompt spam.
      if (user && !pushRegistered) {
        pushRegistered = true;
        pushService.registerForPushNotifications().catch(err => {
          console.warn('[bootstrap] push registration failed:', err);
        });
      }
    });

    const timer = setTimeout(() => {
      if (!useAuthStore.getState().uid) {
        authService.signInAnonymouslyIfNeeded().catch(err => {
          console.warn('[auth] anonymous sign-in failed:', err?.code || err);
        });
      }
    }, 200);

    fetchLocation();

    // Tap-to-open hook. For MVP we only log the orderId — full
    // deep-link nav into OrderDetail is tracked as a follow-up.
    const tapSub = Notifications.addNotificationResponseReceivedListener(
      response => {
        const orderId =
          response.notification.request.content.data?.orderId;
        if (orderId) {
          console.log('[push] tapped notification for order', orderId);
        }
      },
    );

    return () => {
      clearTimeout(timer);
      unsubscribe();
      tapSub.remove();
    };
  }, [fetchLocation]);

  return null;
}
