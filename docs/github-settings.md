# GitHub settings

The standard fixes a small set of repository settings. `scripts/apply-settings.mjs` converges them through `gh`, and `scripts/check-repo.mjs` reports drift from the repository itself. The settings live outside the git tree, so a repository cannot carry them in a file.

## Required settings

| Setting | Value | Why |
| --- | --- | --- |
| Default branch | `main` | The branch model in [governance.md](governance.md). |
| Description | one line | The community profile scores it. See [community.md](community.md). |
| Delete branch on merge | on | Keeps the branch list short after a merge. |
| Merge, squash, rebase | all on | The contributor chooses the merge shape. |
| Topics | the owner login | Ownership is visible in search. |

## Topics

Every repository carries at least one topic that names its owner. An organization repository under `simpsonm09-org` carries `simpsonm09-org`. `check-repo` reads the topics and reports `settings/topics` when the owner is absent.

## Security features

On a public repository the standard turns on GitHub secret scanning and push protection.
`apply-settings` converges both. A repository cannot read its own secret scanning state
with its own token, so the standard applies it once and does not audit it. Both are free
on a public repository. A private repository on the Free plan cannot carry them, so
`apply-settings` leaves them alone until the repository is public.

Dependency updates come from Dependabot. `apply-settings` turns on Dependabot alerts
and security updates for a repository, and the organization can enable them for every
repository at once. See [automation.md](automation.md).

## Apply the settings

[`../scripts/apply-settings.mjs`](../scripts/apply-settings.mjs) prints a dry run by default. Pass `--apply` to write. It is idempotent, so it only touches a setting that differs.

```bash
node scripts/apply-settings.mjs simpsonm09-org/simpsonm09-repo-standard
node scripts/apply-settings.mjs simpsonm09-org/simpsonm09-repo-standard --apply
```

Add `--topic NAME` to keep an extra topic alongside the owner login.

The standard covers the organization repositories only. A personal fork is a private
mirror and is out of scope, so nothing here reads or configures it.

## Rulesets and the plan

[`../rulesets/`](../rulesets) holds `protect-main` and `protect-tags`, and [`../scripts/apply-rulesets.sh`](../scripts/apply-rulesets.sh) applies them. Rulesets on a private repository need GitHub Pro for a personal account or GitHub Team for an organization. On the free plan the apply script reports the ruleset it would apply and stops. A public repository can carry them, and `check-repo` fails a public repository that lacks `protect-main`.
