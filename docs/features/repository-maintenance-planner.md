# Repository-maintenance planner

Planning only. The repository-maintenance planner is a pure decision unit that
turns an immutable snapshot of branches and worktrees into typed eligibility
actions. It is not a deployable cleanup. It ships no executor, opens no
connection, and deletes nothing. This page is the release note for the first
self-contained stage of the component, which is a library and its tests.

## What it does

`plan_cleanup(snapshot, policy)` returns a `CleanupPlan` whose actions are one of
three frozen dataclasses.

- `Skip` names the branch and the `SkipReason` that preserved it.
- `DeleteBranch` names a branch and the tip the snapshot recorded.
- `RemoveEligibleWorktree` names a worktree path, its branch, and the tip.

Every action pins the tip it expects, so a later executor can re-check identity
before it acts. An action records a claim the snapshot supported. It is not an
authorization to delete anything. Branch names never infer merge or safety
status.

The default retention window is three days, and the clock reads the branch
activity time. A merge tip is not time evidence.

## Data shape

The caller assembles three inputs from its own observation.

- `Snapshot` holds the branches, the default branch name, whether the worktree
  bindings were readable, the allowed worktree root, and the deployment and
  archived flags.
- `BranchSnapshot` holds one branch's name, tip, existence, protection, merged
  ancestry result, last activity time, and its `WorktreeBinding` values.
- `Policy` holds the clock, the retention window, the single cleanup owner, and
  the explicit `maintenance_t3_cleanup_disabled` switch.

`T3Activity` carries three enums for freshness, binding, and settlement. These
are claims the snapshot producer supplies. The planner does not derive freshness
from timestamps and ships no activity collector.

The module imports only `__future__`, `dataclasses`, `datetime`, `enum`, and
`pathlib`. Its test suite asserts that import set and rejects any I/O or
execution call in the code.

## Failure modes

The planner fails closed. Any of these produces a `Skip`, so the item is
preserved.

- Scope and protection guards. Archived scope, deployment scope, the default
  branch, a protected branch, and a detached branch are preserved first, before
  any binding evidence is trusted.
- Ancestry guards. Only a known `True` merged-ancestry result proceeds. A `False`
  result is what a squash or rebase merge produces, so it is preserved, and an
  unknown result is preserved.
- Activity guards. A missing, naive, or future activity time is rejected rather
  than interpreted. The same applies when the policy clock is naive. Only fresh,
  unbound, and settled evidence clears the gate.
- Binding guards. Unreadable bindings, a repeated branch entry, a branch bound at
  more than one path, one path bound to more than one branch, and a binding that
  names a foreign branch are preserved.
- Path guards. A worktree path must be a strict descendant of the configured
  root in the same path flavor. Relative, drive-relative, empty-root, `/`, drive
  root, and UNC share root scopes are rejected. A `..` component rejects the path
  before any normalization, and a sibling-prefix path is rejected.
- Ownership guards. With `cleanup_owner=T3` the planner never emits worktree
  removal. With `cleanup_owner=maintenance`, worktree removal additionally
  requires `maintenance_t3_cleanup_disabled=True`. Without it the item is
  preserved.

Path containment is judged lexically. Symlinks, junctions, case-insensitive
filesystems, and mount points can defeat a lexical check, and the snapshot can be
stale by the time anything acts. The emitted path is the snapshot's path
verbatim.

## What a future executor must still do

Any executor built on this output is out of scope for this stage and must, at
minimum:

- re-canonicalize the path with `realpath` and its platform equivalents, then
  re-verify containment after canonicalization;
- re-check that no race changed the state between snapshot and action, covering
  the branch tip, the binding, the lock, and the activity evidence;
- fail closed on any mismatch, including a tip that no longer equals
  `expected_tip`.

This stage changes no execution, deletion, configuration, or scheduled task.

## Running the tests

The suite is pure. It imports only the standard library, the planner, and no
maintenance worker or credential module. It needs Python 3.10 or newer for the
union-type alias in the module. The repository uses an interpreter already on
the host and installs nothing.

```bash
just test-repo-maintenance
```

The recipe routes to `node scripts/op.mjs run test-repo-maintenance`, which finds
an existing Python 3.10 or newer interpreter from a fixed list of interpreter
names on `PATH`, or fails with a clear error when none is present. The
dispatcher takes no interpreter from the environment, so a successful check
always means an interpreter on the host ran the suite. The hosted
`repo-maintenance-planner` workflow runs the same operation on Linux, Windows,
and macOS with Python set up explicitly.
