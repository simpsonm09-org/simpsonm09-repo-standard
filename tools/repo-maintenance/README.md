# Cleanup eligibility planner

A pure decision unit. It turns an immutable snapshot of branches and worktrees
into typed eligibility actions. It contains no executor and performs no I/O: no
subprocess, no network, no Git invocation, no credential handling, and no
filesystem reads or writes. Its inputs are dataclasses a caller assembles; its
outputs are `Skip`, `RemoveEligibleWorktree`, and `DeleteBranch` values.

The planner does not authorize deletion. An eligible action records a claim the
snapshot supported, and nothing more. This package does not collect activity
evidence, does not observe live repository state, and cannot tell whether a
snapshot is truthful or current. A caller must treat every action as a proposal
that a separate, independently safeguarded executor re-verifies before acting.

For timestamp-backed T3 evidence, callers should use
`evaluate_t3_activity(observed_at, now, max_age, binding, settlement)` and pass
its `T3Activity` result through the existing `BranchSnapshot` or
`WorktreeBinding` activity field. This pure evaluator derives freshness from an
observed timestamp, an injected aware clock, and an explicit non-negative
maximum age. The maximum-age boundary is inclusive: an observation exactly that
old is `FRESH`; an older observation is `STALE`. Missing, malformed, naive,
future, or invalid time inputs produce `UNKNOWN`. Timezone offsets are compared
as UTC instants. Missing or malformed binding and settlement values become
`UNKNOWN`; bound and running values remain holds in the planner.

Direct construction of `T3Activity` remains accepted for compatibility with
existing snapshot producers. In that path, `FRESH` is still a producer claim;
it does not prove that a timestamp was evaluated. The planner has no activity
collector and does not independently revalidate timestamps.

## Eligibility

An item becomes eligible only when all of these hold:

- The branch exists.
- The scope is not archived, and neither the snapshot nor the branch is a
  deployment.
- The branch is not the default branch and is not protected.
- The branch is not detached, and its known worktree binding is not the main
  worktree and is not itself detached.
- The merged-ancestry result is a known `True`. A `False` result means the tip
  is not an ancestor of the default branch, which is what a squash or rebase
  merge produces, so it is skipped. An unknown result is skipped.
- The branch tip is known. Every action pins the tip it expects
  (`expected_tip`), so an executor can re-check identity.
- Branch activity time is outside the retention window.
- Worktree bindings were readable.
- Fresh T3 evidence shows the worktree is both unbound and settled. Only that
  exact combination clears the gate.
- The binding path is a strict descendant of the configured worktree root.
- The binding is unlocked, has no tracked changes, no untracked files, and no
  ignored files.

Branch names are never used to infer merge or safety status.

## Fail-closed reasons

Any of these produces a `Skip` instead of an action, so the item is preserved:

`already-gone`, `default-branch`, `protected`, `detached`, `main-worktree`,
`deployment`, `archived`, `tip-not-merged-ancestor`, `ancestry-unknown`,
`branch-tip-missing`, `inside-retention-window`,
`activity-time-missing-naive-or-future`, `activity-unknown-or-stale`,
`activity-bound-or-running`, `worktree-bindings-unreadable`,
`worktree-bindings-duplicated-or-inconsistent`, `branch-checked-out-elsewhere`,
`worktree-path-unsafe-or-outside-root`, `worktree-has-tracked-changes`,
`worktree-has-untracked-files`, `worktree-has-ignored-files`, `worktree-locked`,
`t3-owns-worktree-cleanup`, `t3-cleanup-not-explicitly-disabled`,
`activity-evidence-missing`.

Additional fail-closed rules:

- A missing, naive, or future activity timestamp is rejected rather than
  interpreted. The same applies when the policy's own clock is naive.
- Duplicate or contradictory binding evidence is rejected: a repeated branch
  entry, a branch bound at more than one path, one path bound to more than one
  branch, or a binding that names a branch other than the one listing it.
- A branch with no binding still needs a known tip, fresh unbound settled
  evidence, and complete readable bindings before a `DeleteBranch` is emitted.

## Retention clock

The default retention window is three days. The clock reads the branch activity
time. A merge tip is not time evidence, so a merged branch touched inside the
window is preserved, and a merged branch with no activity time at all is
preserved.

## Ownership

There is exactly one cleanup owner.

With `cleanup_owner=T3`, the planner never emits worktree removal. It can emit a
branch deletion for a verified orphan only when the evidence, bindings, and tip
checks above pass.

With `cleanup_owner=maintenance`, worktree removal additionally requires
`maintenance_t3_cleanup_disabled=True` as an explicit policy setting. Without it
the item is preserved.

## Path containment

Containment is judged lexically per path flavor. A worktree path must be a strict
descendant of the configured root.

- Windows comparisons are case-insensitive; POSIX comparisons are case-sensitive.
- A path whose flavor differs from the root's is rejected.
- Relative, drive-relative, empty-root, and filesystem-root cleanup scopes are
  rejected, including `/`, drive roots, and UNC share roots.
- A `..` component rejects the path before any normalization, so traversal never
  resolves into an accepted location.
- Sibling-prefix paths are rejected. A root of `root` does not contain `root-old`.
- The root itself is rejected; only descendants count.

Lexical comparison is a necessary condition, not sufficient. Symlinks, junctions,
case-insensitive filesystems, and mount points can all defeat a lexical check, and
the snapshot can be stale by the time anything acts. The emitted path is the
snapshot's path verbatim.

## What a future executor must still do

Any executor built on this output is out of scope for this package and must, at
minimum, re-canonicalize the path (`realpath` and its platform equivalents),
re-verify containment after canonicalization, and re-check that no race changed
the state between snapshot and action: the branch tip, the binding, the lock, and
the activity evidence. It must fail closed on any mismatch, including a tip that
no longer equals `expected_tip`.

## Running the tests

The suite is pure and imports nothing but the standard library, this planner, and
no maintenance worker or credential module. It needs a Python 3.10 or newer
interpreter, because the module builds a union-type alias at import time. The
repository uses an interpreter already on the host and installs nothing.

The two test modules live in `tests/`. Run them through the task runner:

```bash
just test-repo-maintenance
```

The recipe routes to `node scripts/op.mjs run test-repo-maintenance`, which
locates an existing Python 3.10 or newer interpreter from a fixed list of
interpreter names on `PATH` and fails with a clear error when none is found. The
dispatcher takes no interpreter from the environment. To run the suite by hand
from the repository root:

```bash
python -B -m unittest discover -v -s tools/repo-maintenance/tests -t tools/repo-maintenance
```
