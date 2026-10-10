# Agents and skills

A repository can carry agents and skills next to its code. An agent or skill is a Markdown file with YAML frontmatter. The org plugin's access gate supports OpenCode, Claude Code, GitHub Copilot CLI, and Pi. The shared and personal skills are provided by plugins. Repo-local skills and agent profiles use the paths described below; this guide documents their discovery in OpenCode and Claude Code only. See [Harnesses](#harnesses) and [Repo-local files](#repo-local-files).

## Ownership

General best practices and integration live in the plugins. Repository-specific facts live in the repository.

| Layer | Owns | Examples |
| --- | --- | --- |
| Plugins | General best practices and integration | `service-integrations`, `local-services`, `repo-tasks`, `dev-tools`, `discord`, `integrations-personal`, the PStack workflow skills |
| Repository | Only repo-specific facts | language and toolchain, database structure, domain rules, architecture invariants, repo commands |

The test: would this help another repository? If so, it belongs in a plugin. A repository never restates a plugin skill. It names the skill to load.

`maxstack` composes the plugin layers: the PStack base, the org layer, and the personal layer. The org plugin's gate supports OpenCode, Claude Code, GitHub Copilot CLI, and Pi; installation and harness setup are specific to each adapter.

## Harnesses

The four gate harnesses load the org plugin through different entry points. See the org plugin README's [plugin loading](https://github.com/simpsonm09-org/simpsonm09-org-ai-plugin#how-it-gets-loaded), [Copilot build](https://github.com/simpsonm09-org/simpsonm09-org-ai-plugin#github-copilot-cli-build), and [Pi build](https://github.com/simpsonm09-org/simpsonm09-org-ai-plugin#pi-coding-agent-build) for those details.

| Harness | Org plugin entry point | Gate adapter | Repo-local skills (`.claude/skills/`) | Repo-local agents (`.opencode/agents/`) |
| --- | --- | --- | --- | --- |
| OpenCode | Loads the workspace `.opencode/plugins/<name>` plugin | `create.before` shell hook | Read | Read |
| Claude Code | Start with `--plugin-dir <workspace>/.claude/plugins` | `PreToolUse` hook | Read | Not read |
| GitHub Copilot CLI | Pass the plugin folder containing `.github/plugin/plugin.json` with `--plugin-dir` | Copilot `preToolUse` hook, adapted to the shared Claude decision | Not documented here | Not documented here |
| Pi | Load the package through Pi's `pi` manifest; save it in Pi's `packages` list to include child agents | `tool_call` extension | Not documented here | Not documented here |

OpenCode registers the plugin's skills through its skill transform. Claude Code loads the plugin from its plugin directory. The org plugin README does not establish repo-local skill or agent discovery for Copilot CLI or Pi.

The access gate ships in the org plugin and runs in all four harnesses. See [`features/agent-access.md`](features/agent-access.md).

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
