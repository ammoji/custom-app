/**
 * Jest config for unit tests (services, hooks, pure helpers, Cloud
 * Function logic). Keeps the existing rules-tests config intact —
 * those need the Firestore + Auth emulators and run via
 * `npm run test:rules`.
 *
 * This config:
 *   - testEnvironment: node — no jsdom needed; we don't render JSX.
 *     Hooks are tested by extracting their pure load logic into
 *     standalone async functions; the React wrapper is a thin shim.
 *   - moduleNameMapper stubs out modules that pull in native code
 *     (react-native, @react-native-firebase/*, firebase/firestore,
 *     etc.) so tests can run in plain Node without a Metro bundle.
 *   - Different testMatch from jest.config.js so the rules suites
 *     don't get pulled in here.
 */
module.exports = {
  rootDir: '..',
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/tests/services/**/*.test.ts',
    '<rootDir>/tests/hooks/**/*.test.ts',
    '<rootDir>/tests/functions/**/*.test.ts',
    '<rootDir>/tests/scripts/**/*.test.ts',
    '<rootDir>/tests/utils/**/*.test.ts',
    '<rootDir>/tests/store/**/*.test.ts',
    '<rootDir>/tests/contracts/**/*.test.ts',
    '<rootDir>/tests/screens/**/*.test.ts',
    '<rootDir>/tests/constants/**/*.test.ts',
  ],
  testTimeout: 10000,
  setupFiles: ['<rootDir>/tests/unit-setup.ts'],
  moduleNameMapper: {
    '^react-native$': '<rootDir>/tests/__mocks__/react-native.ts',
    '^@react-native-firebase/app$':
      '<rootDir>/tests/__mocks__/rnfb-app.ts',
    '^@react-native-firebase/functions$':
      '<rootDir>/tests/__mocks__/empty.ts',
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/tests/__mocks__/async-storage.ts',
    '^firebase/firestore$':
      '<rootDir>/tests/__mocks__/firebase-firestore.ts',
    '^firebase/functions$':
      '<rootDir>/tests/__mocks__/firebase-functions.ts',
    '^firebase/analytics$':
      '<rootDir>/tests/__mocks__/empty.ts',
    '^firebase/performance$':
      '<rootDir>/tests/__mocks__/empty.ts',
    '^@firebase/functions$':
      '<rootDir>/tests/__mocks__/firebase-functions.ts',
    // Match BOTH the bare module 'firebase/auth' usages and the
    // `./firebase` relative import inside src/services/*.ts. The
    // relative pattern uses Jest's regex on the request string —
    // services/orderService.ts says `from './firebase'`, which
    // Jest sees as './firebase' before resolution.
    '^\\./firebase$':
      '<rootDir>/tests/__mocks__/services-firebase.ts',
    '^\\./sentry$':
      '<rootDir>/tests/__mocks__/services-sentry.ts',
  },
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tests/tsconfig.json',
      isolatedModules: true,
      diagnostics: false,
    },
  },
};
