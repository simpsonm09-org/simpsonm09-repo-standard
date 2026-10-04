#!/usr/bin/env node
// Validate the agent-access enforcement wiring end to end without pushing to the
// organization. Two layers are covered: the pure decision layer over a fixture
// catalog that maps the four fixture repositories to their levels, and the
// pre-push hook run as a subprocess against a throwaway clone.
//
// Usage:
//   node scripts/agent-access.test.mjs
//
// Exits 0 when every assertion holds and 1 on the first failure.

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMain } from './lib/proc.mjs';
import { CAPABILITIES, decide, loadCatalog, resolveLevel } from './agent-access.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const RESOLVER = join(HERE, 'agent-access.mjs');
const FIXTURE_CATALOG = join(HERE, 'fixtures', 'agent-access', 'repos.json');
const HOOK_TEMPLATE = join(ROOT, 'templates', 'hooks', 'pre-push');

// Each fixture repository and the exact level its catalog entry declares. The
// catalog is a fixture, so the live roster is never read.
const FIXTURES = [
  { repo: 'simpsonm09-fixture-nest', level: 'propose' },
  { repo: 'simpsonm09-fixture-go', level: 'full' },
  { repo: 'simpsonm09-fixture-rust', level: 'merge' },
  { repo: 'simpsonm09-fixture-dotnet', level: 'read' },
];

// Representative commands, the capability each needs, and whether the level
// grants it. A null capability is a command that reaches nothing governed, so
// every level allows it. `read` denies every remote write below.
const COMMANDS = [
  { command: 'git push origin feat/x', capability: 'pushBranch' },
  { command: 'git push origin main', capability: 'pushMain' },
  { command: 'gh pr create', capability: 'openPr' },
  { command: 'gh pr merge 1', capability: 'mergePr' },
  { command: 'gh api -X POST repos/o/r', capability: 'admin' },
  { command: 'git status', capability: null },
];

const EXPECTED = {
  propose: { read: true, pushBranch: true, pushMain: false, openPr: true, mergePr: false, admin: false },
  full: { read: true, pushBranch: true, pushMain: true, openPr: true, mergePr: true, admin: true },
  merge: { read: true, pushBranch: true, pushMain: false, openPr: true, mergePr: true, admin: false },
  read: { read: true, pushBranch: false, pushMain: false, openPr: false, mergePr: false, admin: false },
};

function makeAsserter() {
  let count = 0;
  const assert = (condition, message) => {
    count += 1;
    if (!condition) throw new Error(message);
  };
  return { assert, total: () => count };
}

// Level one: the fixture catalog resolves to the declared level, and the
// decision layer grants exactly the capabilities the level owns.
function testDecisionLayer(assert) {
  const catalog = loadCatalog(FIXTURE_CATALOG);
  for (const { repo, level } of FIXTURES) {
    const resolved = resolveLevel(catalog, repo);
    assert(resolved.level === level, `${repo} resolves to ${level}, got ${resolved.level}`);
    assert(resolved.source === 'override', `${repo} resolves from the per-repo override`);
    for (const { command, capability } of COMMANDS) {
      const { allowed } = decide(level, command);
      if (capability === null) {
        assert(allowed === true, `${repo} (${level}) allows ${JSON.stringify(command)}`);
      } else {
        const expected = EXPECTED[level][capability];
        assert(
          allowed === expected,
          `${level} ${allowed ? 'allows' : 'denies'} ${JSON.stringify(command)} (${capability}), expected ${expected}`,
        );
      }
    }
    for (const capability of CAPABILITIES[level]) {
      assert(EXPECTED[level][capability] !== undefined, `${level} capability ${capability} is covered`);
      assert(EXPECTED[level][capability] === true, `level ${level} grants ${capability}`);
    }
  }
  const read = resolveLevel(catalog, 'simpsonm09-fixture-dotnet').level;
  for (const { command, capability } of COMMANDS) {
    if (capability === null) continue;
    assert(decide(read, command).allowed === false, `read denies every remote write (${command})`);
  }
}

// Write a sibling resolver that the hook finds at
// <tmp>/simpsonm09-repo-standard/scripts/agent-access.mjs. It imports the real
// module by absolute path, but resolves against the fixture catalog, so the hook
// exercises the real capability table over the fixture levels without touching
// the live roster.
function writeFakeResolver(baseDir) {
  const shadow = join(baseDir, 'simpsonm09-repo-standard', 'scripts');
  mkdirSync(shadow, { recursive: true });
  const file = join(shadow, 'agent-access.mjs');
  const body = [
    `import { CAPABILITIES, loadCatalog, resolveLevel } from ${JSON.stringify(pathToFileURL(RESOLVER).href)};`,
    `const catalog = loadCatalog(${JSON.stringify(FIXTURE_CATALOG)});`,
    'const [repo, flag, capability] = process.argv.slice(2);',
    "if (flag !== '--allows') process.exit(2);",
    'const level = resolveLevel(catalog, repo).level;',
    'process.exit((CAPABILITIES[level] ?? []).includes(capability) ? 0 : 1);',
    '',
  ].join('\n');
  writeFileSync(file, body);
  return file;
}

function resolveShell() {
  if (process.platform !== 'win32') return 'sh';
  for (const candidate of [
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'sh.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'bin', 'sh.exe'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return 'sh';
}

// Level two: install the hook in a throwaway repository, invoke it with the
// remote arguments and the refs on stdin, and assert the exit code.
function testHook(assert) {
  const base = mkdtempSync(join(tmpdir(), 'agent-access-hook-'));
  try {
    const clone = join(base, 'fixture-clone');
    mkdirSync(clone, { recursive: true });
    const init = spawnSync('git', ['init', '-q', clone], { encoding: 'utf8' });
    assert(init.status === 0, `hook fixture: git init succeeds (${(init.stderr ?? '').trim()})`);
    const hook = join(clone, '.git', 'hooks', 'pre-push');
    writeFileSync(hook, readFileSync(HOOK_TEMPLATE));
    chmodSync(hook, 0o755);
    writeFakeResolver(base);
    const shell = resolveShell();
    const orgUrl = (repo) => `https://github.com/simpsonm09-org/${repo}.git`;
    const forkUrl = (repo) => `https://github.com/simpsonm09/${repo}.git`;
    const nest = orgUrl('simpsonm09-fixture-nest');
    const go = orgUrl('simpsonm09-fixture-go');
    const rust = orgUrl('simpsonm09-fixture-rust');
    const dotnet = orgUrl('simpsonm09-fixture-dotnet');

    const cases = [
      { name: 'propose allows a branch push', ref: 'refs/heads/feat/x', url: nest, exit: 0 },
      { name: 'propose denies a main push', ref: 'refs/heads/main', url: nest, exit: 1 },
      { name: 'full allows a main push', ref: 'refs/heads/main', url: go, exit: 0 },
      { name: 'full allows a tag push', ref: 'refs/tags/v1', url: go, exit: 0 },
      { name: 'merge denies a main push', ref: 'refs/heads/main', url: rust, exit: 1 },
      { name: 'merge denies a tag push', ref: 'refs/tags/v1', url: rust, exit: 1 },
      { name: 'read denies a branch push', ref: 'refs/heads/feat/x', url: dotnet, exit: 1 },
      { name: 'read denies a tag push', ref: 'refs/tags/v1', url: dotnet, exit: 1 },
      { name: 'a fork remote is out of scope', ref: 'refs/heads/main', url: forkUrl('simpsonm09-fixture-dotnet'), exit: 0 },
    ];

    for (const { name, ref, url, exit } of cases) {
      const zero = '0'.repeat(40);
      const stdin = `${ref} ${zero} ${ref} ${zero}\n`;
      const result = spawnSync(shell, [hook, 'origin', url], { cwd: clone, input: stdin, encoding: 'utf8' });
      assert(
        result.status === exit,
        `hook: ${name} exits ${exit}, got ${result.status} (${(result.stderr ?? '').trim()})`,
      );
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

// Run the suite and return an exit code, so the runner (verify.mjs) and the CLI
// share one path. It never calls process.exit, so an import cannot end the caller.
export function runTest() {
  const { assert, total } = makeAsserter();
  try {
    testDecisionLayer(assert);
    testHook(assert);
    process.stdout.write(`agent-access.test: ok (${total()} assertions)\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`agent-access.test: failed: ${error.message}\n`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exit(runTest());
