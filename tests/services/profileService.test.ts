/**
 * Plan-B dispatch tests for profileService.
 *
 * Same shape as tests/services/shopService.test.ts — verifies that
 * each callable routes through the right SDK based on Platform.OS.
 * Doesn't re-test the validation logic (that's covered by
 * tests/functions/profileValidation.test.ts) — these tests are
 * strictly about wire-protocol routing.
 */
import { Platform } from 'react-native';
import {
  __resetHttpsCallable,
  __setHttpsCallable,
} from '../__mocks__/rnfb-app';

const loadProfileService = () => {
  let svc: typeof import('../../src/services/profileService').profileService;
  jest.isolateModules(() => {
    svc = require('../../src/services/profileService').profileService;
  });
  // @ts-expect-error assigned inside isolateModules
  return svc;
};

const sampleProfile = {
  uid: 'u1',
  phone: '+919876543210',
  name: 'Sudhir',
  email: null,
  addresses: [],
  defaultAddressId: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

beforeEach(() => {
  __resetHttpsCallable();
});

describe('profileService dispatch (native)', () => {
  test('saveAddress calls the saveAddress callable with the input payload', async () => {
    Platform.OS = 'android';
    const calls: { name: string; data: unknown }[] = [];
    __setHttpsCallable(name => async data => {
      calls.push({ name, data });
      return {
        data: { id: 'new-id', profile: sampleProfile },
      };
    });
    const profileService = loadProfileService();

    const result = await profileService.saveAddress({
      name: 'Sudhir',
      phone: '9876543210',
      line1: 'A-12',
      city: 'New Delhi',
      pincode: '110016',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('saveAddress');
    expect(calls[0].data).toMatchObject({
      name: 'Sudhir',
      phone: '9876543210',
      pincode: '110016',
    });
    expect(result.id).toBe('new-id');
  });

  test('getMyProfile calls the getMyProfile callable with no args', async () => {
    Platform.OS = 'ios';
    const calls: { name: string; data: unknown }[] = [];
    __setHttpsCallable(name => async data => {
      calls.push({ name, data });
      return { data: sampleProfile };
    });
    const profileService = loadProfileService();

    const profile = await profileService.getMyProfile();

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('getMyProfile');
    expect(profile.uid).toBe('u1');
  });

  test('callable error propagates to caller (no silent swallow)', async () => {
    // Same bug class as the orderService watchers — a service that
    // catches and warns silently is what caused the loader-stuck
    // bug. profileService MUST re-throw so the screen can render
    // an error banner.
    Platform.OS = 'android';
    __setHttpsCallable(() => async () => {
      throw new Error('NETWORK_ERROR');
    });
    const profileService = loadProfileService();

    await expect(
      profileService.updateMyProfile({ name: 'Sudhir' }),
    ).rejects.toThrow(/NETWORK_ERROR/);
  });

  test('deleteAddress unwraps { profile } envelope and returns the profile', async () => {
    // Server returns { profile } so the client can replace its local
    // copy without a separate getMyProfile follow-up. The service
    // unwraps the envelope; the screen sees a raw UserProfile.
    Platform.OS = 'ios';
    __setHttpsCallable(() => async () => ({
      data: { profile: { ...sampleProfile, addresses: [] } },
    }));
    const profileService = loadProfileService();

    const profile = await profileService.deleteAddress('addr-1');
    expect(profile.addresses).toEqual([]);
    expect(profile.uid).toBe('u1');
  });
});
