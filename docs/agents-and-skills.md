# Agents and skills

A repository can carry agents and skills next to its code. An agent or skill is a Markdown file with YAML frontmatter. Sessions run in T3 Code, through either the OpenCode or the Claude Code provider. The shared and personal skills reach both providers from plugins. A repository's own skills live in `.claude/skills/`, which both providers read. A repository's own agent profiles are read by OpenCode only. See [Harnesses](#harnesses) and [Repo-local files](#repo-local-files).

## Ownership

General best practices and integration live in the plugins. Repository-specific facts live in the repository.

| Layer | Owns | Examples |
| --- | --- | --- |
| Plugins | General best practices and integration | `service-integrations`, `local-services`, `repo-tasks`, `dev-tools`, `discord`, `integrations-personal`, the PStack workflow skills |
| Repository | Only repo-specific facts | language and toolchain, database structure, domain rules, architecture invariants, repo commands |

The test: would this help another repository? If so, it belongs in a plugin. A repository never restates a plugin skill. It names the skill to load.

`maxstack` composes the plugin layers: the PStack base, the org layer, and the personal layer. Its installer writes them once, at the workspace root, for both harnesses. Nothing is configured per repository for plugins.

## Harnesses

T3 Code runs two providers. Each finds the plugins in a different way, and each names plugin skills in a different way.

| Harness | Finds plugins | Plugin skill names | Repo-local skills (`.claude/skills/`) | Repo-local agents (`.opencode/agents/`) |
| --- | --- | --- | --- | --- |
| OpenCode | Walks up from the repository or worktree to the workspace root, and loads `.opencode/plugins/<name>` | Unprefixed, such as `repo-standard` | Read | Read |
| Claude Code | A T3 Claude provider instance launched with `--plugin-dir <workspace>\.claude\plugins`, which holds one folder per plugin | Prefixed with the plugin name, such as `simpsonm09-org-ai-plugin:repo-standard` and `pstack:poteto-mode` | Read | Not read |

`<workspace>` is the workspace root above `projects`. The installer and the T3 provider setup are in `docs/t3-setup.md` of `simpsonm09-maxstack`.

The access gate ships in the org plugin and runs in both harnesses. See [`features/agent-access.md`](features/agent-access.md).

## Locations

| Path | Purpose |
| --- | --- |
| `AGENTS.md` | The routing instruction. It says what the repository is, the commands, the invariants, and which skills to load. Claude Code reads it natively when there is no `CLAUDE.md`, so a repository keeps only `AGENTS.md`. |
| `.claude/skills/<id>/SKILL.md` | A repo-specific skill. Claude Code and OpenCode both read it. |
| `.opencode/agents/<id>.md` | A repo-specific subagent profile. OpenCode only. |
| `.opencode/skills/<id>/SKILL.md` | The old location of a repo-specific skill. Move it to `.claude/skills/<id>/`. |

A repository adds `AGENTS.md` when it has repo-specific facts. It adds `.claude/skills/<id>/` for each repo-specific skill, and `.opencode/agents/` only when it needs a repo-specific agent profile.

## Repo-local files

A repo-specific skill lives at `.claude/skills/<id>/SKILL.md`. Claude Code and OpenCode both read that path, so one file serves both harnesses and nothing is duplicated. OpenCode also reads `.opencode/skills/` and `.agents/skills/`, and Claude Code reads neither. This standard uses only `.claude/skills/`.

`.opencode/skills/<id>/SKILL.md` is the old location, and it is being migrated. The checker still reads it, so a repository that has not moved is still checked. A repository moves a skill by moving its directory to `.claude/skills/` in the same change. An id belongs in one root only. The checker reports `scripting/skill-duplicate` when the same id is in both.

A repo-specific agent profile lives at `.opencode/agents/<id>.md`. It uses OpenCode-only frontmatter, so OpenCode is the only harness that reads it. Claude Code has no equivalent location here, and this standard does not invent one.

Four repositories still carry a repo-local skill at `.opencode/skills/verify` and have not moved yet: `simpsonm09-browser-calculator`, `simpsonm09-openclaw-homelab`, `simpsonm09-playwright-api-wrapper`, and `simpsonm09-postman-test-utils`. Each moves its skill to `.claude/skills/verify/` in its own pull request. Until then, the `verify` skill is available only in OpenCode sessions in these repositories.

## Repo facts

Put these in `AGENTS.md`, not in a plugin.

- Language and toolchain.
- Data: database structure, schema location, migration command.
- Domain: rules an agent must know.
- Repo-specific commands and their quirks.

`maxstack/AGENTS.md` and `openclaw-homelab/AGENTS.md` are the worked examples.

## Skill rules

- A repo skill id must not collide with a plugin skill id. OpenCode skill names are unprefixed, so the clash is real there. Claude Code names plugin skills with the plugin prefix.
- A repo skill id lives in `.claude/skills/` or in `.opencode/skills/`, never in both.
- `name` equals the directory id.
- `description` is third-person and names the trigger.
- Keep secrets, machine paths, credentials, and personal data out. Put machine-specific AI files on the `local` branch.

## Templates

Copy [`../templates/AGENTS.md`](../templates/AGENTS.md), [`../templates/agents/repo-worker.md`](../templates/agents/repo-worker.md), [`../templates/agents/repo-reviewer.md`](../templates/agents/repo-reviewer.md), or [`../templates/skills/example-skill/`](../templates/skills/example-skill/) into the repository. Copy the skill template to `.claude/skills/<id>/` and rename the directory to the skill id.

The two agent templates use OpenCode's frontmatter (`mode`, `permissions`) and call the `skill` tool, so they are OpenCode only. The skill template uses `name` and `description` frontmatter, the same format the plugin layers use for both harnesses, so it works in both.
