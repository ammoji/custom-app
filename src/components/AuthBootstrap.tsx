import { useEffect } from 'react';
import { authService } from '../services/authService';
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
    });

    const timer = setTimeout(() => {
      if (!useAuthStore.getState().uid) {
        authService.signInAnonymouslyIfNeeded().catch(err => {
          console.warn('[auth] anonymous sign-in failed:', err?.code || err);
        });
      }
    }, 200);

    fetchLocation();

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [fetchLocation]);

  return null;
}
