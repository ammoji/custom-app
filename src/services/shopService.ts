import { firebase as nativeFirebase } from '@react-native-firebase/app';
import '@react-native-firebase/functions';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { Platform } from 'react-native';
import { GeoPoint, Shop } from '../types';
import { haversineKm } from '../utils/distance';
import {
  DEFAULT_SERVICE_RADIUS_KM,
  filterShopsByServiceRadius,
} from '../utils/geoVisibilityHelpers';
import { db } from './firebase';

// PR 48 — the visibility gate is server-side. The native path trusts
// the filter `listShopsPublic` already applied; the web/Plan B path
// mirrors it locally via `filterShopsByServiceRadius` so behavior
// matches across platforms. The cross-city testing override is the
// Firestore doc `appConfig/shopVisibility.showAllShops` — flip it
// `true` while the offshore team is on TestFlight, `false`/delete it
// at real-customer launch. NO REBUILD required to toggle (the old
// `SHOW_ALL_SHOPS = true` constant required an OTA + relaunch and
// silently broke in TestFlight via `__DEV__`).
//
// `DEFAULT_SERVICE_RADIUS_KM` and `haversineKm` MUST stay imported —
// the web branch reads the flag + ranks distance locally; the
// auto-formatter has stripped both during prior PRs (code-discipline
// Rule 1).
void DEFAULT_SERVICE_RADIUS_KM;
void haversineKm;

const isNative = Platform.OS !== 'web';

async function readShowAllShopsFlagWeb(): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, 'appConfig', 'shopVisibility'));
    if (!snap.exists()) return false;
    const data = snap.data() as { showAllShops?: unknown } | undefined;
    return data?.showAllShops === true;
  } catch {
    // Same fail-closed posture as the server: a flag-read hiccup
    // must NEVER inadvertently reveal distant shops. Worst case the
    // testing team temporarily sees a filtered list, which is
    // recoverable by re-touching the doc.
    return false;
  }
}

// Cloud Functions deploy to asia-south1 (see firebase.ts). RNFB defaults
// to us-central1 so we must request the regional instance explicitly.
// Lazy-initialised on first use to avoid touching RNFB on web.
function getNativeFunctions() {
  return nativeFirebase.app().functions('asia-south1');
}

export const shopService = {
  // Plan B: web keeps the existing Firebase Web SDK Firestore read
  // path; native goes through the `listShopsPublic` callable because
  // the Web SDK Firestore client hangs on this RN setup (Expo SDK 54
  // + RN 0.81 + static frameworks — same root cause as orderService's
  // listMyOrders / getOrder Plan B).
  //
  // PR 48 — the visibility gate now lives SERVER-SIDE
  // (`listShopsPublic` applies `filterShopsByServiceRadius`). Native
  // therefore returns the server's filtered list as-is; the web
  // branch reads the flag locally + applies the same pure helper so
  // cross-platform behaviour stays identical.
  async getNearbyShops(userLocation: GeoPoint): Promise<Shop[]> {
    if (!isNative) {
      // Web Plan B: Web SDK Firestore actually works here. Rank
      // distance + apply the SAME visibility gate the server uses
      // (`filterShopsByServiceRadius` is byte-identical to the
      // server helper) so cross-platform behavior matches. The flag
      // read defaults to `false` on any error — see the inline
      // comment on the function for the fail-closed rationale.
      const snap = await getDocs(collection(db, 'shops'));
      const shops = snap.docs.map(d => d.data() as Shop);
      const ranked = shops
        .map(s => ({
          ...s,
          // PR-NEXT-SHOP-LOCATION-REQUIRED — defensive guard. If the
          // shop doc has no `location` (legacy / misconfigured / data
          // edit bypass), `haversineKm` would throw on `b.lat`.
          // Stamp `distanceKm: undefined` instead so the downstream
          // filter takes the shop-side-gap branch (drop).
          distanceKm:
            s.location &&
            typeof s.location.lat === 'number' &&
            typeof s.location.lng === 'number'
              ? haversineKm(userLocation, s.location)
              : undefined,
        }))
        .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
      const showAll = await readShowAllShopsFlagWeb();
      // PR-NEXT-SHOP-LOCATION-REQUIRED — `customerHasLocation: true`
      // because `getNearbyShops` REQUIRES a `userLocation` arg (this
      // branch is unreachable without one). Helper now uses the flag
      // to drop shops without `location` (haversine returns NaN →
      // distanceKm non-finite → previously fail-OPEN, now fail-CLOSED
      // for shop-side gaps). Mirrors server-side `listShopsPublic`.
      return filterShopsByServiceRadius(ranked, {
        showAll,
        customerHasLocation: true,
      });
    }
    // Native: trust the server. `listShopsPublic` already applied
    // `rankShopsByDistance` + `filterShopsByServiceRadius` with the
    // server's reading of the `appConfig/shopVisibility` flag.
    const fn = getNativeFunctions().httpsCallable('listShopsPublic');
    const result = await fn({ userLocation });
    return ((result.data as any)?.shops ?? []) as Shop[];
  },

  // Native reuses listShopMenuPublic which already returns the shop
  // doc alongside the menu — adding a dedicated getShopPublic just to
  // avoid the extra (small) menu read isn't worth a fresh callable
  // surface. If a future caller genuinely needs the shop without a
  // menu, add getShopPublic then.
  async getById(shopId: string, userLocation: GeoPoint): Promise<Shop | null> {
    if (!isNative) {
      const snap = await getDoc(doc(db, 'shops', shopId));
      if (!snap.exists()) return null;
      const shop = snap.data() as Shop;
      return { ...shop, distanceKm: haversineKm(userLocation, shop.location) };
    }
    try {
      const fn = getNativeFunctions().httpsCallable('listShopMenuPublic');
      const result = await fn({ shopId });
      const shop = (result.data as any)?.shop as Shop | undefined;
      if (!shop) return null;
      return {
        ...shop,
        distanceKm: shop.location
          ? haversineKm(userLocation, shop.location)
          : undefined,
      };
    } catch (e: any) {
      // Server returns NOT_FOUND for missing or non-active shops;
      // surface that as null to match the web path's semantics.
      const code = e?.code;
      if (code === 'functions/not-found' || code === 'not-found') {
        return null;
      }
      throw e;
    }
  },
};
