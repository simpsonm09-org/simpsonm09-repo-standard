#!/usr/bin/env node
// Resolve the agent access level for a fleet repository, and the capabilities
// that level grants. The policy lives in repo-catalog/repos.json. This is the
// one reader every enforcement point shares, so a level means the same thing to
// the pre-push hook, the OpenCode gate, and the credential broker.
//
// Usage:
//   node scripts/agent-access.mjs <repo-name> [--catalog <path>] [--json]
//   node scripts/agent-access.mjs <repo-name> --allows <capability> [--catalog <path>]
//   node scripts/agent-access.mjs <repo-name> --command "<shell command>" [--catalog <path>]
//
// The level mode prints the level and exits 0. The allows mode exits 0 when the
// repository's level grants the capability, and 1 when it does not. The command
// mode classifies a shell command to the capability it needs, then exits 0 when
// the level grants it and 1 when it does not. A missing catalog exits 2, so a
// caller fails closed on remote writes.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_DIR = join(ROOT, '..', 'simpsonm09-repo-catalog');
const DEFAULT_CATALOG = join(CATALOG_DIR, 'repos.json');

export const LEVELS = ['none', 'read', 'propose', 'merge', 'full'];

// A level grants a set of capabilities. Enforcement points ask for a
// capability, never for a level, so this table is the single mapping from the
// policy in policy.md to a decision.
export const CAPABILITIES = {
  none: [],
  read: ['read'],
  propose: ['read', 'pushBranch', 'openPr'],
  merge: ['read', 'pushBranch', 'openPr', 'mergePr'],
  full: ['read', 'pushBranch', 'openPr', 'mergePr', 'pushMain', 'admin'],
};

// The level an unknown repository or an unreadable catalog resolves to. It
// allows reading and local work, and denies every remote write.
export const FALLBACK_LEVEL = 'read';

export function loadCatalog(path = DEFAULT_CATALOG) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Read the committed catalog from the clone, preferring the organization ref the
// agent cannot push to. This keeps the level out of the working tree, so an
// uncommitted edit cannot raise it.
export function loadCommittedCatalog(dir = CATALOG_DIR) {
  for (const ref of ['upstream/main', 'main']) {
    try {
      const out = execFileSync('git', ['-C', dir, 'show', `${ref}:repos.json`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return JSON.parse(out);
    } catch {
      // Try the next ref, then give up.
    }
  }
  return null;
}

export function resolveLevel(catalog, repoName) {
  const entry = (catalog.repos ?? []).find((repo) => repo.name === repoName);
  if (!entry) return { repo: repoName, tier: null, level: FALLBACK_LEVEL, source: 'unknown' };
  if (entry.agentAccess) {
    return { repo: repoName, tier: entry.tier, level: entry.agentAccess, source: 'override' };
  }
  const level = (catalog.agentAccessDefaults ?? {})[entry.tier] ?? FALLBACK_LEVEL;
  return { repo: repoName, tier: entry.tier, level, source: 'tier' };
}

export function allows(level, capability) {
  return (CAPABILITIES[level] ?? []).includes(capability);
}

// A shell command needs one capability. The patterns are ordered, first match
// wins, so the specific merge and create checks run before the generic push.
// An unmatched command needs no capability: it does not reach GitHub, so the
// level does not govern it and it is allowed.
const COMMAND_RULES = [
  { capability: 'mergePr', test: (parts) => parts[0] === 'gh' && parts[1] === 'pr' && parts[2] === 'merge' },
  { capability: 'openPr', test: (parts) => parts[0] === 'gh' && parts[1] === 'pr' && parts[2] === 'create' },
  { capability: 'pushMain', test: (parts) => isGitPush(parts) && isMainRef(parts[3]) },
  { capability: 'pushBranch', test: (parts) => isGitPush(parts) },
  { capability: 'admin', test: (parts) => parts[0] === 'gh' && parts[1] === 'api' && isWriteMethod(parts) },
];

function isGitPush(parts) {
  return parts[0] === 'git' && parts[1] === 'push';
}

// git push <remote> <refspec>. Bare "main" expands to refs/heads/main, and a
// deletion refspec ":main" still targets main, so strip a leading colon first.
function isMainRef(refspec) {
  const ref = (refspec ?? '').replace(/^:/, '');
  return ref === 'main' || ref === 'refs/heads/main';
}

// gh api mutates only when it names an explicit HTTP method. The method comes
// from the next token after -X or --method, or from a --method=... form.
function isWriteMethod(parts) {
  const write = ['POST', 'PUT', 'PATCH', 'DELETE'];
  for (let index = 0; index < parts.length; index += 1) {
    const arg = parts[index];
    const value = arg === '-X' || arg === '--method' ? parts[index + 1] : arg.startsWith('--method=') ? arg.slice('--method='.length) : null;
    if (value && write.includes(value.toUpperCase())) return true;
  }
  return false;
}

// Split a shell command on whitespace and quotes. It is not a full shell parse,
// only enough to reach the command and its git refspec. A command with no match
// classifies to null, which decide treats as allowed.
export function classify(command) {
  const parts = tokenize(command);
  const rule = COMMAND_RULES.find((candidate) => candidate.test(parts));
  return rule ? rule.capability : null;
}

function tokenize(command) {
  return (command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [])
    .map((token) => token.replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

// A null classification needs no capability, so it is allowed at every level.
export function decide(level, command) {
  const capability = classify(command);
  return capability === null ? { capability, allowed: true } : { capability, allowed: allows(level, capability) };
}

export function selfTest() {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const fixture = {
    agentAccessDefaults: { standard: 'read', feature: 'propose', legacy: 'none' },
    repos: [
      { name: 'tier-default', tier: 'standard' },
      { name: 'feature-default', tier: 'feature' },
      { name: 'override', tier: 'feature', agentAccess: 'merge' },
      { name: 'legacy', tier: 'legacy' },
    ],
  };

  assert(resolveLevel(fixture, 'tier-default').level === 'read', 'tier default');
  assert(resolveLevel(fixture, 'feature-default').level === 'propose', 'feature default');
  const override = resolveLevel(fixture, 'override');
  assert(override.level === 'merge' && override.source === 'override', 'per-repo override');
  assert(resolveLevel(fixture, 'legacy').level === 'none', 'legacy default');
  const unknown = resolveLevel(fixture, 'not-listed');
  assert(unknown.level === FALLBACK_LEVEL && unknown.source === 'unknown', 'unknown repository');

  for (const level of LEVELS) assert(Array.isArray(CAPABILITIES[level]), `capabilities for ${level}`);
  assert(allows('none', 'read') === false, 'none denies read');
  assert(allows('read', 'read') && allows('read', 'pushBranch') === false, 'read capabilities');
  assert(allows('propose', 'pushBranch') && allows('propose', 'mergePr') === false, 'propose capabilities');
  assert(allows('merge', 'mergePr') && allows('merge', 'pushMain') === false, 'merge capabilities');
  assert(allows('full', 'pushMain') && allows('full', 'admin'), 'full capabilities');

  const table = [
    ['gh pr merge 1', 'mergePr'],
    ['gh pr create --title x', 'openPr'],
    ['git push origin main', 'pushMain'],
    ['git push upstream refs/heads/main', 'pushMain'],
    ['git push origin main --force-with-lease', 'pushMain'],
    ['git push origin feat/x', 'pushBranch'],
    ['git push origin :main', 'pushMain'],
    ['gh api repos/o/r --method PATCH', 'admin'],
    ['gh api -X DELETE repos/o/r', 'admin'],
    ['gh api --method=POST repos/o/r', 'admin'],
    ['gh api --method=delete repos/o/r', 'admin'],
    ['gh api -X get repos/o/r', null],
    ['gh api repos/o/r', null],
    ['gh api -X GET repos/o/r', null],
    ['gh pr view 1', null],
    ['npm test', null],
    ['git status', null],
    ['', null],
  ];
  for (const [command, expected] of table) {
    assert(classify(command) === expected, `classify ${JSON.stringify(command)} -> ${expected}`);
  }

  const allowed = [
    ['read', 'gh pr merge 1', false],
    ['read', 'gh pr create', false],
    ['propose', 'gh pr create', true],
    ['propose', 'gh pr merge 1', false],
    ['merge', 'gh pr merge 1', true],
    ['merge', 'git push origin main', false],
    ['full', 'git push origin main', true],
    ['none', 'npm test', true],
    ['read', 'gh api -X POST repos/o/r', false],
    ['full', 'gh api -X POST repos/o/r', true],
  ];
  for (const [level, command, expected] of allowed) {
    assert(decide(level, command).allowed === expected, `decide ${level} ${JSON.stringify(command)} -> ${expected}`);
  }
}

function parseArgs(argv) {
  const args = { repo: undefined, catalog: undefined, allows: undefined, command: undefined, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--catalog') args.catalog = argv[(index += 1)];
    else if (arg === '--allows') args.allows = argv[(index += 1)];
    else if (arg === '--command') args.command = argv[(index += 1)];
    else if (arg === '--json') args.json = true;
    else if (!args.repo) args.repo = arg;
  }
  return args;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    try {
      selfTest();
      process.stdout.write('agent-access: self-test ok\n');
    } catch (error) {
      process.stderr.write(`agent-access: self-test failed: ${error.message}\n`);
      process.exit(1);
    }
    return;
  }

  const args = parseArgs(argv);
  if (!args.repo) {
    process.stderr.write('usage: agent-access <repo-name> [--catalog <path>] [--json] [--allows <capability>] [--command "<shell command>"]\n');
    process.exit(2);
  }

  let catalog;
  try {
    catalog = args.catalog
      ? loadCatalog(args.catalog)
      : loadCommittedCatalog() ?? loadCatalog(DEFAULT_CATALOG);
  } catch {
    process.stderr.write('agent-access: cannot read the catalog, denying remote writes\n');
    process.exit(2);
  }

  const resolved = resolveLevel(catalog, args.repo);
  const capabilities = CAPABILITIES[resolved.level] ?? [];

  if (args.command !== undefined) {
    const { capability, allowed } = decide(resolved.level, args.command);
    if (args.json) process.stdout.write(`${JSON.stringify({ ...resolved, capability, allowed })}\n`);
    process.exit(allowed ? 0 : 1);
  }
  if (args.allows) process.exit(capabilities.includes(args.allows) ? 0 : 1);
  if (args.json) process.stdout.write(`${JSON.stringify({ ...resolved, capabilities })}\n`);
  else process.stdout.write(`${resolved.level}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
