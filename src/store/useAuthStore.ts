import { create } from 'zustand';
import type { AuthUser } from '../services/authService';

type AuthState = {
  uid: string | null;
  isAnonymous: boolean;
  phoneNumber: string | null;
  isAdmin: boolean;
  ready: boolean;
  setUser: (u: AuthUser | null) => void;
  setReady: (b: boolean) => void;
};

export const useAuthStore = create<AuthState>(set => ({
  uid: null,
  isAnonymous: false,
  phoneNumber: null,
  isAdmin: false,
  ready: false,
  setUser: u =>
    set({
      uid: u?.uid ?? null,
      isAnonymous: u?.isAnonymous ?? false,
      phoneNumber: u?.phoneNumber ?? null,
      isAdmin: u?.isAdmin ?? false,
    }),
  setReady: b => set({ ready: b }),
}));
