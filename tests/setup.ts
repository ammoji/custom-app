/**
 * Per-suite lifecycle helpers. Imported by each test file rather than
 * registered as a Jest global setup — keeps the wiring explicit and
 * easy to opt out of for one-off debugging.
 */
import { getEnv } from './helpers';

/**
 * Hook a Jest suite into the shared RulesTestEnvironment:
 *   - beforeAll: ensure env is initialized
 *   - beforeEach: clear all Firestore docs so tests don't leak state
 *   - afterAll: cleanup is left to the very last suite via env.cleanup()
 *     (registered once in a top-level afterAll below)
 */
export function useRulesTestEnv() {
  beforeEach(async () => {
    const env = await getEnv();
    await env.clearFirestore();
  });
}

// Cleanup the singleton env after the very last test in the run.
// Jest invokes top-level afterAll once per file; the env.cleanup()
// call is idempotent for already-stopped envs.
afterAll(async () => {
  const env = await getEnv().catch(() => null);
  if (env) {
    try {
      await env.cleanup();
    } catch {
      // Already cleaned up in another file — ignore.
    }
  }
});
