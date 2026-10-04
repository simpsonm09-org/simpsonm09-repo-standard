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

Flint manages the Go and Rust tools in the table above. Declaring `golangci-lint`, `gofmt`, `cargo-clippy`, or `cargo-fmt` in `mise.toml` activates the matching check, so no `just` recipe is needed. Flint names the Rust checks `cargo-clippy` and `cargo-fmt`, which run `clippy` and `rustfmt`. `golangci-lint` reads `.golangci.yml` from `$FLINT_CONFIG_DIR` (`.github/config`); the other checks need no Flint-managed config.

C# is the exception. Flint ships one C# check, `dotnet-format`, which runs `dotnet format` and is classified as the formatter. Flint exposes no separate C# linter. Declaring `dotnet-format` in `mise.toml` makes Flint format C# and report what still needs action. A repository that also wants analyzer linting enforced as a hard gate adds a `just` recipe outside Flint, because Flint has no C# lint check to activate. Prefer `dotnet format` over `csharpier` for the formatting Flint runs, since `dotnet-format` is Flint-managed while `csharpier` is absent from Flint's check list and would itself need a repository-owned `just` recipe.

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
