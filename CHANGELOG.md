# Changelog

## Unreleased

- Scope GitHub App installation tokens to the requested repository. Existing
  installation permission defaults remain unchanged.
- Add the pure repository-maintenance planner under `tools/repo-maintenance/`. It
  is planning only: it turns an immutable snapshot into typed eligibility actions
  and ships no executor, no CLI, and no cleanup. Its pure suite runs through
  `just test-repo-maintenance` and the hosted `repo-maintenance-planner`
  workflow.
