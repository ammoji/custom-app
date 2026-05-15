# Cleanup script — Windsurf prompt (`scripts/reset-test-data.ts`)

## Why this PR exists

After Phase 12c finishes and we've finished a round of solo + automated
testing, the dev project will be full of test orders, test sign-ins,
ad-hoc admin-approved shops, half-edited menus, etc. Before the
family-of-five role-play session, we need the dev project to feel like
"real users walking up to the app for the first time" — fresh user
sign-ins, no prior orders, shops that go through the registration +
approval flow as actual workflow rather than as legacy state.

This script is the data-wipe that gets us there. It is **destructive
by design** — it deletes Firestore docs and Firebase Auth users — so
the prompt is specified more strictly than usual. Treat the safety
guards as non-negotiable.

## Read first

- **`.windsurf/test-discipline.md`** — established post-v2-iii hotfix.
  **Tests run once at the end of the PR**, not iteratively. Two
  commands the repo now exposes: `npm test` (audit + unit, ~15s) and
  `npm run test:full` (audit + unit + rules, ~45s). Pick the
  narrowest one your changes warrant.
- `.windsurf/deploy-discipline.md`
- Existing utility scripts for tone / pattern reference:
  - `scripts/seed.ts`
  - `scripts/set-admin.ts`
  - `scripts/set-shop-owner.ts`
  - `scripts/backfill-shop-menus.ts`
- `firestore.rules` (so the script's deletion paths line up with the
  real schema, particularly `shops/{shopId}/menu` subcollection)
- `tests/jest.unit.config.js` and `tests/__mocks__/` — unit-test infra
  to extend (do **not** fork; add a new `tests/scripts/` directory
  using the existing config)

## Scope (in)

1. New script: `scripts/reset-test-data.ts` (TypeScript, run via `tsx`
   like the other scripts).
2. New npm script in root `package.json`:
   - `"reset:test-data": "tsx scripts/reset-test-data.ts"`
3. New directory: `scripts/.cleanup-logs/` with a `.gitkeep` and added
   to `.gitignore` (audit logs go here, not committed).
4. `PRELAUNCH_CHECKLIST.md` — new section under Testing called
   "Resetting test data" documenting how to use the script and what
   it wipes / preserves.

## Scope (out — explicitly defer)

- Razorpay test-payment cleanup (external system, dev-mode payments
  are inert; just print a warning at the end of execution).
- Cloud Storage cleanup (no uploads yet; revisit when image upload
  ships).
- Cloud Functions log cleanup (separate ops concern).
- Cloud Scheduler job state (no scheduled jobs deleting / mutating
  data right now).
- Production-targeting code paths — script must refuse to run against
  prod, full stop. Do not add a "prod mode with extra confirmation"
  flag.

## Behaviour spec

### Default invocation: dry-run

```
npm run reset:test-data
```

- Connects to dev project.
- Counts what would be deleted in each category.
- Prints a table:

```
DRY RUN — nothing will be deleted.
Project: grocery-mvp-dev

Would delete:
  Orders:           42 docs
  Shops:            10 docs (each with N menu items, total 340 menu docs)
  User profiles:    7 docs (excluding admin UID xxx)
  Auth users:       7 accounts (excluding admin UID xxx)

Would preserve:
  /products:        ~120 docs (untouched)
  Admin user:       UID xxx, claims {admin: true}
  Service accounts: untouched

To actually delete, re-run with --execute.
```

- Exits 0.

### Real run

```
npm run reset:test-data -- --execute
```

- Same counts as dry-run.
- **Interactive confirmation** prompt:

```
This will permanently delete the data above from project
"grocery-mvp-dev". Type the project ID to confirm: _
```

- If the user types anything other than the exact project ID
  (`grocery-mvp-dev`), abort with exit 1, no data touched.
- If user types it correctly, proceed with deletion.
- Print progress per phase:

```
[1/5] Deleting orders... 42/42 ✓
[2/5] Deleting shop menu subcollections... 340/340 ✓
[3/5] Deleting shop docs... 10/10 ✓
[4/5] Deleting user profile docs... 7/7 ✓
[5/5] Deleting Auth users... 7/7 ✓
```

- Write audit log to
  `scripts/.cleanup-logs/{ISO-timestamp}.json` containing:
  - script version / git SHA at run time
  - operator (whoever ran it — pull from `git config user.email`)
  - project ID
  - dry-run flag
  - per-phase counts (planned vs actually deleted)
  - any errors

### Flag matrix

| Flag | Effect | Default |
|---|---|---|
| `--execute` | Actually delete; without it, dry-run | false |
| `--keep-shops` | Delete orders + users + auth, but keep `/shops` and `/shops/*/menu` intact | false |
| `--keep-orders` | Wipe everything except `/orders` (rare; lets you debug an order in isolation while resetting users) | false |
| `--no-confirm` | Skip interactive confirmation (CI use; dangerous — but `--execute` still required separately) | false |
| `--admin-uid=<uid>` | Override which UID is protected from deletion | reads from `ADMIN_PROTECT_UID` env var |

`--no-confirm` + `--execute` together still require **both** flags
explicitly — never make destruction a single-flag operation.

## Safety guards (mandatory; PR rejected if any missing)

1. **Project ID allowlist.** First thing the script does after init:
   read the project ID from the Admin SDK. If it is **not** in
   `['grocery-mvp-dev']`, abort with a loud error:

   ```
   REFUSING TO RUN. Detected project: <projectId>.
   This script only runs against grocery-mvp-dev.
   If you really need to wipe a different project, edit the
   ALLOWED_PROJECTS constant in scripts/reset-test-data.ts and commit
   a separate change for review.
   ```

   Hardcode the allowlist as a `const ALLOWED_PROJECTS = ['grocery-mvp-dev'] as const;`
   at the top of the file. **Do not** accept it via flag or env var.

2. **Admin UID protection.** Read `ADMIN_PROTECT_UID` from env (or
   `--admin-uid` flag). If unset, abort with:

   ```
   REFUSING TO RUN. ADMIN_PROTECT_UID env var must be set to the UID
   of the admin account that should NOT be deleted. Find your UID in
   Firebase Console → Authentication → Users. Then run:
     $env:ADMIN_PROTECT_UID="abc123..."
   ```

   In every deletion phase that touches users (steps 4 and 5), filter
   out the protected UID and assert that **at least one** record was
   filtered out. If zero matched, abort — that means either the UID
   is wrong or the admin account was already deleted, both of which
   warrant operator attention.

3. **Service account scope check.** Print the service account email
   and project at startup. If the email contains `prod` or doesn't
   contain `dev`, warn but don't abort (judgment call belongs to the
   operator, but they should see it loud).

4. **Atomic per-doc deletion.** Use Firestore batched writes
   (max 500 per batch). On batch failure, log the failed doc IDs to
   the audit log and continue with the next batch — don't crash mid-run
   leaving partial state with no record of what got deleted.

5. **No `db.recursiveDelete`.** Use explicit subcollection traversal
   (e.g. for `shops/{shopId}/menu`). The recursive delete is fine in
   theory but obscures what was deleted; explicit is safer for an
   audited script.

6. **Idempotency.** Running the script twice in a row must succeed
   the second time with all counts at 0. No "already deleted" errors.

## Tests (mandatory, per `.windsurf/test-discipline.md`)

Add `tests/scripts/reset-test-data.test.ts` extending the existing
`tests/jest.unit.config.js` infra. The script's high-stakes pure
logic is the project guard, the admin-UID-protection filter, the
flag parser, and the deletion-plan computation — all of which are
testable without touching firebase-admin.

Refactor the script so those pieces are exported helpers (e.g.
`assertProjectAllowed(projectId)`, `protectAdminFromUserList(users, adminUid)`,
`parseFlags(argv)`, `buildDeletionPlan(snapshots, options)`) and
unit-test them directly. The `main()` function that wires
firebase-admin together stays untested at the unit level — that's
what the dry-run + abort-path manual demos in §Acceptance prove.

Required tests (≥10, exact split flexible):

- `assertProjectAllowed` accepts `grocery-mvp-dev`
- `assertProjectAllowed` rejects `grocery-mvp` (prod)
- `assertProjectAllowed` rejects empty string / undefined
- `protectAdminFromUserList` filters out the admin UID
- `protectAdminFromUserList` throws if the admin UID isn't in the input
  (the "at least one filtered" assertion)
- `parseFlags` defaults to dry-run when no flags
- `parseFlags` requires both `--execute` AND interactive confirm to
  proceed (interactive is mocked / stubbed)
- `parseFlags` accepts `--keep-shops` and produces the right
  deletion plan
- `parseFlags` accepts `--keep-orders` and produces the right
  deletion plan
- `parseFlags` rejects `--no-confirm` without `--execute`

Add a deliberate-break demo in the final report: revert the
`assertProjectAllowed` to accept any project (i.e. weaken the guard),
confirm at least one test fails by name, re-apply the fix, confirm
green. Same ritual as the rules-test PR and the v2-iii hotfix PR.

## What gets preserved (must NOT be touched)

- `/products` collection — full catalog, expensive to rebuild.
- The admin UID's Auth account and its custom claims.
- Service accounts (Cloud Functions, Compute Engine SA, etc. — the
  script shouldn't go anywhere near IAM).
- Cloud Functions deployments.
- Firestore rules / indexes.
- Any docs in collections not explicitly listed in the deletion plan
  (the script must be **allowlist-based**, not denylist — only delete
  from collections it explicitly knows about).

## What gets deleted (default `--execute` behaviour, no other flags)

In strict order:

1. `/orders/*` — all docs.
2. For each `/shops/{shopId}`: delete the `menu` subcollection (all
   docs).
3. `/shops/{shopId}` — all shop docs.
4. `/users/{uid}` — all docs except `uid === ADMIN_PROTECT_UID`.
5. Firebase Auth users — all except `ADMIN_PROTECT_UID`. Use
   `auth.deleteUsers([uids])` in batches of 1000.

After step 5, print a summary and a note:

```
✓ Cleanup complete. Audit log: scripts/.cleanup-logs/2026-05-15T....json

Notes:
  • Test payments in Razorpay test dashboard remain (they're inert).
  • Firebase Auth deletions free up the test phone numbers — fresh
    OTPs will work immediately.
  • Custom claims (shopOwner, delivery) for deleted users are gone
    automatically; the admin claim on UID xxx is preserved.

Next step (if prepping for family role-play):
  1. Sign your admin phone in (custom claim already attached).
  2. Family members sign in fresh on test phone numbers.
  3. Phones B and C register shops via "Open a shop on Kirana Mart".
  4. You approve via Pending Shop Approvals → bootstrapShopMenu fires.
  5. Customer testing begins.
```

## Acceptance checklist (Windsurf must verify)

- [ ] `npm run reset:test-data` runs in dry-run mode by default and
      exits without modifying any data. Prove by running it twice and
      showing identical counts both times.
- [ ] Without `ADMIN_PROTECT_UID` set, the script refuses to run.
- [ ] With `ADMIN_PROTECT_UID` set to a UID that doesn't exist in the
      project, the script refuses to run (the "at least one filtered"
      assertion fires).
- [ ] Project guard works: if you temporarily change the project ID
      (use a hardcoded test override in a throwaway commit), the
      script aborts. Demonstrate by including the captured error
      output. Revert the override.
- [ ] Real `--execute` run on dev project successfully wipes seeded
      test data. Show before / after Firestore counts (use `firebase
      firestore:read` or write a tiny diagnostic script that calls
      `.count()` on each collection).
- [ ] Re-run after a successful execute returns 0 / 0 / 0 counts
      (idempotency).
- [ ] `--keep-shops` preserves `/shops` and their menu subcollections
      while still wiping orders + users + auth.
- [ ] Audit log file is written, parseable JSON, with all required
      fields.
- [ ] `npm test` passes (audit + 24+N unit tests where N is the
      count added in this PR; expect ≥10 new from §Tests).
- [ ] Deliberate-break demo executed and reverted; output captured
      in the report.
- [ ] No new TypeScript errors (baseline of 11 preserved).
- [ ] Tests run **once** at the very end, plus the deliberate-break
      cycle. No iterative re-runs during development. (Per
      `.windsurf/test-discipline.md`.)

## Important: do not run the script against the dev project as part
of acceptance unless explicitly necessary

Running the dry-run is fine and required. For the real `--execute`
demonstration, **first ask Sudhir** before doing it. He may want to
preserve current dev state until after his solo testing wraps. If
asked to demonstrate execute, do it on a small subset first
(temporarily seed 2-3 throwaway docs in a non-`/products`/`/shops`
collection like `/cleanup_test_dummy`, point the script at deleting
those instead, prove the mechanism works, then do a full run only on
explicit go-ahead).

Default to demonstrating just dry-run + the abort paths + the
idempotency claim via dry-run-twice.

## Reporting back

- Output of `npm run reset:test-data` (dry-run) showing counts.
- Output of running it without `ADMIN_PROTECT_UID` (showing abort).
- Output of running with bad `ADMIN_PROTECT_UID` (showing abort).
- Output of running with overridden project ID (showing abort).
- Confirmation that no real `--execute` was run, OR if it was, the
  audit log JSON contents.
- Full file listing of new files added (paths + line counts).
- The npm script you added.
- Any safety guards you considered adding beyond what's specified.

## Design notes for Windsurf

- The script will eventually be invoked manually from a developer's
  laptop, not from CI. Optimise for clarity over speed.
- Use `chalk` (or similar) for the terminal output if it's already a
  transitive dep; if not, just use ANSI escape codes for colour, no
  new dep.
- For interactive confirmation, use Node's built-in `readline` — no
  new dep.
- Print the elapsed time at the end. Operators want to know if it's
  going to take 30s or 30m.
- If you hit any case where the right behaviour is unclear, **ask
  Sudhir** before guessing. This script's blast radius warrants
  pausing for clarification.
