# Documentation

This directory holds the repository documentation. Start here, then read the guide that matches the task.

## Guides

- [Adopting the standard](adoption.md) walks a repository through the standard, one step at a time.
- [Automation](automation.md) covers Dependabot updates, the labeler, and the release workflow.
- [Documentation layout](documentation.md) defines the layout every repository in the fleet keeps.
- [Local runs](local-runs.md) shows how to run the same checks as CI before pushing.
- [Task runner](task-runner.md) explains the `justfile` convention.
- [Validation](validation.md) documents the fleet conformance checker and the exception file.
- [Testing](testing.md) covers the test job each repository adds.

## Reference

- [Governance](governance.md) defines the branch model and the protection rules.
- [GitHub settings](github-settings.md) defines the repository settings and topics and the apply script.
- [Pinning](pinning.md) defines the commit-SHA pinning rules.
- [Linting](linting.md) defines the linters and formatters the lint job runs.
- [Coverage](coverage.md) defines the changed-line coverage gate.
- [Scripts](scripting.md) defines the bash and PowerShell script conventions.
- [Architecture](architecture.md) diagrams the fleet conformance check.

## Concepts

- [Agents and skills](agents-and-skills.md) covers where agents and skills come from in each harness, and the repo-local skill location in `.claude/skills/`.
- [Fleet conformance](features/fleet-conformance.md) describes the two checkers end to end.
- [Agent access](features/agent-access.md) resolves a repository's agent level, guards pushes, and gates agent shell commands in OpenCode, Claude Code, GitHub Copilot CLI, and Pi.

## Conventions

- [Definition of done](definition-of-done.md) is the bar every change meets.
- [Root README](root-readme.md) defines the README every repository carries.
- [Community health files](community.md) defines the files GitHub detects and which are required.
- [License](license.md) defines the MIT license and the README section.
- [Contributing](../CONTRIBUTING.md) covers branches, pull requests, and commits.
- [Security policy](../SECURITY.md) covers vulnerability reporting and scanning.
