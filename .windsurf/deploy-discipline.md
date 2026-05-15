# Firebase Deploy Discipline

**Status:** mandatory for all Windsurf sessions on this project.
**Reason:** in May 2026 a Windsurf-issued
`firebase deploy --only functions,firestore:rules,firestore:indexes 2>&1 | Select-Object -Last 80`
hung silently for 5+ hours. The pipe through `Select-Object` buffered all
stdout, hiding both the live progress bars **and** the interactive
`"Would you like to proceed with deletion of claimShop?"` prompt that
the CLI was waiting on. The user killed the Windsurf shell and re-ran
the same command in a real PowerShell window, where the prompt
appeared, was answered `Y`, and the deploy completed in ~6 minutes.

These rules exist to make that incident impossible to repeat.

## Rules

### 1. One `--only` target per command. Always.

Never bundle:

```powershell
# DON'T
firebase deploy --only functions,firestore:rules,firestore:indexes
```

Instead:

```powershell
# DO
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only storage:rules     # only if storage.rules changed
firebase deploy --only functions
```

Each command waits for the previous to finish. If one fails you know
exactly which one. Bundling makes the failure mode "everything is
half-deployed and you have to read 200 lines of output to find the
broken one."

### 2. Never pipe deploy output through anything.

Forbidden:

```powershell
firebase deploy --only functions | Select-Object -Last 80
firebase deploy --only functions | Out-File deploy.log
firebase deploy --only functions 2>&1 | Tee-Object deploy.log
firebase deploy --only functions > deploy.log 2>&1
```

`Select-Object` and `Out-File` both buffer stdout. The Firebase CLI
uses **interactive prompts** (delete-orphaned-functions, IAM grants,
quota confirmations) that read from stdin only when stdout is a TTY.
Buffering breaks that handshake; the CLI hangs forever waiting for
input that the user can't see they need to provide.

If you need the output saved, run it raw and let the user copy/paste:

```powershell
firebase deploy --only functions
# then user pastes the output back into Windsurf
```

### 3. Never run `firebase deploy` from Windsurf at all.

Even with all the rules above followed, Windsurf's shell wrappers can
buffer or drop stdin. The agent **must not auto-run** any
`firebase deploy ...` command. Instead, write the exact command the
user should paste into their own PowerShell window and ask them to
run it.

```text
Please run this in PowerShell (not Windsurf):

    firebase deploy --only functions

Then paste the last ~30 lines of output back here so I can verify.
```

### 4. Order of operations.

When a phase changes multiple Firebase artifacts, deploy in this
order, one at a time:

1. `firebase deploy --only firestore:rules` — fastest, ~30 sec.
   Failures here are syntax errors and abort cleanly.
2. `firebase deploy --only firestore:indexes` — ~30–60 sec.
   New composite indexes start building in the background; queries
   that need them will fail until the build finishes. Plan releases
   accordingly.
3. `firebase deploy --only storage:rules` — ~10 sec, only when
   `storage.rules` changed.
4. `firebase deploy --only functions` — 5–15 min for a full deploy.
   This is the one that has interactive prompts.

### 5. Functions deletion confirmations.

When source code drops a function that is still deployed (e.g. we
removed `claimShop` in Phase 12a-v2-i), the CLI asks:

```text
The following functions are found in your project but do not exist
in your local source code:
    claimShop(asia-south1)
? Would you like to proceed with deletion?
```

This **must** be confirmed by a human, not silently auto-answered. If
the deletion is intentional and already discussed, the user can pass
`--force` to skip the prompt:

```powershell
firebase deploy --only functions --force
```

Windsurf must **never** add `--force` on its own. Adding `--force`
without explicit user direction can silently delete production
functions that were temporarily missing from local source (e.g.
during a refactor in progress). Rule of thumb: `--force` requires
the user to type "use --force" or equivalent in chat.

### 6. Verify after every deploy.

After the user confirms a deploy completed, ask them to run:

```powershell
firebase functions:list
```

Compare the output against the expected function list for the phase.
If anything is missing or unexpected, that is a server-state mismatch
and needs another targeted deploy — do not proceed to the next task.

For rules:

```powershell
firebase firestore:rules:get
```

For indexes:

```powershell
firebase firestore:indexes
```

### 7. Audit before every deploy.

Run `npm run audit` and `npx tsc --noEmit` before asking the user to
deploy anything. A truncated source file or a TypeScript regression
will deploy successfully and then crash at runtime — much harder to
debug than a pre-deploy compile error.

The audit script tracks file integrity (file ends cleanly, no truncation
mid-statement). It is the line of defense against partial-write bugs
introduced by the multi-edit / write_to_file tools.

### 8. If a deploy "appears stuck."

Default assumption: it is **waiting for an interactive prompt** that
got buffered. Do not wait more than 90 seconds with no output.
Action:

1. Tell the user the deploy may be stuck on a prompt.
2. Have them kill the Windsurf shell (Ctrl+C in the agent's terminal,
   or Stop on the running command in the chat).
3. Have them re-run the exact same command in their own PowerShell
   window where they can answer prompts directly.

### 9. SSL / system CA on Windows.

If the Firebase CLI fails with
`unable to verify the first certificate` /
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, the user is on a corporate or VPN
network and Node isn't picking up the system CA bundle. Fix:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
firebase deploy --only <target>
```

Set this in the user's PowerShell profile if it recurs. Don't
auto-set it from Windsurf — environment mutations should be visible.

## Quick reference

| Target | Command | Approx. time | Interactive prompts? |
|---|---|---|---|
| Rules | `firebase deploy --only firestore:rules` | 30 s | No |
| Indexes | `firebase deploy --only firestore:indexes` | 30–60 s | No |
| Storage rules | `firebase deploy --only storage:rules` | 10 s | No |
| Functions | `firebase deploy --only functions` | 5–15 min | **Yes** (deletions) |
| Verify | `firebase functions:list` | 5 s | No |

## Cross-references

This doc is referenced from `PRELAUNCH_CHECKLIST.md` under the
"Phase 12a-v2-i" entries. If you change the deploy workflow, update
both files together.
