# Definition of done

A change is done when every item below holds. The pull request checklist links here.

1. The `standard` check is green. The repository matches the standard.
2. The `test` check is green. The suite, and the changed-line coverage the repository gates, pass.
3. The change is verified on the real artifact. The pull request states how you proved it, such as the command you ran, the endpoint you called, or the screen you drove. A compile or a green lint is not proof of behavior.
4. Commits are signed. The `protect-main` ruleset enforces this.
5. No secret, credential, or machine path is committed, and the secret scan is green. An ignored `.env` is never deleted, and its committed sibling `.env.example` and the root `.worktreeinclude` stay in sync.
6. The docs match the change. Update the root README, `docs/`, and `docs/manifest.json` when the change alters behavior, a contract, or the layout.
7. Generated files are marked `linguist-generated` in `.gitattributes`.
8. A change that ships carries a release note. Update `CHANGELOG.md` when the repository publishes an artifact.
9. Work a human reviews after stepping away carries a decision trail. See the `show-me-your-work` skill (`pstack:show-me-your-work` in Claude Code).

A change is not done when a required check is red, when the only proof is that it compiles, or when a gap is excepted without a recorded reason.
