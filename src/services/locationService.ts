import * as Location from 'expo-location';
import { MOCK_USER_LOCATION } from '../mocks/userLocation';
import type { GeoPoint } from '../types';

export type LocationResult = {
  location: GeoPoint;
  source: 'gps' | 'fallback';
};

export const locationService = {
  async getCurrentLocation(): Promise<LocationResult> {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return { location: MOCK_USER_LOCATION, source: 'fallback' };
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return {
        location: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        source: 'gps',
      };
    } catch (e) {
      console.warn('[locationService] falling back to default:', e);
      return { location: MOCK_USER_LOCATION, source: 'fallback' };
    }
  },
};
