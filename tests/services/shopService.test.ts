/**
 * Plan B dispatch tests for shopService (post-v2-iii hotfix).
 *
 * These verify the Platform.OS-based dispatch in
 * src/services/shopService.ts:
 *   - native:  callable path via @react-native-firebase/functions
 *   - web:     web-SDK path via firebase/firestore getDocs/getDoc
 *
 * The unit-test jest config (tests/jest.unit.config.js) maps
 * react-native, @react-native-firebase/*, firebase/firestore, and
 * services/firebase to in-test mocks under tests/__mocks__/.
 */
import { Platform } from 'react-native';
import {
  __reset as resetFs,
  __setGetDoc,
  __setGetDocs,
} from '../__mocks__/firebase-firestore';
import {
  __resetHttpsCallable,
  __setHttpsCallable,
} from '../__mocks__/rnfb-app';

// shopService is imported lazily per-test so each test can flip
// Platform.OS before module-level Platform check is captured. The
// service computes `isNative = Platform.OS !== 'web'` at module load,
// so we have to jest.resetModules between platform changes.
const loadShopService = () => {
  let svc: typeof import('../../src/services/shopService').shopService;
  jest.isolateModules(() => {
    svc = require('../../src/services/shopService').shopService;
  });
  // @ts-expect-error assigned inside isolateModules
  return svc;
};

const userLocation = { lat: 28.6139, lng: 77.209 };

beforeEach(() => {
  resetFs();
  __resetHttpsCallable();
});

describe('shopService.getNearbyShops dispatch', () => {
  test('native: routes through listShopsPublic callable', async () => {
    Platform.OS = 'ios';
    const calls: { name: string; data: unknown }[] = [];
    __setHttpsCallable(name => async data => {
      calls.push({ name, data });
      return {
        data: {
          shops: [
            { id: 'a', name: 'A', location: userLocation, distanceKm: 0 },
            { id: 'b', name: 'B', location: userLocation, distanceKm: 0.5 },
          ],
        },
      };
    });
    const shopService = loadShopService();

    const result = await shopService.getNearbyShops(userLocation as any);

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('listShopsPublic');
    expect(calls[0].data).toEqual({ userLocation });
    expect(result.map(s => s.id)).toEqual(['a', 'b']);
  });

  test('web: routes through getDocs against shops collection', async () => {
    Platform.OS = 'web';
    let getDocsCalled = false;
    __setGetDocs(async () => {
      getDocsCalled = true;
      return {
        docs: [
          {
            id: 'a',
            data: () => ({ id: 'a', name: 'A', location: userLocation }),
          },
          {
            id: 'b',
            data: () => ({
              id: 'b',
              name: 'B',
              location: { lat: 28.7, lng: 77.1 },
            }),
          },
        ],
        exists: () => false,
        data: () => undefined,
      };
    });
    // Native path must NOT be hit on web — wire a callable that throws
    // to turn any accidental dispatch into a test failure.
    __setHttpsCallable(() => async () => {
      throw new Error('native callable should not run on web');
    });
    const shopService = loadShopService();

    const result = await shopService.getNearbyShops(userLocation as any);

    expect(getDocsCalled).toBe(true);
    // Web path computes distance client-side; FORCE_SHOW_ALL filter
    // (__DEV__ in tests is undefined → falsy) means only shops within
    // 1km survive. 'a' is at the user location → 0km → kept.
    expect(result.map(s => s.id)).toContain('a');
  });

  test('native: callable throw propagates to caller', async () => {
    Platform.OS = 'ios';
    __setHttpsCallable(() => async () => {
      const err = new Error('NETWORK_ERROR');
      throw err;
    });
    const shopService = loadShopService();

    await expect(
      shopService.getNearbyShops(userLocation as any),
    ).rejects.toThrow('NETWORK_ERROR');
  });
});

describe('shopService.getById dispatch', () => {
  test('native: reuses listShopMenuPublic and returns the shop only', async () => {
    Platform.OS = 'ios';
    const calls: { name: string; data: unknown }[] = [];
    __setHttpsCallable(name => async data => {
      calls.push({ name, data });
      return {
        data: {
          shop: {
            id: 'shop_1',
            name: 'Shop One',
            location: userLocation,
          },
          items: [{ id: 'i1' }, { id: 'i2' }],
        },
      };
    });
    const shopService = loadShopService();

    const result = await shopService.getById('shop_1', userLocation as any);

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('listShopMenuPublic');
    expect(calls[0].data).toEqual({ shopId: 'shop_1' });
    expect(result?.id).toBe('shop_1');
    // distanceKm computed client-side from the shop's location
    expect(typeof result?.distanceKm).toBe('number');
  });

  test('native: not-found surfaces as null (matches web semantics)', async () => {
    Platform.OS = 'ios';
    __setHttpsCallable(() => async () => {
      const err: any = new Error('Shop not found');
      err.code = 'functions/not-found';
      throw err;
    });
    const shopService = loadShopService();

    const result = await shopService.getById('missing', userLocation as any);

    expect(result).toBeNull();
  });

  test('web: routes through getDoc against shops/{id}', async () => {
    Platform.OS = 'web';
    let getDocCalled = false;
    __setGetDoc(async () => {
      getDocCalled = true;
      return {
        docs: [],
        exists: () => true,
        data: () => ({
          id: 'shop_1',
          name: 'Shop One',
          location: userLocation,
        }),
      };
    });
    const shopService = loadShopService();

    const result = await shopService.getById(
      'shop_1',
      userLocation as any,
    );

    expect(getDocCalled).toBe(true);
    expect(result?.id).toBe('shop_1');
  });
});
