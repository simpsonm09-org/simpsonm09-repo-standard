# Agents and skills

A repository can carry agents and skills next to its code. An agent or skill is a Markdown file with YAML frontmatter. Sessions run in T3 Code, through either the OpenCode or the Claude Code provider. The shared and personal skills reach both providers from plugins. A repository's own files are read by OpenCode only today. See [Harnesses](#harnesses) and [Repo-local files](#repo-local-files).

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

| Harness | Finds plugins | Plugin skill names | Repo-local `.opencode/` |
| --- | --- | --- | --- |
| OpenCode | Walks up from the repository or worktree to the workspace root, and loads `.opencode/plugins/<name>` | Unprefixed, such as `repo-standard` | Read |
| Claude Code | A T3 Claude provider instance launched with `--plugin-dir <workspace>\.claude\plugins`, which holds one folder per plugin | Prefixed with the plugin name, such as `simpsonm09-org-ai-plugin:repo-standard` and `pstack:poteto-mode` | Not read |

`<workspace>` is the workspace root above `projects`. The installer and the T3 provider setup are in `docs/t3-setup.md` of `simpsonm09-maxstack`.

The access gate ships in the org plugin and runs in both harnesses. See [`features/agent-access.md`](features/agent-access.md).

## Locations

| Path | Purpose |
| --- | --- |
| `AGENTS.md` | The routing instruction. It says what the repository is, the commands, the invariants, and which skills to load. Claude Code reads it natively when there is no `CLAUDE.md`, so a repository keeps only `AGENTS.md`. |
| `.opencode/agents/<id>.md` | A repo-specific subagent profile. OpenCode only. |
| `.opencode/skills/<id>/SKILL.md` | A repo-specific skill. OpenCode only. |

A repository adds `AGENTS.md` when it has repo-specific facts. It adds `.opencode/` only when it needs a repo-specific agent or skill.

## Repo-local files

A repo-specific agent or skill is read by OpenCode only. Claude Code does not read `.opencode/`, and this standard does not yet provide a Claude location for repo-local skills.

Four repositories carry a repo-local skill at `.opencode/skills/verify`: `simpsonm09-browser-calculator`, `simpsonm09-openclaw-homelab`, `simpsonm09-playwright-api-wrapper`, and `simpsonm09-postman-test-utils`. No Claude copy exists. Until one is added, the `verify` skill is available only in OpenCode sessions in these repositories, and a Claude session does not load it.

## Repo facts

Put these in `AGENTS.md`, not in a plugin.

- Language and toolchain.
- Data: database structure, schema location, migration command.
- Domain: rules an agent must know.
- Repo-specific commands and their quirks.

`maxstack/AGENTS.md` and `openclaw-homelab/AGENTS.md` are the worked examples.

## Skill rules

- A repo skill id must not collide with a plugin skill id. OpenCode skill names are unprefixed, so the clash is real there. Claude Code names plugin skills with the plugin prefix.
- `name` equals the directory id.
- `description` is third-person and names the trigger.
- Keep secrets, machine paths, credentials, and personal data out. Put machine-specific AI files on the `local` branch.

## Templates

Copy [`../templates/AGENTS.md`](../templates/AGENTS.md), [`../templates/agents/repo-worker.md`](../templates/agents/repo-worker.md), [`../templates/agents/repo-reviewer.md`](../templates/agents/repo-reviewer.md), or [`../templates/skills/example-skill/`](../templates/skills/example-skill/) into the repository.

The two agent templates use OpenCode's frontmatter (`mode`, `permissions`) and call the `skill` tool, so they are OpenCode only. The skill template uses `name` and `description` frontmatter, the same format the plugin layers use for both harnesses.
