import { create } from 'zustand';
import type { AuthUser } from '../services/authService';

type AuthState = {
  uid: string | null;
  isAnonymous: boolean;
  phoneNumber: string | null;
  ready: boolean;

  // Multi-role flags, all sourced from custom claims (server-authoritative).
  // Customer is implicit — every authenticated user is a customer.
  isAdmin: boolean;
  isShopOwner: boolean;
  shopId: string | null; // present iff isShopOwner is true
  isDelivery: boolean; // claim wired in Phase 12a; UI lands in Phase 12b

  setUser: (u: AuthUser | null) => void;
  setReady: (b: boolean) => void;
};

export const useAuthStore = create<AuthState>(set => ({
  uid: null,
  isAnonymous: false,
  phoneNumber: null,
  ready: false,
  isAdmin: false,
  isShopOwner: false,
  shopId: null,
  isDelivery: false,
  setUser: u =>
    set({
      uid: u?.uid ?? null,
      isAnonymous: u?.isAnonymous ?? false,
      phoneNumber: u?.phoneNumber ?? null,
      isAdmin: u?.isAdmin ?? false,
      isShopOwner: u?.isShopOwner ?? false,
      shopId: u?.shopId ?? null,
      isDelivery: u?.isDelivery ?? false,
    }),
  setReady: b => set({ ready: b }),
}));
