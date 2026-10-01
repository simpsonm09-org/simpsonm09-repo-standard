# Conformance

Conformance answers one question. Does this repository match the standard? Each
repository answers it about itself, from its own CI, with its own token. No
repository audits another, and there is no organization-wide audit or token.

## `check-standard`

[`../../scripts/check-standard.mjs`](../../scripts/check-standard.mjs) takes one
repository path and prints a compact matrix of six tree-local groups.

| Group | Checks |
| --- | --- |
| `files` | The required paths exist, including `.github/ISSUE_TEMPLATE/`. |
| `mise` | `mise.toml` pins `aqua:casey/just`. |
| `ci` | `ci.yml` calls `lint`, `aislop`, `security`, and `standard` at a pinned 40-character SHA, and runs a test job when the repository defines a test task. |
| `dependabot` | `.github/dependabot.yml` declares version 2, a scheduled ecosystem, and no inline credential. |
| `community` | The byte-identical community files match the pinned standard. |
| `docs` | The [documentation layout](../documentation.md) holds. |

The script exits `1` when any group has a gap. It never reads the exception file, so
a single repository can be checked on its own.

## `check-repo`

[`../../scripts/check-repo.mjs`](../../scripts/check-repo.mjs) runs `check-standard`
and then adds the checks a repository can make about itself through the GitHub API
with its own token. It reads the identity from `GITHUB_REPOSITORY` or the `--repo`
flag, and it applies the subset of [`../exceptions.json`](../exceptions.json) that
names the repository.

The API groups are `settings` and `ruleset`.

- `settings` requires the default branch to be `main`, the description to be set, and
  the owner topic to be present.
- `ruleset` requires `protect-main` on a public repository.

A repository cannot read its own secret scanning, push protection, or merge methods
with its own token, so those are applied once and not audited. See
[github-settings.md](../github-settings.md).

## The reusable workflow

[`../../.github/workflows/standard.yml`](../../.github/workflows/standard.yml) is the
entry point. It checks out the caller and this repository at the caller's pinned SHA,
then runs `check-repo` with the caller's `GITHUB_TOKEN`. A repository adopts a new
standard by bumping its pin. See [adoption.md](../adoption.md).

Gaps tolerated for a reason are listed in [`../exceptions.json`](../exceptions.json).
Every other gap fails the command with exit `1`.
