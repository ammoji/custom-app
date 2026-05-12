import { MOCK_SHOPS } from '../mocks/shops';
import { MOCK_USER_LOCATION } from '../mocks/userLocation';
import { haversineKm } from '../utils/distance';
import { Shop } from '../types';

const NEAR_KM = 1;
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export const shopService = {
  async getNearbyShops(): Promise<Shop[]> {
    await delay(300);
    return MOCK_SHOPS
      .map(s => ({ ...s, distanceKm: haversineKm(MOCK_USER_LOCATION, s.location) }))
      .filter(s => (s.distanceKm ?? 0) <= NEAR_KM)
      .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
  },
  async getById(shopId: string): Promise<Shop | null> {
    await delay(150);
    const s = MOCK_SHOPS.find(x => x.id === shopId);
    if (!s) return null;
    return { ...s, distanceKm: haversineKm(MOCK_USER_LOCATION, s.location) };
  },
};
