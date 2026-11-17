# Root README

Every repository carries a root `README.md`. It is the front door for a human or an agent, not the reference. Keep it under about 120 lines and put detail in `docs/`.

## Required sections

Use these sections in this order.

| Section | Required | Holds |
| --- | --- | --- |
| `# <repo-name>` | yes | The repository name. |
| Purpose | yes | One sentence that says what it is and who uses it. |
| Source of truth | yes | The `simpsonm09-projects` repository it lives in, and the branch-and-PR rule. |
| `## Status` | scaffolds | The current state. |
| `## What it does` | yes | The short version. |
| `## Quick start` | yes | The shortest path to run it. |
| `## Commands` | yes | The `just` recipe table. |
| `## Documentation` | when `docs/` exists | A link to `docs/README.md`. |
| `## Layout` | optional | The top-level paths. |
| `## License` | yes | The license and a link to `LICENSE`. |
| `## Related repositories` | optional | What this repository depends on or feeds. |

## Rules

- The README is the front door. API and user detail live in `docs/`.
- Commands go through `just`. Do not put raw tool invocations in the README.
- The purpose sentence names the repository and its audience.
- The `## License` section states `MIT` and links `LICENSE`.
- A scaffold carries a `## Status` line, as `openclaw-homelab` does.

## Source of truth

State where the repository lives in the opening section.

```
This repository lives in `simpsonm09-projects/<repo>`. Work happens on a branch
with a pull request into `main`.
See [`repo-standard`](https://github.com/simpsonm09-projects/simpsonm09-repo-standard)
for the branch model and the protection rules.
```

A source repository states that it is the source, as `repo-standard` and `repo-template` do. The one personal repository is the PStack plugin source, `simpsonm09/pstack-max`, a fork of `michael-denyer/pstack-claude`; it states that it is a fork and where the upstream lives.

## Start from the template

Copy [`../templates/README.md`](../templates/README.md) and replace the placeholders.
