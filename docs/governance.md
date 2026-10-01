# Governance

This document defines the branch model and the protection rules for repositories in `simpsonm09-org`.

## Branch model

- `main` is the integration branch and is protected.
- Feature branches open pull requests into `main`.
- Anything not on `main` is a pull request candidate.

## Pull requests

A pull request against `main` runs the shared checks from the repository. The checks are lint, aislop, security, and standard.

## Protection rules

Two rulesets live in [`../rulesets/`](../rulesets).

### protect-main

Targets `refs/heads/main`.

- Block creations, deletions, and force pushes. The pull request rule blocks direct updates, so `main` only changes through a pull request. Do not add a separate `update` rule. It also blocks the pull request merge the ruleset requires, and every merge then needs the administrator bypass.
- Require a pull request before merging.
- Required approvals set to zero. GitHub does not allow self-approval, so zero is the honest value for a solo maintainer.
- Extra approval for unattributed changes is off. GitHub enables `require_extra_approval_for_unattributed_changes` when the field is absent, and that would demand an approval a solo maintainer cannot give. The ruleset sets it to `false` explicitly.
- Dismiss stale approvals and require conversation resolution.
- Require signed commits on the branch.
- Require the lint, aislop, security, standard, and test status checks, and require branches to be up to date.
- No linear-history rule. Merge commits are allowed.
- Bypass list is the organization admin role with mode `pull_request`. The only escape hatch is merging a pull request as an administrator. A bypass is recorded in the audit log.

### protect-tags

Targets `refs/tags/v*`. Blocks update, deletion, and force push.

## Code owners and reviewers

`CODEOWNERS` is `* @simpsonm09` in every repository. GitHub auto-requests the code owner as an optional reviewer, because `require_code_owner_review` is `false`. The review is not a gate.

GitHub never requests the pull-request author as a reviewer. A self-authored pull request shows no request. This is expected, not a missing configuration.

## Repository settings

Rulesets do not cover these. Set them on each repository.

- Default branch `main`.
- Merge, squash, and rebase enabled.
- Delete branch on merge.
- Auto-merge enabled. The API does not enable it on the Free organization plan, so it stays off on the current private repositories.
- Default Actions token read-only.

## Signed commits

Signed commits are required on `main`, and the `protect-main` ruleset enforces it with the `required_signatures` rule. GitHub signs the merge commits it creates through the web UI and through the API, so the merge itself passes. Each commit on the feature branch must be signed. Configure an SSH signing key on each runtime.

## Enforcement timing

Rulesets on private repositories need GitHub Pro for a personal account and GitHub Team for an organization. On the free plan, private repositories cannot carry rulesets. The apply script reads each repository's visibility. While a repository is private it reports the ruleset it would apply and stops. When the repository becomes public, the same script applies for real.

`check-repo` fails a public repository that is missing `protect-main`, so the gap cannot be forgotten.

## Bypass actors

The rulesets use `OrganizationAdmin` as the bypass actor. For a repository that is not in an organization, replace it with `RepositoryRole` and the administrator role ID.
