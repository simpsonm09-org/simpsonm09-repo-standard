# Scripts

Operational scripts live in `scripts/`. Each script ships as a bash version and a PowerShell version with the same behavior and the same exit codes. Change one and you change both.

## Parity

- `apply-rulesets.sh` and `apply-rulesets.ps1` apply every JSON file under `rulesets/` to a repository.

## Rules

- Read paths from the script location, not the current directory.
- Print a dry run by default. Write only when the caller passes `--apply` or `-Apply`.
- Exit non-zero on a real failure. Exit zero when there is nothing to do.
- Keep secrets out of a script. Read them from the environment by name.
- Land a new flag or check in both versions in the same change.
- Run consistent error handling. The bash version sets `set -euo pipefail`. The PowerShell version sets `Set-StrictMode -Version Latest` and `$ErrorActionPreference = 'Stop'`.

## Declaring a single-platform script

Most scripts are twins. When a script is legitimately single-platform, say so in a header comment within the first ten lines. The conformance check reads the comment and stops asking for a missing twin.

```bash
# platforms: posix
```

Use `# platforms: windows` for a PowerShell-only script. The value is one word, `windows` or `posix`. Do not add a sidecar file.

## Conformance

`scripts/check-standard.mjs` runs a `scripting` group over a repository. Each rule is a named entry in the printed matrix.

| Entry | Rule |
| --- | --- |
| `scripting/windows-shell` | the root `justfile` has a `set windows-shell` line |
| `scripting/shell-ops` | a recipe body has no `&&`, `&`, `;`, `|`, redirection, `$VAR`, backtick substitution, `./`, or `.\` |
| `scripting/interpreter` | a recipe body names no interpreter as its command word (a version suffix such as `python3.12` counts as `python`) outside a `{{ ... }}` expression or a `mise exec`/`mise run` line |
| `scripting/twin-exists` | a recipe that routes on `os_family()` or `os()` points at scripts that exist |
| `scripting/script-declared` | every `scripts/**/*.ps1` and `scripts/**/*.sh` is referenced by an op or recipe, or declares its platform |
| `scripting/skill-recipe` | a non-vendored skill says `just <recipe>`, never a script path |
| `scripting/tools-check` | a repository with a `tools.yaml` has a `tools-check` recipe |

Run the group on one repository with `just check-standard .`. Run it over the whole fleet with `just audit-fleet <repos-dir>`, which prints one matrix and exits non-zero when any repository fails. Vendored PStack skills are exempt.

## Running

```bash
bash scripts/apply-rulesets.sh <owner>/<repo> --apply
```

```powershell
pwsh -File scripts/apply-rulesets.ps1 -Repo <owner>/<repo> -Apply
```

The ruleset scripts need an authenticated `gh` CLI.
