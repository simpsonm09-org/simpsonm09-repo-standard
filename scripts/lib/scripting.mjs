import { existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { extensionOf, justfileText, listFiles, normalize, readText, toPosix } from './tree.mjs';

// Scripting conformance. A recipe body is portable or a routed twin. The names
// the checker reports (scripting/<rule>) are stable ids a repository can except
// with the existing exception file.
const INTERPRETERS = new Set(['bash', 'pwsh', 'powershell', 'sh', 'cmd', 'python', 'python3']);
const SHELL_OPERATORS = [
  { pattern: /&&/, label: 'shell operator &&' },
  { pattern: /&/, label: 'shell operator &' },
  { pattern: /;/, label: 'shell operator ;' },
  { pattern: /\|/, label: 'shell operator |' },
  { pattern: /[<>]/, label: 'shell redirection' },
  { pattern: /\$[A-Za-z_{]/, label: 'shell variable expansion' },
  { pattern: /`/, label: 'shell backtick substitution' },
  { pattern: /\.\//, label: 'relative ./ path' },
  { pattern: /\.\\/, label: 'relative .\\ path' },
];
const DECLARED_SCRIPT_EXTENSIONS = ['.ps1', '.sh'];
// Each pattern names the script path it matches so the checker can tell a
// repository script from a skill-local asset. A pattern without a path (the
// `pwsh -File` spelling) always flags.
const SKILL_SCRIPT_PATTERNS = [
  { pattern: /(?<![\w./\\-])(scripts[\\/][^\s`)"'<>]+\.(?:ps1|sh|py|mjs))\b/gi, path: 1 },
  { pattern: /(?<![\w./\\-])(windows[\\/][^\s`)"'<>]+\.ps1)\b/gi, path: 1 },
  { pattern: /(?<![\w./\\-])(wsl[\\/][^\s`)"'<>]+\.sh)\b/gi, path: 1 },
  { pattern: /pwsh\s+-File\b/gi, path: null },
  { pattern: /(?<![\w./\\-])bash\s+([^\s`)"'<>]+\.(?:sh|ps1|py|mjs))\b/gi, path: 1 },
];

function isRecipeHeader(line) {
  return /^@?[A-Za-z_][A-Za-z0-9_-]*(?:\s+[^:\n]*)?:(?!=)/.test(line);
}

function recipeName(line) {
  const match = /^@?([A-Za-z_][A-Za-z0-9_-]*)/.exec(line);
  return match ? match[1] : line;
}

// A recipe body is the run of indented, non-comment lines under a recipe
// header. A blank line or a non-indented line ends the run; a comment is
// skipped and keeps the current header.
function recipeBodies(text) {
  const bodies = [];
  let header = null;
  for (const line of text.split('\n')) {
    if (/^\s*$/.test(line)) {
      header = null;
    } else if (/^[^\s]/.test(line)) {
      header = isRecipeHeader(line) ? recipeName(line) : null;
    } else if (header && !/^\s*#/.test(line)) {
      bodies.push({ header, line: line.trim() });
    }
  }
  return bodies;
}

function checkWindowsShell(root, add) {
  const file = join(root, 'justfile');
  if (!existsSync(file)) return;
  if (!/^\s*set\s+windows-shell\b/m.test(normalize(readText(file)))) {
    add('scripting/windows-shell', 'justfile has no "set windows-shell" line');
  }
}

function checkShellOps(header, line, add) {
  // A single-quoted segment is data and is dropped. Inside double quotes the
  // shell still expands `$VAR` and backticks and still reads a relative `./`
  // path, so only the operators inert there (`;`, `|`, `&`, `<`, `>`) are
  // masked. A flag value such as `--filter "a<b"` is therefore not a
  // redirection, while a double-quoted `$CONFIG` or backtick substitution is
  // still scanned.
  const scan = line.replace(/'[^']*'|"([^"]*)"/g, (_, double) =>
    double === undefined ? ' ' : double.replace(/[;|&<>]/g, ' '),
  );
  for (const { pattern, label } of SHELL_OPERATORS) {
    if (pattern.test(scan)) {
      add('scripting/shell-ops', `recipe "${header}" uses ${label}: ${line}`);
      return;
    }
  }
}

function interpreterName(token) {
  const trimmed = token.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9.]+$/, '');
  const base = trimmed.split(/[\\/]/).pop() ?? '';
  const withoutExtension = base.replace(/\.(exe|cmd|bat)$/i, '');
  return withoutExtension.replace(/\d+(?:\.\d+)*$/, '').toLowerCase();
}

// The command word is the first token, or the first token after a
// `mise exec --` / `mise run` prefix. A flag value such as `--language python`
// is not a command word, and a version suffix is dropped so `python3.12`
// reads as `python`.
function commandWord(line) {
  const tokens = line.replace(/\{\{[\s\S]*?\}\}/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { token: null, viaMise: false };
  if (interpreterName(tokens[0]) !== 'mise') return { token: tokens[0], viaMise: false };
  if (tokens[1] === 'exec' && tokens[2] === '--') return { token: tokens[3] ?? null, viaMise: true };
  if (tokens[1] === 'run') return { token: tokens[2] ?? null, viaMise: true };
  return { token: tokens[0], viaMise: false };
}

function checkInterpreter(header, line, add) {
  const { token, viaMise } = commandWord(line);
  if (token === null || viaMise) return;
  const name = interpreterName(token);
  if (INTERPRETERS.has(name)) {
    add('scripting/interpreter', `recipe "${header}" names interpreter "${name}": ${line}`);
  }
}

function quotedScriptPaths(line) {
  const out = [];
  for (const match of line.matchAll(/"([^"]*)"|'([^']*)'/g)) {
    const text = match[1] ?? match[2] ?? '';
    for (const path of text.matchAll(/[A-Za-z0-9_./\\-]+\.(?:ps1|sh|py|mjs)\b/g)) out.push(toPosix(path[0]));
  }
  return out;
}

function checkTwinExists(root, bodies, add) {
  for (const { header, line } of bodies) {
    if (!/\bos(?:_family)?\s*\(/.test(line)) continue;
    for (const rel of quotedScriptPaths(line)) {
      if (!existsSync(join(root, rel))) {
        add('scripting/twin-exists', `recipe "${header}" routes to missing script ${rel}`);
      }
    }
  }
}

function scriptTokens(run) {
  const out = [];
  for (const token of run.split(/\s+/)) {
    if (/\.(?:ps1|sh|py|mjs)$/i.test(token)) out.push(toPosix(token.replace(/^\.\//, '')));
  }
  return out;
}

function opScriptPaths(root) {
  const file = join(root, 'ops.json');
  if (!existsSync(file)) return [];
  let data;
  try {
    data = JSON.parse(normalize(readText(file)));
  } catch {
    return [];
  }
  const out = [];
  for (const op of data.operations ?? []) {
    for (const rel of [op.windows, op.posix]) {
      if (rel) out.push(toPosix(rel));
    }
    if (typeof op.run === 'string') out.push(...scriptTokens(op.run));
  }
  return out;
}

// The platforms a script may declare. A PowerShell script is windows-only. A
// bash script is portable (`posix`) by default, or specifically `linux` or
// `macos` when it is not portable.
function platformsOf(file) {
  return extensionOf(file) === '.ps1' ? ['windows'] : ['posix', 'linux', 'macos'];
}

// The declared platform is the one word after `# platforms:` in the first ten
// lines, or null when the file declares nothing.
function declaredPlatform(file) {
  const head = normalize(readText(file)).replace(/\r\n/g, '\n').split('\n').slice(0, 10);
  for (const line of head) {
    const match = /^\s*#\s*platforms:\s*(windows|posix|linux|macos)\b/i.exec(line);
    if (match) return match[1].toLowerCase();
  }
  return null;
}

// A reference is a whole token that equals the script path, on a non-comment
// line. A path that appears only inside a comment or as a substring does not
// declare the script.
function referencedInText(text, rel) {
  for (const line of text.split('\n')) {
    if (/^\s*#/.test(line)) continue;
    for (const raw of line.split(/\s+/)) {
      const token = toPosix(raw.replace(/^["'`]+|["'`]+$/g, '').replace(/^\.\//, ''));
      if (token === rel) return true;
    }
  }
  return false;
}

// A script is reachable from an op manifest entry or from the justfile text.
// The justfile text already folds in imported files such as ops.generated.just.
function checkScriptsDeclared(root, text, add) {
  const referenced = new Set(opScriptPaths(root));
  for (const file of listFiles(join(root, 'scripts'), DECLARED_SCRIPT_EXTENSIONS)) {
    const rel = toPosix(relative(root, file));
    const declared = declaredPlatform(file);
    if (referenced.has(rel) || referencedInText(text, rel) || (declared !== null && platformsOf(file).includes(declared))) continue;
    add('scripting/script-declared', `${rel} is not referenced by an op or recipe and declares no matching "# platforms:" line`);
  }
}

function skillFiles(root) {
  const out = listFiles(join(root, 'skills'), ['.md']).filter((file) => basename(file) === 'SKILL.md');
  for (const file of listFiles(join(root, '.opencode', 'skills'), ['.md'])) {
    if (basename(file) === 'SKILL.md') out.push(file);
  }
  return out;
}

// The PStack skill tree is vendored: a repository that pins it carries a
// pstack.lock.json at the root, and its skills/ are byte-identical upstream.
function isVendoredSkill(root, rel) {
  if (rel.startsWith('vendor/')) return true;
  return rel.startsWith('skills/') && existsSync(join(root, 'pstack.lock.json'));
}

// A skill-local asset resolves under the skill's own directory and is not a
// repository operation, so it is not a violation.
function skillScriptOffender(text, dir) {
  for (const { pattern, path } of SKILL_SCRIPT_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const candidate = path === null ? null : match[path];
      if (candidate && existsSync(join(dir, candidate))) continue;
      return match[0].trim();
    }
  }
  return null;
}

function checkSkillRecipes(root, add) {
  for (const file of skillFiles(root)) {
    const rel = toPosix(relative(root, file));
    if (isVendoredSkill(root, rel)) continue;
    const text = normalize(readText(file)).replace(/\r\n/g, '\n');
    const offender = skillScriptOffender(text, dirname(file));
    if (offender) {
      add('scripting/skill-recipe', `${rel} names a script path (${offender}); a skill calls "just <recipe>"`);
    }
  }
}

function checkToolsRecipe(root, text, add) {
  if (!existsSync(join(root, 'tools.yaml'))) return;
  if (!/^@?tools-check(?:\s+[^:\n]*)?:(?!=)/m.test(text)) {
    add('scripting/tools-check', 'tools.yaml exists but the justfile has no "tools-check" recipe');
  }
}

export function checkScripting(root, add) {
  const repoRoot = resolve(root);
  const text = justfileText(repoRoot);
  const bodies = recipeBodies(text);
  checkWindowsShell(repoRoot, add);
  for (const { header, line } of bodies) {
    checkShellOps(header, line, add);
    checkInterpreter(header, line, add);
  }
  checkTwinExists(repoRoot, bodies, add);
  checkScriptsDeclared(repoRoot, text, add);
  checkSkillRecipes(repoRoot, add);
  checkToolsRecipe(repoRoot, text, add);
}
