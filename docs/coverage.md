# Coverage

The `coverage` check gates the units a change adds or edits, not the whole repository. A
repository owns its suite and its coverage tool. It defines one `just coverage` recipe that
runs the suite and leaves an lcov report at `coverage/lcov.info`. The shared
[`coverage` workflow](../.github/workflows/coverage.yml) calls that recipe and then runs
[`scripts/patch-coverage.mjs`](../scripts/patch-coverage.mjs) over the report and the git
diff.

Gating changed units avoids retrofitting tests onto existing code, which is why the fleet
does not set a whole-repository floor.

## The `just coverage` contract

`just coverage` runs the test suite with coverage and writes the lcov report to
`coverage/lcov.info`. Keep the recipe thin: call a portable executable such as `node`,
`pytest`, or a script under `scripts/`. The workflow checks out the pinned standard, runs
`just coverage`, runs the gate, and uploads `coverage/lcov.info` as the `coverage` artifact.

A repository that calls the shared workflow must define the recipe. The standard check
enforces it with `ci/coverage-recipe`.

A TypeScript repository with Vitest adds `@vitest/coverage-v8` and reports lcov.

```just
# Run the suite with coverage.
coverage:
    npx vitest run --coverage --coverage.reporter=lcov
```

A Python repository adds `pytest-cov`.

```just
# Run the suite with coverage.
coverage:
    pytest --cov=src --cov-report=lcov:coverage/lcov.info
```

## The gate

The gate reads the lcov report and the merge-base diff, then measures only the lines the
change adds or edits. A change with no measured units passes, so a documentation-only
change is never blocked.

- `--mode lines|branches|both` picks what the gate measures. The default is `lines`.
- `--threshold` is the changed-line floor, 80 percent by default.
- `--branch-threshold` is the changed-branch floor, 70 percent by default.
- `--crap` prints an advisory CRAP score per changed function. It never fails the gate.
- `--allow-missing-branch` degrades to line coverage when the report carries no branch data.

The workflow calls the gate as:

```yaml
      - name: Patch coverage gate
        env:
          BASE: ${{ github.event.pull_request.base.sha || github.event.before }}
        run: node .standard/scripts/patch-coverage.mjs --lcov coverage/lcov.info --base "$BASE" --mode lines
```

Start with `--mode lines`. Raise the mode to `both` and the thresholds per repository once
the coverage tool emits branch data and the suite is strong.

## Branch data

Branch coverage needs `BRDA` records in the lcov report, and not every tool writes them.

- The Node built-in coverage reporter and Vitest's v8 provider write branch data.
- `pytest-cov` writes branch data only with `--cov-branch`.
- `cargo-llvm-cov` writes branch data only with `--branch`.
- The JaCoCo and Cobertura converters were upgraded to emit `BRDA`.
- Go stays line-only, so a Go repository uses `--mode lines`.

The gate is fail-closed. When the mode requires branches and the report has no `BRDA`
records, the gate fails instead of silently passing. Pass `--allow-missing-branch` to
degrade to line coverage instead; the run reports that it degraded and CRAP becomes
unavailable. CRAP also needs `FN` records, so it prints scores only when the report has both
branch and function data.

## Converters

A Kotlin repository runs Kover or JaCoCo and writes the same lcov file. JVM coverage tools
report XML or HTML by default, so the repository adds a converter step that writes
`coverage/lcov.info`. The gate then runs unchanged.

A Go repository writes a coverprofile, not lcov, so it adds `scripts/coverprofile-to-lcov.mjs`,
which reads the coverprofile at the default `coverage/cover.out` and writes
`coverage/lcov.info`.

```bash
go test ./... -coverprofile=coverage/cover.out
node scripts/coverprofile-to-lcov.mjs
```

A C#/.NET repository runs coverlet through `dotnet test`, which writes a cobertura XML report
by default, so it adds `scripts/cobertura-to-lcov.mjs`, which reads that report and writes
`coverage/lcov.info`.

```bash
dotnet test --collect:"XPlat Code Coverage"
node scripts/cobertura-to-lcov.mjs
```

The Go and C#/.NET converters are repository-owned, following the Kotlin converter in
[`simpsonm09-repo-template/scripts/jacoco-to-lcov.mjs`](https://github.com/simpsonm09-org/simpsonm09-repo-template/blob/main/scripts/jacoco-to-lcov.mjs),
which reads the JaCoCo report at its default `build/reports/jacoco/test/jacocoTestReport.xml`
and writes `coverage/lcov.info`. The gate then runs unchanged.

## Run it locally

```bash
node scripts/patch-coverage.mjs --lcov coverage/lcov.info --base origin/main
```

Add `--mode both` and the thresholds to mirror what the workflow gates. A change with no
measured lines passes, so a documentation-only change is never blocked.
