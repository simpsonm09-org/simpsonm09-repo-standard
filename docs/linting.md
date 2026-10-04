# Linting

The shared `lint` job runs [Flint](https://github.com/grafana/flint) in the calling repository. Flint activates a check from the repository's `mise.toml`: declare a Flint-managed tool and the check runs. An undeclared tool is skipped, so a check never runs without a pinned tool.

## Declared tools

Every repository declares the workflow linters.

- `aqua:rhysd/actionlint` and `aqua:zizmorcore/zizmor` lint the GitHub Actions workflows.

Each repository declares the language tools it ships, and Flint installs and runs them.

| Language or file | Linter | Formatter |
| --- | --- | --- |
| TypeScript, JavaScript, JSON | `biome` | `biome-format` |
| Python | `ruff` | `ruff-format` |
| Kotlin | `ktlint` | `ktlint` |
| Java | `checkstyle` | `google-java-format` |
| Go | `golangci-lint` | `gofmt` |
| Rust | `cargo-clippy` | `cargo-fmt` |
| C# | none | `dotnet-format` |
| Shell | `shellcheck` | `shfmt` |
| Markdown | `rumdl` | `rumdl` |
| YAML | `ryl` | `ryl` |
| TOML | none | `taplo` |
| Dockerfile | `hadolint` | none |
| Any | `editorconfig-checker`, `typos`, `lychee` | none |

Prefer a formatter for every file type the repository ships, so lint and format do not fight over the same files.

### Go, C#, and Rust

Flint activates the Go, Rust, and C# checks through each language's toolchain, so declare the toolchain in `mise.toml` and no `just` recipe is needed.
For Go, declare `go`, which provides `gofmt`, and declare `golangci-lint` for the linter.
For Rust, declare `rust` with the `clippy` and `rustfmt` components, which provides `cargo-clippy` and `cargo-fmt`.
For C#, declare `dotnet`, which provides `dotnet-format`.
Flint names the Rust checks `cargo-clippy` and `cargo-fmt`.
`cargo-clippy` runs `cargo clippy`, and `cargo-fmt` runs `cargo fmt`.
`cargo-fmt` and `dotnet-format` are not `mise.toml` keys, so declaring either activates nothing.
`golangci-lint` reads `.golangci.yml` from `$FLINT_CONFIG_DIR` (`.github/config`), and `cargo-fmt` reads `rustfmt.toml` from the same directory.
`gofmt`, `cargo-clippy`, and `dotnet-format` need no Flint-managed config.

C# is the exception.
Flint ships one C# check, `dotnet-format`, which runs `dotnet format` and is classified as the formatter.
Flint exposes no separate C# linter.
Declare `dotnet` in `mise.toml` so Flint formats C# and reports what still needs action.
A repository that also wants analyzer linting enforced as a hard gate adds a `just` recipe outside Flint, because Flint has no C# lint check to activate.
Prefer `dotnet format` over `csharpier` for the formatting Flint runs, since `dotnet-format` is Flint-managed while `csharpier` is absent from Flint's check list and would itself need a repository-owned `just` recipe.

## Complexity and size

The fleet holds one set of complexity limits. Each language linter reads the limit from the config file it already owns.

| Metric | Default |
| --- | --- |
| Cognitive complexity | 15 |
| Cyclomatic complexity | 10 |
| Function length (statements) | 60 |
| Block nesting depth | 4 |
| Parameters | 6 |

The config file for each linter.

| Language | Config file | Setting |
| --- | --- | --- |
| TypeScript, JavaScript | `biome.jsonc` | `linter.rules.complexity.noExcessiveCognitiveComplexity`, option `maxAllowedComplexity` |
| Python | `.github/config/ruff.toml` | top-level `[lint]` C901, PLR0912, PLR0915, and PLR0913, and `[lint.mccabe] max-complexity` |
| Go | `.github/config/.golangci.yml` | `gocyclo`, `gocognit`, `funlen`, `nestif` |
| Rust | `Cargo.toml` | `[lints.clippy]` `cognitive_complexity` and `too_many_lines` |
| C# and .NET | `.globalconfig` | `is_global = true` and severities for `CA1502`, `CA1505`, and `CA1506`, plus a repository-owned `just` recipe |
| Kotlin | Detekt | `CyclomaticComplexMethod`, `LongMethod`, `NestedBlockDepth` |
| Java | checkstyle | `CyclomaticComplexity`, `NPathComplexity`, `JavaNCSS`, `MethodLength` |

Flint has no C# linter, so a C# repository enforces the analyzer rules with a `just` recipe it owns. A C# repository puts the analyzer severities in a repository-local `.globalconfig`, a Roslyn global analyzer config, and wires it through `Directory.Build.props` when a solution spans several projects. The shared `.editorconfig` is byte-identical across the fleet and a repository that edits it fails the `standard` check, so repository-local analyzer rules never go there. Flint manages `ktlint` for Kotlin formatting only, so Detekt carries the Kotlin limits.

When existing code trips a rule, set the initial threshold at the current maximum and record why. Lower the threshold as the code improves, so the limit only decreases.

[`../templates/config/`](../templates/config/) holds a minimal snippet for each linter.

## Add a check

Use Flint to add or refresh one check without disturbing the others.

```bash
mise exec -- flint init --only ruff
```

This pins the tool in `mise.toml` and writes any managed config. Commit the pins it adds.

## Run it

```bash
just lint        # flint run
just lint-fix    # flint run --fix
```

The shared `lint` job runs the same command in CI. Flint checks changed files locally and the full set in CI.

## Configuration

- Flint reads `.github/config/flint.toml` through `FLINT_CONFIG_DIR`.
- The canonical config for a linter lives under `.github/config`, unless the linter needs its own root file.
- Mark generated files `linguist-generated` in `.gitattributes` instead of excluding them from lint.

See the [Flint CLI reference](https://github.com/grafana/flint/blob/main/docs/cli.md).
