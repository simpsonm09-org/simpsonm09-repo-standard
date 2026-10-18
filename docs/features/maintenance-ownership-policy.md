# Ownership policy planner

Planning only. The ownership-policy planner is a pure, offline decision unit that
turns a fleet inventory and an optional operator config into an explicit
per-repository ownership policy, held safe by default. It ships no executor and no
command-line entry point: it is a library and its tests.

Everything it emits is a candidate. Generating the candidate approves nothing. It
changes no repository, no runtime config, and no live system, and no output can be
applied by this package. `apply_permitted` is `False` by construction.

The caller parses the JSON boundary and hands plain data to the planner. The
planner reads no file, opens no socket, runs no Git command, and touches no
settings, tasks, WSL, or credentials.

## What it does

- Plans every inventory record, grouped by its canonical repository and by its
  owner account, with no drops for private, personal, or organization repos.
- Separates canonical policy from checkout policy. Canonical policy is per
  canonical repository. Checkout policy is per physical checkout path, aggregated
  across every inventory record that names that path.
- Emits three ownership fields per scope: `local_default_writer`,
  `fork_sync_owner`, and `cleanup_owner`. Each defaults to `hold`.
- Fails closed. Unknown ownership evidence yields `hold`. A clean branch, a default
  branch, or a familiar name never makes a checkout safe.

## Inputs

The caller supplies two documents and an optional config:

- an inventory document with the canonical, fork, checkout, and remote data;
- an optional runtime manifest, whose canonical repositories and physical checkout
  paths must all appear in the plan;
- an operator config carrying the human decisions the rules need. Its defaults are
  empty and fail closed.

The config carries `owned_accounts`, `approved_dev_checkouts`,
`worker_local_writes_disabled`, evidence, and exceptions, plus the caller-supplied
provenance: `source_label`, `reviewed_clone_version`, `reviewed_clone_commit`, and
`current_server_version`. The core hard-codes none of these; in particular the
running-server version is always operator input, never a constant. The JSON shape
is:

```json
{
  "owned_accounts": [],
  "approved_dev_checkouts": [],
  "worker_local_writes_disabled": null,
  "current_server_version": null,
  "source_label": null,
  "reviewed_clone_version": null,
  "reviewed_clone_commit": null,
  "evidence": { "checkouts": {}, "canonicals": {} },
  "exceptions": { "checkouts": {}, "canonicals": {} }
}
```

## Data shape

`plan(entries, config)` returns a `Plan` whose parts serialize to one candidate
JSON document.

- `provenance` records the caller-supplied source and reviewed-clone facts, the
  expected running version, and that the reviewed clone and the running build are
  not proven equivalent.
- `canonical_policies` has one record per canonical repository.
- `repo_plans` has one record per inventory entry, with no drops.
- `checkout_decisions` has one record per physical checkout, each listing every
  canonical and remote binding recorded for that path.
- `counts` summarizes coverage. Every count is derived from the supplied data,
  never from a fixed number.

## Rules

### Who may write the local default branch

`local_default_writer` is `hold`, `t3`, or `maintenance`.

- `hold` is the default and the fallback for every unresolved case.
- `t3` requires verified, fresh evidence that effective T3 autoPull is `true`, with
  worker local writes disabled. It can own a checkout while fork sync stays with
  maintenance.
- `maintenance` requires verified, fresh evidence that effective T3 autoPull is
  `false`, the checkout approved as an explicit dev checkout, and worker local
  writes enabled.

Ownership evidence is the effective per-project T3 autoPull value, not the legacy
aggregate `autoPull` field. The only allowed verifying source is a human read of
the supported Settings UI per-project override. A clone read can never verify the
running build, and the planner downgrades any such evidence to unverified.

Two further checks make an observation usable:

- Freshness is **derived**, never self-attested. The planner parses a
  timezone-aware `observed_at` and compares it against an explicitly injected `now`
  and `max_age`. A missing, malformed, naive, future, or stale timestamp is not
  fresh.
- The evidence `version` must equal the explicitly configured
  `current_server_version`. A version that does not match the running server cannot
  verify it.

To take maintenance ownership while T3 is not the writer, a human first verifies a
`false` override in the supported UI and then approves the checkout as a dev
checkout. T3 pulls run while the T3 truth server is running, which is independent
of whether the desktop UI is open; there is no "T3-closed" freshness.

### What always holds

These classes hold unless a human records an explicit exception, and only a
**checkout-scoped** exception may lift a pin. A canonical-scoped exception and
canonical-scoped evidence are recorded and reported but never unlock a physical
checkout. Even a checkout exception only unlocks the normal rules, and the checkout
still holds if the evidence is not verified and fresh.

- Deployment and homelab checkouts.
- Archived repositories.
- Third-party personal forks.
- Entries with no checkout.
- Checkouts on an unsupported WSL path (`unsupported_wsl`) or a Git-Bash/MSYS
  mount (`unsupported_gitbash`).

When one physical path is named by more than one inventory record, the decision
aggregates every member: any member's pin holds the path, and conflicting canonical
identities or conflicting remote bindings hold it as well. The decision never
depends on input order.

### Fork sync is separate

`fork_sync_owner` is `hold`, `maintenance`, or `none`. It is independent of the
local writer, so a fork may sync under maintenance while T3 owns the local default
branch. It becomes `maintenance` only when an exact owned canonical and an exact
owned personal fork are both present in the inventory, the fork's canonical and
parent agree with the group, and a configured account is supplied. A declared fork
that is absent from the inventory, or a fork whose parent is not the group
canonical, holds rather than syncs. A third-party parent name is never used as a
canonical and never grants a sync claim. The canonical identity is preserved as the
inventory records it, including a bridge repo whose parent is a third-party
repository. The planner never infers a token identity from a repository owner, and
a checkout whose remote URL does not match any expected identity for its group is
flagged and held.

### Cleanup

`cleanup_owner` is declared only. The planner proposes no cleanup action. Entries
whose inventory profile is excluded or has no cleanup profile are marked `none`.
Everything else holds and is deferred to the separate cleanup-eligibility planner.

## Failure modes

Every unresolved case fails closed.

- Unknown evidence holds. A clean branch or a familiar name never unlocks a
  checkout.
- A missing, naive, future, or stale `observed_at` is not fresh.
- A version that does not match the configured running version cannot verify it.
- A canonical-scoped exception or a canonical-scoped observation never unlocks a
  physical checkout.
- Conflicting canonicals, owner groups, or remote bindings on a shared path hold.
- A dropped or duplicated repository or checkout is an invariant violation, and the
  plan is rejected rather than shipped.

## Boundary honesty

- No authenticity proof. A recorded observation is an operator assertion, not a
  verified fact. The planner checks it for internal consistency and freshness, and
  a future apply step still must validate the running server live.
- No MCP or programmatic read. There is no MCP or programmatic read of the
  effective per-project autoPull value that the planner can call offline, so the
  per-repo truth lives in the human override plus the caller's config. The
  supported Settings UI **does** read the effective override, and an agent may
  inspect it when it is available. The two must be kept in sync by a person.
- No live probe. The planner does not read settings, run Git, call the network, or
  touch WSL, tasks, services, credentials, or the repository.
- Path keys follow the platform. Windows drive-letter and UNC paths are matched
  case-insensitively with normalized separators, while POSIX paths stay
  case-sensitive, so a casing surprise fails toward `hold` on Windows and never
  silently merges two distinct POSIX directories.
- The plan covers canonical repositories and checkouts. It does not model thread
  worktrees or settlement merges, which are separate writers by design.

## Running the tests

The suite is pure and imports only the standard library and this package. It needs
a Python 3.10 or newer interpreter and installs nothing.

```bash
just test-repo-maintenance
```

The recipe routes to `node scripts/op.mjs run test-repo-maintenance`, which finds
an existing Python 3.10 or newer interpreter from a fixed list of interpreter names
on `PATH`. The same suite is discovered from the `tools/repo-maintenance/tests`
package as the cleanup planner's tests, and the hosted `repo-maintenance-planner`
workflow runs it on Linux, Windows, and macOS. The committed fixtures are
synthetic: the suite seeds no personal account, machine path, or private inventory
and reads no external input.
