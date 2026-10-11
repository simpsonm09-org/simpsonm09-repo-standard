# repo-standard

The reusable repository standard for `simpsonm09-org`. It owns the shared CI, linting, security scanning, and branch governance that every other repository consumes.

## What it provides

- Reusable GitHub Actions workflows for linting, AI-slop detection, and security scanning. Each repository calls them with a thin caller workflow.
- Flint as the lint aggregator, covering language and file linters from one runner.
- aislop as the AI-slop quality gate, reporting SARIF to the Security tab.
- Trivy for vulnerability, secret, and misconfiguration scanning, plus a dedicated secret scanner with full git history.
- Dependabot for dependency and action updates, with alerts and security updates from the organization.
- Ruleset JSON and an idempotent apply script for branch and tag protection.
- A `justfile` task-runner convention, with `just` as the one local entry point.
- A fleet conformance checker that proves every repository matches the standard and stays aligned.
- Repository settings and owner-topic convergence through a dry-run apply script.
- Bash and PowerShell versions of every operational script, with matching behavior.
- A testing convention for the test job each repository adds to its caller workflow.
- A generated-OpenAPI contract rule for the repositories that expose an API, with a checker that fails a hand-edited document.
- Agent and skill templates for repository-local setup, with the plugin-versus-repository ownership rule. Repo-local skills live in `.claude/skills/`, which both Claude Code and OpenCode read. Repo-local OpenCode agent profiles stay in `.opencode/agents/`. Shared skills reach both through plugins, not through this repository.
- A root README convention with a skeleton, a documentation layout, and an MIT license policy.
- Editor and git conventions, issue and pull request templates, and security policy.

## Consumption model

An original repository lives in `simpsonm09-org`. A personal fork lives under `simpsonm09`. Work happens on the fork. See [`docs/governance.md`](docs/governance.md) for the branch model and the protection rules.

To adopt the standard in a repository, follow [`docs/adoption.md`](docs/adoption.md).

## Local use

The same checks run locally. Run `mise install` once, then `just --list`. See [`docs/local-runs.md`](docs/local-runs.md) and [`docs/task-runner.md`](docs/task-runner.md).

## Docs

Read [`docs/README.md`](docs/README.md) for the documentation index. The documentation layout is defined in [`docs/documentation.md`](docs/documentation.md). `just check-standard .` checks one repository and `just check-repo .` adds the checks a repository makes about itself. See [`docs/validation.md`](docs/validation.md).

## Pinning

Actions are pinned to commit SHAs and updated by Dependabot. See [`docs/pinning.md`](docs/pinning.md).

## Layout

- `.github/workflows/` holds the reusable workflows and this repository's own CI.
- `.github/config/` holds the Flint configuration.
- `rulesets/` holds the branch and tag rulesets as JSON.
- `scripts/` holds the ruleset apply scripts, in bash and PowerShell, and the Node checkers and apply script.
- `justfile` holds this repository's task recipes.
- `templates/` holds files to copy into a consuming repository, including the `justfile`, the README and `AGENTS.md` skeletons, the license, agent profiles, and a skill skeleton.
- `docs/` holds the adoption, governance, documentation, local-run, pinning, task-runner, scripting, testing, validation, agent-and-skill, README, and license guides.

## License

MIT. See [`LICENSE`](LICENSE).

## Related repositories

- [`repo-template`](https://github.com/simpsonm09-org/simpsonm09-repo-template) is the generated-repo starting point.
- [`maxstack`](https://github.com/simpsonm09-org/simpsonm09-maxstack) composes the plugin layers for OpenCode and Claude Code. The org plugin also provides agent-access gates for GitHub Copilot CLI and Pi.
