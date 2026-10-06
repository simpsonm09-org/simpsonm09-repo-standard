# Architecture

## Self-conformance check

Every repository checks itself. There is no cross-repository audit and no
organization-wide token. `scripts/check-standard.mjs` reads the working tree against
the pinned standard, and `scripts/check-repo.mjs` adds the checks a repository can
make about itself through the GitHub API, then applies the exception file.

```mermaid
sequenceDiagram
    participant Dev as Repository CI
    participant Repo as check-repo.mjs
    participant Std as check-standard.mjs
    participant GH as gh CLI
    Dev->>Repo: node scripts/check-repo.mjs .
    Repo->>Std: tree-local checks
    Std-->>Repo: files, mise, ci, community, docs, scripting, and env gaps
    Repo->>GH: read this repository's settings, topics, and rulesets
    GH-->>Repo: repository metadata
    Repo->>Repo: apply docs/exceptions.json
    Repo-->>Dev: conformance matrix, exit 0 or 1
```

## Reusable workflow consumption

A consuming repository calls the reusable workflows at a pinned commit of this
repository. The called workflow runs in the consuming repository and reads only that
repository, with the consuming repository's own token.

```mermaid
sequenceDiagram
    participant Push as Push or pull request
    participant Caller as .github/workflows/ci.yml
    participant Standard as repo-standard workflows
    Push->>Caller: trigger ci
    Caller->>Standard: lint, aislop, security, and standard at the pinned SHA
    Standard-->>Caller: job conclusions
```
