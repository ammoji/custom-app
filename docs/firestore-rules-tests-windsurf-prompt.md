# Firestore rules tests — Windsurf prompt

## Why this PR exists

Manual testing covers happy paths. Rules regressions are silent — a
weakened rule lets unauthorised reads/writes through and nothing
crashes; you find out when a customer can read someone else's order or
a shop owner edits another shop. We want emulator-based rules tests
that lock down current behaviour so any future rule edit (Phase 12c,
cleanup, future EditShop screen, etc.) breaks loudly.

This PR is intentionally scoped to **rules tests only**. No app code
changes. No Cloud Functions changes. No new app dependencies (the new
deps are dev-only).

## Read first

- `firestore.rules` — the surface under test (90 lines, simple)
- `.windsurf/deploy-discipline.md` — still applies; though this PR has
  no deploys, follow the "no piping output" and "audit first" parts

## Scope (in)

1. New `tests/` folder at repo root with rules test file(s).
2. New dev dependencies: `@firebase/rules-unit-testing`, `jest`,
   `@types/jest`, `ts-jest`. Pinned to versions compatible with Node
   20 (Sudhir runs Node 20.x).
3. New `tests/jest.config.js` and `tests/tsconfig.json` (don't pollute
   the app's tsconfig — rules tests run in a separate context with a
   different module target).
4. Update `firebase.json` to add `emulators` block for `firestore` +
   `auth` on default ports. Hosting/functions emulators NOT needed.
5. New npm scripts in root `package.json`:
   - `"test:rules"` — runs `firebase emulators:exec --only firestore,auth "jest --config tests/jest.config.js"`
   - `"test:rules:watch"` — same but with `--watch` (developer convenience)
6. Update `.gitignore` if any test artifacts (coverage, .firebase/) need to be excluded.
7. New section in `PRELAUNCH_CHECKLIST.md` documenting how to run the
   tests locally and what they cover.

## Scope (out — explicitly defer)

- Cloud Functions unit tests (separate PR)
- React component tests (skip until UI stabilises post-cleanup)
- Detox / E2E (skip until production role-play)
- Storage rules tests (revisit when we wire image uploads)
- CI integration (no GitHub Actions / Cloud Build right now — Sudhir
  runs everything locally; add `gh` workflow later)

## Required test coverage

Every rule path in `firestore.rules` gets at least one **allow** test
and one **deny** test. Use named test contexts so failure messages are
human-readable.

### `/users/{uid}`

- `allow read` when caller uid === uid → ✅
- `allow write` when caller uid === uid → ✅
- `deny read` when caller is signed-in but different uid → ❌
- `deny write` when caller is signed-in but different uid → ❌
- `deny read` when caller is unauthenticated → ❌
- `deny read` even when caller is admin (admin doesn't get user-doc
  read access through rules — must go through Cloud Functions like
  `listAllUsers`) → ❌

### `/shops/{shopId}` — read

- Anonymous user: can read shop with `status: 'active'` → ✅
- Anonymous user: cannot read `status: 'pending'` → ❌
- Anonymous user: cannot read `status: 'suspended'` → ❌
- Anonymous user: cannot read `status: 'rejected'` → ❌
- Owner (uid matches `ownerUid`): can read their own pending shop → ✅
- Owner: can read their own suspended shop → ✅
- Admin: can read any pending/suspended/rejected shop → ✅
- Random signed-in user (not owner, not admin): cannot read pending → ❌
- **Edge:** shop with no `status` field at all (legacy pre-v2-i): the
  current rule requires `status == 'active'` for the public path —
  document the actual behaviour and pin it as a test (probably denies;
  if so, leave a TODO in the test referencing the
  `backfill-shop-menus.ts` legacy-status workaround).

### `/shops/{shopId}` — write

- Any caller (anon, signed-in, admin, owner): cannot create/update/delete → ❌
  (rule is `allow write: if false`; one test per role variant is enough,
  no need for exhaustive matrix)

### `/shops/{shopId}/menu/{menuItemId}`

- Anonymous user: can read → ✅
- Signed-in non-owner: can read → ✅
- Anyone (incl. shop owner of this shop, incl. admin): cannot create/update/delete → ❌
  (writes are funneled through `addCustomMenuItem` /
  `updateMenuItem` / `removeMenuItem` callables, never direct)

### `/products/{productId}`

- Anonymous: read ✅, write ❌
- Admin: read ✅, write ❌

### `/orders/{orderId}`

This is the most complex rule. Test matrix:

| Caller | Order state | Expected |
|---|---|---|
| Customer who placed it | any status | read ✅ |
| Different customer | any status | read ❌ |
| Admin | any status | read ✅ |
| Shop owner of order's shopId (claim matches) | any status | read ✅ |
| Shop owner of a DIFFERENT shop | any status | read ❌ |
| Shop owner with shopOwner=true but wrong shopId claim | any status | read ❌ |
| Delivery person, deliveryPersonId === their uid | any status | read ✅ |
| Delivery person, deliveryPersonId === some other uid | any status | read ❌ |
| Delivery person, status='out_for_delivery', deliveryPersonId=null | available | read ✅ |
| Delivery person, status='ready', deliveryPersonId=null | NOT yet out | read ❌ |
| Delivery person, status='out_for_delivery', deliveryPersonId set to other | claimed by someone else | read ❌ |
| Anonymous | any | read ❌ |
| Any caller (incl. admin) | — | create/update/delete ❌ |

## File layout

```
tests/
  jest.config.js
  tsconfig.json
  setup.ts                     # initialize test env, helper to seed docs
  helpers.ts                   # auth contexts: anon, customer, admin, etc.
  rules/
    users.test.ts
    shops.test.ts
    shopMenu.test.ts
    products.test.ts
    orders.test.ts
```

Keep each file under ~200 lines. If a file gets longer, split by rule
clause (e.g. `orders-customer.test.ts`, `orders-delivery.test.ts`).

## Reference helper sketch

`helpers.ts` should expose:

```ts
export type Role =
  | { kind: 'anon' }
  | { kind: 'user'; uid: string }
  | { kind: 'admin'; uid: string }
  | { kind: 'shopOwner'; uid: string; shopId: string }
  | { kind: 'delivery'; uid: string };

export function ctxFor(env: RulesTestEnvironment, role: Role) {
  switch (role.kind) {
    case 'anon':
      return env.unauthenticatedContext();
    case 'user':
      return env.authenticatedContext(role.uid);
    case 'admin':
      return env.authenticatedContext(role.uid, { admin: true });
    case 'shopOwner':
      return env.authenticatedContext(role.uid, {
        shopOwner: true,
        shopId: role.shopId,
      });
    case 'delivery':
      return env.authenticatedContext(role.uid, { delivery: true });
  }
}
```

Use `assertSucceeds` and `assertFails` from
`@firebase/rules-unit-testing` rather than try/catch.

Seed data via `env.withSecurityRulesDisabled` so tests don't have to
fight rules to set up state.

## Configuration

`firebase.json` add:

```json
"emulators": {
  "auth": { "port": 9099 },
  "firestore": { "port": 8080 },
  "ui": { "enabled": false },
  "singleProjectMode": true
}
```

`tests/jest.config.js`:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  testTimeout: 10000,
  setupFilesAfterEach: ['<rootDir>/tests/setup.ts'],
};
```

`tests/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "esModuleInterop": true,
    "strict": true,
    "types": ["jest", "node"],
    "rootDir": "."
  },
  "include": ["**/*.ts"]
}
```

## Acceptance checklist (Windsurf must verify)

- [ ] `npm install` succeeds with new dev deps. No conflicting peer
      dep warnings (Firebase v12 + rules-unit-testing v3+ should align).
- [ ] `npm run test:rules` runs the emulator, executes all tests,
      reports `0 failures`.
- [ ] Total test count is at least **35** (matches the matrix above
      with margin).
- [ ] Each test file is under 200 lines.
- [ ] Deliberately break one rule (e.g. change `orders` read to
      `if true`) and confirm at least 5 tests fail. Revert the rule
      after demonstrating. Include the failing-test output in the
      Windsurf report.
- [ ] `npm run audit` still passes (the new files shouldn't trigger
      any audit warnings).
- [ ] Existing `tsc --noEmit` for the app is unaffected. The 11
      pre-existing TS errors stay; **no new ones**.
- [ ] `PRELAUNCH_CHECKLIST.md` updated with a new "Testing" section
      explaining how to run rules tests.

## Reporting back

- npm install output (last 20 lines, no piping — paste raw).
- `npm run test:rules` output showing pass count.
- The deliberate-break demonstration: the diff that broke it, the
  failing test output, and confirmation it was reverted.
- Any rule behaviours you discovered along the way that surprised you
  (e.g. the legacy-status edge case). Don't fix surprising behaviours
  in this PR — log them as findings.

## What this PR is NOT trying to do

- Not trying to find rule bugs (we expect rules to pass — tests
  pin current behaviour).
- Not trying to refactor rules.
- Not trying to optimise rules for cost / performance.

If, while writing tests, you discover a rule that's clearly wrong
(e.g. allows a write that shouldn't), do **not** silently fix it.
Write the test to match the **current** rule behaviour, mark it
`test.skip` with a comment `// FIXME(rules-bug): see PR-N`, and report
the finding back to Sudhir at the end.
