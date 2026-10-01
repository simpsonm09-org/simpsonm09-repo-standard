# Pinning

## Actions

Every action reference is pinned to a full commit SHA with the human-readable version in a trailing comment.

```yaml
uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

Dependabot updates the SHA and the comment together. Do not replace a SHA with a mutable tag.

## Reusable workflow callers

Consuming repositories should pin the `uses:` reference to this repository at a commit SHA rather than `@main`. Dependabot does not update a remote reusable-workflow reference, so the pin-update workflow reports when the pin falls behind. See [automation.md](automation.md).

## Tools

Tool versions are pinned in `mise.toml`. Flint runs only the tools declared there. Treat a linter or formatter version bump as an intentional change. Dependabot does not manage `mise.toml`, so bump the pin by hand.

## Images

Container references are pinned to a version tag. Pin to a digest where the registry supports it.
