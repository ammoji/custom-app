/**
 * HOTFIX-JEST-PROJECTS-CONFIG — DO NOT REMOVE.
 *
 * Root jest config so a bare `npx jest` (the command everyone naturally
 * runs) routes through the real project configs instead of jest's
 * zero-config default. The default matched every `*.test.ts` in the repo
 * with NO moduleNameMapper, so files that import `react-native` /
 * `@react-native-firebase/*` crashed at parse time ("Cannot use import
 * statement outside a module"). That made the suite look ~27 suites
 * broken when in reality all 1601 logic tests pass under the mapped
 * config — the test discipline was sound; the entrypoint was not.
 *
 * Projects model:
 *   - 'logic'  → tests/jest.unit.config.js. Node env + ts-jest +
 *                moduleNameMapper stubbing RN / RNFB / firebase. This is
 *                the entire unit/logic/service/hook/store/screen-logic
 *                suite. Runs by default on `npx jest` and `npm test`.
 *   - 'rules'  → tests/jest.config.js. Firestore-rules suites that need
 *                the Auth + Firestore emulators. INTENTIONALLY excluded
 *                from the default run (it would fail without a live
 *                emulator). Boot it via `npm run test:rules`, which
 *                wraps it in `firebase emulators:exec`.
 *
 * There is no separate RN-render 'components' project: this codebase has
 * zero `.test.tsx` render tests by design — screen/hook behaviour is
 * extracted into pure functions tested in Node (see the header of
 * tests/jest.unit.config.js). A jest-expo / jsdom project would add a new
 * dependency (out of scope) and match zero tests today.
 */
module.exports = {
  projects: ['<rootDir>/tests/jest.unit.config.js'],
};
