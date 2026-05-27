import {
  createNavigationContainerRef,
  type NavigationContainerRefWithCurrent,
} from '@react-navigation/native';

/**
 * PR 41 — Module-level navigation ref so callers OUTSIDE the React
 * tree (notification-response handlers, deep-link parsers, etc.)
 * can drive navigation without prop-drilling a `nav` object.
 *
 * Wired into the `<NavigationContainer ref={navigationRef}>` in
 * `App.js`. The notification handler in `AuthBootstrap.tsx` uses
 * this to deeplink admin push taps to the right detail screen.
 *
 * Typed as `any` for the param-list slot because the screen
 * registry is dispersed across multiple stacks (AppNavigator's
 * RootStack); a stricter typing would couple this file to the
 * full ParamList and create a circular-import landmine. Callers
 * pass through `useNavigation<any>()` everywhere else in the app —
 * keeping the same posture here.
 */
export const navigationRef: NavigationContainerRefWithCurrent<any> =
  createNavigationContainerRef<any>();

/**
 * Best-effort navigation that no-ops if the container hasn't yet
 * mounted. Wrapping `navigate` rather than exposing the raw ref
 * keeps the call sites compact (no `if (isReady())` ceremony).
 */
export function safeNavigate(name: string, params?: object): void {
  if (navigationRef.isReady()) {
    // Cast through `any` because the param-list slot above is also
    // typed as `any` and overload resolution can't pick between the
    // (name) and (name, params) forms without it.
    (navigationRef as any).navigate(name, params);
  } else {
    console.warn('[navigationRef] not ready; dropping nav to', name);
  }
}
