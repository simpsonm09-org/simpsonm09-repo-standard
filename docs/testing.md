# Testing

The standard ships the lint, aislop, and security jobs. It does not ship a test job, because the test command belongs to the repository. Each repository adds one.

## Add a test job

Add a `test` job to the repository's caller workflow next to the shared jobs. The job installs the pinned tools and runs the suite.

[`../templates/caller-ci.yml`](../templates/caller-ci.yml) holds the three shared jobs. Add the test job after them. A Python repository adds this shape:

```yaml
  test:
    runs-on: ubuntu-24.04
    steps:
      - name: Checkout
        uses: actions/checkout@<sha> # <version>
        with:
          persist-credentials: false
      - name: Install pinned tools
        uses: jdx/mise-action@<sha> # <version>
      - name: Install and test
        run: |
          pip install -e '.[test]'
          pytest
```

Pin every action to a commit SHA with the version in a trailing comment. See [`pinning.md`](pinning.md).

The test command is the repository's own. Python runs `pytest`, Node runs `npm test`, and Kotlin runs `./gradlew test`.

## Regenerate the API document

A repository that exposes an HTTP API adds a step that regenerates the OpenAPI document and fails on drift. Run it before the coverage gate. See [`documentation.md`](documentation.md).

```yaml
      - name: Check the API document
        run: |
          just spec
          git diff --exit-code -- docs/openapi.*
```

## Required check

The shared status checks are `lint / flint`, `aislop / aislop`, `security / trivy`, `security / secrets`, `standard / standard`, and `coverage / coverage`. The `test` job is also required. Name the job `test` so the required check has one stable name across the fleet. See [`governance.md`](governance.md).

## Local

Run the suite through the task runner, and keep the same command in a `mise` task.

```bash
just test
```
