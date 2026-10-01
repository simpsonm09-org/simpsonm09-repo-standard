# Automation

The standard keeps a small set of optional workflows. A repository copies the ones it needs from `templates/`. None of them are enforced by `check-standard`.

## Dependency and Action updates

Dependabot is the updater. Each repository carries [`.github/dependabot.yml`](../templates/dependabot.yml), which schedules the weekly check and groups minor and patch updates. Dependabot has no shareable preset, so the file lives in the repository rather than in the standard.

Version updates start as soon as the file is on the default branch. Alerts and security updates come from the organization, and `scripts/apply-settings.mjs` converges them per repository. The standard ships a single updater, so a repository does not add a second one.

Every action reference is pinned to a 40-character commit SHA. Dependabot updates the SHA and the trailing version comment together.

The caller pins this repository at a commit SHA. Dependabot does not update a remote reusable-workflow reference, so [`../templates/workflows/pin-update.yml`](../templates/workflows/pin-update.yml) checks the pin on a schedule and opens a tracking issue when it falls behind `main`.

## Labels

[`../templates/workflows/labeler.yml`](../templates/workflows/labeler.yml) labels a pull request by the paths it changes, using [`../templates/labeler.yml`](../templates/labeler.yml) as the rule set. Copy the workflow to `.github/workflows/labeler.yml` and the rules to `.github/labeler.yml`.

Every label named in the rule set must exist in the repository. The labeler skips a label that is missing. Create the set once with `gh label create` or the web UI before the workflow runs.

## Releases

[`../templates/workflows/release.yml`](../templates/workflows/release.yml) creates a GitHub release when a `v*` tag is pushed. It uses `gh release create --generate-notes`, so GitHub writes the notes from the merged pull requests and needs no third-party action. Copy it to `.github/workflows/release.yml`, then push a tag.

Tag protection comes from the `protect-tags` ruleset. See [governance.md](governance.md).
