import { firebase as nativeFirebase } from '@react-native-firebase/app';
import '@react-native-firebase/functions';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { Platform } from 'react-native';
import { GeoPoint, Shop } from '../types';
import { haversineKm } from '../utils/distance';
import { db } from './firebase';

// PR 10 — Phase-of-testing flag. While the team is testing across
// multiple Indian cities, every tester should see every active shop
// regardless of distance. The previous `FORCE_SHOW_ALL_SHOPS_IN_DEV`
// flag was gated on `__DEV__`, which is `false` in TestFlight builds,
// so cross-city testers couldn't see each other's shops. Flip back
// to `false` for real-customer launch — and ideally make this
// server-side configurable per launch-pincode/state at that point
// (tracked in PRELAUNCH_CHECKLIST).
const SHOW_ALL_SHOPS = true;
const NEAR_KM = 1;

const isNative = Platform.OS !== 'web';

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
  // listMyOrders / getOrder Plan B). The server already filters
  // status==active and computes distanceKm + sorts; we still apply
  // the SHOW_ALL_SHOPS / NEAR_KM gate on native so behaviour matches
  // web.
  async getNearbyShops(userLocation: GeoPoint): Promise<Shop[]> {
    if (!isNative) {
      const snap = await getDocs(collection(db, 'shops'));
      const shops = snap.docs.map(d => d.data() as Shop);
      return shops
        .map(s => ({ ...s, distanceKm: haversineKm(userLocation, s.location) }))
        .filter(s => SHOW_ALL_SHOPS || (s.distanceKm ?? 0) <= NEAR_KM)
        .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
    }
    const fn = getNativeFunctions().httpsCallable('listShopsPublic');
    const result = await fn({ userLocation });
    const shops = ((result.data as any)?.shops ?? []) as Shop[];
    return shops.filter(
      s => SHOW_ALL_SHOPS || (s.distanceKm ?? 0) <= NEAR_KM,
    );
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
