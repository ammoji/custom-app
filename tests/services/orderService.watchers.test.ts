/**
 * Watcher contract tests (post-loader-spin hotfix).
 *
 * Pins the new orderService watch* contract:
 *
 *   cb(data, undefined)              ← success
 *   cb(emptyValue, error)            ← failure (NEVER silently swallow)
 *
 * Before the hotfix the native poll path used `console.warn` on
 * failure and never invoked the callback, which left consumers
 * (ShopOwnerDashboardScreen) spinning forever on the very first
 * failed poll. These tests fail loudly if anyone reverts that.
 */
import { Platform } from 'react-native';
import {
    __resetHttpsCallable,
    __setHttpsCallable,
} from '../__mocks__/rnfb-app';

const loadOrderService = () => {
  let svc: typeof import('../../src/services/orderService').orderService;
  jest.isolateModules(() => {
    svc = require('../../src/services/orderService').orderService;
  });
  // @ts-expect-error assigned inside isolateModules
  return svc;
};

// Drain enough microtasks for the watcher's first poll to settle.
// Each poll path is up to ~5 awaits deep (callable → response → toOrder
// map → cb). 10 cycles is plenty and still <1ms.
const flushPolls = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  __resetHttpsCallable();
  Platform.OS = 'ios'; // exercise the native polling path
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('orderService.watchShopOrders contract', () => {
  test('success: cb(data, undefined) on first poll', async () => {
    __setHttpsCallable(name => {
      if (name !== 'listShopOrders') {
        return async () => {
          throw new Error(`unexpected callable ${name}`);
        };
      }
      return async () => ({
        data: [
          { id: 'o1', shopId: 's1', createdAt: 0, statusHistory: [] },
        ],
      });
    });
    const orderService = loadOrderService();
    const calls: any[] = [];
    const off = orderService.watchShopOrders('s1', (orders, err) => {
      calls.push({ orders, err });
    });

    // First poll fires immediately. Drain microtasks.
    await flushPolls();

    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0].err).toBeUndefined();
    expect(calls[0].orders).toHaveLength(1);
    expect(calls[0].orders[0].id).toBe('o1');

    off();
  });

  test('failure: cb([], error) on first poll — never silently swallows', async () => {
    __setHttpsCallable(() => async () => {
      throw new Error('PERMISSION_DENIED');
    });
    const orderService = loadOrderService();
    const calls: any[] = [];
    const off = orderService.watchShopOrders('s1', (orders, err) => {
      calls.push({ orders, err });
    });

    await flushPolls();

    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0].err).toBeInstanceOf(Error);
    expect(calls[0].err.message).toBe('PERMISSION_DENIED');
    expect(calls[0].orders).toEqual([]);

    off();
  });

  test('cleanup: cancellation prevents further callbacks', async () => {
    let resolveSecond: ((v: any) => void) | null = null;
    let invocations = 0;
    __setHttpsCallable(() => async () => {
      invocations += 1;
      if (invocations === 1) {
        return { data: [] };
      }
      // 2nd poll never resolves until we let it.
      return new Promise(r => {
        resolveSecond = r;
      });
    });
    const orderService = loadOrderService();
    const calls: any[] = [];
    const off = orderService.watchShopOrders('s1', (orders, err) => {
      calls.push({ orders, err });
    });
    await flushPolls();
    expect(calls).toHaveLength(1);

    // Trigger 2nd poll, then unsubscribe before it resolves.
    jest.advanceTimersByTime(10000);
    off();
    if (resolveSecond) (resolveSecond as any)({ data: [{ id: 'late' }] });
    await flushPolls();

    // Second result must NOT reach the callback.
    expect(calls).toHaveLength(1);
  });
});

describe('orderService.watchOrder contract', () => {
  test('success: cb(order, undefined)', async () => {
    __setHttpsCallable(name => {
      if (name !== 'getOrder') {
        return async () => {
          throw new Error(`unexpected callable ${name}`);
        };
      }
      return async () => ({
        data: { id: 'o1', shopId: 's1', createdAt: 0, statusHistory: [] },
      });
    });
    const orderService = loadOrderService();
    const calls: any[] = [];
    const off = orderService.watchOrder('o1', (order, err) => {
      calls.push({ order, err });
    });
    await flushPolls();

    expect(calls[0].err).toBeUndefined();
    expect(calls[0].order?.id).toBe('o1');

    off();
  });

  test('not-found: cb(null, undefined) — does NOT use the error path', async () => {
    __setHttpsCallable(() => async () => {
      const e: any = new Error('Order not found');
      e.code = 'functions/not-found';
      throw e;
    });
    const orderService = loadOrderService();
    const calls: any[] = [];
    const off = orderService.watchOrder('o1', (order, err) => {
      calls.push({ order, err });
    });
    await flushPolls();

    // Per orderService.watchOrder semantics: not-found is a normal
    // "missing" state, not an error. UI renders an EmptyState rather
    // than a retry banner.
    expect(calls[0].err).toBeUndefined();
    expect(calls[0].order).toBeNull();

    off();
  });

  test('other failure: cb(null, error)', async () => {
    __setHttpsCallable(() => async () => {
      throw new Error('boom');
    });
    const orderService = loadOrderService();
    const calls: any[] = [];
    const off = orderService.watchOrder('o1', (order, err) => {
      calls.push({ order, err });
    });
    await flushPolls();

    expect(calls[0].err).toBeInstanceOf(Error);
    expect(calls[0].err.message).toBe('boom');
    expect(calls[0].order).toBeNull();

    off();
  });
});

describe('orderService.watchAllOrders contract', () => {
  test('failure: cb([], error) — was previously silent', async () => {
    __setHttpsCallable(() => async () => {
      throw new Error('PERMISSION_DENIED');
    });
    const orderService = loadOrderService();
    const calls: any[] = [];
    const off = orderService.watchAllOrders((orders, err) => {
      calls.push({ orders, err });
    });
    await flushPolls();

    expect(calls[0].err).toBeInstanceOf(Error);
    expect(calls[0].orders).toEqual([]);

    off();
  });
});

describe('orderService.watchAvailableDeliveries contract', () => {
  test('failure: cb([], error)', async () => {
    __setHttpsCallable(() => async () => {
      throw new Error('rate-limited');
    });
    const orderService = loadOrderService();
    const calls: any[] = [];
    const off = orderService.watchAvailableDeliveries((orders, err) => {
      calls.push({ orders, err });
    });
    await flushPolls();

    expect(calls[0].err).toBeInstanceOf(Error);
    expect(calls[0].err.message).toBe('rate-limited');
    expect(calls[0].orders).toEqual([]);

    off();
  });
});

describe('orderService.watchMyDeliveries contract', () => {
  test('failure: cb([], error)', async () => {
    __setHttpsCallable(() => async () => {
      throw new Error('offline');
    });
    const orderService = loadOrderService();
    const calls: any[] = [];
    const off = orderService.watchMyDeliveries((orders, err) => {
      calls.push({ orders, err });
    });
    await flushPolls();

    expect(calls[0].err).toBeInstanceOf(Error);
    expect(calls[0].err.message).toBe('offline');
    expect(calls[0].orders).toEqual([]);

    off();
  });
});

