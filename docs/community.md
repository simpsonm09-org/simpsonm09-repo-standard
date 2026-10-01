# Community health files

GitHub shows a row of quick links on a repository's main page when it detects
specific files. The row is the community health files bar. This page defines which
files the standard requires, where they live, and which are optional.
`scripts/check-standard.mjs` enforces the required set in the `community` and
`files` groups, and `check-repo` reports a missing repository description.

## Detected fields

| Field | File | Required | Location |
| --- | --- | --- | --- |
| README | `README.md` | yes | root |
| Code of conduct | `CODE_OF_CONDUCT.md` | yes | root |
| Contributing | `CONTRIBUTING.md` | yes | root |
| Security | `SECURITY.md` | yes | root |
| License | `LICENSE` | yes | root |
| Support | `SUPPORT.md` | yes | root |
| Citation | `CITATION.cff` | no | root |

GitHub detects these files in the repository root, in `.github/`, or in `docs/`. The
standard keeps them in the root so the same path works in every checkout and in the
byte-identical comparison.

## Required files

`README.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, and
`SUPPORT.md` are required. All except `README.md` are byte-identical across the fleet,
so the checker fails when one differs. Copy them from this repository without edits.
See [adoption.md](adoption.md) step 11 and [root-readme.md](root-readme.md).

## Byte-identical set

These files must match this repository byte for byte.

- `LICENSE`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SUPPORT.md`
- `.editorconfig`
- `.aislop/config.yml`
- `.github/pull_request_template.md`
- `.github/ISSUE_TEMPLATE/bug.yml`
- `.github/ISSUE_TEMPLATE/feature.yml`
- `.github/ISSUE_TEMPLATE/config.yml`

`CODEOWNERS` and `.gitattributes` are per-repository. Set the owner in `CODEOWNERS`,
and add `linguist-generated` lines to `.gitattributes` for the files the repository
generates.

## Optional files

- `CITATION.cff` states how to cite the repository. The fleet does not use it.

## Repository description

GitHub scores the community profile from the description, the README, the license,
the code of conduct, the contributing guide, the templates, and whether content
reports are enabled. Keep a one-line description that names what the repository is
and who uses it. `check-repo` reports `settings/description` when it is empty. Set it
with `gh repo edit --description`.

## Profile score

Content reports are set per repository and the API cannot change them, so a
repository created before the setting existed scores 87 percent while a newer one
scores 100. The score is a guide, not a gate. The required files and the description
are the parts the standard controls. The wiki is unrelated to the score and stays off
unless a repository wants a page surface.
