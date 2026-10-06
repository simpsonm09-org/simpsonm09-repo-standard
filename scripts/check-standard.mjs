#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from './lib/exit.mjs';
import { isMain } from './lib/proc.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STANDARD_ROOT = resolve(HERE, '..');

export const REQUIRED_PATHS = [
  '.github/workflows/ci.yml',
  'mise.toml',
  'justfile',
  'trivy.yaml',
  '.aislop/config.yml',
  '.github/config/flint.toml',
  '.github/dependabot.yml',
  '.editorconfig',
  '.gitattributes',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CODEOWNERS',
  'SUPPORT.md',
  '.github/ISSUE_TEMPLATE/',
  '.github/pull_request_template.md',
];

export const COMMUNITY_PATHS = [
  'LICENSE',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SUPPORT.md',
  '.editorconfig',
  '.aislop/config.yml',
  '.github/pull_request_template.md',
  '.github/ISSUE_TEMPLATE/bug.yml',
  '.github/ISSUE_TEMPLATE/feature.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
];

const SHARED_JOBS = ['lint', 'aislop', 'security'];
const STANDARD_REPO = 'simpsonm09-org/simpsonm09-repo-standard';
const SHA_PATTERN = /^[0-9a-fA-F]{40}$/;
const GROUPS = ['files', 'mise', 'ci', 'dependabot', 'community', 'docs', 'scripting'];
const DIAGRAM_FENCES = ['mermaid', 'plantuml', 'graphviz', 'dot'];
const MANIFEST_KEYS = new Set(['readme', 'features', 'diagrams', 'api']);

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

function readText(path) {
  return readFileSync(path, 'utf8');
}

function normalize(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function stripFences(text) {
  const out = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out.join('\n');
}

function toPosix(value) {
  return value.split('\\').join('/');
}

function extensionOf(name) {
  return extname(name).toLowerCase();
}

function groupOf(id) {
  const slash = id.indexOf('/');
  return slash === -1 ? id : id.slice(0, slash);
}

function listFiles(dir, extensions) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (extensions.includes(extensionOf(entry.name))) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function parseJobs(text) {
  const jobs = new Map();
  let inJobs = false;
  let current = null;
  for (const line of text.split('\n')) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    if (/^\S/.test(line)) {
      inJobs = false;
      continue;
    }
    const match = /^ {2}([A-Za-z0-9_.-]+):\s*$/.exec(line);
    if (match) {
      current = match[1];
      jobs.set(current, []);
      continue;
    }
    if (current) jobs.get(current).push(line);
  }
  return jobs;
}

function findUses(block) {
  for (const line of block) {
    const match = /^\s+uses:\s*(\S+)/.exec(line);
    if (match) return match[1].replace(/['"]/g, '');
  }
  return null;
}

function checkFiles(root, add) {
  for (const rel of REQUIRED_PATHS) {    const full = join(root, rel);
    if (!existsSync(full)) {
      add(`files/${rel.replace(/\/$/, '')}`, `missing required path ${rel}`);
      continue;
    }
    if (rel.endsWith('/') && !statSync(full).isDirectory()) {
      add(`files/${rel.replace(/\/$/, '')}`, `${rel} is not a directory`);
    }
  }
}

function checkMise(root, add) {
  const file = join(root, 'mise.toml');
  if (!existsSync(file)) return;
  if (!/^\s*"aqua:casey\/just"\s*=/m.test(normalize(readText(file)))) {
    add('mise/just-pin', 'mise.toml does not pin aqua:casey/just');
  }
}

function hasTestJob(root) {
  const dir = join(root, '.github', 'workflows');
  if (!existsSync(dir)) return false;
  for (const name of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const jobs = parseJobs(normalize(readText(join(dir, name))));
    const block = jobs.get('test');
    if (block?.some((line) => /^\s+runs-on:/.test(line))) return true;
  }
  return false;
}

function checkCi(root, add) {
  const file = join(root, '.github/workflows/ci.yml');
  if (!existsSync(file)) return;
  const text = normalize(readText(file));
  const jobs = parseJobs(text);
  const isSelf = root === STANDARD_ROOT;
  const external = /^simpsonm09-org\/simpsonm09-repo-standard\/\.github\/workflows\/([a-z0-9-]+)\.yml@([0-9a-fA-F]{40})$/;
  const local = /^\.\/\.github\/workflows\/([a-z0-9-]+)\.yml$/;

  for (const job of SHARED_JOBS) checkSharedJob(job, jobs, external, local, isSelf, add);

  if (callsCoverage(jobs, external, local, isSelf) && !hasCoverageRecipe(root)) {
    add('ci/coverage-recipe', 'ci.yml calls the shared coverage workflow but justfile has no "coverage" recipe');
  }

  checkPins(text, add);

  if (!hasTestJob(root)) {
    add('ci/test', 'no "test" job that runs on a runner in .github/workflows');
  }
}

function checkSharedJob(job, jobs, external, local, isSelf, add) {
  const block = jobs.get(job);
  if (!block) {
    add(`ci/${job}`, `ci.yml has no "${job}" job`);
    return;
  }
  const uses = findUses(block);
  if (!uses) {
    add(`ci/${job}`, `job "${job}" does not call a reusable workflow`);
    return;
  }
  const externalMatch = external.exec(uses);
  const localMatch = local.exec(uses);
  if (externalMatch) {
    if (externalMatch[1] !== job) add(`ci/${job}`, `job "${job}" calls ${externalMatch[1]}.yml`);
  } else if (localMatch && isSelf) {
    if (localMatch[1] !== job) add(`ci/${job}`, `job "${job}" calls ${localMatch[1]}.yml`);
  } else {
    add(`ci/${job}`, `job "${job}" is not pinned to a 40-char repo-standard SHA (uses: ${uses})`);
  }
}

function callsCoverage(jobs, external, local, isSelf) {
  for (const block of jobs.values()) {
    const uses = findUses(block);
    if (!uses) continue;
    const externalMatch = external.exec(uses);
    const localMatch = local.exec(uses);
    if (externalMatch?.[1] === 'coverage' || (isSelf && localMatch?.[1] === 'coverage')) return true;
  }
  return false;
}

function checkPins(text, add) {
  for (const match of text.matchAll(/^\s*uses:\s*(\S+)/gm)) {
    const ref = match[1];
    if (!ref.includes(`${STANDARD_REPO}/`)) continue;
    const at = ref.lastIndexOf('@');
    if (at === -1 || !SHA_PATTERN.test(ref.slice(at + 1))) {
      add('ci/pin', `unpinned repo-standard reference ${ref}`);
    }
  }
}

function checkDependabot(root, add) {
  const file = join(root, '.github/dependabot.yml');
  if (!existsSync(file)) return;
  const text = normalize(readText(file)).replace(/\r\n/g, '\n');
  if (!/^\s*version:\s*["']?2["']?\s*$/m.test(text)) {
    add('dependabot/version', '.github/dependabot.yml must declare version: 2');
  }
  const blocks = text.split(/^\s*-\s*package-ecosystem:\s*/m).slice(1);
  if (blocks.length === 0) {
    add('dependabot/ecosystems', '.github/dependabot.yml declares no package ecosystem');
    return;
  }
  for (const block of blocks) {
    const name = block.split('\n')[0].replace(/["']/g, '').trim() || 'unknown';
    if (!/^\s*schedule:\s*$/m.test(block)) {
      add(`dependabot/${name}`, `package ecosystem ${name} has no schedule`);
    } else if (!/^\s*interval:\s*\S/m.test(block)) {
      add(`dependabot/${name}`, `package ecosystem ${name} has no schedule interval`);
    }
  }
  for (const match of text.matchAll(/^\s*(token|password):\s*(.+)$/gm)) {
    if (!match[2].includes('${{ secrets.')) {
      add('dependabot/secret', `${match[1]} must reference a secret, not an inline value`);
    }
  }
}

function checkCommunity(root, add) {
  for (const rel of COMMUNITY_PATHS) {
    const target = join(root, rel);
    const source = join(STANDARD_ROOT, rel);
    if (!existsSync(target)) {
      add(`community/${rel}`, `${rel} is missing`);
      continue;
    }
    if (!existsSync(source)) continue;
    const targetText = normalize(readText(target)).replace(/\r\n/g, '\n');
    const sourceText = normalize(readText(source)).replace(/\r\n/g, '\n');
    if (targetText !== sourceText) add(`community/${rel}`, `${rel} differs from repo-standard`);
  }
}

function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function fileLinks(file) {
  const text = normalize(readText(file));
  const out = [];
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim().split(/\s+/)[0];
    if (target.startsWith('<')) target = target.slice(1);
    if (target.endsWith('>')) target = target.slice(0, -1);
    target = target.split('#')[0].split('?')[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    out.push(resolve(dirname(file), target));
  }
  return out;
}

function reachableDocs(index, markdown) {
  const known = new Set(markdown.map((file) => resolve(file)));
  const reached = new Set([resolve(index)]);
  const queue = [index];
  while (queue.length > 0) {
    for (const target of fileLinks(queue.shift())) {
      if (!known.has(target) || reached.has(target)) continue;
      reached.add(target);
      queue.push(target);
    }
  }
  return reached;
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function marksGenerated(root, rel) {
  const file = join(root, '.gitattributes');
  if (!existsSync(file)) return false;
  const base = basename(rel);
  for (const line of normalize(readText(file)).split('\n')) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    const tokens = text.split(/\s+/);
    if (tokens.length < 2) continue;
    const marked = tokens.slice(1).some((attr) => attr === 'linguist-generated' || attr.startsWith('linguist-generated='));
    if (!marked) continue;
    const pattern = tokens[0].replace(/^\//, '');
    if (pattern === rel || pattern === base || pattern === `**/${base}`) return true;
    if (pattern.startsWith('*') && base.endsWith(pattern.slice(1))) return true;
  }
  return false;
}

// A thin justfile can delegate its recipes to imported files. Read the justfile
// and each file it imports one level deep, so a recipe check sees the combined
// text. Paths are resolved from the repository root.
function justfileText(root) {
  const file = join(root, 'justfile');
  if (!existsSync(file)) return '';
  const text = normalize(readText(file)).replace(/\r\n/g, '\n');
  let combined = text;
  for (const match of text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
    const imported = join(root, match[1]);
    if (!existsSync(imported)) continue;
    combined += `\n${normalize(readText(imported)).replace(/\r\n/g, '\n')}`;
  }
  return combined;
}

function hasSpecRecipe(root) {
  return /^@?spec(\s+[^:\n]*)?:(?!=)/m.test(justfileText(root));
}

function hasCoverageRecipe(root) {
  return /^@?coverage(\s+[^:\n]*)?:(?!=)/m.test(justfileText(root));
}

function checkDocs(root, add) {
  const docsDir = join(root, 'docs');
  const markdown = listFiles(docsDir, ['.md']);
  const hasDocs = markdown.length > 0;

  const readme = checkReadme(root, add);
  if (hasDocs && !/docs\/README\.md/.test(readme)) {
    add('docs/readme-link', 'README.md does not link docs/README.md');
  }

  const index = join(docsDir, 'README.md');
  if (hasDocs) checkDocsIndex(root, index, markdown, add);

  const manifestPath = join(docsDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    add('docs/manifest', 'docs/manifest.json is missing');
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(normalize(readText(manifestPath)));
  } catch (error) {
    add('docs/manifest', `docs/manifest.json is invalid JSON: ${error.message}`);
    return;
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    add('docs/manifest', 'docs/manifest.json must be a JSON object');
    return;
  }

  validateManifest(manifest, add);
  checkFeatureDocs(root, index, manifest, add);
  checkDiagramDocs(root, manifest, add);
  checkApiSpec(root, manifest, add);
}

function checkReadme(root, add) {
  const readmePath = join(root, 'README.md');
  if (!existsSync(readmePath)) {
    add('docs/readme', 'README.md is missing');
    return '';
  }
  const readme = normalize(readText(readmePath));
  const headings = stripFences(readme).split('\n').filter((line) => /^#\s+\S/.test(line));
  if (headings.length !== 1) {
    add('docs/readme', `README.md has ${headings.length} level-1 headings, expected 1`);
  }
  return readme;
}

function checkDocsIndex(root, index, markdown, add) {
  if (!existsSync(index)) {
    add('docs/index', 'docs/README.md index is missing');
    return;
  }
  const reached = reachableDocs(index, markdown);
  for (const doc of markdown) {
    if (samePath(doc, index)) continue;
    if (!reached.has(resolve(doc))) {
      add('docs/index', `${toPosix(relative(root, doc))} is not reachable from docs/README.md`);
    }
  }
}

function validateManifest(manifest, add) {
  for (const key of Object.keys(manifest)) {
    if (!MANIFEST_KEYS.has(key)) add('docs/manifest', `docs/manifest.json has unknown key "${key}"`);
  }
  if ('readme' in manifest && typeof manifest.readme !== 'boolean') {
    add('docs/manifest', 'readme must be a boolean');
  }
  for (const key of ['features', 'diagrams']) {
    if (key in manifest && !isStringArray(manifest[key])) {
      add('docs/manifest', `${key} must be an array of strings`);
    }
  }
  if (isInvalidApi(manifest.api)) {
    add('docs/manifest', 'api must be a spec path or an object with a string spec');
  }
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isInvalidApi(api) {
  if (api === undefined || api === null) return false;
  return !(typeof api === 'string' || (typeof api === 'object' && typeof api.spec === 'string'));
}

function checkFeatureDocs(root, index, manifest, add) {
  const indexTargets = existsSync(index) ? fileLinks(index) : [];
  for (const rel of stringArray(manifest.features)) {
    const full = resolve(root, rel);
    if (!existsSync(full)) add('docs/feature', `declared feature doc ${rel} is missing`);
    else if (!indexTargets.some((target) => samePath(target, full))) {
      add('docs/feature', `declared feature doc ${rel} is not linked from docs/README.md`);
    }
  }
}

function checkDiagramDocs(root, manifest, add) {
  const fence = new RegExp(`\`\`\`\\s*(${DIAGRAM_FENCES.join('|')})\\b`);
  for (const rel of stringArray(manifest.diagrams)) {
    const full = resolve(root, rel);
    if (!existsSync(full)) {
      add('docs/diagram', `declared diagram doc ${rel} is missing`);
      continue;
    }
    if (!fence.test(normalize(readText(full)))) {
      add('docs/diagram', `declared diagram doc ${rel} has no supported diagram fence`);
    }
  }
}

function checkApiSpec(root, manifest, add) {
  if (typeof manifest.api !== 'string' && !(manifest.api && typeof manifest.api.spec === 'string')) return;
  const spec = typeof manifest.api === 'string' ? manifest.api : manifest.api.spec;
  const full = resolve(root, spec);
  if (!existsSync(full)) {
    add('docs/api', `declared API spec ${spec} is missing`);
    return;
  }
  if (!hasOpenapiVersion(spec, normalize(readText(full)))) {
    add('docs/api', `declared API spec ${spec} has no openapi/asyncapi version`);
  }

  const rel = toPosix(relative(root, full));
  if (!marksGenerated(root, rel)) {
    add('docs/api-generated', `${spec} is not marked linguist-generated in .gitattributes`);
  }
  if (!hasSpecRecipe(root)) {
    add('docs/api-generated', 'justfile has no "spec" recipe to regenerate the API document');
  }
}

function hasOpenapiVersion(spec, text) {
  if (/\.json$/i.test(spec)) {
    try {
      const data = JSON.parse(text);
      return Boolean(data.openapi || data.asyncapi);
    } catch {
      return false;
    }
  }
  return /^\s*(openapi|asyncapi):\s*\S/m.test(text);
}

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

function platformOf(file) {
  return extensionOf(file) === '.ps1' ? 'windows' : 'posix';
}

// The declared platform is the one word after `# platforms:` in the first ten
// lines, or null when the file declares nothing.
function declaredPlatform(file) {
  const head = normalize(readText(file)).replace(/\r\n/g, '\n').split('\n').slice(0, 10);
  for (const line of head) {
    const match = /^\s*#\s*platforms:\s*(windows|posix)\b/i.exec(line);
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
    if (referenced.has(rel) || referencedInText(text, rel) || declaredPlatform(file) === platformOf(file)) continue;
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

export function checkStandard(root) {
  const repoRoot = resolve(root);
  const gaps = [];
  const add = (id, message) => gaps.push({ id, message });
  checkFiles(repoRoot, add);
  checkMise(repoRoot, add);
  checkCi(repoRoot, add);
  checkDependabot(repoRoot, add);
  checkCommunity(repoRoot, add);
  checkDocs(repoRoot, add);
  checkScripting(repoRoot, add);
  return { root: repoRoot, gaps };
}

function statusFor(gaps, group) {
  const count = gaps.filter((gap) => groupOf(gap.id) === group).length;
  return count === 0 ? 'ok' : `GAP(${count})`;
}

function printResult(result) {
  const label = basename(result.root) || result.root;
  const header = ['repo'.padEnd(30), ...GROUPS.map((group) => group.padEnd(11))].join('');
  const row = [label.padEnd(30), ...GROUPS.map((group) => statusFor(result.gaps, group).padEnd(11))].join('');
  process.stdout.write(`check-standard  ${result.root}\n`);
  process.stdout.write(`${header}\n${row}\n`);
  for (const gap of result.gaps) process.stdout.write(`  gap ${gap.id}: ${gap.message}\n`);
}

function parseArgs(argv) {
  if (argv.includes('-h') || argv.includes('--help')) return { help: true };
  const positional = argv.filter((arg) => arg !== '--' && !arg.startsWith('-'));
  return { help: false, root: positional[0] ?? '.' };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('usage: node scripts/check-standard.mjs [repo-path]\n');
    process.exit(EXIT.OK);
  }
  const result = checkStandard(args.root);
  printResult(result);
  process.exit(result.gaps.length > 0 ? EXIT.FAIL : EXIT.OK);
}
