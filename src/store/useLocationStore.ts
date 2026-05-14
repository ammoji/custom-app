import { create } from 'zustand';
import { locationService } from '../services/locationService';
import type { GeoPoint } from '../types';

type LocationState = {
  location: GeoPoint | null;
  source: 'gps' | 'fallback' | null;
  loading: boolean;
  fetch: () => Promise<void>;
};

// No persistence — re-fetch on each app launch so we don't serve stale GPS.
export const useLocationStore = create<LocationState>((set, get) => ({
  location: null,
  source: null,
  loading: false,
  fetch: async () => {
    if (get().loading) return;
    set({ loading: true });
    const result = await locationService.getCurrentLocation();
    set({
      location: result.location,
      source: result.source,
      loading: false,
    });
  },
}));
