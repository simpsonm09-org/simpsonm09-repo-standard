#!/usr/bin/env node
// Prove each scripting conformance rule against a throwaway fixture repository.
// Every rule gets a violating fixture that must report its named matrix entry
// and a compliant fixture that must report nothing, so the assertions name the
// entry, not a count. The checker reads files only and never runs repo code.
//
// Usage:
//   node --test scripts/scripting.test.mjs
//
// Exits 0 when every assertion holds and 1 on the first failure.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkScripting } from './check-standard.mjs';
import { isMain } from './lib/proc.mjs';

const SHELL = 'set windows-shell := ["pwsh", "-NoLogo", "-NoProfile", "-Command"]\n';
const DEFAULT = '\n# List the recipes.\ndefault:\n    @just --list\n';
const COMPLIANT = { justfile: `${SHELL}${DEFAULT}` };
const SKILL = (body) => `---\nname: sample\ndescription: A sample skill.\n---\n\n${body}\n`;

function makeAsserter() {
  let count = 0;
  const assert = (condition, message) => {
    count += 1;
    if (!condition) throw new Error(message);
  };
  return { assert, total: () => count };
}

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'scripting-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, ...rel.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function idsFor(files) {
  const root = fixture(files);
  try {
    const ids = [];
    checkScripting(root, (id) => ids.push(id));
    return ids;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function expectEntry(assert, label, files, id) {
  const ids = idsFor(files);
  assert(ids.includes(id), `${label}: expected ${id}, got [${ids.join(', ')}]`);
}

function expectClean(assert, label, files) {
  const ids = idsFor(files);
  assert(ids.length === 0, `${label}: expected no gaps, got [${ids.join(', ')}]`);
}

function testWindowsShell(assert) {
  expectEntry(assert, 'missing set windows-shell', { justfile: DEFAULT }, 'scripting/windows-shell');
  expectClean(assert, 'compliant justfile', COMPLIANT);
}

function testShellOps(assert) {
  const violations = [
    'echo a && echo b',
    'echo a; echo b',
    'echo a | cat',
    'echo a > out',
    'echo $HOME',
    'node ./scripts/x.mjs',
    'node a.mjs & node b.mjs',
    'echo `date`',
    'node x "$CONFIG"',
    'echo "`date`"',
  ];
  for (const body of violations) {
    const files = { justfile: `${SHELL}\n# Bad.\nbad:\n    ${body}\n` };
    expectEntry(assert, `shell operator in "${body}"`, files, 'scripting/shell-ops');
  }
  expectClean(assert, 'portable recipe body', COMPLIANT);
  expectClean(assert, 'a quoted flag value is not shell syntax', {
    justfile: `${SHELL}\n# Run.\nrun:\n    node scripts/run.mjs --filter "a<b"\n`,
  });
  expectClean(assert, 'a single-quoted segment is inert', {
    justfile: `${SHELL}\n# Run.\nrun:\n    node scripts/run.mjs ';'\n`,
  });
}

function testInterpreter(assert) {
  expectEntry(assert, 'bare bash', { justfile: `${SHELL}\n# Bad.\nbad:\n    bash scripts/x.sh\n` }, 'scripting/interpreter');
  expectEntry(assert, 'bare pwsh', { justfile: `${SHELL}\n# Bad.\nbad:\n    pwsh -File scripts/x.ps1\n` }, 'scripting/interpreter');
  expectEntry(assert, 'bare python', { justfile: `${SHELL}\n# Bad.\nbad:\n    python scripts/x.py\n` }, 'scripting/interpreter');
  expectEntry(assert, 'a versioned python is still python', { justfile: `${SHELL}\n# Bad.\nbad:\n    python3.12 scripts/x.py\n` }, 'scripting/interpreter');
  const routed = {
    justfile: `${SHELL}\n# Route.\nrun:\n    {{ if os_family() == "windows" { "pwsh -File scripts/run.ps1" } else { "bash scripts/run.sh" } }}\n`,
    'scripts/run.ps1': 'Write-Output ok\n',
    'scripts/run.sh': 'echo ok\n',
  };
  expectClean(assert, 'interpreter inside a just expression', routed);
  expectClean(assert, 'interpreter behind mise exec', { justfile: `${SHELL}\n# Spec.\nspec:\n    mise exec -- python scripts/x.py\n` });
  expectClean(assert, 'an interpreter used as a flag value is not the command', {
    justfile: `${SHELL}\n# Generate.\ngen:\n    node scripts/gen.mjs --language python\n`,
  });
}

function testTwinExists(assert) {
  const missing = {
    justfile: `${SHELL}\n# Route.\nrun:\n    {{ if os_family() == "windows" { "pwsh -File scripts/run.ps1" } else { "bash scripts/run.sh" } }}\n`,
    'scripts/run.sh': 'echo ok\n',
  };
  expectEntry(assert, 'twin routes to a missing side', missing, 'scripting/twin-exists');
  expectClean(assert, 'both twin sides exist', {
    justfile: `${SHELL}\n# Route.\nrun:\n    {{ if os_family() == "windows" { "pwsh -File scripts/run.ps1" } else { "bash scripts/run.sh" } }}\n`,
    'scripts/run.ps1': 'Write-Output ok\n',
    'scripts/run.sh': 'echo ok\n',
  });
}

function testScriptDeclared(assert) {
  expectEntry(assert, 'orphan posix script', { ...COMPLIANT, 'scripts/orphan.sh': '#!/usr/bin/env bash\necho ok\n' }, 'scripting/script-declared');
  expectEntry(assert, 'orphan windows script', { ...COMPLIANT, 'scripts/orphan.ps1': 'Write-Output ok\n' }, 'scripting/script-declared');
  expectEntry(assert, 'a bash script declaring windows', { ...COMPLIANT, 'scripts/orphan.sh': '# platforms: windows\n#!/usr/bin/env bash\necho ok\n' }, 'scripting/script-declared');
  expectEntry(assert, 'a PowerShell script declaring linux', { ...COMPLIANT, 'scripts/orphan.ps1': '# platforms: linux\nWrite-Output ok\n' }, 'scripting/script-declared');
  expectEntry(assert, 'a script named only in a comment', {
    justfile: `${SHELL}\n# Run scripts/orphan.sh from here.\ndefault:\n    @just --list\n`,
    'scripts/orphan.sh': '#!/usr/bin/env bash\necho ok\n',
  }, 'scripting/script-declared');
  expectClean(assert, 'declared posix script', { ...COMPLIANT, 'scripts/orphan.sh': '# platforms: posix\n#!/usr/bin/env bash\necho ok\n' });
  expectClean(assert, 'declared linux script', { ...COMPLIANT, 'scripts/orphan.sh': '# platforms: linux\n#!/usr/bin/env bash\necho ok\n' });
  expectClean(assert, 'declared macos script', { ...COMPLIANT, 'scripts/orphan.sh': '# platforms: macos\n#!/usr/bin/env bash\necho ok\n' });
  expectClean(assert, 'declared windows script', { ...COMPLIANT, 'scripts/orphan.ps1': '# platforms: windows\nWrite-Output ok\n' });
  expectClean(assert, 'script referenced by a recipe', {
    justfile: `${SHELL}\n# Route.\nrun:\n    {{ if os_family() == "windows" { "pwsh -File scripts/run.ps1" } else { "bash scripts/run.sh" } }}\n`,
    'scripts/run.ps1': 'Write-Output ok\n',
    'scripts/run.sh': 'echo ok\n',
  });
  expectClean(assert, 'script referenced by an op', {
    ...COMPLIANT,
    'ops.json': JSON.stringify({ operations: [{ id: 'run', kind: 'twin', windows: 'scripts/run.ps1', posix: 'scripts/run.sh' }] }),
    'scripts/run.ps1': 'Write-Output ok\n',
    'scripts/run.sh': 'echo ok\n',
  });
  expectClean(assert, 'a quoted relative script path declares it', {
    ...COMPLIANT,
    justfile: `${SHELL}\n# Path.\npath := "./scripts/orphan.sh"\n${DEFAULT}`,
    'scripts/orphan.sh': '#!/usr/bin/env bash\necho ok\n',
  });
}

function testSkillRecipe(assert) {
  expectEntry(assert, 'skill names scripts path', { ...COMPLIANT, 'skills/x/SKILL.md': SKILL('Run `scripts/Import-Secrets.ps1 -Apply`.') }, 'scripting/skill-recipe');
  expectEntry(assert, 'skill names windows path', { ...COMPLIANT, 'skills/x/SKILL.md': SKILL('Apply `windows/Apply-Settings.ps1`.') }, 'scripting/skill-recipe');
  expectEntry(assert, 'skill names wsl path', { ...COMPLIANT, 'skills/x/SKILL.md': SKILL('Load `. wsl/load-secrets.sh`.') }, 'scripting/skill-recipe');
  expectEntry(assert, 'skill names a bash script', { ...COMPLIANT, 'skills/x/SKILL.md': SKILL('Run `bash scripts/x.sh`.') }, 'scripting/skill-recipe');
  expectClean(assert, 'skill names a recipe', { ...COMPLIANT, 'skills/x/SKILL.md': SKILL('Run `just import-secrets --apply`.') });
  expectClean(assert, 'vendored pstack skill is exempt', {
    ...COMPLIANT,
    'pstack.lock.json': '{}\n',
    'skills/x/SKILL.md': SKILL('Run `scripts/Import-Secrets.ps1 -Apply`.'),
  });
  expectClean(assert, 'a skill-local driver path is not a repo script', {
    ...COMPLIANT,
    '.opencode/skills/verify/SKILL.md': SKILL('Run `node .opencode/skills/verify/scripts/drive.mjs`.'),
  });
  expectClean(assert, 'a skill-local driver named in short form is exempt', {
    ...COMPLIANT,
    '.opencode/skills/verify/SKILL.md': SKILL('Run `node scripts/drive.mjs`.'),
    '.opencode/skills/verify/scripts/drive.mjs': 'export {};\n',
  });
  expectEntry(assert, 'a plugin skill naming a repo script is not exempt', {
    ...COMPLIANT,
    'skills/x/SKILL.md': SKILL('Run `scripts/Import-Secrets.ps1 -Apply`.'),
    'scripts/Import-Secrets.ps1': 'Write-Output ok\n',
  }, 'scripting/skill-recipe');
  expectEntry(assert, 'a claude-local skill naming a repo script path', { ...COMPLIANT, '.claude/skills/x/SKILL.md': SKILL('Run `scripts/Import-Secrets.ps1 -Apply`.') }, 'scripting/skill-recipe');
  expectClean(assert, 'a claude-local skill driver path is not a repo script', {
    ...COMPLIANT,
    '.claude/skills/verify/SKILL.md': SKILL('Run `node .claude/skills/verify/scripts/drive.mjs`.'),
  });
  expectClean(assert, 'a claude-local skill driver named in short form is exempt', {
    ...COMPLIANT,
    '.claude/skills/verify/SKILL.md': SKILL('Run `node scripts/drive.mjs`.'),
    '.claude/skills/verify/scripts/drive.mjs': 'export {};\n',
  });
}

function testSkillIds(assert) {
  expectEntry(assert, 'one skill id in both repo-local roots', {
    ...COMPLIANT,
    '.claude/skills/verify/SKILL.md': SKILL('Run `just verify`.'),
    '.opencode/skills/verify/SKILL.md': SKILL('Run `just verify`.'),
  }, 'scripting/skill-duplicate');
  expectClean(assert, 'one skill id in .claude/skills only', {
    ...COMPLIANT,
    '.claude/skills/verify/SKILL.md': SKILL('Run `just verify`.'),
  });
  expectClean(assert, 'one skill id in .opencode/skills only', {
    ...COMPLIANT,
    '.opencode/skills/verify/SKILL.md': SKILL('Run `just verify`.'),
  });
  expectClean(assert, 'different skill ids in each repo-local root', {
    ...COMPLIANT,
    '.claude/skills/verify/SKILL.md': SKILL('Run `just verify`.'),
    '.opencode/skills/lint/SKILL.md': SKILL('Run `just lint`.'),
  });
}

function testToolsRecipe(assert) {
  expectEntry(assert, 'tools.yaml without a tools-check recipe', { ...COMPLIANT, 'tools.yaml': 'version: 1\n' }, 'scripting/tools-check');
  expectClean(assert, 'tools.yaml with a tools-check recipe', {
    ...COMPLIANT,
    'tools.yaml': 'version: 1\n',
    justfile: `${SHELL}${DEFAULT}\n# Validate the manifest.\ntools-check:\n    node scripts/tools.mjs check\n`,
  });
  expectClean(assert, 'no tools.yaml', COMPLIANT);
}

export function runTest() {
  const { assert, total } = makeAsserter();
  try {
    testWindowsShell(assert);
    testShellOps(assert);
    testInterpreter(assert);
    testTwinExists(assert);
    testScriptDeclared(assert);
    testSkillRecipe(assert);
    testSkillIds(assert);
    testToolsRecipe(assert);
    process.stdout.write(`scripting.test: ok (${total()} assertions)\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`scripting.test: failed: ${error.message}\n`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exit(runTest());
