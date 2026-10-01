# Cross-platform task runner for humans and agents. `just --list` shows every
# recipe. The recipes come from ops.generated.just, which scripts/op.mjs renders
# from ops.json. See docs/task-runner.md and docs/validation.md.
set windows-shell := ["pwsh", "-NoLogo", "-NoProfile", "-Command"]

import "ops.generated.just"

# List the recipes.
default:
    @just --list
