# Agents and skills

A repository can carry OpenCode agents and skills next to its code. An agent or skill is a Markdown file with YAML frontmatter. OpenCode reads the project copies, so a checkout carries the setup an agent needs.

## Ownership

General best practices and integration live in the plugins. Repository-specific facts live in the repository.

| Layer | Owns | Examples |
| --- | --- | --- |
| Plugins | General best practices and integration | `service-integrations`, `local-services`, `repo-tasks`, `dev-tools`, `discord`, `linkedin`, the PStack workflow skills |
| Repository | Only repo-specific facts | language and toolchain, database structure, domain rules, architecture invariants, repo commands |

The test: would this help another repository? If so, it belongs in a plugin. A repository never restates a plugin skill. It names the skill to load.

`maxstack` composes the plugin layers: the PStack base, the org layer, and the personal layer.

## Locations

| Path | Purpose |
| --- | --- |
| `AGENTS.md` | The routing instruction. It says what the repository is, the commands, the invariants, and which skills to load. |
| `.opencode/agents/<id>.md` | A repo-specific subagent profile. |
| `.opencode/skills/<id>/SKILL.md` | A repo-specific skill. |

A repository adds `AGENTS.md` when it has repo-specific facts. It adds `.opencode/` only when it needs a repo-specific agent or skill.

## Repo facts

Put these in `AGENTS.md`, not in a plugin.

- Language and toolchain.
- Data: database structure, schema location, migration command.
- Domain: rules an agent must know.
- Repo-specific commands and their quirks.

`maxstack/AGENTS.md` and `openclaw-homelab/AGENTS.md` are the worked examples.

## Skill rules

- A repo skill id must not collide with a plugin skill id.
- `name` equals the directory id.
- `description` is third-person and names the trigger.
- Keep secrets, machine paths, credentials, and personal data out. Put machine-specific AI files on the `local` branch.

## Templates

Copy [`../templates/AGENTS.md`](../templates/AGENTS.md), [`../templates/agents/repo-worker.md`](../templates/agents/repo-worker.md), [`../templates/agents/repo-reviewer.md`](../templates/agents/repo-reviewer.md), or [`../templates/skills/example-skill/`](../templates/skills/example-skill/) into the repository.
