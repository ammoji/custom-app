import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { GeoPoint, Shop } from '../types';
import { haversineKm } from '../utils/distance';
import { db } from './firebase';

const NEAR_KM = 1;

// DEV-ONLY ESCAPE HATCH: To test with shops outside the radius,
// set EXPO_PUBLIC_FORCE_SHOW_ALL_SHOPS=true in .env.local
// This has no effect in production builds (__DEV__ is always false).
const FORCE_SHOW_ALL_SHOPS_IN_DEV =
  __DEV__;

export const shopService = {
  async getNearbyShops(userLocation: GeoPoint): Promise<Shop[]> {
    const snap = await getDocs(collection(db, 'shops'));
    const shops = snap.docs.map(d => d.data() as Shop);
    return shops
      .map(s => ({ ...s, distanceKm: haversineKm(userLocation, s.location) }))
      .filter(s => FORCE_SHOW_ALL_SHOPS_IN_DEV || (s.distanceKm ?? 0) <= NEAR_KM)
      .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
  },
  async getById(shopId: string, userLocation: GeoPoint): Promise<Shop | null> {
    const snap = await getDoc(doc(db, 'shops', shopId));
    if (!snap.exists()) return null;
    const shop = snap.data() as Shop;
    return { ...shop, distanceKm: haversineKm(userLocation, shop.location) };
  },
};
