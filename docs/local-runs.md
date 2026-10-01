# Local runs

Run the same checks that CI runs, before pushing.

## Tools

Install mise once, then let it install the pinned tools from `mise.toml`.

```bash
curl https://mise.run | sh
mise install
```

Keep the `[tools]` block in Flint's canonical order: the task-runner group first, then the linter group. `flint run --fix flint-setup` or `just lint-fix` normalizes it. CI enforces it with the `flint-setup` check.

## Task runner

`just` is the one entry point. It delegates to the tools mise pins. See [`task-runner.md`](task-runner.md).

```bash
just --list        # show the recipes
just lint          # lint every tracked file
just lint-fix      # fix what is fixable
just test          # run the test suite
just aislop        # run the AI-slop gate
just verify        # lint and test
```

## Lint

Run Flint directly to choose the scope.

```bash
mise exec -- flint run          # changed files only
mise exec -- flint run --full   # every tracked file
mise exec -- flint run --fix    # fix what is fixable
```

## AI-slop gate

Pin the same version as the aislop workflow.

```bash
npx --yes aislop@0.16.1 scan
npx --yes aislop@0.16.1 ci
```

## Security

```bash
trivy fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL .
docker run --rm -v "$PWD:/repo" -w /repo ghcr.io/gitleaks/gitleaks:v8.30.1 detect --source=. --redact
```

## Workflows

Run the GitHub Actions workflows locally with act. A Docker daemon is required.

```bash
act pull_request
```

## Hooks

Flint can install a git hook that fixes and lints before each commit.

```bash
mise exec -- flint hook install
```
