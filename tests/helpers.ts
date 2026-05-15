/**
 * Test helpers for Firestore rules tests.
 *
 * `getEnv()` lazily initializes a single RulesTestEnvironment shared
 * across the suite. `ctxFor()` mints a Firestore client for a specific
 * role (anon / customer / admin / shopOwner / delivery). Seed data via
 * `seed()`, which uses withSecurityRulesDisabled so setup never has to
 * fight the rules under test.
 */
import {
    initializeTestEnvironment,
    RulesTestEnvironment,
    TokenOptions,
} from '@firebase/rules-unit-testing';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ID = 'grocery-mvp-test';

export type Role =
  | { kind: 'anon' }
  | { kind: 'user'; uid: string }
  | { kind: 'admin'; uid: string }
  | { kind: 'shopOwner'; uid: string; shopId: string }
  | { kind: 'delivery'; uid: string };

let envPromise: Promise<RulesTestEnvironment> | null = null;

export function getEnv(): Promise<RulesTestEnvironment> {
  if (!envPromise) {
    envPromise = initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: fs.readFileSync(
          path.resolve(__dirname, '..', 'firestore.rules'),
          'utf8',
        ),
        // host/port picked up from FIRESTORE_EMULATOR_HOST set by
        // `firebase emulators:exec`. No need to hard-code.
      },
    });
  }
  return envPromise!;
}

export function ctxFor(env: RulesTestEnvironment, role: Role) {
  switch (role.kind) {
    case 'anon':
      return env.unauthenticatedContext();
    case 'user':
      return env.authenticatedContext(role.uid);
    case 'admin': {
      const claims: TokenOptions = { admin: true };
      return env.authenticatedContext(role.uid, claims);
    }
    case 'shopOwner': {
      // Mirrors the real custom-claim shape set by mergeCustomClaims
      // in functions/src/index.ts (shopOwner: true + shopId: '<id>').
      const claims: TokenOptions = {
        shopOwner: true,
        shopId: role.shopId,
      };
      return env.authenticatedContext(role.uid, claims);
    }
    case 'delivery': {
      const claims: TokenOptions = { delivery: true };
      return env.authenticatedContext(role.uid, claims);
    }
  }
}

/**
 * Seed Firestore docs bypassing rules. Each call gets a fresh
 * admin-context so writes don't leak between test files.
 */
export async function seed(
  env: RulesTestEnvironment,
  fn: (db: FirebaseFirestore.Firestore) => Promise<void>,
): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    // The rules-unit-testing SDK returns a Web Firestore instance, but
    // the type doesn't matter for set/get inside seed helpers.
    await fn(ctx.firestore() as unknown as FirebaseFirestore.Firestore);
  });
}

/** Convenience: doc() ref via the web SDK's modular API surface. */
export { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';

