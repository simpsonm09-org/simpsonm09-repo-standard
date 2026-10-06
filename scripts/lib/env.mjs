import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { normalize, readText, toPosix } from './tree.mjs';

// The env convention. A repository that ignores a local `.env` must ship a
// committed sibling `.env.example` and list the local file in a root
// `.worktreeinclude`. The checker reports stable `env/<rule>` ids.
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileIgnoreRule(pattern) {
  let body = '';
  for (const char of pattern) {
    body += char === '*' ? '[^/]*' : escapeRegExp(char);
  }
  return { anchored: pattern.includes('/'), regex: new RegExp(`^${body}$`) };
}

function readGitignore(root) {
  const file = join(root, '.gitignore');
  if (!existsSync(file)) return [];
  const rules = [];
  for (const raw of normalize(readText(file)).replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    const pattern = (negated ? line.slice(1) : line).replace(/^\//, '').replace(/\/$/, '');
    if (!pattern) continue;
    rules.push({ negated, ...compileIgnoreRule(pattern) });
  }
  return rules;
}

// A rule without a slash matches a basename at any depth; a rule with one is
// anchored to the repository root. The last matching rule decides, so a later
// negation un-ignores a path.
function ignoredBy(rules, rel) {
  const base = basename(rel);
  let ignored = false;
  for (const rule of rules) {
    if (rule.regex.test(rule.anchored ? rel : base)) ignored = !rule.negated;
  }
  return ignored;
}

function worktreeincludePaths(root) {
  const file = join(root, '.worktreeinclude');
  const out = [];
  for (const raw of normalize(readText(file)).replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    out.push(toPosix(line));
  }
  return out;
}

export function checkEnv(root, add) {
  const repoRoot = resolve(root);
  const rules = readGitignore(repoRoot);
  const includeFile = join(repoRoot, '.worktreeinclude');
  const hasInclude = existsSync(includeFile);
  if (!hasInclude && !ignoredBy(rules, '.env')) return;

  if (!hasInclude) {
    add('env/worktreeinclude', '.gitignore ignores .env but there is no root .worktreeinclude');
    return;
  }

  const paths = worktreeincludePaths(repoRoot);
  if (paths.length === 0) {
    add('env/worktreeinclude-path', '.worktreeinclude lists no paths');
    return;
  }

  for (const rel of paths) {
    if (!ignoredBy(rules, rel)) {
      add('env/worktreeinclude-path', `.worktreeinclude lists ${rel}, which .gitignore does not ignore`);
    }
    const example = `${rel}.example`;
    if (!existsSync(join(repoRoot, example))) {
      add('env/example', `${rel} has no sibling ${example}`);
    } else if (ignoredBy(rules, example)) {
      add('env/example', `${example} must not be ignored by .gitignore`);
    }
  }
}
