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

## Running

```bash
bash scripts/apply-rulesets.sh <owner>/<repo> --apply
```

```powershell
pwsh -File scripts/apply-rulesets.ps1 -Repo <owner>/<repo> -Apply
```

The ruleset scripts need an authenticated `gh` CLI.
