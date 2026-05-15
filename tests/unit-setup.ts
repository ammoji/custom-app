// Provide stand-in env vars so any code path that imports the real
// services/firebase before the moduleNameMapper picks it up doesn't
// throw on env validation. The mapper should catch most cases; this
// is a belt-and-suspenders for transitive imports.
process.env.EXPO_PUBLIC_FIREBASE_API_KEY ||= 'test-api-key';
process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ||= 'test.firebaseapp.com';
process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ||= 'test-project';
process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ||= 'test.appspot.com';
process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||= '0';
process.env.EXPO_PUBLIC_FIREBASE_APP_ID ||= 'test-app-id';

// __DEV__ is a global injected by Metro/Babel in RN bundles. The
// services use it to gate dev-only escape hatches (e.g.
// FORCE_SHOW_ALL_SHOPS_IN_DEV). Default to false so unit tests
// exercise production-shaped code paths.
(globalThis as any).__DEV__ = false;
