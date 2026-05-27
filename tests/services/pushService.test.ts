/**
 * PR 45 — Tests for `pushService.registerForPushNotifications`.
 *
 * The pre-PR-45 pipeline had zero coverage. This suite pins every
 * branch in the registration flow:
 *   - Web / simulator / permission skips → return null, no side
 *     effects beyond Sentry breadcrumbs
 *   - Permission denied → captureMessage at 'info'
 *   - Missing projectId → captureMessage at 'warning'
 *   - getExpoPushTokenAsync throws → captureException tagged
 *     `getExpoPushTokenAsync`, return null (NOT throw)
 *   - Happy path → callable invoked with { token }, breadcrumb
 *     'backend write ok', token returned
 *   - Callable rejects → captureException tagged
 *     `registerPushToken_callable` AND the promise rejects (key
 *     contract for AuthBootstrap's retry gate)
 *   - Android → both default + admin-alerts channels set
 *
 * Mocks the expo / firebase SDK boundaries; the SUT runs in plain
 * Node.
 */

// Mutable mock state — tests reset + reconfigure between cases.
type Status = 'granted' | 'denied' | 'undetermined';
const mockState = {
  isDevice: true,
  permission: 'granted' as Status,
  permissionAfterRequest: 'granted' as Status,
  projectId: 'fake-project-id' as string | undefined,
  tokenAsyncImpl: async (_opts: unknown) => ({ data: 'ExponentPushToken[abc]' }),
  callableImpl: jest.fn() as jest.Mock,
  setChannelCalls: [] as string[],
};

jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: mockState.permission })),
  requestPermissionsAsync: jest.fn(async () => ({
    status: mockState.permissionAfterRequest,
  })),
  getExpoPushTokenAsync: jest.fn(async (opts: unknown) =>
    mockState.tokenAsyncImpl(opts),
  ),
  setNotificationChannelAsync: jest.fn(async (id: string, _cfg: unknown) => {
    mockState.setChannelCalls.push(id);
  }),
}));

jest.mock('expo-device', () => ({
  get isDevice() {
    return mockState.isDevice;
  },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockState.projectId
        ? { extra: { eas: { projectId: mockState.projectId } } }
        : { extra: {} };
    },
  },
}));

// RNFB native functions handle — services/pushService.ts uses this
// when isNative === true (Platform.OS !== 'web').
jest.mock('@react-native-firebase/app', () => ({
  firebase: {
    app: () => ({
      functions: (_region: string) => ({
        httpsCallable: (_name: string) =>
          (args: unknown) => mockState.callableImpl(args),
      }),
    }),
  },
}));
jest.mock('@react-native-firebase/functions', () => ({}));

// Sentry capture sink. jest.unit.config.js maps './sentry' to an
// external __mocks__ file (so other tests reuse it), which means
// jest.mock() inside this file would be ignored. Instead, import
// the mock module directly and spy on its methods.
// The moduleNameMapper rewrite for `./sentry` only fires for that
// EXACT relative spec (used inside src/services/*). Importing the
// service path directly would load the real `@sentry/react-native`
// (ESM, breaks ts-jest). Pull from the __mocks__ file by path —
// same object the mapper hands to pushService.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Sentry: sentryReal } = require('../__mocks__/services-sentry');
const sentryMock = {
  addBreadcrumb: jest.spyOn(sentryReal, 'addBreadcrumb'),
  captureException: jest.spyOn(sentryReal, 'captureException'),
  captureMessage: jest.spyOn(sentryReal, 'captureMessage'),
};

// firebase/functions web variant — not actually exercised on native,
// but the import statement loads at module scope.
jest.mock('firebase/functions', () => ({
  httpsCallable: () => (args: unknown) => mockState.callableImpl(args),
}));
jest.mock('../../src/services/firebase', () => ({ functions: {} }));

// react-native Platform — the shared mock reads from globalThis.
const setPlatform = (os: 'ios' | 'android' | 'web') => {
  (globalThis as any).__rn_platform_os = os;
};

// Load AFTER mocks are configured.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pushService } = require('../../src/services/pushService');

const resetMocks = () => {
  mockState.isDevice = true;
  mockState.permission = 'granted';
  mockState.permissionAfterRequest = 'granted';
  mockState.projectId = 'fake-project-id';
  mockState.tokenAsyncImpl = async () => ({ data: 'ExponentPushToken[abc]' });
  mockState.callableImpl = jest.fn(async () => ({ data: { ok: true } })) as jest.Mock;
  mockState.setChannelCalls = [];
  sentryMock.addBreadcrumb.mockClear();
  sentryMock.captureException.mockClear();
  sentryMock.captureMessage.mockClear();
  setPlatform('ios');
};

describe('PR 45 — pushService.registerForPushNotifications', () => {
  beforeEach(() => {
    resetMocks();
  });

  test('emits a "register: start" breadcrumb on every call', async () => {
    await pushService.registerForPushNotifications();
    const messages = sentryMock.addBreadcrumb.mock.calls.map(
      c => (c[0] as { message: string }).message,
    );
    expect(messages).toContain('register: start');
  });

  test('returns null on web — no token fetch attempted', async () => {
    setPlatform('web');
    const r = await pushService.registerForPushNotifications();
    expect(r).toBeNull();
    expect(sentryMock.captureException).not.toHaveBeenCalled();
    expect(mockState.callableImpl).not.toHaveBeenCalled();
  });

  test('returns null on simulator', async () => {
    mockState.isDevice = false;
    const r = await pushService.registerForPushNotifications();
    expect(r).toBeNull();
    expect(mockState.callableImpl).not.toHaveBeenCalled();
  });

  test('permission denied → captureMessage info, returns null', async () => {
    mockState.permission = 'denied';
    mockState.permissionAfterRequest = 'denied';
    const r = await pushService.registerForPushNotifications();
    expect(r).toBeNull();
    expect(sentryMock.captureMessage).toHaveBeenCalledWith(
      'push registration: permission not granted',
      'info',
    );
    expect(mockState.callableImpl).not.toHaveBeenCalled();
  });

  test('missing EAS projectId → captureMessage warning, returns null', async () => {
    mockState.projectId = undefined;
    const r = await pushService.registerForPushNotifications();
    expect(r).toBeNull();
    expect(sentryMock.captureMessage).toHaveBeenCalledWith(
      'push registration: no EAS projectId',
      'warning',
    );
  });

  test('getExpoPushTokenAsync throws → captureException with stage tag, returns null (no re-throw)', async () => {
    const apnError = new Error('APN credential missing');
    mockState.tokenAsyncImpl = async () => {
      throw apnError;
    };
    const r = await pushService.registerForPushNotifications();
    expect(r).toBeNull();
    expect(sentryMock.captureException).toHaveBeenCalledWith(
      apnError,
      { tags: { push_stage: 'getExpoPushTokenAsync' } },
    );
    // Token-mint failure is the device's fault — no point retrying
    // this session. Returns null rather than throwing so the
    // orchestrator marks the outcome 'skipped' (not 'failed').
  });

  test('happy path → callable invoked with token, breadcrumb fires, token returned', async () => {
    const r = await pushService.registerForPushNotifications();
    expect(r).toBe('ExponentPushToken[abc]');
    expect(mockState.callableImpl).toHaveBeenCalledWith({
      token: 'ExponentPushToken[abc]',
    });
    const messages = sentryMock.addBreadcrumb.mock.calls.map(
      c => (c[0] as { message: string }).message,
    );
    expect(messages).toContain('register: token obtained');
    expect(messages).toContain('register: backend write ok');
  });

  test('CRITICAL: callable rejects → captureException tagged, AND the promise re-throws', async () => {
    // This is the closure-gate regression contract. AuthBootstrap's
    // orchestrator distinguishes 'skipped' (null token) from
    // 'failed' (thrown) based on whether THIS promise rejects.
    // Pre-PR-45 it always resolved; the orchestrator could never
    // tell a real failure from a permission skip.
    const callableError = new Error('functions/internal');
    mockState.callableImpl = jest.fn(async () => {
      throw callableError;
    }) as jest.Mock;
    await expect(
      pushService.registerForPushNotifications(),
    ).rejects.toBe(callableError);
    expect(sentryMock.captureException).toHaveBeenCalledWith(
      callableError,
      { tags: { push_stage: 'registerPushToken_callable' } },
    );
  });

  test('Android → both default + admin-alerts channels configured', async () => {
    setPlatform('android');
    await pushService.registerForPushNotifications();
    expect(mockState.setChannelCalls).toEqual(['default', 'admin-alerts']);
  });

  test('iOS → no notification channels touched (Android-only feature)', async () => {
    setPlatform('ios');
    await pushService.registerForPushNotifications();
    expect(mockState.setChannelCalls).toEqual([]);
  });
});
