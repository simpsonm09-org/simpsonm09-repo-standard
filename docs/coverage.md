# Coverage

The test check gates coverage on the lines a change adds or edits, not on the whole
repository. A repository carries its own suite and its own coverage tool, and the shared
[`scripts/patch-coverage.mjs`](../scripts/patch-coverage.mjs) reads the lcov report and the
git diff and fails when the changed lines fall below the threshold (80 percent by default).

Gating changed lines avoids retrofitting tests onto existing code, which is why the fleet
does not set a whole-repository floor.

## Wire it into the test job

Copy [`scripts/patch-coverage.mjs`](../scripts/patch-coverage.mjs) into the repository's
`scripts/` directory, next to `prune.mjs`. Emit an lcov report, then run the gate.

A TypeScript repository with Vitest adds `@vitest/coverage-v8` and reports lcov.

```yaml
      - name: Test with coverage
        run: npx vitest run --coverage --coverage.reporter=lcov
      - name: Patch coverage
        env:
          BASE: ${{ github.event.pull_request.base.sha || github.event.before }}
        run: node scripts/patch-coverage.mjs --lcov coverage/lcov.info --base "$BASE" --threshold 80
```

A Python repository adds `pytest-cov`.

```yaml
      - name: Test with coverage
        run: pytest --cov=src --cov-report=lcov:coverage/lcov.info
      - name: Patch coverage
        env:
          BASE: ${{ github.event.pull_request.base.sha || github.event.before }}
        run: node scripts/patch-coverage.mjs --lcov coverage/lcov.info --base "$BASE" --threshold 80
```

Node runs the same script for both languages because both emit lcov.

A Kotlin repository runs Kover or JaCoCo and writes the same lcov file. JVM coverage tools report XML or HTML by default, so the repository adds a converter step that writes `coverage/lcov.info`. The gate then runs unchanged.

## Run it locally

```bash
node scripts/patch-coverage.mjs --lcov coverage/lcov.info --base origin/main --threshold 80
```

A change with no measured lines passes, so a documentation-only change is never blocked.
The threshold is a starting line; raise it per repository when the suite is strong.
