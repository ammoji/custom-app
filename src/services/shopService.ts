import { firebase as nativeFirebase } from '@react-native-firebase/app';
import '@react-native-firebase/functions';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { Platform } from 'react-native';
import { GeoPoint, Shop } from '../types';
import { haversineKm } from '../utils/distance';
import { db } from './firebase';

const NEAR_KM = 1;

// DEV-ONLY ESCAPE HATCH: To test with shops outside the radius,
// set EXPO_PUBLIC_FORCE_SHOW_ALL_SHOPS=true in .env.local
// This has no effect in production builds (__DEV__ is always false).
const FORCE_SHOW_ALL_SHOPS_IN_DEV =
  __DEV__;

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
  // the FORCE_SHOW_ALL_SHOPS_IN_DEV override on native so behaviour
  // matches web.
  async getNearbyShops(userLocation: GeoPoint): Promise<Shop[]> {
    if (!isNative) {
      const snap = await getDocs(collection(db, 'shops'));
      const shops = snap.docs.map(d => d.data() as Shop);
      return shops
        .map(s => ({ ...s, distanceKm: haversineKm(userLocation, s.location) }))
        .filter(s => FORCE_SHOW_ALL_SHOPS_IN_DEV || (s.distanceKm ?? 0) <= NEAR_KM)
        .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
    }
    const fn = getNativeFunctions().httpsCallable('listShopsPublic');
    const result = await fn({ userLocation });
    const shops = ((result.data as any)?.shops ?? []) as Shop[];
    return shops.filter(
      s => FORCE_SHOW_ALL_SHOPS_IN_DEV || (s.distanceKm ?? 0) <= NEAR_KM,
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
