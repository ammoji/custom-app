/**
 * Jest config for Firestore rules tests.
 *
 * Lives under tests/ so the app's tsconfig + Expo/Metro tooling stays
 * untouched. Run via `npm run test:rules`, which boots the Firestore +
 * Auth emulators and points this Jest run at them.
 *
 * testMatch is deliberately narrow: only `tests/rules/**` and
 * `tests/contracts/**` belong here. Everything else (services, hooks,
 * functions, store, utils, screens, scripts) is unit-style and runs
 * via the OTHER config — `tests/jest.unit.config.js`, invoked by
 * `npm test`. That config has moduleNameMapper entries to stub out
 * react-native / @react-native-firebase / firebase/firestore so the
 * tests run in plain Node.
 *
 * Historical note: this file used to match `tests/**` which roped in
 * unit suites; they failed with "Unexpected token 'export'" because
 * this config has no RN/Expo transform set up. Same tests run clean
 * under the unit config. Narrowed in PR 12 deploy prep after the
 * confusion surfaced.
 */
module.exports = {
  rootDir: '..',
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/tests/rules/**/*.test.ts',
    '<rootDir>/tests/contracts/**/*.test.ts',
  ],
  testTimeout: 15000,
  // Force serial execution: every test file shares the same emulator
  // instance and clears Firestore between tests. Running in parallel
  // would have suites stomp each other's seed data.
  maxWorkers: 1,
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tests/tsconfig.json',
      isolatedModules: true,
    },
  },
};
