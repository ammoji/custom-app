/**
 * Jest config for Firestore rules tests.
 *
 * Lives under tests/ so the app's tsconfig + Expo/Metro tooling stays
 * untouched. Run via `npm run test:rules`, which boots the Firestore +
 * Auth emulators and points this Jest run at them.
 */
module.exports = {
  rootDir: '..',
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
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
